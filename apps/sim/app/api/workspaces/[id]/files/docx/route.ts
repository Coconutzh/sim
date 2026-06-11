import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { Document as DocxDocument, Packer, Paragraph, TextRun } from 'docx'
import { type NextRequest, NextResponse } from 'next/server'
import { saveMessageAsDocxContract } from '@/lib/api/contracts/workspace-files'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  getWorkspaceFile,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const logger = createLogger('WorkspaceDocxSaveAPI')
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function normalizeDocxFileName(value: string | undefined): string {
  const base = (value || `agent-output-${new Date().toISOString().slice(0, 10)}.docx`)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
  const withName = base || 'agent-output.docx'
  return withName.toLowerCase().endsWith('.docx') ? withName : `${withName}.docx`
}

function markdownToPlainLines(content: string): string[] {
  const stripped = content
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .replace(/<options>[\s\S]*?<\/options>/g, '')
    .replace(/```[\s\S]*?```/g, (block) =>
      block
        .replace(/^```[^\n]*\n?/, '')
        .replace(/```$/, '')
        .trim()
    )
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')

  return stripped.split(/\r?\n/).map((line) =>
    line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\s*[-*]\s+/, '')
      .replace(/^\s*\d+\.\s+/, '')
      .trim()
  )
}

async function buildDocxBuffer(content: string): Promise<Buffer> {
  const lines = markdownToPlainLines(content)
  const paragraphs = (lines.length > 0 ? lines : ['']).map(
    (line) =>
      new Paragraph({
        children: [new TextRun({ text: line || ' ' })],
        spacing: { after: line ? 160 : 80 },
      })
  )

  const document = new DocxDocument({
    sections: [
      {
        children: paragraphs,
      },
    ],
  })

  const buffer = await Packer.toBuffer(document)
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
}

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(saveMessageAsDocxContract, request, context)
    if (!parsed.success) return parsed.response

    const workspaceId = parsed.data.params.id
    const { content, fileName, chatId, messageId, workflowId } = parsed.data.body
    const userId = session.user.id

    const access = await checkWorkspaceAccess(workspaceId, userId)
    if (!access.exists || !access.hasAccess) {
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
    }
    if (!access.canWrite) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const normalizedFileName = normalizeDocxFileName(fileName)

    try {
      const buffer = await buildDocxBuffer(content)
      const uploaded = await uploadWorkspaceFile(
        workspaceId,
        userId,
        buffer,
        normalizedFileName,
        DOCX_MIME
      )
      const file = await getWorkspaceFile(workspaceId, uploaded.id)
      if (!file) {
        throw new Error('Generated file was uploaded but could not be reloaded')
      }

      recordAudit({
        workspaceId,
        actorId: userId,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.FILE_UPLOADED,
        resourceType: AuditResourceType.FILE,
        resourceId: file.id,
        resourceName: file.name,
        description: `Saved Agent output as DOCX "${file.name}"`,
        metadata: {
          fileSize: file.size,
          fileType: DOCX_MIME,
          chatId,
          messageId,
          workflowId,
        },
        request,
      })

      return NextResponse.json({ success: true, file })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save DOCX'
      logger.error('Failed to save assistant output as DOCX', {
        workspaceId,
        userId,
        chatId,
        messageId,
        workflowId,
        error: message,
      })
      return NextResponse.json({ success: false, error: message }, { status: 500 })
    }
  }
)
