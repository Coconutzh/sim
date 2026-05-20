import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { markMothershipChatReadContract } from '@/lib/api/contracts/mothership-tasks'
import { parseRequest } from '@/lib/api/server'
import { getAccessibleMothershipChat } from '@/lib/copilot/chat/lifecycle'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('MarkTaskReadAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const parsed = await parseRequest(markMothershipChatReadContract, request, {})
    if (!parsed.success) return parsed.response
    const { chatId } = parsed.data.body

    const chat = await getAccessibleMothershipChat(chatId, userId)
    if (!chat) {
      return createNotFoundResponse('Chat not found')
    }

    await db
      .update(copilotChats)
      .set({ lastSeenAt: sql`GREATEST(${copilotChats.updatedAt}, NOW())` })
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.type, 'mothership')))

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error marking task as read:', error)
    return createInternalServerErrorResponse('Failed to mark task as read')
  }
})
