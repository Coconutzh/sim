import { GoogleGenAI } from '@google/genai'
import { createLogger } from '@sim/logger'
import type { StreamingExecution } from '@/executor/types'
import { executeGeminiRequest } from '@/providers/gemini/core'
import {
  executeEvolinkGeminiFallback,
  isRetryableGoogleAuthError,
  shouldPreferEvolinkGeminiTransport,
} from '@/providers/google/evolink'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'

const logger = createLogger('GoogleProvider')

/**
 * Google Gemini provider
 *
 * Uses the @google/genai SDK with API key authentication.
 * Shares core execution logic with Vertex AI provider.
 */
export const googleProvider: ProviderConfig = {
  id: 'google',
  name: 'Google',
  description: "Google's Gemini models",
  version: '1.0.0',
  models: getProviderModels('google'),
  defaultModel: getProviderDefaultModel('google'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Google Gemini')
    }

    if (shouldPreferEvolinkGeminiTransport(request)) {
      logger.info('Routing Gemini request through Evolink OpenAI-compatible transport', {
        model: request.model,
      })
      return executeEvolinkGeminiFallback(request)
    }

    logger.info('Creating Google Gemini client', { model: request.model })

    try {
      const ai = new GoogleGenAI({ apiKey: request.apiKey })

      return await executeGeminiRequest({
        ai,
        model: request.model,
        request,
        providerType: 'google',
      })
    } catch (error) {
      if (!canRetryWithEvolink(request, error)) {
        throw error
      }

      logger.warn('Native Google Gemini request failed; retrying with Evolink fallback', {
        model: request.model,
        error: error instanceof Error ? error.message : String(error),
      })

      return executeEvolinkGeminiFallback(request)
    }
  },
}

function canRetryWithEvolink(request: ProviderRequest, error: unknown) {
  return request.model.startsWith('gemini-') && !!request.apiKey && isRetryableGoogleAuthError(error)
}
