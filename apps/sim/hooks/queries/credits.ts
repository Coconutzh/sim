import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getMyCreditLedgerContract, getMyCreditsContract } from '@/lib/api/contracts/credits'

export const creditKeys = {
  all: ['platform-credits'] as const,
  wallet: () => [...creditKeys.all, 'wallet'] as const,
  ledger: () => [...creditKeys.all, 'ledger'] as const,
}

export function useMyCredits() {
  return useQuery({
    queryKey: creditKeys.wallet(),
    queryFn: ({ signal }) => requestJson(getMyCreditsContract, { signal }),
    staleTime: 30 * 1000,
  })
}

export function useMyCreditLedger() {
  return useQuery({
    queryKey: creditKeys.ledger(),
    queryFn: ({ signal }) =>
      requestJson(getMyCreditLedgerContract, { query: { limit: 50 }, signal }),
    staleTime: 30 * 1000,
  })
}
