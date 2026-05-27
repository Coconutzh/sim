'use client'

import {
  getProviderModels,
  updateFireworksModels,
  updateOllamaModels,
  updateOpenRouterModels,
  updateVLLMModels,
} from '@/providers/models'

export function updateOllamaProviderModels(models: string[]): string[] {
  updateOllamaModels(models)
  return getProviderModels('ollama')
}

export function updateVLLMProviderModels(models: string[]): string[] {
  updateVLLMModels(models)
  return getProviderModels('vllm')
}

export function updateOpenRouterProviderModels(models: string[]): string[] {
  updateOpenRouterModels(models)
  return getProviderModels('openrouter')
}

export function updateFireworksProviderModels(models: string[]): string[] {
  updateFireworksModels(models)
  return getProviderModels('fireworks')
}
