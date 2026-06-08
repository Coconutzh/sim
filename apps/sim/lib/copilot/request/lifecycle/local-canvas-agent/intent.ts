import type {
  LocalAgentContext,
  LocalCanvasMutationPolicy,
  LocalCanvasReadPolicy,
  LocalCanvasUserIntent,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

export interface LocalCanvasIntentDecision {
  userIntent: LocalCanvasUserIntent
  mutationPolicy: LocalCanvasMutationPolicy
  canvasReadPolicy: LocalCanvasReadPolicy
  reason: string
}

function includesAny(message: string, terms: readonly string[]): boolean {
  const normalized = message.toLowerCase()
  return terms.some((term) => normalized.includes(term.toLowerCase()))
}

function matchesAny(message: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message))
}

const CONSULT_PATTERNS = [
  /先.{0,10}(?:告诉|说|讲|聊|讨论|规划|设计|分析)/,
  /(?:如何|怎么|怎样).{0,12}(?:设计|搭建|规划|构建|安排)/,
  /(?:讨论|聊聊|商量|给我思路|给我建议|设计思路|工作流如何设计)/,
  /(?:先别|不要|暂时别).{0,12}(?:创建|修改|执行|改画布|动画布|生成节点)/,
] as const

const PROPOSE_ONLY_PATTERNS = [
  /(?:先|只).{0,8}(?:给|出|写).{0,8}(?:计划|方案|步骤|patch|修改方案)/i,
  /(?:等我|让我).{0,8}(?:确认|批准|同意).{0,8}(?:再|后).{0,8}(?:执行|修改|创建|生成)/,
  /(?:不要|先别|暂时别).{0,8}(?:执行|应用|修改|创建|写回|生成)/,
] as const

const MUTATION_TERMS = [
  '创建',
  '新建',
  '新增',
  '加一个',
  '加上',
  '补一个',
  '补齐',
  '生成节点',
  '生成工作流',
  '写回',
  '修改',
  '更新',
  '改成',
  '调整成',
  '连接',
  '接到',
  '布局',
  '整理',
  '排列',
  'create',
  'add',
  'update',
  'rewrite',
  'connect',
  'layout',
] as const

const STRONG_CANVAS_MUTATION_TERMS = [
  '创建',
  '新建',
  '新增',
  '加一个',
  '加上',
  '补一个',
  '补齐',
  '写回',
  '修改',
  '更新',
  '改成',
  '调整成',
  '连接',
  '接到',
  '布局',
  '整理',
  '排列',
  'create',
  'add',
  'update',
  'rewrite',
  'connect',
  'layout',
] as const

const CONTEXT_WRITE_TERMS = [
  '保存附件',
  '保存文件',
  '持久化文件',
  '导入文件',
  '提交任务',
  '提交结果',
  '更新任务',
  '开始任务',
  '标记任务',
] as const

const GENERATION_TERMS = [
  '生成并写回',
  '根据这个节点',
  '根据当前节点',
  'aiPrompt',
  'prompt 生成',
  '生成正文',
  '生成图片',
  '生成视频',
  '生成音频',
  'generate output',
] as const

const INSPECTION_TERMS = [
  '总结',
  '分析',
  '检查',
  '判断',
  '读取',
  '说明',
  '有哪些',
  '关系',
  '连接到了',
  '上游',
  '下游',
  '孤立',
  '找到',
  '搜索',
  'inspect',
  'summarize',
  'search',
] as const

const CANVAS_CONTEXT_TERMS = [
  '画布',
  '节点',
  '工作流',
  'workflow',
  'canvas',
  '内容链',
  '文案',
  '脚本',
  '主视觉',
  '视频',
  '音频',
  '配乐',
] as const

function hasConsultSignal(message: string): boolean {
  return matchesAny(message, CONSULT_PATTERNS)
}

function hasProposeOnlySignal(message: string): boolean {
  return matchesAny(message, PROPOSE_ONLY_PATTERNS)
}

function hasMutationSignal(message: string): boolean {
  return includesAny(message, MUTATION_TERMS)
}

function hasStrongCanvasMutationSignal(message: string): boolean {
  return includesAny(message, STRONG_CANVAS_MUTATION_TERMS)
}

function hasContextWriteSignal(message: string): boolean {
  return includesAny(message, CONTEXT_WRITE_TERMS)
}

function hasGenerationSignal(message: string): boolean {
  return includesAny(message, GENERATION_TERMS)
}

function hasCanvasSignal(message: string): boolean {
  return includesAny(message, CANVAS_CONTEXT_TERMS)
}

function hasInspectionSignal(message: string): boolean {
  return includesAny(message, INSPECTION_TERMS)
}

function wantsCurrentCanvas(message: string, context: LocalAgentContext): boolean {
  return (
    context.selectedNodeIds.length > 0 ||
    includesAny(message, ['当前画布', '这个画布', '选中', '当前节点', '基于画布', '基于当前'])
  )
}

export function classifyLocalCanvasUserIntent(
  context: LocalAgentContext
): LocalCanvasIntentDecision {
  const message = context.message.trim()
  if (!message) {
    return {
      userIntent: 'inspect_canvas',
      mutationPolicy: 'read_only',
      canvasReadPolicy: 'none',
      reason: 'empty message',
    }
  }

  const consult = hasConsultSignal(message)
  const proposeOnly = hasProposeOnlySignal(message)
  const mutate = hasMutationSignal(message)
  const strongCanvasMutation = hasStrongCanvasMutationSignal(message)
  const generate = hasGenerationSignal(message)
  const inspect = hasInspectionSignal(message)
  const canvas = hasCanvasSignal(message)
  const currentCanvas = wantsCurrentCanvas(message, context)

  if (proposeOnly) {
    return {
      userIntent: 'propose_plan',
      mutationPolicy: 'propose_only',
      canvasReadPolicy: currentCanvas ? 'required' : 'optional',
      reason: 'user asked for a plan or confirmation before changes',
    }
  }

  if (hasContextWriteSignal(message)) {
    return {
      userIntent: 'mutate_canvas',
      mutationPolicy: 'allow_mutation',
      canvasReadPolicy: currentCanvas ? 'required' : 'optional',
      reason: 'user explicitly requested a local context write action',
    }
  }

  if (consult && canvas && !strongCanvasMutation) {
    return {
      userIntent: 'consult_design',
      mutationPolicy: 'read_only',
      canvasReadPolicy: currentCanvas ? 'optional' : 'none',
      reason: 'user asks to discuss or design before canvas changes',
    }
  }

  if (consult && !mutate) {
    return {
      userIntent: 'consult_design',
      mutationPolicy: 'read_only',
      canvasReadPolicy: currentCanvas ? 'optional' : 'none',
      reason: 'user asks for consultation rather than execution',
    }
  }

  if (generate) {
    return {
      userIntent: 'generate_output',
      mutationPolicy: 'allow_mutation',
      canvasReadPolicy: 'required',
      reason: 'user asks to generate node output',
    }
  }

  if (mutate) {
    return {
      userIntent: 'mutate_canvas',
      mutationPolicy: 'allow_mutation',
      canvasReadPolicy: 'required',
      reason: 'user asks to change the canvas',
    }
  }

  if (inspect || canvas || currentCanvas) {
    return {
      userIntent: 'inspect_canvas',
      mutationPolicy: 'read_only',
      canvasReadPolicy: currentCanvas || inspect ? 'required' : 'optional',
      reason: 'user asks to inspect or reason about canvas context',
    }
  }

  return {
    userIntent: 'non_canvas',
    mutationPolicy: 'read_only',
    canvasReadPolicy: 'none',
    reason: 'no canvas intent detected',
  }
}
