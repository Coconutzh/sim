import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  addMothershipChatResourceContract,
  removeMothershipChatResourceContract,
  reorderMothershipChatResourcesContract,
} from '@/lib/api/contracts/mothership-tasks'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getAccessibleMothershipChat } from '@/lib/copilot/chat/lifecycle'
import {
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import type { ChatResource, ResourceType } from '@/lib/copilot/resources/persistence'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('MothershipChatResourcesAPI')

const VALID_RESOURCE_TYPES = new Set<ResourceType>([
  'table',
  'file',
  'workflow',
  'knowledgebase',
  'folder',
  'log',
])
const GENERIC_TITLES = new Set(['Table', 'File', 'Workflow', 'Knowledge Base', 'Folder', 'Log'])

function isValidResourceType(value: string): value is ResourceType {
  return VALID_RESOURCE_TYPES.has(value as ResourceType)
}

export const POST = withRouteHandler(async (req: NextRequest) => {
  try {
    const session = await getSession()
    const userId = session?.user?.id
    if (!userId) {
      return createUnauthorizedResponse()
    }

    const parsed = await parseRequest(
      addMothershipChatResourceContract,
      req,
      {},
      {
        validationErrorResponse: (error) =>
          createBadRequestResponse(error.issues.map((issue) => issue.message).join(', ')),
      }
    )
    if (!parsed.success) return parsed.response
    const { chatId, resource } = parsed.data.body

    if (resource.id === 'streaming-file') {
      return NextResponse.json({ success: true, resources: [] })
    }

    if (!isValidResourceType(resource.type)) {
      return createBadRequestResponse(`Invalid resource type: ${resource.type}`)
    }
    const validatedResource: ChatResource = { ...resource, type: resource.type }

    const chat = await getAccessibleMothershipChat(chatId, userId)
    if (!chat) {
      return createNotFoundResponse('Chat not found or unauthorized')
    }

    const existing = Array.isArray(chat.resources) ? (chat.resources as ChatResource[]) : []
    const key = `${validatedResource.type}:${validatedResource.id}`
    const previous = existing.find((entry) => `${entry.type}:${entry.id}` === key)

    let merged: ChatResource[]
    if (previous) {
      if (GENERIC_TITLES.has(previous.title) && !GENERIC_TITLES.has(validatedResource.title)) {
        merged = existing.map((entry) =>
          `${entry.type}:${entry.id}` === key ? { ...entry, title: validatedResource.title } : entry
        )
      } else {
        merged = existing
      }
    } else {
      merged = [...existing, validatedResource]
    }

    await db
      .update(copilotChats)
      .set({ resources: sql`${JSON.stringify(merged)}::jsonb`, updatedAt: new Date() })
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.type, 'mothership')))

    logger.info('Added resource to mothership chat', { chatId, resource: validatedResource })

    return NextResponse.json({ success: true, resources: merged })
  } catch (error) {
    logger.error('Error adding mothership chat resource:', error)
    return createInternalServerErrorResponse('Failed to add resource')
  }
})

export const PATCH = withRouteHandler(async (req: NextRequest) => {
  try {
    const session = await getSession()
    const userId = session?.user?.id
    if (!userId) {
      return createUnauthorizedResponse()
    }

    const parsed = await parseRequest(
      reorderMothershipChatResourcesContract,
      req,
      {},
      {
        validationErrorResponse: (error) =>
          createBadRequestResponse(error.issues.map((issue) => issue.message).join(', ')),
      }
    )
    if (!parsed.success) return parsed.response
    const { chatId, resources: newOrder } = parsed.data.body

    const chat = await getAccessibleMothershipChat(chatId, userId)
    if (!chat) {
      return createNotFoundResponse('Chat not found or unauthorized')
    }

    const existing = Array.isArray(chat.resources) ? (chat.resources as ChatResource[]) : []
    const existingKeys = new Set(existing.map((resource) => `${resource.type}:${resource.id}`))
    const newKeys = new Set(newOrder.map((resource) => `${resource.type}:${resource.id}`))

    if (existingKeys.size !== newKeys.size || ![...existingKeys].every((key) => newKeys.has(key))) {
      return createBadRequestResponse('Reordered resources must match existing resources')
    }

    await db
      .update(copilotChats)
      .set({ resources: sql`${JSON.stringify(newOrder)}::jsonb`, updatedAt: new Date() })
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.type, 'mothership')))

    logger.info('Reordered resources for mothership chat', { chatId, count: newOrder.length })

    return NextResponse.json({ success: true, resources: newOrder })
  } catch (error) {
    logger.error('Error reordering mothership chat resources:', error)
    return createInternalServerErrorResponse('Failed to reorder resources')
  }
})

export const DELETE = withRouteHandler(async (req: NextRequest) => {
  try {
    const session = await getSession()
    const userId = session?.user?.id
    if (!userId) {
      return createUnauthorizedResponse()
    }

    const parsed = await parseRequest(
      removeMothershipChatResourceContract,
      req,
      {},
      {
        validationErrorResponse: (error) =>
          createBadRequestResponse(error.issues.map((issue) => issue.message).join(', ')),
      }
    )
    if (!parsed.success) return parsed.response
    const { chatId, resourceType, resourceId } = parsed.data.body

    const chat = await getAccessibleMothershipChat(chatId, userId)
    if (!chat) {
      return createNotFoundResponse('Chat not found or unauthorized')
    }

    const [updated] = await db
      .update(copilotChats)
      .set({
        resources: sql`COALESCE((
          SELECT jsonb_agg(elem)
          FROM jsonb_array_elements(${copilotChats.resources}) elem
          WHERE NOT (elem->>'type' = ${resourceType} AND elem->>'id' = ${resourceId})
        ), '[]'::jsonb)`,
        updatedAt: new Date(),
      })
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.type, 'mothership')))
      .returning({ resources: copilotChats.resources })

    if (!updated) {
      return createNotFoundResponse('Chat not found or unauthorized')
    }

    const resources = Array.isArray(updated.resources) ? (updated.resources as ChatResource[]) : []

    logger.info('Removed resource from mothership chat', { chatId, resourceType, resourceId })

    return NextResponse.json({ success: true, resources })
  } catch (error) {
    logger.error('Error removing mothership chat resource:', error)
    return createInternalServerErrorResponse('Failed to remove resource')
  }
})
