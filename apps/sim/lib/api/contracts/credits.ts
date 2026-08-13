import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const creditWalletSchema = z.object({
  availableCredits: z.number().int().nonnegative(),
  reservedCredits: z.number().int().nonnegative(),
  totalConsumedCredits: z.number().int().nonnegative(),
  isUnlimited: z.boolean(),
})

export const creditLedgerEntrySchema = z.object({
  id: z.string(),
  eventType: z.string(),
  availableDelta: z.number().int(),
  reservedDelta: z.number().int(),
  balanceAfter: z.number().int(),
  capability: z.string().nullable(),
  modelId: z.string().nullable(),
  // untyped-response: ledger metadata retains provider task and error details that vary by capability
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.coerce.date(),
})

export const getMyCreditsContract = defineRouteContract({
  method: 'GET',
  path: '/api/credits/me',
  response: { mode: 'json', schema: creditWalletSchema },
})

export const getMyCreditLedgerContract = defineRouteContract({
  method: 'GET',
  path: '/api/credits/me/ledger',
  query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }),
  response: { mode: 'json', schema: z.object({ entries: z.array(creditLedgerEntrySchema) }) },
})

export type CreditWallet = z.output<typeof creditWalletSchema>
export type CreditLedgerEntry = z.output<typeof creditLedgerEntrySchema>
