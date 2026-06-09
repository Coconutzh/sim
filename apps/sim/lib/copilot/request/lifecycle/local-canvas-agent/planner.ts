import { z } from 'zod'
import {
  loadCanvasSnapshot,
  readCanvasNodeDetail,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context'
import { buildTokenAwareLocalAgentContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/context-manager'
import {
  classifyLocalCanvasUserIntent,
  type LocalCanvasIntentDecision,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/intent'
import { executeLocalAgentModelRequest } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/config'
import { buildLocalAgentRoleSystemPrompt } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/prompts'
import type {
  CanvasNodeDetail,
  CanvasSnapshot,
  LocalAgentContext,
  LocalAgentPlan,
  LocalAgentToolName,
  LocalCanvasNodeKind,
  LocalCanvasPatch,
  LocalCanvasToolName,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const localCanvasUserIntentSchema = z.enum([
  'consult_design',
  'inspect_canvas',
  'propose_plan',
  'mutate_canvas',
  'generate_output',
  'non_canvas',
])
const localCanvasMutationPolicySchema = z.enum(['read_only', 'propose_only', 'allow_mutation'])
const localCanvasReadPolicySchema = z.enum(['none', 'optional', 'required'])

const plannerResponseSchema = z.object({
  goal: z.string().catch(''),
  risk: z.enum(['low', 'medium', 'high']).catch('low'),
  userIntent: localCanvasUserIntentSchema.optional(),
  mutationPolicy: localCanvasMutationPolicySchema.optional(),
  canvasReadPolicy: localCanvasReadPolicySchema.optional(),
  intentConfidence: z.number().min(0).max(1).optional(),
  intentEvidence: z.array(z.string()).optional(),
  requiresUserConfirmation: z.boolean().optional(),
  requiresClarification: z.boolean().catch(false),
  clarificationQuestion: z.string().optional(),
  steps: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        intent: z.enum(['inspect', 'create', 'update', 'connect', 'generate', 'verify', 'answer']),
        toolHints: z.array(
          z.enum([
            'canvas.read_summary',
            'canvas.read_node',
            'canvas.read_selected_nodes',
            'canvas.search_nodes',
            'canvas.inspect_schema',
            'canvas.propose_patch',
            'canvas.apply_patch',
            'canvas.verify_patch',
            'canvas.generate_node_output',
            'read_file',
            'search_workspace',
            'materialize_file',
            'query_knowledge',
            'search_docs',
            'read_tasks',
            'update_task_result',
            'submit_task_result',
          ])
        ),
        expectedObservation: z.string(),
      })
    )
    .catch([]),
  successCriteria: z.array(z.string()).catch([]),
  patch: z.unknown().optional(),
  generateNodeIds: z.array(z.string()).optional(),
  readNodeIds: z.array(z.string()).optional(),
})

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/)
    return match ? JSON.parse(match[0]) : null
  }
}

function includesAny(message: string, terms: string[]): boolean {
  const normalized = message.toLowerCase()
  return terms.some((term) => normalized.includes(term.toLowerCase()))
}

function isMutationToolHint(toolName: LocalAgentToolName): boolean {
  return (
    toolName === 'canvas.apply_patch' ||
    toolName === 'canvas.generate_node_output' ||
    toolName === 'materialize_file' ||
    toolName === 'update_task_result' ||
    toolName === 'submit_task_result'
  )
}

function filterToolHintsByPolicy(
  toolHints: LocalAgentToolName[],
  decision: LocalCanvasIntentDecision
): LocalAgentToolName[] {
  if (decision.mutationPolicy === 'allow_mutation') return toolHints
  return toolHints.filter((toolName) => {
    if (isMutationToolHint(toolName)) return false
    if (decision.mutationPolicy === 'read_only' && toolName === 'canvas.propose_patch') {
      return false
    }
    if (decision.mutationPolicy !== 'allow_mutation' && toolName === 'canvas.verify_patch') {
      return false
    }
    if (
      decision.canvasReadPolicy === 'none' &&
      (toolName === 'canvas.read_summary' ||
        toolName === 'canvas.read_node' ||
        toolName === 'canvas.read_selected_nodes' ||
        toolName === 'canvas.search_nodes' ||
        toolName === 'canvas.inspect_schema')
    ) {
      return false
    }
    return true
  })
}

function getMutationPolicyRank(policy: LocalCanvasIntentDecision['mutationPolicy']): number {
  if (policy === 'read_only') return 0
  if (policy === 'propose_only') return 1
  return 2
}

function getReadPolicyRank(policy: LocalCanvasIntentDecision['canvasReadPolicy']): number {
  if (policy === 'none') return 0
  if (policy === 'optional') return 1
  return 2
}

function chooseStricterMutationPolicy(
  planPolicy: LocalCanvasIntentDecision['mutationPolicy'] | undefined,
  decisionPolicy: LocalCanvasIntentDecision['mutationPolicy']
): LocalCanvasIntentDecision['mutationPolicy'] {
  if (!planPolicy) return decisionPolicy
  return getMutationPolicyRank(planPolicy) < getMutationPolicyRank(decisionPolicy)
    ? planPolicy
    : decisionPolicy
}

function chooseStricterReadPolicy(
  planPolicy: LocalCanvasIntentDecision['canvasReadPolicy'] | undefined,
  decisionPolicy: LocalCanvasIntentDecision['canvasReadPolicy']
): LocalCanvasIntentDecision['canvasReadPolicy'] {
  if (!planPolicy) return decisionPolicy
  return getReadPolicyRank(planPolicy) < getReadPolicyRank(decisionPolicy)
    ? planPolicy
    : decisionPolicy
}

function applyIntentPolicy(
  plan: LocalAgentPlan,
  decision: LocalCanvasIntentDecision
): LocalAgentPlan {
  const mutationPolicy = chooseStricterMutationPolicy(plan.mutationPolicy, decision.mutationPolicy)
  const canvasReadPolicy = chooseStricterReadPolicy(
    plan.canvasReadPolicy,
    decision.canvasReadPolicy
  )
  const requiresUserConfirmation =
    decision.requiresUserConfirmation ||
    plan.requiresUserConfirmation ||
    mutationPolicy === 'propose_only'
  const basePlan: LocalAgentPlan = {
    ...plan,
    userIntent: decision.userIntent,
    mutationPolicy,
    canvasReadPolicy,
    intentConfidence: decision.confidence,
    intentEvidence: [...new Set([...(decision.evidence ?? []), ...(plan.intentEvidence ?? [])])],
    requiresUserConfirmation,
  }

  if (mutationPolicy === 'allow_mutation') return basePlan

  const policyDecision: LocalCanvasIntentDecision = {
    ...decision,
    userIntent: decision.userIntent,
    mutationPolicy,
    canvasReadPolicy,
  }
  const steps = basePlan.steps
    .map((step) => ({
      ...step,
      toolHints: filterToolHintsByPolicy(step.toolHints, policyDecision),
    }))
    .filter((step) => step.toolHints.length > 0 || step.intent === 'answer')

  if (mutationPolicy === 'read_only') {
    return {
      ...basePlan,
      patch: undefined,
      generateNodeIds: undefined,
      steps,
    }
  }

  const hasProposeStep = steps.some((step) => step.toolHints.includes('canvas.propose_patch'))
  return {
    ...basePlan,
    generateNodeIds: undefined,
    steps:
      basePlan.patch && !hasProposeStep
        ? [
            ...steps,
            {
              id: 'propose_patch',
              title: 'Prepare canvas change proposal',
              intent: 'update',
              toolHints: ['canvas.propose_patch'],
              expectedObservation: 'Canvas patch is validated as a proposal only',
            },
          ]
        : steps,
  }
}

const REQUESTED_KIND_TERMS: Array<{ kind: LocalCanvasNodeKind; terms: string[] }> = [
  { kind: 'image', terms: ['图片', '图像', '视觉', '主视觉', 'image'] },
  { kind: 'video', terms: ['视频', '镜头', '画面动态', 'video'] },
  { kind: 'audio', terms: ['音频', '音乐', '配乐', '声音', 'audio', 'music'] },
  { kind: 'text', terms: ['文本', '文案', '脚本', '口播', 'caption', 'copy', 'text'] },
]

function inferRequestedKinds(message: string): LocalCanvasNodeKind[] {
  const normalized = message.toLowerCase()
  return REQUESTED_KIND_TERMS.map(({ kind, terms }) => {
    const indexes = terms
      .map((term) => normalized.indexOf(term.toLowerCase()))
      .filter((index) => index >= 0)
    return indexes.length ? { kind, index: Math.min(...indexes) } : null
  })
    .filter((item): item is { kind: LocalCanvasNodeKind; index: number } => Boolean(item))
    .sort((a, b) => a.index - b.index)
    .map((item) => item.kind)
}

function inferTextCreateAnchorKinds(message: string): LocalCanvasNodeKind[] {
  const requested = inferRequestedKinds(message).filter((kind) => kind !== 'text')
  return requested.length ? requested : ['text', 'image', 'video', 'audio']
}

function resolveTargetSelectedNode(params: {
  snapshot: CanvasSnapshot
  selectedNodeIds: string[]
  message: string
  preferredKinds?: LocalCanvasNodeKind[]
}): string | undefined {
  const selectedSet = new Set(params.selectedNodeIds)
  const selectedNodes = params.snapshot.nodes.filter((node) => selectedSet.has(node.id))
  const preferredKinds = params.preferredKinds ?? inferRequestedKinds(params.message)
  for (const kind of preferredKinds) {
    const matched = selectedNodes.find((node) => node.kind === kind)
    if (matched) return matched.id
  }
  return params.selectedNodeIds[0]
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function textToContentHtml(value: string): string {
  const paragraphs = value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  return paragraphs.length
    ? paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')
    : '<p></p>'
}

function buildDeterministicRewrite(params: { currentText: string }): string {
  const source = params.currentText.trim()
  const core = source
    .split(/[。！？!?]/)
    .map((item) => item.trim())
    .find((item) => item.length > 8 && !item.includes('方案'))
  return [
    core
      ? `${core}，现在用更直接、更有节奏的方式说给年轻用户听。`
      : '把灵感打开，用更轻、更快、更有画面感的方式进入主题。',
    '别等以后，就现在出发。把体验、效率和态度一次拉满，让每一次点击都更有爽感。',
    '适合短视频口播：节奏更快，表达更短，重点更清楚。',
  ].join('\n')
}

function stripCanvasCommandLanguage(message: string): string {
  return message
    .replace(/^(请|帮我|麻烦)?\s*/g, '')
    .replace(/(?:根据|基于)?当前主题[，,:：]*/g, '')
    .replace(/(?:创建|新建|新增|生成|做|搭建|建立|设计)\s*(?:一条|一个|一组|用于)?/g, '')
    .replace(/用于/g, '')
    .replace(
      /(?:内容链|工作流|节点|并按生产顺序连接|按生产顺序|从左到右排好|连接|排好|包含|包括|四个|三个|两个|一组)/g,
      ''
    )
    .replace(/(?:脚本|文案|主视觉|产品主图|配乐|音频)(?:、|，|和|及|与)?/g, ' ')
    .replace(/[：:，,。；;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface CreativeBrief {
  platform: string
  subject: string
  theme: string
  audience: string
  style: string
}

function cleanCreativeSubject(value: string): string {
  return stripCanvasCommandLanguage(value)
    .replace(/^(?:以|把|将|用|围绕|关于|根据|基于)\s*/g, '')
    .replace(/(?:为主题|为主线|为核心|主题|主线|核心)$/g, '')
    .replace(/(?:小红书|xiaohongshu|rednote|抖音|douyin|tiktok)\s*(?:的|上|平台)?/gi, '')
    .replace(/(?:短视频|视频|内容|素材|创意|策划|方案)$/g, '')
    .replace(/[“”"'‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractCreativeSubject(source: string): string | null {
  const patterns = [
    /(?:以|把|将)\s*(.{1,50}?)(?:为主题|为主线|为核心)/,
    /(?:根据|基于)\s*(.{1,50}?)(?:主题|主线|核心)/,
    /(?:围绕|关于)\s*(.{1,50}?)(?:做|创作|策划|生成|创建|设计|$)/,
    /(?:主题|主线|核心)\s*(?:是|为|：|:)?\s*(.{1,50})/,
  ] as const

  for (const pattern of patterns) {
    const candidate = cleanCreativeSubject(source.match(pattern)?.[1] ?? '')
    if (candidate.length >= 2) return candidate.slice(0, 40)
  }

  const fallback = cleanCreativeSubject(source)
  return fallback.length >= 2 ? fallback.slice(0, 40) : null
}

function inferContentChainTheme(context: LocalAgentContext): CreativeBrief {
  const message = context.message
  const memoryGoal = context.memory?.taskState.goal?.trim() ?? ''
  const memorySummary = context.memory?.conversationSummary?.trim() ?? ''
  const cleaned = stripCanvasCommandLanguage(message)
  const source =
    [cleaned, memoryGoal, memorySummary]
      .map((item) => stripCanvasCommandLanguage(item))
      .find((item) => item.length > 0) ?? '当前主题'
  const platform = /小红书|xiaohongshu|rednote/i.test(source)
    ? '小红书'
    : /抖音|douyin|tiktok/i.test(source)
      ? '短视频平台'
      : '短视频'
  const subject = extractCreativeSubject(source) ?? '当前主题'
  const theme = subject === '当前主题' ? source : subject
  return {
    platform,
    subject,
    theme,
    audience: /年轻|学生|宝妈|职场|新手|亲子/i.test(source)
      ? (source.match(/年轻|学生|宝妈|职场|新手|亲子/i)?.[0] ?? '目标用户')
      : platform === '小红书'
        ? '小红书用户'
        : '目标用户',
    style: /治愈|种草|剧情|教程|高级|可爱|科技|轻快/i.test(source)
      ? (source.match(/治愈|种草|剧情|教程|高级|可爱|科技|轻快/i)?.[0] ?? '清晰')
      : /小猫|猫咪|猫/i.test(source)
        ? '治愈可爱'
        : '清晰有记忆点',
  }
}

function sanitizePromptField(value: string): string {
  return value
    .replace(/(?:创建|新建|新增|生成|做|搭建|建立|设计).{0,8}(?:内容链|工作流|节点)/g, '')
    .replace(/(?:从左到右|按生产顺序).{0,8}(?:排好|连接|排列)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeContentChainFields(fields: {
  text: Record<string, unknown>
  image: Record<string, unknown>
  video: Record<string, unknown>
  audio: Record<string, unknown>
}): typeof fields {
  return {
    text: {
      ...fields.text,
      aiPrompt:
        typeof fields.text.aiPrompt === 'string'
          ? sanitizePromptField(fields.text.aiPrompt)
          : fields.text.aiPrompt,
    },
    image: {
      ...fields.image,
      aiPrompt:
        typeof fields.image.aiPrompt === 'string'
          ? sanitizePromptField(fields.image.aiPrompt)
          : fields.image.aiPrompt,
    },
    video: {
      ...fields.video,
      videoPrompt:
        typeof fields.video.videoPrompt === 'string'
          ? sanitizePromptField(fields.video.videoPrompt)
          : fields.video.videoPrompt,
    },
    audio: {
      ...fields.audio,
      audioPrompt:
        typeof fields.audio.audioPrompt === 'string'
          ? sanitizePromptField(fields.audio.audioPrompt)
          : fields.audio.audioPrompt,
    },
  }
}

function buildContentChainFields(context: LocalAgentContext): {
  text: Record<string, unknown>
  image: Record<string, unknown>
  video: Record<string, unknown>
  audio: Record<string, unknown>
} {
  const { platform, subject, theme, audience, style } = inferContentChainTheme(context)
  const scriptText = [
    `开场：用一个有画面感的问题切入 ${subject}，先抓住 ${audience} 的注意力。`,
    `中段：围绕 ${theme} 展开核心卖点或故事冲突，保持 ${style} 的短句节奏。`,
    '收尾：给出明确行动或情绪落点，方便继续生成主视觉、视频和配乐。',
  ].join('\n')
  return sanitizeContentChainFields({
    text: {
      aiPrompt: `为${platform}短视频策划一段围绕“${theme}”的脚本，面向${audience}，风格${style}，要求口语化、有镜头感、适合继续生成图片、视频和配乐。`,
      contentHtml: textToContentHtml(scriptText),
    },
    image: {
      aiPrompt: `${platform}短视频主视觉，主题“${theme}”，主体突出${subject}，风格${style}，明亮干净，强情绪钩子，竖屏构图，适合作为视频第一帧。`,
      aiAspectRatio: '9:16',
    },
    video: {
      videoPrompt: `${platform}短视频镜头，围绕“${theme}”做 5 秒动态展示：开场快速吸引注意，中段展示${subject}的关键细节，结尾留出标题或行动引导空间。`,
      videoParameters: {
        duration: 5,
        resolution: '720P',
      },
    },
    audio: {
      audioPrompt: `${platform}短视频配乐，围绕“${theme}”营造${style}且有记忆点的节奏，适合种草、治愈或产品展示氛围。`,
    },
  })
}

function buildContentChainPlan(context: LocalAgentContext): LocalCanvasPatch {
  const fields = buildContentChainFields(context)
  return {
    reason: 'Create a complete content chain from the current canvas request',
    operations: [
      {
        type: 'create_node',
        clientNodeId: 'new_script',
        kind: 'text',
        title: '短视频脚本',
        position: { x: 0, y: 0 },
        fields: fields.text,
      },
      {
        type: 'create_node',
        clientNodeId: 'new_image',
        kind: 'image',
        title: '视觉画面',
        position: { x: 360, y: 0 },
        fields: fields.image,
      },
      {
        type: 'create_node',
        clientNodeId: 'new_video',
        kind: 'video',
        title: '视频节点',
        position: { x: 720, y: 0 },
        fields: fields.video,
      },
      {
        type: 'create_node',
        clientNodeId: 'new_audio',
        kind: 'audio',
        title: '音频节点',
        position: { x: 1080, y: 0 },
        fields: fields.audio,
      },
      { type: 'connect', sourceNodeId: 'new_script', targetNodeId: 'new_image' },
      { type: 'connect', sourceNodeId: 'new_image', targetNodeId: 'new_video' },
      { type: 'connect', sourceNodeId: 'new_video', targetNodeId: 'new_audio' },
    ],
  }
}

function hasPersonaLeak(value: string): boolean {
  return /(?:我是|作为|这里是).{0,18}(?:agent|代理|助手|角色|负责人|统筹|导演)|(?:各位|各组|团队|成员).{0,18}(?:注意|同步|请看|请确认|大家)|(?:以|用).{0,12}(?:agent|代理|角色|负责人|统筹|导演).{0,12}(?:身份|口吻|视角)/i.test(
    value
  )
}

function hasRewriteInstructionLeak(value: string): boolean {
  const normalized = value.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!normalized) return false

  return (
    /\b(?:do not|don't|return only|just plain text|no markdown|no json|line breaks|system prompt|user request|current selected text)\b/.test(
      normalized
    ) ||
    (/\b(?:markdown|json|formatting|format)\b/.test(normalized) && /[`*_#{}[\]]/.test(normalized))
  )
}

async function rewriteSelectedTextContent(params: {
  context: LocalAgentContext
  snapshot: CanvasSnapshot
  nodeId: string
}): Promise<string> {
  const detail = readCanvasNodeDetail(
    params.snapshot,
    params.nodeId,
    params.context.selectedNodeIds
  )
  const currentText = detail?.textContent?.trim() || detail?.summary || ''
  try {
    const response = await executeLocalAgentModelRequest(params.context.model, {
      role: 'actor',
      workspaceId: params.context.workspaceId,
      systemPrompt: [
        'You rewrite selected canvas text for the user.',
        'Return only the rewritten copy in Chinese. Do not introduce yourself, do not mention any agent role, and do not include JSON or markdown.',
      ].join('\n'),
      prompt: [
        `User request:\n${params.context.message}`,
        `Current selected text:\n${currentText}`,
        'Rewrite the selected text so it satisfies the request. Keep it suitable for writing back to a text canvas node.',
      ].join('\n\n'),
      temperature: 0.35,
      maxTokens: 1200,
      abortSignal: params.context.options.abortSignal,
    })
    const rewritten = response.content?.trim()
    if (rewritten && !hasPersonaLeak(rewritten) && !hasRewriteInstructionLeak(rewritten)) {
      return rewritten
    }
  } catch {}
  return buildDeterministicRewrite({ currentText })
}

function parseDurationSeconds(message: string): number | null {
  const match = message.match(/(\d+(?:\.\d+)?)\s*(?:秒|s|sec|second)/i)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

function extractFieldInstruction(message: string): string {
  const cleaned = message
    .replace(
      /把\s*(?:这个|当前|选中(?:的)?)?\s*(?:图片|图像|视频|音频|音乐|配乐|节点)?\s*(?:节点)?\s*(?:的)?/g,
      ''
    )
    .replace(/(?:提示词|prompt|视频时长|时长|音乐方向|音频方向)\s*/gi, '')
    .replace(/改成|修改成|调整成|优化成|改为|修改为|调整为|优化为/g, '')
    .replace(/^[，,。.\s]+/, '')
    .trim()
  return cleaned || message.trim()
}

function mergePromptInstruction(existingPrompt: string, instruction: string): string {
  const normalizedInstruction = instruction.trim()
  if (!existingPrompt.trim()) return normalizedInstruction
  if (!normalizedInstruction || existingPrompt.includes(normalizedInstruction))
    return existingPrompt
  return [existingPrompt.trim(), normalizedInstruction].join('\n')
}

function summarizeDetailSubject(detail: CanvasNodeDetail | null): string {
  const source =
    detail?.summary?.trim() || detail?.textContent?.trim() || detail?.name?.trim() || '选中节点'
  return source.replace(/\s+/g, ' ').slice(0, 80)
}

function extractSelectedTextDraftFocus(message: string): string {
  const focus = stripCanvasCommandLanguage(extractFieldInstruction(message))
    .replace(
      /(?:选中(?:的)?|当前|这个|节点|图片|图像|视频|音频|音乐|配乐|后面|前面|接到|连接|加一个|加上|写一段|补(?:一段)?|文案|口播|文本|copy|caption)/gi,
      ' '
    )
    .replace(/[，,。.\s]+/g, ' ')
    .replace(/^(?:在|的|和|并|到|把|将|一段)\s*/g, '')
    .replace(/\s*(?:在|的|和|并|到|把|将|一段)$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const meaningful = focus.replace(/[的在和并到把将一段\s]/g, '')
  return meaningful.length >= 2 ? focus : '短视频口播'
}

function buildSelectedTextNodeFields(params: {
  message: string
  detail: CanvasNodeDetail | null
}): Record<string, unknown> {
  const subject = summarizeDetailSubject(params.detail)
  const focus = extractSelectedTextDraftFocus(params.message)
  const draft = [
    `开场：承接“${subject}”，先给出一个容易理解的钩子。`,
    `中段：围绕${focus}展开 2-3 个具体表达，语气自然、有画面感。`,
    '收尾：给出明确行动或情绪落点，方便继续连接下游视觉、视频或配乐节点。',
  ].join('\n')
  return {
    aiPrompt: `基于选中${params.detail?.kind ?? 'content'}节点“${subject}”补充一段${focus}，适合写入文本节点。`,
    contentHtml: textToContentHtml(draft),
  }
}

function getNodePosition(snapshot: CanvasSnapshot, nodeId: string): { x: number; y: number } {
  return snapshot.nodes.find((node) => node.id === nodeId)?.position ?? { x: 0, y: 0 }
}

function isSelectionScopedUpdateRequest(message: string): boolean {
  return (
    includesAny(message, ['选中', '当前节点', '这个节点', 'this node', 'selected']) &&
    isUpdateRequest(message)
  )
}

function isUpdateRequest(message: string): boolean {
  return includesAny(message, ['修改', '改成', '优化', 'rewrite', 'update', '调整'])
}

function isSelectionScopedReadRequest(message: string): boolean {
  return includesAny(message, ['选中', '当前节点', '这个节点', 'this node', 'selected'])
}

function isSelectedGenerationRequest(message: string): boolean {
  if (includesAny(message, ['检查', '判断', '分析', '是否完整', '设置是否完整'])) return false
  return (
    includesAny(message, ['生成', 'generate']) &&
    includesAny(message, ['这个节点', '选中', '当前节点', '写回', 'aiPrompt', 'prompt', '内容'])
  )
}

function isSelectionScopedCreateTextRequest(message: string): boolean {
  return (
    includesAny(message, ['文案', 'copy', 'caption', '口播', '文本']) &&
    includesAny(message, [
      '补',
      '创建',
      '新建',
      '加一个',
      '加上',
      '写一段',
      '接到',
      '连接',
      '前面',
      '后面',
      '后续',
      '结尾',
      'before',
      'after',
      'create',
    ]) &&
    !includesAny(message, ['说明它', '说明一下', '分析', '检查', '判断', '适合接什么'])
  )
}

function wantsBeforeSelectedNode(message: string): boolean {
  return includesAny(message, ['前面', '前置', '之前', '上游', 'before'])
}

function isSearchRequest(message: string): boolean {
  return includesAny(message, ['找到', '搜索', '包含', '含有', '定位', 'search'])
}

function isConnectionReasoningRequest(message: string): boolean {
  return includesAny(message, ['下游', '上游', '后面', '前面', '连接到了', '连到', '连接关系'])
}

function isIsolatedNodeRequest(message: string): boolean {
  return includesAny(message, ['孤立', '未连接', '没有连接', '没连接', 'isolated'])
}

function isDestructiveCanvasRequest(message: string): boolean {
  return (
    includesAny(message, ['删除', '删掉', '清空', '移除', 'delete', 'remove', 'clear']) &&
    includesAny(message, ['所有', '全部', '整个', '全都', 'all', 'everything', '画布'])
  )
}

function inferContextToolHints(context: LocalAgentContext): LocalAgentToolName[] {
  const message = context.message
  const hints: LocalAgentToolName[] = []
  if (
    includesAny(message, [
      '附件',
      '文件',
      '上传',
      'brief',
      'pdf',
      'doc',
      'file',
      '@file',
      '@文件',
    ]) ||
    context.attachments?.length
  ) {
    hints.push('read_file')
  }
  if (
    includesAny(message, [
      '保存附件',
      '保存文件',
      '持久化文件',
      '导入文件',
      '导入 workflow',
      '导入工作流',
      'materialize',
      'import file',
      'save file',
    ])
  ) {
    hints.push('materialize_file')
  }
  if (
    includesAny(message, [
      '知识库',
      '知识',
      '规范',
      '品牌规范',
      'brand guide',
      'knowledge',
      '@knowledge',
    ])
  ) {
    hints.push('query_knowledge')
  }
  if (
    includesAny(message, ['文档', '说明文档', '帮助', '怎么用', 'docs', 'documentation', '@docs'])
  ) {
    hints.push('search_docs')
  }
  if (
    includesAny(message, ['提交任务', '提交结果', '提交当前节点', 'submit task', 'submit result'])
  ) {
    hints.push('submit_task_result')
  } else if (includesAny(message, ['更新任务', '开始任务', '标记任务', 'update task'])) {
    hints.push('update_task_result')
  }
  if (
    includesAny(message, [
      '任务',
      '待办',
      '提交',
      '审核',
      '生产任务',
      'production task',
      'task',
      'todo',
    ])
  ) {
    hints.push('read_tasks')
  }
  if (includesAny(message, ['工作区', '项目里', '有哪些文件', 'workspace', 'inventory', '资源'])) {
    hints.push('search_workspace')
  }
  return [...new Set(hints)]
}

function buildContextInspectionPlan(
  context: LocalAgentContext,
  toolHints: LocalAgentToolName[]
): LocalAgentPlan {
  const hasContextMutation = toolHints.some(
    (toolHint) =>
      toolHint === 'materialize_file' ||
      toolHint === 'update_task_result' ||
      toolHint === 'submit_task_result'
  )
  return {
    goal: context.message || 'Read local agent context',
    risk: hasContextMutation ? 'medium' : 'low',
    requiresClarification: false,
    steps: [
      {
        id: 'inspect_context',
        title: hasContextMutation
          ? 'Execute requested local context action'
          : 'Read requested local context',
        intent: hasContextMutation ? 'update' : 'inspect',
        toolHints,
        expectedObservation:
          'Requested file, workspace, knowledge, docs, or task context action is completed',
      },
      {
        id: 'answer_context',
        title: 'Answer from local context',
        intent: 'answer',
        toolHints: [],
        expectedObservation: 'User receives a concise answer from the retrieved context',
      },
    ],
    successCriteria: [
      hasContextMutation
        ? 'Execute the explicitly requested local context action without modifying the canvas'
        : 'Answer using retrieved local context without modifying the canvas',
    ],
  }
}

function buildConsultDesignPlan(
  context: LocalAgentContext,
  decision: LocalCanvasIntentDecision
): LocalAgentPlan {
  return applyIntentPolicy(
    {
      goal: context.message || 'Discuss a canvas workflow design before making changes',
      risk: 'low',
      requiresClarification: false,
      steps: [
        {
          id: 'consult_design',
          title: 'Discuss workflow design without changing canvas',
          intent: 'answer',
          toolHints: [],
          expectedObservation: 'User receives a design discussion and open questions',
        },
      ],
      successCriteria: [
        'Discuss the workflow design without reading or modifying the canvas unless explicitly needed',
      ],
    },
    decision
  )
}

function buildProposeOnlyPlan(params: {
  context: LocalAgentContext
  decision: LocalCanvasIntentDecision
  patch?: LocalCanvasPatch
}): LocalAgentPlan {
  return applyIntentPolicy(
    {
      goal: params.context.message || 'Propose canvas changes without applying them',
      risk: params.patch ? 'medium' : 'low',
      requiresClarification: false,
      steps: [
        ...(params.decision.canvasReadPolicy === 'required'
          ? [
              {
                id: 'inspect_for_proposal',
                title: 'Read canvas context for proposal',
                intent: 'inspect' as const,
                toolHints: [
                  params.context.selectedNodeIds.length > 0
                    ? 'canvas.read_selected_nodes'
                    : 'canvas.read_summary',
                ] as LocalAgentToolName[],
                expectedObservation: 'Canvas context is available before proposal',
              },
            ]
          : []),
        ...(params.patch
          ? [
              {
                id: 'propose_patch',
                title: 'Prepare canvas change proposal',
                intent: 'update' as const,
                toolHints: ['canvas.propose_patch' as const],
                expectedObservation: 'Canvas patch is validated but not applied',
              },
            ]
          : [
              {
                id: 'answer_plan',
                title: 'Describe the proposed approach',
                intent: 'answer' as const,
                toolHints: [],
                expectedObservation: 'User receives a proposal without canvas mutation',
              },
            ]),
      ],
      successCriteria: ['No canvas mutation is applied before user confirmation'],
      patch: params.patch,
    },
    params.decision
  )
}

function extractExplicitNodeIds(message: string): string[] {
  const quoted = [...message.matchAll(/[“"']([^”"']{3,120})[”"']/g)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))
  const unquoted = [
    ...message.matchAll(/\b(?:node|block|content)[-_][a-zA-Z0-9][a-zA-Z0-9_-]{2,}\b/g),
  ]
    .map((match) => match[0])
    .filter(Boolean)
  return [...new Set([...quoted, ...unquoted])]
}

function buildExplicitReadNodePlan(context: LocalAgentContext, nodeIds: string[]): LocalAgentPlan {
  return {
    goal: context.message || 'Read an explicitly referenced canvas node',
    risk: 'low',
    requiresClarification: false,
    steps: [
      {
        id: 'read_explicit_node',
        title: 'Read explicitly referenced node',
        intent: 'inspect',
        toolHints: ['canvas.read_node'],
        expectedObservation:
          'Explicitly referenced node detail is available or a not-found error is returned',
      },
    ],
    successCriteria: ['Do not modify the canvas unless the explicitly referenced node exists'],
    readNodeIds: nodeIds,
  }
}

function buildReadonlySelectedWriteRefusalPlan(params: {
  context: LocalAgentContext
  detailKind: string
}): LocalAgentPlan {
  return {
    goal: params.context.message || 'Refuse unsupported selected node write',
    risk: 'low',
    requiresClarification: true,
    clarificationQuestion: `我可以读取当前选中的 ${params.detailKind} 节点，但第一版暂不支持写入这种节点类型。请换成 text/image/video/audio 内容节点，或只让我做摘要和分析。`,
    steps: [
      {
        id: 'refuse_readonly_selected_write',
        title: 'Refuse unsupported selected node write',
        intent: 'answer',
        toolHints: [],
        expectedObservation: 'Selected node type is read-only or unsupported for writes',
      },
    ],
    successCriteria: ['No canvas patch is executed for read-only selected nodes'],
  }
}

async function buildSelectedUpdatePatch(params: {
  context: LocalAgentContext
  snapshot: CanvasSnapshot
  nodeId: string
}): Promise<LocalCanvasPatch | undefined> {
  const detail = readCanvasNodeDetail(
    params.snapshot,
    params.nodeId,
    params.context.selectedNodeIds
  )
  if (!detail) return undefined

  if (detail.kind === 'text') {
    const rewrittenText = await rewriteSelectedTextContent(params)
    return {
      reason: 'Update selected text node',
      operations: [
        {
          type: 'update_node',
          nodeId: params.nodeId,
          fields: {
            aiPrompt: params.context.message,
            contentHtml: textToContentHtml(rewrittenText),
          },
        },
      ],
    }
  }

  if (detail.kind === 'image') {
    const existingPrompt =
      typeof detail.fields.aiPrompt === 'string' ? detail.fields.aiPrompt.trim() : ''
    const instruction = extractFieldInstruction(params.context.message)
    return {
      reason: 'Update selected image prompt',
      operations: [
        {
          type: 'update_node',
          nodeId: params.nodeId,
          fields: {
            aiPrompt: mergePromptInstruction(existingPrompt, instruction),
          },
        },
      ],
    }
  }

  if (detail.kind === 'video') {
    const existingPrompt =
      typeof detail.fields.videoPrompt === 'string' ? detail.fields.videoPrompt.trim() : ''
    const existingParameters =
      detail.fields.videoParameters && typeof detail.fields.videoParameters === 'object'
        ? detail.fields.videoParameters
        : {}
    const duration = parseDurationSeconds(params.context.message)
    const instruction = extractFieldInstruction(params.context.message)
    return {
      reason: 'Update selected video settings',
      operations: [
        {
          type: 'update_node',
          nodeId: params.nodeId,
          fields: {
            videoPrompt: mergePromptInstruction(existingPrompt, instruction),
            videoParameters: {
              ...existingParameters,
              ...(duration ? { duration } : {}),
            },
          },
        },
      ],
    }
  }

  if (detail.kind === 'audio') {
    const existingPrompt =
      typeof detail.fields.audioPrompt === 'string' ? detail.fields.audioPrompt.trim() : ''
    const instruction = extractFieldInstruction(params.context.message)
    return {
      reason: 'Update selected audio prompt',
      operations: [
        {
          type: 'update_node',
          nodeId: params.nodeId,
          fields: {
            audioPrompt: mergePromptInstruction(existingPrompt, instruction),
          },
        },
      ],
    }
  }

  return undefined
}

async function buildFallbackPatch(
  context: LocalAgentContext,
  snapshot: CanvasSnapshot
): Promise<LocalCanvasPatch | undefined> {
  const message = context.message
  const wantsChain = includesAny(message, ['完整短视频', '内容链', '一组', 'chain', 'storyboard'])
  if (wantsChain) {
    return buildContentChainPlan(context)
  }

  const selected = resolveTargetSelectedNode({
    snapshot,
    selectedNodeIds: context.selectedNodeIds,
    message,
  })
  if (selected && isUpdateRequest(message)) {
    return buildSelectedUpdatePatch({ context, snapshot, nodeId: selected })
  }

  const textCreateTarget = resolveTargetSelectedNode({
    snapshot,
    selectedNodeIds: context.selectedNodeIds,
    message,
    preferredKinds: inferTextCreateAnchorKinds(message),
  })
  if (textCreateTarget && isSelectionScopedCreateTextRequest(message)) {
    const selected = textCreateTarget
    const selectedPosition = getNodePosition(snapshot, selected)
    const detail = readCanvasNodeDetail(snapshot, selected, context.selectedNodeIds)
    const before = wantsBeforeSelectedNode(message)
    const clientNodeId = before ? 'new_text_before_selection' : 'new_text_after_selection'
    return {
      reason: 'Create a text node from the selected canvas node',
      operations: [
        {
          type: 'create_node',
          clientNodeId,
          kind: 'text',
          title: before ? '创意说明' : '补充文案',
          position: {
            x: selectedPosition.x + (before ? -360 : 360),
            y: selectedPosition.y,
          },
          fields: buildSelectedTextNodeFields({ message, detail }),
        },
        before
          ? { type: 'connect', sourceNodeId: clientNodeId, targetNodeId: selected }
          : { type: 'connect', sourceNodeId: selected, targetNodeId: clientNodeId },
      ],
    }
  }

  if (includesAny(message, ['整理', '布局', 'layout', '排列'])) {
    return {
      reason: 'Lay out current canvas nodes',
      operations: [{ type: 'layout_nodes', direction: 'horizontal' }],
    }
  }

  return undefined
}

async function buildFallbackPlan(
  context: LocalAgentContext,
  snapshot: CanvasSnapshot
): Promise<LocalAgentPlan> {
  if (isDestructiveCanvasRequest(context.message)) {
    return {
      goal: context.message || 'Handle destructive canvas request',
      risk: 'high',
      requiresClarification: true,
      clarificationQuestion:
        '这个请求会破坏当前画布的大量内容，我不会直接执行。请明确说明要删除的具体节点，或先在手动确认模式下给出可审查的删除范围。',
      steps: [
        {
          id: 'guard_destructive_request',
          title: 'Guard destructive canvas request',
          intent: 'answer',
          toolHints: ['canvas.read_summary'],
          expectedObservation: 'Destructive request is not executed without explicit scope',
        },
      ],
      successCriteria: ['No destructive canvas change is executed without explicit confirmation'],
    }
  }

  if (context.selectedNodeIds.length === 0 && isSelectionScopedUpdateRequest(context.message)) {
    return {
      goal: context.message || 'Update selected canvas node',
      risk: 'low',
      requiresClarification: true,
      clarificationQuestion:
        '我没有收到当前选中的画布节点。请先选中要修改的内容节点，再发送这条修改需求。',
      steps: [
        {
          id: 'clarify_selection',
          title: 'Ask for selected node',
          intent: 'answer',
          toolHints: [],
          expectedObservation: 'User selects a node before modification',
        },
      ],
      successCriteria: ['A selected node is available before modifying the canvas'],
    }
  }

  if (context.selectedNodeIds.length === 0 && isSelectionScopedReadRequest(context.message)) {
    return {
      goal: context.message || 'Read selected canvas node',
      risk: 'low',
      requiresClarification: true,
      clarificationQuestion:
        '我没有收到当前选中的画布节点。请先在画布上选中要分析的内容节点，再发送这条需求。',
      steps: [
        {
          id: 'clarify_selected_read',
          title: 'Ask for selected node before analysis',
          intent: 'answer',
          toolHints: [],
          expectedObservation: 'User selects a node before selected-node analysis',
        },
      ],
      successCriteria: ['A selected node is available before selected-node analysis'],
    }
  }

  if (context.selectedNodeIds.length === 0 && isSelectedGenerationRequest(context.message)) {
    return {
      goal: context.message || 'Generate selected node output',
      risk: 'low',
      requiresClarification: true,
      clarificationQuestion:
        '我没有收到当前选中的画布节点。请先选中要生成并写回的内容节点，再发送生成请求。',
      steps: [
        {
          id: 'clarify_generation_selection',
          title: 'Ask for selected node before generation',
          intent: 'answer',
          toolHints: [],
          expectedObservation: 'User selects a node before generation',
        },
      ],
      successCriteria: ['A selected generatable node is available before generation'],
    }
  }

  if (context.selectedNodeIds.length > 0 && isSelectedGenerationRequest(context.message)) {
    const selected = resolveTargetSelectedNode({
      snapshot,
      selectedNodeIds: context.selectedNodeIds,
      message: context.message,
    })
    return {
      goal: context.message || 'Generate selected node output',
      risk: 'medium',
      requiresClarification: false,
      steps: [
        {
          id: 'inspect_selected',
          title: 'Read selected node before generation',
          intent: 'inspect',
          toolHints: ['canvas.read_selected_nodes'],
          expectedObservation: 'Selected node generation fields are available',
        },
        {
          id: 'generate_selected',
          title: 'Generate selected node output',
          intent: 'generate',
          toolHints: ['canvas.generate_node_output'],
          expectedObservation: 'Generated output is written back to the selected node',
        },
        {
          id: 'verify_generation',
          title: 'Verify generated output writeback',
          intent: 'verify',
          toolHints: ['canvas.verify_patch'],
          expectedObservation: 'Generated output exists on the selected node',
        },
      ],
      successCriteria: ['Generated output is written back to the selected node'],
      generateNodeIds: selected ? [selected] : [context.selectedNodeIds[0]],
    }
  }

  const patch = await buildFallbackPatch(context, snapshot)
  const shouldInspectSelected = context.selectedNodeIds.length > 0
  const toolHints: LocalCanvasToolName[] = []
  if (shouldInspectSelected) toolHints.push('canvas.read_selected_nodes')
  if (
    !shouldInspectSelected ||
    isSearchRequest(context.message) ||
    isConnectionReasoningRequest(context.message) ||
    isIsolatedNodeRequest(context.message) ||
    patch
  ) {
    toolHints.push('canvas.read_summary')
  }
  if (isSearchRequest(context.message)) toolHints.push('canvas.search_nodes')
  if (patch) toolHints.push('canvas.apply_patch', 'canvas.verify_patch')
  return {
    goal: context.message || 'Analyze the current canvas',
    risk: 'low',
    requiresClarification: false,
    steps: [
      {
        id: 'inspect',
        title: shouldInspectSelected ? 'Read selected nodes' : 'Read canvas summary',
        intent: 'inspect',
        toolHints,
        expectedObservation: 'Canvas context is available',
      },
      ...(patch
        ? [
            {
              id: 'apply',
              title: 'Apply canvas changes',
              intent: 'create' as const,
              toolHints: ['canvas.apply_patch' as const],
              expectedObservation: 'Canvas patch is applied',
            },
            {
              id: 'verify',
              title: 'Verify canvas changes',
              intent: 'verify' as const,
              toolHints: ['canvas.verify_patch' as const],
              expectedObservation: 'Canvas changes are verified',
            },
          ]
        : []),
    ],
    successCriteria: patch
      ? ['Canvas reflects the requested change']
      : ['Answer based on current canvas'],
    patch,
  }
}

async function ensureSelectedTextRewritePatch(params: {
  context: LocalAgentContext
  snapshot: CanvasSnapshot
  plan: LocalAgentPlan
}): Promise<LocalAgentPlan> {
  const selected = resolveTargetSelectedNode({
    snapshot: params.snapshot,
    selectedNodeIds: params.context.selectedNodeIds,
    message: params.context.message,
    preferredKinds: ['text'],
  })
  if (
    !selected ||
    !includesAny(params.context.message, ['修改', '改成', '优化', 'rewrite', 'update'])
  ) {
    return params.plan
  }

  const detail = readCanvasNodeDetail(params.snapshot, selected, params.context.selectedNodeIds)
  if (detail?.kind !== 'text') return params.plan

  const operations = params.plan.patch?.operations ?? []
  const hasSelectedUpdate = operations.some(
    (operation) => operation.type === 'update_node' && operation.nodeId === selected
  )
  const hasContentHtmlUpdate = operations.some(
    (operation) =>
      operation.type === 'update_node' &&
      operation.nodeId === selected &&
      typeof operation.fields.contentHtml === 'string'
  )

  if (hasContentHtmlUpdate) return params.plan

  const rewrittenText = await rewriteSelectedTextContent({
    context: params.context,
    snapshot: params.snapshot,
    nodeId: selected,
  })
  const rewriteOperation = {
    type: 'update_node' as const,
    nodeId: selected,
    fields: {
      aiPrompt: params.context.message,
      contentHtml: textToContentHtml(rewrittenText),
    },
  }

  return {
    ...params.plan,
    patch: {
      reason: params.plan.patch?.reason ?? 'Rewrite selected text content',
      operations: hasSelectedUpdate
        ? operations.map((operation) =>
            operation.type === 'update_node' && operation.nodeId === selected
              ? {
                  ...operation,
                  fields: {
                    ...operation.fields,
                    contentHtml: textToContentHtml(rewrittenText),
                  },
                }
              : operation
          )
        : [...operations, rewriteOperation],
    },
    steps: params.plan.steps.some((step) => step.toolHints.includes('canvas.apply_patch'))
      ? params.plan.steps
      : [
          ...params.plan.steps,
          {
            id: 'apply_rewrite',
            title: 'Update selected text content',
            intent: 'update',
            toolHints: ['canvas.apply_patch'],
            expectedObservation: 'Selected text content is updated',
          },
          {
            id: 'verify_rewrite',
            title: 'Verify selected text update',
            intent: 'verify',
            toolHints: ['canvas.verify_patch'],
            expectedObservation: 'Selected text update is verified',
          },
        ],
    successCriteria: params.plan.successCriteria.length
      ? params.plan.successCriteria
      : ['Selected text node content is rewritten'],
  }
}

function withToolHints(
  plan: LocalAgentPlan,
  requiredToolHints: LocalAgentToolName[]
): LocalAgentPlan {
  if (requiredToolHints.length === 0) return plan
  const hasInspectStep = plan.steps.length > 0
  if (!hasInspectStep) {
    return {
      ...plan,
      steps: [
        {
          id: 'inspect',
          title: 'Read canvas context',
          intent: 'inspect',
          toolHints: requiredToolHints,
          expectedObservation: 'Canvas context is available',
        },
      ],
    }
  }
  const [firstStep, ...rest] = plan.steps
  return {
    ...plan,
    steps: [
      {
        ...firstStep,
        toolHints: [...new Set([...firstStep.toolHints, ...requiredToolHints])],
      },
      ...rest,
    ],
  }
}

function ensureReadOnlyInspectionCoverage(
  context: LocalAgentContext,
  plan: LocalAgentPlan
): LocalAgentPlan {
  if (plan.patch || plan.generateNodeIds?.length) return plan
  const requiredToolHints: LocalAgentToolName[] = []
  requiredToolHints.push(...inferContextToolHints(context))
  if (context.selectedNodeIds.length > 0) requiredToolHints.push('canvas.read_selected_nodes')
  if (
    context.selectedNodeIds.length === 0 ||
    isSearchRequest(context.message) ||
    isConnectionReasoningRequest(context.message) ||
    isIsolatedNodeRequest(context.message)
  ) {
    requiredToolHints.push('canvas.read_summary')
  }
  if (isSearchRequest(context.message)) requiredToolHints.push('canvas.search_nodes')
  return withToolHints(plan, [...new Set(requiredToolHints)])
}

function buildPlannerPrompt(
  context: LocalAgentContext,
  tokenAwareContext: string,
  decision: LocalCanvasIntentDecision
): string {
  return [
    `Token-aware context:\n${tokenAwareContext}`,
    [
      'Immutable intent policy:',
      `- userIntent=${decision.userIntent}`,
      `- mutationPolicy=${decision.mutationPolicy}`,
      `- canvasReadPolicy=${decision.canvasReadPolicy}`,
      `- confidence=${decision.confidence}`,
      `- requiresUserConfirmation=${decision.requiresUserConfirmation}`,
      `- evidence=${decision.evidence.join(', ') || 'none'}`,
    ].join('\n'),
    'Return JSON for a multi-step local canvas agent plan. Use high-level patch operations only. Do not output raw EditWorkflowOperation.',
    'You may make the plan more restrictive for safety, but you must not escalate read or mutation permissions beyond the immutable intent policy.',
    'When the user asks to inspect or summarize, prefer read tools and an answer step. When the user asks to modify, plan inspect -> apply_patch -> verify_patch.',
    'Use read_file for attached file context, query_knowledge for attached knowledge context, search_docs for documentation context, search_workspace for workspace inventory, and read_tasks for production task status.',
    'Use materialize_file only when the user explicitly asks to save/import an uploaded file. Use update_task_result or submit_task_result only with an explicit task id or bound task context.',
  ].join('\n\n')
}

export async function buildLocalAgentPlan(context: LocalAgentContext): Promise<LocalAgentPlan> {
  const snapshot = await loadCanvasSnapshot({
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
  })
  const intentDecision = classifyLocalCanvasUserIntent(context)

  if (isDestructiveCanvasRequest(context.message)) {
    return applyIntentPolicy(await buildFallbackPlan(context, snapshot), intentDecision)
  }

  if (context.selectedNodeIds.length === 0 && isSelectionScopedUpdateRequest(context.message)) {
    return applyIntentPolicy(await buildFallbackPlan(context, snapshot), intentDecision)
  }

  if (context.selectedNodeIds.length === 0 && isSelectionScopedReadRequest(context.message)) {
    return applyIntentPolicy(await buildFallbackPlan(context, snapshot), intentDecision)
  }

  if (intentDecision.userIntent === 'consult_design') {
    return buildConsultDesignPlan(context, intentDecision)
  }

  if (intentDecision.mutationPolicy === 'propose_only') {
    const patch = await buildFallbackPatch(context, snapshot)
    return buildProposeOnlyPlan({ context, decision: intentDecision, patch })
  }

  const contextToolHints = inferContextToolHints(context)
  if (
    contextToolHints.length > 0 &&
    !isSelectionScopedUpdateRequest(context.message) &&
    !isSelectedGenerationRequest(context.message)
  ) {
    return applyIntentPolicy(
      buildContextInspectionPlan(
        context,
        context.selectedNodeIds.length > 0
          ? ['canvas.read_selected_nodes', ...contextToolHints]
          : contextToolHints
      ),
      intentDecision
    )
  }

  if (context.selectedNodeIds.length > 0 && isUpdateRequest(context.message)) {
    const selected = resolveTargetSelectedNode({
      snapshot,
      selectedNodeIds: context.selectedNodeIds,
      message: context.message,
    })
    const detail = selected
      ? readCanvasNodeDetail(snapshot, selected, context.selectedNodeIds)
      : null
    if (detail && !detail.capabilities.canWrite) {
      return applyIntentPolicy(
        buildReadonlySelectedWriteRefusalPlan({ context, detailKind: detail.kind }),
        intentDecision
      )
    }
    return applyIntentPolicy(await buildFallbackPlan(context, snapshot), intentDecision)
  }

  if (isSelectedGenerationRequest(context.message)) {
    return applyIntentPolicy(await buildFallbackPlan(context, snapshot), intentDecision)
  }

  if (
    isSearchRequest(context.message) ||
    isConnectionReasoningRequest(context.message) ||
    isIsolatedNodeRequest(context.message)
  ) {
    return applyIntentPolicy(await buildFallbackPlan(context, snapshot), intentDecision)
  }

  if (
    context.selectedNodeIds.length > 0 &&
    (isSelectionScopedReadRequest(context.message) ||
      isConnectionReasoningRequest(context.message) ||
      includesAny(context.message, ['检查', '分析', '判断']))
  ) {
    return applyIntentPolicy(await buildFallbackPlan(context, snapshot), intentDecision)
  }

  if (
    context.selectedNodeIds.length > 0 &&
    (isSelectionScopedUpdateRequest(context.message) ||
      isSelectionScopedReadRequest(context.message))
  ) {
    return applyIntentPolicy(await buildFallbackPlan(context, snapshot), intentDecision)
  }

  const explicitNodeIds = extractExplicitNodeIds(context.message)
  if (
    explicitNodeIds.length > 0 &&
    includesAny(context.message, ['读取', 'read', '修改', 'update'])
  ) {
    return applyIntentPolicy(buildExplicitReadNodePlan(context, explicitNodeIds), intentDecision)
  }

  const tokenAwareContext = buildTokenAwareLocalAgentContext({ context, snapshot })

  try {
    const response = await executeLocalAgentModelRequest(context.model, {
      role: 'planner',
      workspaceId: context.workspaceId,
      systemPrompt: buildLocalAgentRoleSystemPrompt({
        context,
        role: 'planner',
        roleInstruction:
          'You are planning for a local TapNow-style canvas agent. Plans may inspect, patch, generate, verify, or answer. Use JSON only.',
      }),
      prompt: buildPlannerPrompt(context, tokenAwareContext, intentDecision),
      temperature: context.thinkingLevel === 'extra' ? 0.15 : 0.05,
      maxTokens: context.thinkingLevel === 'extra' ? 3000 : 1800,
      responseFormat: {
        name: 'local_canvas_agent_plan',
        schema: z.toJSONSchema(plannerResponseSchema),
        strict: true,
      },
      abortSignal: context.options.abortSignal,
    })
    const parsed = plannerResponseSchema.safeParse(parseJsonObject(response.content ?? ''))
    if (parsed.success) {
      const coveredPlan = ensureReadOnlyInspectionCoverage(context, {
        goal: parsed.data.goal || context.message,
        risk: parsed.data.risk,
        userIntent: parsed.data.userIntent ?? intentDecision.userIntent,
        mutationPolicy: parsed.data.mutationPolicy ?? intentDecision.mutationPolicy,
        canvasReadPolicy: parsed.data.canvasReadPolicy ?? intentDecision.canvasReadPolicy,
        intentConfidence: parsed.data.intentConfidence,
        intentEvidence: parsed.data.intentEvidence,
        requiresUserConfirmation: parsed.data.requiresUserConfirmation,
        requiresClarification: parsed.data.requiresClarification,
        clarificationQuestion: parsed.data.clarificationQuestion,
        steps: parsed.data.steps,
        successCriteria: parsed.data.successCriteria,
        patch: parsed.data.patch as LocalCanvasPatch | undefined,
        generateNodeIds: parsed.data.generateNodeIds,
        readNodeIds: parsed.data.readNodeIds,
      })
      if (!coveredPlan.patch && !coveredPlan.generateNodeIds?.length) {
        const fallbackPatch = await buildFallbackPatch(context, snapshot)
        if (fallbackPatch)
          return applyIntentPolicy(await buildFallbackPlan(context, snapshot), intentDecision)
      }
      return applyIntentPolicy(
        await ensureSelectedTextRewritePatch({
          context,
          snapshot,
          plan: coveredPlan,
        }),
        intentDecision
      )
    }
  } catch {
    return applyIntentPolicy(await buildFallbackPlan(context, snapshot), intentDecision)
  }

  return applyIntentPolicy(await buildFallbackPlan(context, snapshot), intentDecision)
}
