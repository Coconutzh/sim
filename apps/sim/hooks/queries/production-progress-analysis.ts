import { useMutation } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type AnalyzeProductionProgressBody,
  analyzeProductionProgressContract,
} from '@/lib/api/contracts/production-progress-analysis'

export const productionProgressAnalysisKeys = {
  all: ['production-progress-analysis'] as const,
  mutations: () => [...productionProgressAnalysisKeys.all, 'mutation'] as const,
}

export function useAnalyzeProductionProgress() {
  return useMutation({
    mutationKey: productionProgressAnalysisKeys.mutations(),
    mutationFn: (body: AnalyzeProductionProgressBody) =>
      requestJson(analyzeProductionProgressContract, { body }),
  })
}
