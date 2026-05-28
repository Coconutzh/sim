/**
 * @vitest-environment node
 */
import {
  BLOCK_OPERATIONS,
  OPERATION_TARGETS,
  SUBBLOCK_OPERATIONS,
} from '@sim/realtime-protocol/constants'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IRoomManager, UserPresence } from '@/rooms'

const { mockPersistWorkflowOperation, mockAssertWorkflowMutable } = vi.hoisted(() => ({
  mockPersistWorkflowOperation: vi.fn(),
  mockAssertWorkflowMutable: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@sim/workflow-authz', () => ({
  assertWorkflowMutable: mockAssertWorkflowMutable,
  WorkflowLockedError: class WorkflowLockedError extends Error {
    readonly status = 423
  },
}))

vi.mock('@/database/operations', () => ({
  persistWorkflowOperation: mockPersistWorkflowOperation,
}))

import { setupOperationsHandlers } from '@/handlers/operations'

type WorkflowOperationHandler = (payload: unknown) => Promise<void> | void

function createSocket() {
  const handlers: Record<string, WorkflowOperationHandler> = {}
  const roomEmit = vi.fn()
  const socket = {
    id: 'socket-1',
    on: vi.fn((event: string, handler: WorkflowOperationHandler) => {
      handlers[event] = handler
    }),
    emit: vi.fn(),
    to: vi.fn().mockReturnValue({ emit: roomEmit }),
  }

  return { handlers, socket, roomEmit }
}

function createPresence(role: string): UserPresence {
  return {
    userId: 'user-1',
    workflowId: 'workflow-1',
    userName: 'Test User',
    socketId: 'socket-1',
    joinedAt: Date.now(),
    lastActivity: Date.now(),
    role,
  }
}

function createRoomManager(presence: UserPresence): IRoomManager {
  return {
    isReady: vi.fn().mockReturnValue(true),
    getWorkflowIdForSocket: vi.fn().mockResolvedValue('workflow-1'),
    getUserSession: vi.fn().mockResolvedValue({ userId: 'user-1', userName: 'Test User' }),
    hasWorkflowRoom: vi.fn().mockResolvedValue(true),
    getWorkflowUsers: vi.fn().mockResolvedValue([presence]),
    updateUserActivity: vi.fn().mockResolvedValue(undefined),
    updateRoomLastModified: vi.fn().mockResolvedValue(undefined),
    addUserToRoom: vi.fn().mockResolvedValue(undefined),
    removeUserFromRoom: vi.fn().mockResolvedValue(null),
    broadcastPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    emitToWorkflow: vi.fn(),
    getUniqueUserCount: vi.fn().mockResolvedValue(1),
    getTotalActiveConnections: vi.fn().mockResolvedValue(1),
    handleWorkflowDeletion: vi.fn().mockResolvedValue(undefined),
    handleWorkflowRevert: vi.fn().mockResolvedValue(undefined),
    handleWorkflowUpdate: vi.fn().mockResolvedValue(undefined),
    handleWorkflowDeployed: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    io: {
      in: vi.fn().mockReturnValue({
        fetchSockets: vi.fn().mockResolvedValue([]),
        socketsLeave: vi.fn().mockResolvedValue(undefined),
      }),
    },
  } as unknown as IRoomManager
}

function createPositionOperation(commit = false) {
  return {
    operation: BLOCK_OPERATIONS.UPDATE_POSITION,
    target: OPERATION_TARGETS.BLOCK,
    payload: {
      id: 'block-1',
      position: { x: 10, y: 20 },
      commit,
    },
    timestamp: Date.now(),
    operationId: 'op-1',
  }
}

function createSubblockUpdateOperation() {
  return {
    operation: SUBBLOCK_OPERATIONS.UPDATE,
    target: OPERATION_TARGETS.SUBBLOCK,
    payload: {
      blockId: 'block-1',
      subblockId: 'contentHtml',
      value: '<p>Persist me</p>',
    },
    timestamp: Date.now(),
    operationId: 'op-subblock-1',
  }
}

describe('setupOperationsHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssertWorkflowMutable.mockResolvedValue(undefined)
  })

  it('denies non-committed position broadcasts for read-only users', async () => {
    const { handlers, socket, roomEmit } = createSocket()
    const roomManager = createRoomManager(createPresence('read'))

    setupOperationsHandlers(
      socket as unknown as Parameters<typeof setupOperationsHandlers>[0],
      roomManager
    )

    await handlers['workflow-operation'](createPositionOperation(false))

    expect(socket.emit).toHaveBeenCalledWith('operation-forbidden', {
      type: 'INSUFFICIENT_PERMISSIONS',
      message: "Role 'read' not permitted to perform 'update-position' on 'block'",
      operation: 'update-position',
      target: 'block',
    })
    expect(roomEmit).not.toHaveBeenCalled()
    expect(mockPersistWorkflowOperation).not.toHaveBeenCalled()
  })

  it('allows non-committed position broadcasts for write users without persistence', async () => {
    const { handlers, socket, roomEmit } = createSocket()
    const roomManager = createRoomManager(createPresence('write'))

    setupOperationsHandlers(
      socket as unknown as Parameters<typeof setupOperationsHandlers>[0],
      roomManager
    )

    await handlers['workflow-operation'](createPositionOperation(false))

    expect(roomEmit).toHaveBeenCalledWith(
      'workflow-operation',
      expect.objectContaining({
        operation: 'update-position',
        target: 'block',
        userId: 'user-1',
      })
    )
    expect(mockPersistWorkflowOperation).not.toHaveBeenCalled()
  })

  it('persists and broadcasts single subblock updates for write users', async () => {
    const { handlers, socket, roomEmit } = createSocket()
    const roomManager = createRoomManager(createPresence('write'))

    setupOperationsHandlers(
      socket as unknown as Parameters<typeof setupOperationsHandlers>[0],
      roomManager
    )

    const operation = createSubblockUpdateOperation()
    await handlers['workflow-operation'](operation)

    expect(mockPersistWorkflowOperation).toHaveBeenCalledWith(
      'workflow-1',
      expect.objectContaining({
        operation: SUBBLOCK_OPERATIONS.UPDATE,
        target: OPERATION_TARGETS.SUBBLOCK,
        payload: operation.payload,
      })
    )
    expect(roomEmit).toHaveBeenCalledWith(
      'workflow-operation',
      expect.objectContaining({
        operation: SUBBLOCK_OPERATIONS.UPDATE,
        target: OPERATION_TARGETS.SUBBLOCK,
        payload: operation.payload,
      })
    )
    expect(socket.emit).toHaveBeenCalledWith(
      'operation-confirmed',
      expect.objectContaining({ operationId: 'op-subblock-1' })
    )
  })
})
