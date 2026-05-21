import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { copilotModelsContract } from '@/lib/api/contracts/copilot'
import { parseRequest } from '@/lib/api/server'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { fetchGo } from '@/lib/copilot/request/go/fetch'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/request/http'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { DYNAMIC_MODEL_PROVIDERS, PROVIDER_DEFINITIONS } from '@/providers/models'

interface AvailableModel {
  id: string
  friendlyName: string
  provider: string
}

const logger = createLogger('CopilotModelsAPI')

interface RawAvailableModel {
  id: string
  friendlyName?: string
  displayName?: string
  provider?: string
}

function isRawAvailableModel(item: unknown): item is RawAvailableModel {
  return (
    typeof item === 'object' &&
    item !== null &&
    'id' in item &&
    typeof (item as { id: unknown }).id === 'string'
  )
}

function buildStaticAvailableModels(): AvailableModel[] {
  const models: AvailableModel[] = []

  for (const [providerId, provider] of Object.entries(PROVIDER_DEFINITIONS)) {
    if ((DYNAMIC_MODEL_PROVIDERS as readonly string[]).includes(providerId)) {
      continue
    }

    for (const model of provider.models) {
      models.push({
        id: model.id,
        friendlyName: model.id,
        provider: provider.id,
      })
    }
  }

  return models
}

export const GET = withRouteHandler(async (req: NextRequest) => {
  const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
  if (!isAuthenticated || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(copilotModelsContract, req, {})
  if (!parsed.success) return parsed.response

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (env.COPILOT_API_KEY) {
    headers['x-api-key'] = env.COPILOT_API_KEY
  }

  try {
    const response = await fetchGo(`${SIM_AGENT_API_URL}/api/get-available-models`, {
      method: 'GET',
      headers,
      cache: 'no-store',
      spanName: 'sim → go /api/get-available-models',
      operation: 'get_available_models',
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      logger.warn('Failed to fetch available models from copilot backend', {
        status: response.status,
      })
      return NextResponse.json(
        {
          success: true,
          fallback: 'static',
          ...(payload?.error ? { error: payload.error } : {}),
          models: buildStaticAvailableModels(),
        },
        { status: 200 }
      )
    }

    const rawModels = Array.isArray(payload?.models) ? payload.models : []
    const models: AvailableModel[] = rawModels
      .filter((item: unknown): item is RawAvailableModel => isRawAvailableModel(item))
      .map((item: RawAvailableModel) => ({
        id: item.id,
        friendlyName: item.friendlyName || item.displayName || item.id,
        provider: item.provider || 'unknown',
      }))

    return NextResponse.json({ success: true, models })
  } catch (error) {
    logger.error('Error fetching available models', {
      error: toError(error).message,
    })
    return NextResponse.json(
      {
        success: true,
        fallback: 'static',
        error: 'Failed to fetch available models',
        models: buildStaticAvailableModels(),
      },
      { status: 200 }
    )
  }
})
