import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamingContext,
} from '@/lib/copilot/request/types'
import type { EditWorkflowOperation } from '@/lib/copilot/tools/server/workflow/edit-workflow/types'
import type { ContentNodePresetId } from '@/lib/product/content-node-presets'
import type { ContentReferenceRole } from '@/lib/workflows/content-references'
import type { ProviderId, ProviderRequest } from '@/providers/types'

export type LocalAgentSessionScope = 'personal' | 'team' | 'task'
export type LocalAgentRole = 'planner' | 'actor' | 'verifier' | 'summarizer' | 'decision'
export type LocalAgentRisk = 'low' | 'medium' | 'high'
export type LocalCanvasUserIntent =
  | 'consult_design'
  | 'inspect_canvas'
  | 'propose_plan'
  | 'mutate_canvas'
  | 'generate_output'
  | 'non_canvas'
export type LocalAgentDecisionIntent =
  | LocalCanvasUserIntent
  | 'ask_confirmation'
  | 'ask_clarification'
  | 'ambiguous'
export type LocalCanvasMutationPolicy = 'read_only' | 'propose_only' | 'allow_mutation'
export type LocalCanvasReadPolicy = 'none' | 'optional' | 'required'
export type LocalCanvasNodeKind = ContentNodePresetId | 'generic_workflow_block'
export type LocalCanvasToolName =
  | 'canvas.read_summary'
  | 'canvas.read_node'
  | 'canvas.read_selected_nodes'
  | 'canvas.search_nodes'
  | 'canvas.inspect_schema'
  | 'canvas.propose_patch'
  | 'canvas.apply_patch'
  | 'canvas.verify_patch'
  | 'canvas.generate_node_output'
export type LocalMediaToolName = 'media.analyze_node_media'
export type LocalAgentToolName =
  | LocalCanvasToolName
  | LocalMediaToolName
  | 'read_file'
  | 'search_workspace'
  | 'materialize_file'
  | 'query_knowledge'
  | 'search_docs'
  | 'read_tasks'
  | 'update_task_result'
  | 'submit_task_result'

export interface LocalAgentModelConfig {
  provider?: ProviderId
  model: string
  mode: 'structured' | 'tool-call'
  apiKey?: string
  useContentCanvasTextResolver?: boolean
}

export interface LocalAgentModelRequest {
  role: LocalAgentRole
  systemPrompt: string
  prompt: string
  messages?: ProviderRequest['messages']
  workspaceId: string
  temperature?: number
  maxTokens?: number
  responseFormat?: ProviderRequest['responseFormat']
  abortSignal?: AbortSignal
}

export interface LocalAgentSkill {
  id: string
  name: string
  description: string
  content: string
  enabled: boolean
  source: 'agent_template' | 'team_override' | 'workspace'
}

export interface LocalAgentContext {
  userId: string
  workspaceId: string
  workflowId: string
  chatId?: string
  message: string
  sessionScope: LocalAgentSessionScope
  agent: {
    code: string
    name: string
    description: string
    systemPrompt: string
  }
  discipline: {
    id: string
    code: string
    name: string
  }
  workgroup: {
    id: string
    name: string
    organizationId: string
    teamWorkspaceId: string | null
  }
  permissions: {
    canRead: boolean
    canWrite: boolean
    canPublish: boolean
    readonlyReason?: string
  }
  selectedNodeIds: string[]
  attachments?: LocalAgentAttachment[]
  attachedContexts?: LocalAgentAttachedContext[]
  conversationHistory: LocalAgentMessage[]
  memory?: LocalAgentMemoryData
  skills: LocalAgentSkill[]
  model: LocalAgentModelConfig
  confirmationMode: 'manual' | 'auto'
  thinkingLevel: 'standard' | 'extra'
  requestPayload: Record<string, unknown>
  execContext: ExecutionContext
  streamContext: StreamingContext
  options: Pick<OrchestratorOptions, 'abortSignal' | 'onEvent'>
}

export interface LocalAgentAttachment {
  id?: string
  key?: string
  name: string
  type?: string
  size?: number
  url?: string
  storageContext?: 'workspace' | 'mothership'
}

export interface LocalAgentAttachedContext {
  type: string
  tag: string
  content: string
}

export interface LocalAgentMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface LocalAgentMemoryData {
  version: 1 | 2
  scope: 'personal' | 'thread'
  userId: string
  workspaceId: string
  workflowId: string
  agentCode: string
  chatId?: string
  conversationSummary: string
  taskState: {
    goal?: string
    completedSteps: string[]
    openQuestions: string[]
    lastObservation?: string
  }
  canvasSummary: string
  recentObservations: LocalAgentObservation[]
  toolResultRefs?: LocalAgentToolResultRef[]
  updatedAt: string
}

export interface LocalAgentObservation {
  toolName: LocalAgentToolName | 'planner' | 'verifier' | 'memory' | 'decision'
  summary: string
  success: boolean
  timestamp: string
  outputRef?: string
  output?: unknown
}

export interface LocalAgentToolResultRef {
  id: string
  toolName: LocalAgentToolName
  summary: string
  storageKey: string
  outputPreview?: string
  outputSizeChars?: number
  createdAt: string
}

export interface CanvasNodeRecord {
  id: string
  name: string
  blockType: string
  kind: LocalCanvasNodeKind
  position: { x: number; y: number }
  values: Record<string, unknown>
  raw: Record<string, unknown>
}

export interface CanvasNodeSummary {
  id: string
  name: string
  blockType: string
  kind: LocalCanvasNodeKind
  position: { x: number; y: number }
  selected: boolean
  summary: string
  capabilities: CanvasNodeCapabilities
}

export interface CanvasNodeDetail extends CanvasNodeSummary {
  fields: Record<string, unknown>
  textContent?: string
  file?: Record<string, unknown> | null
}

export interface CanvasNodeCapabilities {
  canRead: boolean
  canWrite: boolean
  canGenerate: boolean
  canReferenceFile: boolean
}

export interface CanvasEditableField {
  id: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file'
  required?: boolean
}

export interface CanvasPatchValidationResult {
  valid: boolean
  errors: string[]
}

export interface CanvasNodeAdapter {
  kind: LocalCanvasNodeKind
  blockType: string
  capabilities: CanvasNodeCapabilities
  summarize(node: CanvasNodeRecord, selected: boolean): CanvasNodeSummary
  readDetail(node: CanvasNodeRecord, selected: boolean): CanvasNodeDetail
  getEditableFields(): CanvasEditableField[]
  buildCreateOperation(input: LocalCanvasCreateNodeOperation): EditWorkflowOperation
  buildUpdateOperation(input: LocalCanvasUpdateNodeOperation): EditWorkflowOperation
  validatePatch(operation: LocalCanvasPatchOperation): CanvasPatchValidationResult
}

export type LocalCanvasPatchOperation =
  | LocalCanvasCreateNodeOperation
  | LocalCanvasUpdateNodeOperation
  | LocalCanvasMoveNodeOperation
  | LocalCanvasDeleteNodeOperation
  | LocalCanvasConnectOperation
  | LocalCanvasAddContentReferenceOperation
  | LocalCanvasRemoveContentReferenceOperation
  | LocalCanvasLayoutOperation

export interface LocalCanvasPatch {
  operations: LocalCanvasPatchOperation[]
  reason?: string
}

export interface LocalCanvasCreateNodeOperation {
  type: 'create_node'
  operationId?: string
  clientNodeId?: string
  nodeId?: string
  kind: LocalCanvasNodeKind
  title: string
  position?: { x: number; y: number }
  fields?: Record<string, unknown>
}

export interface LocalCanvasUpdateNodeOperation {
  type: 'update_node'
  operationId?: string
  nodeId: string
  fields: Record<string, unknown>
}

export interface LocalCanvasMoveNodeOperation {
  type: 'move_node'
  operationId?: string
  nodeId: string
  position: { x: number; y: number }
}

export interface LocalCanvasDeleteNodeOperation {
  type: 'delete_node'
  operationId?: string
  nodeId: string
}

export interface LocalCanvasConnectOperation {
  type: 'connect'
  operationId?: string
  sourceNodeId: string
  targetNodeId: string
}

export interface LocalCanvasAddContentReferenceOperation {
  type: 'add_content_reference'
  operationId?: string
  consumerNodeId: string
  sourceNodeId: string
  role: ContentReferenceRole
}

export interface LocalCanvasRemoveContentReferenceOperation {
  type: 'remove_content_reference'
  operationId?: string
  consumerNodeId: string
  sourceNodeId: string
  role?: ContentReferenceRole
}

export interface LocalCanvasLayoutOperation {
  type: 'layout_nodes'
  operationId?: string
  nodeIds?: string[]
  direction: 'horizontal' | 'vertical' | 'grid'
}

export interface LocalCanvasGenerationTarget {
  nodeId?: string
  clientNodeId?: string
  afterOperationId?: string
  kind?: LocalCanvasNodeKind
  reason?: string
}

export interface LocalCanvasVerifyOperationResult {
  operationId: string
  operationType: LocalCanvasPatchOperation['type'] | 'generation'
  nodeId?: string
  clientNodeId?: string
  field?: string
  sourceNodeId?: string
  targetNodeId?: string
  consumerNodeId?: string
  role?: ContentReferenceRole
  expected?: unknown
  actual?: unknown
  success: boolean
  error?: string
}

export interface CanvasSnapshot {
  workflowId: string
  workspaceId: string
  nodes: CanvasNodeRecord[]
  edges: Array<{
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
    data?: {
      kind?: unknown
      autoLinkType?: unknown
    }
  }>
}

export interface LocalAgentPlanStep {
  id: string
  title: string
  intent: 'inspect' | 'create' | 'update' | 'connect' | 'generate' | 'verify' | 'answer'
  toolHints: LocalAgentToolName[]
  expectedObservation: string
}

export interface LocalAgentPlan {
  goal: string
  risk: LocalAgentRisk
  userIntent?: LocalCanvasUserIntent
  mutationPolicy?: LocalCanvasMutationPolicy
  canvasReadPolicy?: LocalCanvasReadPolicy
  intentConfidence?: number
  intentEvidence?: string[]
  requiresUserConfirmation?: boolean
  requiresClarification: boolean
  clarificationQuestion?: string
  steps: LocalAgentPlanStep[]
  successCriteria: string[]
  patch?: LocalCanvasPatch
  generateNodeIds?: string[]
  generationTargets?: LocalCanvasGenerationTarget[]
  readNodeIds?: string[]
}

export interface LocalAgentToolCall {
  name: LocalAgentToolName
  input: Record<string, unknown>
}

export interface LocalAgentDecisionSemantics {
  intent?: LocalAgentDecisionIntent
  confidence?: number
  intentReason?: string
}

export type LocalAgentDecision =
  | LocalAgentToolCallDecision
  | LocalAgentParallelToolCallsDecision
  | LocalAgentAskConfirmationDecision
  | LocalAgentAskClarificationDecision
  | LocalAgentFinalAnswerDecision

export interface LocalAgentToolCallDecision extends LocalAgentDecisionSemantics {
  type: 'tool_call'
  toolName: LocalAgentToolName
  toolInput: Record<string, unknown>
  userVisibleReason: string
  risk: LocalAgentRisk
}

export interface LocalAgentParallelToolCallsDecision extends LocalAgentDecisionSemantics {
  type: 'tool_calls'
  toolCalls: Array<{
    toolName: LocalAgentToolName
    toolInput: Record<string, unknown>
    userVisibleReason?: string
  }>
  userVisibleReason: string
  risk: LocalAgentRisk
}

export interface LocalAgentAskConfirmationDecision extends LocalAgentDecisionSemantics {
  type: 'ask_confirmation'
  question: string
  pendingToolCall?: LocalAgentToolCall
  risk: Extract<LocalAgentRisk, 'medium' | 'high'>
}

export interface LocalAgentAskClarificationDecision extends LocalAgentDecisionSemantics {
  type: 'ask_clarification'
  question: string
}

export interface LocalAgentFinalAnswerDecision extends LocalAgentDecisionSemantics {
  type: 'final_answer'
  answer: string
  memoryUpdate?: LocalAgentThreadMemoryUpdate
}

export interface LocalAgentThreadMemoryUpdate {
  conversationSummary?: string
  canvasSummary?: string
  taskState?: {
    goal?: string
    openQuestions?: string[]
    lastObservation?: string
  }
}

export interface LocalAgentToolResult {
  name: LocalAgentToolName
  success: boolean
  output?: unknown
  error?: string
  summary: string
}

export interface LocalAgentToolLoopResult {
  plan: LocalAgentPlan
  observations: LocalAgentObservation[]
  answer: string
}
