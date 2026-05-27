import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import OpenAI from 'openai'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import { enrichLastModelSegmentFromChatCompletions } from '@/providers/trace-enrichment'
import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'
import { ProviderError } from '@/providers/types'
import {
  calculateCost,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  trackForcedToolUsage,
} from '@/providers/utils'
import { createReadableStreamFromZhipuStream } from '@/providers/zhipu/utils'
import { executeTool } from '@/tools'

const logger = createLogger('ZhipuProvider')

function createProviderError(
  message: string,
  providerStartTimeISO: string,
  providerStartTime: number
): ProviderError {
  return new ProviderError(message, {
    startTime: providerStartTimeISO,
    endTime: new Date().toISOString(),
    duration: Date.now() - providerStartTime,
  })
}

export const zhipuProvider: ProviderConfig = {
  id: 'zhipu',
  name: 'Zhipu',
  description: "Zhipu's GLM models",
  version: '1.0.0',
  models: getProviderModels('zhipu'),
  defaultModel: getProviderDefaultModel('zhipu'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Zhipu')
    }

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      const zhipu = new OpenAI({
        apiKey: request.apiKey,
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      })

      const allMessages = []

      if (request.systemPrompt) {
        allMessages.push({
          role: 'system',
          content: request.systemPrompt,
        })
      }

      if (request.context) {
        allMessages.push({
          role: 'user',
          content: request.context,
        })
      }

      if (request.messages) {
        allMessages.push(...request.messages)
      }

      const tools = request.tools?.length
        ? request.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.id,
              description: tool.description,
              parameters: tool.parameters,
            },
          }))
        : undefined

      const payload: any = {
        model: request.model,
        messages: allMessages,
      }

      if (request.temperature !== undefined) payload.temperature = request.temperature
      if (request.maxTokens != null) payload.max_tokens = request.maxTokens
      if (request.responseFormat) {
        payload.response_format = {
          type: 'json_schema',
          json_schema: {
            name: request.responseFormat.name || 'response_schema',
            schema: request.responseFormat.schema || request.responseFormat,
            strict: request.responseFormat.strict !== false,
          },
        }
      }

      let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

      if (tools?.length) {
        preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'zhipu')
        const { tools: filteredTools, toolChoice } = preparedTools

        if (filteredTools?.length && toolChoice) {
          payload.tools = filteredTools
          payload.tool_choice = toolChoice
        }
      }

      if (request.stream && (!tools || tools.length === 0)) {
        logger.info('Using streaming response for Zhipu request (no tools)')

        const streamResponse = await zhipu.chat.completions.create(
          {
            ...payload,
            stream: true,
          },
          request.abortSignal ? { signal: request.abortSignal } : undefined
        )

        const streamingResult = {
          stream: createReadableStreamFromZhipuStream(streamResponse as any, (content, usage) => {
            streamingResult.execution.output.content = content
            streamingResult.execution.output.tokens = {
              input: usage.prompt_tokens,
              output: usage.completion_tokens,
              total: usage.total_tokens,
            }

            const costResult = calculateCost(
              request.model,
              usage.prompt_tokens,
              usage.completion_tokens
            )
            streamingResult.execution.output.cost = {
              input: costResult.input,
              output: costResult.output,
              total: costResult.total,
            }
          }),
          execution: {
            success: true,
            output: {
              content: '',
              model: request.model,
              tokens: { input: 0, output: 0, total: 0 },
              toolCalls: undefined,
              providerTiming: {
                startTime: providerStartTimeISO,
                endTime: new Date().toISOString(),
                duration: Date.now() - providerStartTime,
                timeSegments: [
                  {
                    type: 'model',
                    name: request.model,
                    startTime: providerStartTime,
                    endTime: Date.now(),
                    duration: Date.now() - providerStartTime,
                  },
                ],
              },
              cost: { input: 0, output: 0, total: 0 },
            },
            logs: [],
            metadata: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
            },
            isStreaming: true,
          },
        } as StreamingExecution

        return streamingResult
      }

      let currentResponse = await zhipu.chat.completions.create(
        payload,
        request.abortSignal ? { signal: request.abortSignal } : undefined
      )

      const forcedTools = preparedTools?.forcedTools || []
      let usedForcedTools: string[] = []
      const toolResults: any[] = []
      const allToolCalls: any[] = []
      const allTimeSegments: TimeSegment[] = []

      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        const choice = currentResponse.choices?.[0]
        const toolCalls = choice?.message?.tool_calls || []

        const providerSegment: TimeSegment = {
          type: 'model',
          name: request.model,
          startTime: providerStartTime,
          endTime: Date.now(),
          duration: Date.now() - providerStartTime,
          tokens: currentResponse.usage
            ? {
                input: currentResponse.usage.prompt_tokens,
                output: currentResponse.usage.completion_tokens,
                total: currentResponse.usage.total_tokens,
              }
            : undefined,
        }

        allTimeSegments.push(providerSegment)
        enrichLastModelSegmentFromChatCompletions(
          allTimeSegments,
          currentResponse,
          currentResponse.choices[0]?.message?.tool_calls ?? undefined,
          {
            model: request.model,
            provider: 'zhipu',
          }
        )

        if (!toolCalls.length || !request.tools?.length) {
          const content = choice?.message?.content || ''
          const tokens = currentResponse.usage
            ? {
                input: currentResponse.usage.prompt_tokens,
                output: currentResponse.usage.completion_tokens,
                total: currentResponse.usage.total_tokens,
              }
            : undefined

          const cost = tokens
            ? calculateCost(request.model, tokens.input || 0, tokens.output || 0)
            : undefined

          return {
            content,
            model: request.model,
            tokens,
            cost,
            toolCalls: allToolCalls,
            toolResults,
            timing: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
              timeSegments: allTimeSegments,
            },
          }
        }

        const assistantMessage = choice.message
        const messageHistory = [...allMessages, assistantMessage]

        for (const toolCall of toolCalls) {
          const toolCallId = toolCall.id
          const toolName = toolCall.function.name
          const providerTool = request.tools.find((tool) => tool.id === toolName)

          if (!providerTool) {
            throw createProviderError(
              `Tool ${toolName} not found in request`,
              providerStartTimeISO,
              providerStartTime
            )
          }

          const preparedExecution = prepareToolExecution(
            providerTool,
            JSON.parse(toolCall.function.arguments || '{}'),
            {
              workflowId: request.workflowId,
              workspaceId: request.workspaceId,
              chatId: request.chatId,
              userId: request.userId,
              blockData: request.blockData,
              environmentVariables: request.environmentVariables,
              workflowVariables: request.workflowVariables,
              blockNameMapping: request.blockNameMapping,
              isDeployedContext: request.isDeployedContext,
              callChain: request.callChain,
            }
          )

          const startedAt = Date.now()
          const result = await executeTool(
            providerTool.id,
            preparedExecution.executionParams,
            false
          )
          const endedAt = Date.now()

          const toolSegment: TimeSegment = {
            type: 'tool',
            name: toolName,
            startTime: startedAt,
            endTime: endedAt,
            duration: endedAt - startedAt,
          }
          allTimeSegments.push(toolSegment)

          toolResults.push(result)
          allToolCalls.push({
            id: toolCallId,
            name: toolName,
            arguments: JSON.parse(toolCall.function.arguments || '{}'),
            result,
          })

          const trackingResult = trackForcedToolUsage(
            toolCalls,
            payload.tool_choice,
            logger,
            'zhipu',
            forcedTools,
            usedForcedTools
          )
          usedForcedTools = trackingResult.usedForcedTools
          if (trackingResult.nextToolChoice !== undefined) {
            payload.tool_choice = trackingResult.nextToolChoice
          }

          messageHistory.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: JSON.stringify(result.output ?? result),
          })
        }

        currentResponse = await zhipu.chat.completions.create(
          {
            ...payload,
            messages: messageHistory as any,
          },
          request.abortSignal ? { signal: request.abortSignal } : undefined
        )
      }

      throw createProviderError(
        'Maximum tool iterations reached',
        providerStartTimeISO,
        providerStartTime
      )
    } catch (error) {
      logger.error('Zhipu request failed', {
        model: request.model,
        error: toError(error).message,
      })
      if (error instanceof ProviderError) {
        throw error
      }
      throw createProviderError(toError(error).message, providerStartTimeISO, providerStartTime)
    }
  },
}
