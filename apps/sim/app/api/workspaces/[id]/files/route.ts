import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  listWorkspaceFilesContract,
  uploadWorkspaceFileContract,
} from '@/lib/api/contracts/workspace-files'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  FileConflictError,
  listWorkspaceFiles,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace'
import { MAX_WORKSPACE_FORMDATA_FILE_SIZE } from '@/lib/uploads/shared/types'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import { getWorkspaceMembershipAccess } from '@/app/api/workflows/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceFilesAPI')

class WorkspaceUploadRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'WorkspaceUploadRequestError'
  }
}

type ParsedWorkspaceUpload = {
  buffer: Buffer
  fileName: string
  contentType: string
  size: number
}

const getWorkspaceUploadSizeError = (sizeBytes: number) =>
  `File size exceeds maximum of ${MAX_WORKSPACE_FORMDATA_FILE_SIZE} bytes (${(sizeBytes / (1024 * 1024)).toFixed(2)}MB)`

async function parseWorkspaceUploadRequest(request: NextRequest): Promise<ParsedWorkspaceUpload> {
  const rawHeaderName = request.headers.get('x-upload-file-name')
  if (rawHeaderName) {
    const declaredSize = Number(request.headers.get('x-upload-file-size') ?? '')
    if (Number.isFinite(declaredSize) && declaredSize > MAX_WORKSPACE_FORMDATA_FILE_SIZE) {
      throw new WorkspaceUploadRequestError(getWorkspaceUploadSizeError(declaredSize), 413)
    }

    const contentLength = Number(request.headers.get('content-length') ?? '')
    if (Number.isFinite(contentLength) && contentLength > MAX_WORKSPACE_FORMDATA_FILE_SIZE) {
      throw new WorkspaceUploadRequestError(getWorkspaceUploadSizeError(contentLength), 413)
    }

    const buffer = Buffer.from(await request.arrayBuffer())
    if (buffer.length > MAX_WORKSPACE_FORMDATA_FILE_SIZE) {
      throw new WorkspaceUploadRequestError(getWorkspaceUploadSizeError(buffer.length), 413)
    }
    if (Number.isFinite(declaredSize) && declaredSize !== buffer.length) {
      throw new WorkspaceUploadRequestError(
        `Upload body appears truncated: expected ${declaredSize} bytes but received ${buffer.length} bytes`,
        413
      )
    }

    let fileName = 'untitled.md'
    try {
      fileName = decodeURIComponent(rawHeaderName) || fileName
    } catch {
      fileName = rawHeaderName || fileName
    }

    return {
      buffer,
      fileName,
      contentType: request.headers.get('content-type') || 'application/octet-stream',
      size: buffer.length,
    }
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    throw new WorkspaceUploadRequestError('Request body must be valid multipart form data', 400)
  }

  const rawFile = formData.get('file')
  if (!rawFile || !(rawFile instanceof File)) {
    throw new WorkspaceUploadRequestError('No file provided', 400)
  }

  if (rawFile.size > MAX_WORKSPACE_FORMDATA_FILE_SIZE) {
    throw new WorkspaceUploadRequestError(getWorkspaceUploadSizeError(rawFile.size), 413)
  }

  return {
    buffer: Buffer.from(await rawFile.arrayBuffer()),
    fileName: rawFile.name || 'untitled.md',
    contentType: rawFile.type || 'application/octet-stream',
    size: rawFile.size,
  }
}

/**
 * GET /api/workspaces/[id]/files
 * List all files for a workspace (requires read permission)
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(listWorkspaceFilesContract, request, context)
      if (!parsed.success) return parsed.response
      const { id: workspaceId } = parsed.data.params
      const { scope } = parsed.data.query

      // Check workspace permissions (requires read)
      const membership = await getWorkspaceMembershipAccess(session.user.id, workspaceId)
      if (!membership.exists || !membership.hasAccess) {
        logger.warn(
          `[${requestId}] User ${session.user.id} lacks permission for workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
      }

      const files = await listWorkspaceFiles(workspaceId, { scope })

      logger.info(`[${requestId}] Listed ${files.length} files for workspace ${workspaceId}`)

      return NextResponse.json({
        success: true,
        files,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error listing workspace files:`, error)
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list files',
        },
        { status: 500 }
      )
    }
  }
)

/**
 * POST /api/workspaces/[id]/files
 * Upload a new file to workspace storage (requires write permission)
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(uploadWorkspaceFileContract, request, context)
      if (!parsed.success) return parsed.response
      const { id: workspaceId } = parsed.data.params

      const access = await checkWorkspaceAccess(workspaceId, session.user.id)
      if (!access.exists || !access.hasAccess) {
        logger.warn(`[${requestId}] User ${session.user.id} cannot access workspace ${workspaceId}`)
        return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
      }

      if (!access.canWrite) {
        logger.warn(
          `[${requestId}] User ${session.user.id} lacks write permission for workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }

      const parsedUpload = await parseWorkspaceUploadRequest(request)

      const userFile = await uploadWorkspaceFile(
        workspaceId,
        session.user.id,
        parsedUpload.buffer,
        parsedUpload.fileName,
        parsedUpload.contentType
      )

      logger.info(`[${requestId}] Uploaded workspace file: ${parsedUpload.fileName}`)

      captureServerEvent(
        session.user.id,
        'file_uploaded',
        { workspace_id: workspaceId, file_type: parsedUpload.contentType },
        { groups: { workspace: workspaceId } }
      )

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.FILE_UPLOADED,
        resourceType: AuditResourceType.FILE,
        resourceId: userFile.id,
        resourceName: parsedUpload.fileName,
        description: `Uploaded file "${parsedUpload.fileName}"`,
        metadata: {
          fileSize: parsedUpload.size,
          fileType: parsedUpload.contentType,
        },
        request,
      })

      return NextResponse.json({
        success: true,
        file: userFile,
      })
    } catch (error) {
      if (error instanceof WorkspaceUploadRequestError) {
        return NextResponse.json({ success: false, error: error.message }, { status: error.status })
      }

      logger.error(`[${requestId}] Error uploading workspace file:`, error)

      const errorMessage = error instanceof Error ? error.message : 'Failed to upload file'
      const isDuplicate =
        error instanceof FileConflictError || errorMessage.includes('already exists')

      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
          isDuplicate,
        },
        { status: isDuplicate ? 409 : 500 }
      )
    }
  }
)
