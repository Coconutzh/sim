import { z } from 'zod'
import {
  nonEmptyIdSchema,
  workflowIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const hermesCanvasMediaExportBodySchema = z.object({
  userId: nonEmptyIdSchema,
  organizationId: nonEmptyIdSchema.optional(),
  workspaceId: workspaceIdSchema,
  workflowId: workflowIdSchema,
  chatId: nonEmptyIdSchema.optional(),
  nodeId: nonEmptyIdSchema.optional(),
  selectedNodeIds: z.array(nonEmptyIdSchema).max(20).optional().default([]),
  question: z.string().trim().max(4000).optional(),
  traceId: z.string().trim().min(1).max(200).optional(),
  hermesRunId: z.string().trim().min(1).max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type HermesCanvasMediaExportBody = z.input<typeof hermesCanvasMediaExportBodySchema>
export type ParsedHermesCanvasMediaExportBody = z.output<typeof hermesCanvasMediaExportBodySchema>

export const hermesCanvasMediaExportContract = defineRouteContract({
  method: 'POST',
  path: '/api/internal/hermes/canvas-media/export',
  body: hermesCanvasMediaExportBodySchema,
  response: {
    mode: 'binary',
    status: [200, 400, 401, 403, 404, 413, 500],
  },
})
