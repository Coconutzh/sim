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
  confidence: number
  evidence: string[]
  requiresUserConfirmation: boolean
  reason: string
}

function includesAny(message: string, terms: readonly string[]): boolean {
  const normalized = message.toLowerCase()
  return terms.some((term) => normalized.includes(term.toLowerCase()))
}

function matchesAny(message: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message))
}

const EXPLICIT_READ_ONLY_PATTERNS = [
  /(?:^|[，。,.、\s])先(?!生成|创建|新建|新增|搭建|制作).{0,10}(?:告诉|说|讲|聊|讨论|分析|解释)/,
  /(?:只|仅).{0,8}(?:讨论|聊|分析|给我思路|给我建议|给方案)/,
  /(?:^|[，。,.、\s])(?:讨论一下|讨论下|聊聊|商量一下|商量下)(?:$|[，。,.、\s])/,
  /(?:^|[，。,.、\s])给我(?:一些|点|个|一个|一版)?.{0,4}(?:思路|建议)(?:$|[，。,.、\s])/,
  /(?:先别|不要|暂时别|不需要|不用).{0,12}(?:创建|修改|执行|改画布|动画布|生成节点|写回|应用)/,
] as const

const CONSULT_PATTERNS = [
  /(?:^|[，。,.、\s])先(?!生成|创建|新建|新增|搭建|制作).{0,10}(?:告诉|说|讲|聊|讨论|规划|设计|分析)/,
  /(?:如何|怎么|怎样).{0,12}(?:设计|搭建|规划|构建|安排)/,
  /(?:讨论|聊聊|商量|给我思路|给我建议|设计思路|工作流如何设计)/,
  /(?:先别|不要|暂时别).{0,12}(?:创建|修改|执行|改画布|动画布|生成节点)/,
] as const

const PROPOSE_ONLY_PATTERNS = [
  /(?:先|只).{0,8}(?:给|出|写).{0,8}(?:计划|方案|步骤|patch|修改方案)/i,
  /(?:等我|让我).{0,8}(?:确认|批准|同意).{0,8}(?:再|后).{0,8}(?:执行|修改|创建|生成)/,
  /(?:不要|先别|暂时别).{0,8}(?:执行|应用|修改|创建|写回)/,
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
  '删除',
  '删掉',
  '清空',
  '移除',
  'create',
  'add',
  'update',
  'rewrite',
  'connect',
  'layout',
  'delete',
  'remove',
  'clear',
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
  '删除',
  '删掉',
  '清空',
  '移除',
  'create',
  'add',
  'update',
  'rewrite',
  'connect',
  'layout',
  'delete',
  'remove',
  'clear',
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

const NON_CANVAS_TERMS = [
  '考试',
  '试卷',
  '出题',
  '考题',
  '天气',
  '气温',
  '新闻',
  '热搜',
  '百科',
  '历史事件',
  '股票',
  '汇率',
  '航班',
  '写代码',
  '代码报错',
  'debug',
  'typescript',
  'python',
  'java',
] as const

const NON_CANVAS_PATTERNS = [/[中高]考/, /考研|升学|备考/] as const

const DESTRUCTIVE_PATTERNS = [
  /(?:删除|删掉|清空|移除).{0,12}(?:所有|全部|整个|全都|all|everything).{0,12}(?:节点|画布|workflow|canvas)/i,
  /(?:delete|remove|clear).{0,20}(?:all|everything|entire).{0,20}(?:nodes|canvas|workflow)/i,
] as const

const EXECUTE_FOLLOW_UP_PATTERNS = [
  /(?:现在|那就|就按|按刚才|按这个|可以|确认).{0,12}(?:创建|执行|开始|落实|生成|做出来|改画布|应用)/,
  /^(?:继续|开始执行|执行吧|确认|可以执行|go ahead|run it)$/i,
] as const

const DISCUSSION_FOLLOW_UP_PATTERNS = [
  /(?:继续|再).{0,8}(?:讨论|聊|完善|调整|规划|设计)/,
  /(?:偏|更偏|风格|受众|时长|口播|不要创建|先不创建|先不改)/,
] as const

const EXPLICIT_CURRENT_CANVAS_TERMS = [
  '当前画布',
  '这个画布',
  '基于画布',
  '基于当前',
  '选中',
  '当前节点',
  '这个节点',
] as const

function hasConsultSignal(message: string): boolean {
  return matchesAny(message, CONSULT_PATTERNS)
}

function hasExplicitReadOnlySignal(message: string): boolean {
  return matchesAny(message, EXPLICIT_READ_ONLY_PATTERNS)
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
  if (/(?:不要|先别|暂时别|不需要|不用).{0,8}生成/.test(message)) return false
  if (/(?:do not|don't|without).{0,12}generat/i.test(message)) return false
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
    Boolean(context.selectedNodeIds.length > 0 && includesAny(message, ['它', '这个'])) ||
    includesAny(message, EXPLICIT_CURRENT_CANVAS_TERMS)
  )
}

function hasTaskMemorySignal(context: LocalAgentContext): boolean {
  return Boolean(
    context.memory?.taskState.goal?.trim() ||
      context.memory?.taskState.openQuestions.length ||
      context.memory?.taskState.lastObservation?.trim()
  )
}

function hasExecuteFollowUpSignal(message: string): boolean {
  return matchesAny(message, EXECUTE_FOLLOW_UP_PATTERNS)
}

function hasDiscussionFollowUpSignal(message: string): boolean {
  return matchesAny(message, DISCUSSION_FOLLOW_UP_PATTERNS)
}

function hasDestructiveSignal(message: string): boolean {
  return matchesAny(message, DESTRUCTIVE_PATTERNS)
}

function hasNonCanvasSignal(message: string): boolean {
  return includesAny(message, NON_CANVAS_TERMS) || matchesAny(message, NON_CANVAS_PATTERNS)
}

function makeDecision(params: {
  userIntent: LocalCanvasUserIntent
  mutationPolicy: LocalCanvasMutationPolicy
  canvasReadPolicy: LocalCanvasReadPolicy
  reason: string
  confidence: number
  evidence: string[]
  requiresUserConfirmation?: boolean
}): LocalCanvasIntentDecision {
  return {
    userIntent: params.userIntent,
    mutationPolicy: params.mutationPolicy,
    canvasReadPolicy: params.canvasReadPolicy,
    reason: params.reason,
    confidence: Math.max(0, Math.min(1, params.confidence)),
    evidence: [...new Set(params.evidence)].filter(Boolean),
    requiresUserConfirmation: params.requiresUserConfirmation ?? false,
  }
}

export function classifyLocalCanvasUserIntent(
  context: LocalAgentContext
): LocalCanvasIntentDecision {
  const message = context.message.trim()
  if (!message) {
    return makeDecision({
      userIntent: 'inspect_canvas',
      mutationPolicy: 'read_only',
      canvasReadPolicy: 'none',
      reason: 'empty message',
      confidence: 0.4,
      evidence: ['empty_message'],
    })
  }

  const consult = hasConsultSignal(message)
  const explicitReadOnly = hasExplicitReadOnlySignal(message)
  const proposeOnly = hasProposeOnlySignal(message)
  const mutate = hasMutationSignal(message)
  const strongCanvasMutation = hasStrongCanvasMutationSignal(message)
  const generate = hasGenerationSignal(message)
  const inspect = hasInspectionSignal(message)
  const canvas = hasCanvasSignal(message)
  const currentCanvas = wantsCurrentCanvas(message, context)
  const hasTaskMemory = hasTaskMemorySignal(context)
  const executeFollowUp = hasExecuteFollowUpSignal(message)
  const discussionFollowUp = hasDiscussionFollowUpSignal(message)
  const destructive = hasDestructiveSignal(message)
  const nonCanvas = hasNonCanvasSignal(message)

  if (destructive) {
    return makeDecision({
      userIntent: 'propose_plan',
      mutationPolicy: 'propose_only',
      canvasReadPolicy: 'required',
      reason: 'destructive canvas changes require explicit confirmation',
      confidence: 0.95,
      evidence: ['destructive_canvas_request'],
      requiresUserConfirmation: true,
    })
  }

  if (hasTaskMemory && discussionFollowUp && !executeFollowUp) {
    return makeDecision({
      userIntent: 'consult_design',
      mutationPolicy: 'read_only',
      canvasReadPolicy: currentCanvas ? 'optional' : 'none',
      reason: 'user follow-up continues an open design discussion',
      confidence: 0.78,
      evidence: [
        'task_memory_signal',
        'discussion_follow_up_signal',
        explicitReadOnly ? 'explicit_read_only_signal' : '',
      ],
    })
  }

  if (proposeOnly) {
    return makeDecision({
      userIntent: 'propose_plan',
      mutationPolicy: 'propose_only',
      canvasReadPolicy: currentCanvas ? 'required' : 'optional',
      reason: 'user asked for a plan or confirmation before changes',
      confidence: 0.9,
      evidence: [
        'propose_only_signal',
        currentCanvas ? 'current_canvas_reference' : 'no_current_canvas_reference',
      ],
      requiresUserConfirmation: true,
    })
  }

  if (hasContextWriteSignal(message)) {
    return makeDecision({
      userIntent: 'mutate_canvas',
      mutationPolicy: 'allow_mutation',
      canvasReadPolicy: currentCanvas ? 'required' : 'optional',
      reason: 'user explicitly requested a local context write action',
      confidence: 0.86,
      evidence: ['context_write_signal'],
    })
  }

  if (nonCanvas && !canvas && !currentCanvas) {
    return makeDecision({
      userIntent: 'non_canvas',
      mutationPolicy: 'read_only',
      canvasReadPolicy: 'none',
      reason: 'message is clearly outside current canvas operations',
      confidence: 0.9,
      evidence: ['non_canvas_signal'],
    })
  }

  if (hasTaskMemory && executeFollowUp) {
    return makeDecision({
      userIntent: 'mutate_canvas',
      mutationPolicy: 'allow_mutation',
      canvasReadPolicy: 'required',
      reason: 'user follow-up asks to execute the remembered task plan',
      confidence: 0.82,
      evidence: ['task_memory_signal', 'execute_follow_up_signal'],
    })
  }

  if (hasTaskMemory && discussionFollowUp && !mutate) {
    return makeDecision({
      userIntent: 'consult_design',
      mutationPolicy: 'read_only',
      canvasReadPolicy: currentCanvas ? 'optional' : 'none',
      reason: 'user follow-up continues an open design discussion',
      confidence: 0.78,
      evidence: [
        'task_memory_signal',
        'discussion_follow_up_signal',
        explicitReadOnly ? 'explicit_read_only_signal' : '',
      ],
    })
  }

  if (consult && canvas && !strongCanvasMutation) {
    return makeDecision({
      userIntent: 'consult_design',
      mutationPolicy: 'read_only',
      canvasReadPolicy: currentCanvas ? 'optional' : 'none',
      reason: 'user asks to discuss or design before canvas changes',
      confidence: 0.88,
      evidence: [
        'consult_signal',
        'canvas_topic_signal',
        'no_strong_mutation_signal',
        explicitReadOnly ? 'explicit_read_only_signal' : '',
      ],
    })
  }

  if (consult && !mutate) {
    return makeDecision({
      userIntent: 'consult_design',
      mutationPolicy: 'read_only',
      canvasReadPolicy: currentCanvas ? 'optional' : 'none',
      reason: 'user asks for consultation rather than execution',
      confidence: 0.82,
      evidence: [
        'consult_signal',
        explicitReadOnly ? 'explicit_read_only_signal' : '',
        currentCanvas ? 'current_canvas_reference' : 'no_mutation_signal',
      ],
    })
  }

  if (generate) {
    return makeDecision({
      userIntent: 'generate_output',
      mutationPolicy: 'allow_mutation',
      canvasReadPolicy: 'required',
      reason: 'user asks to generate node output',
      confidence: 0.86,
      evidence: ['generation_signal'],
    })
  }

  if (mutate) {
    return makeDecision({
      userIntent: 'mutate_canvas',
      mutationPolicy: 'allow_mutation',
      canvasReadPolicy: 'required',
      reason: 'user asks to change the canvas',
      confidence: nonCanvas && canvas ? 0.76 : 0.88,
      evidence: [
        'mutation_signal',
        canvas ? 'canvas_topic_signal' : 'implicit_canvas_change_signal',
        nonCanvas ? 'non_canvas_topic_used_as_canvas_subject' : '',
      ],
    })
  }

  if (inspect || canvas || currentCanvas) {
    return makeDecision({
      userIntent: 'inspect_canvas',
      mutationPolicy: 'read_only',
      canvasReadPolicy: currentCanvas || inspect ? 'required' : 'optional',
      reason: 'user asks to inspect or reason about canvas context',
      confidence: 0.78,
      evidence: [
        inspect ? 'inspection_signal' : '',
        canvas ? 'canvas_topic_signal' : '',
        currentCanvas ? 'current_canvas_reference' : '',
        explicitReadOnly ? 'explicit_read_only_signal' : '',
      ],
    })
  }

  if (hasTaskMemory && !nonCanvas) {
    return makeDecision({
      userIntent: 'consult_design',
      mutationPolicy: 'read_only',
      canvasReadPolicy: 'none',
      reason: 'user follow-up belongs to an open local agent task',
      confidence: 0.66,
      evidence: [
        'task_memory_signal',
        'ambiguous_follow_up',
        explicitReadOnly ? 'explicit_read_only_signal' : '',
      ],
    })
  }

  return makeDecision({
    userIntent: 'non_canvas',
    mutationPolicy: 'read_only',
    canvasReadPolicy: 'none',
    reason: 'no canvas intent detected',
    confidence: nonCanvas ? 0.9 : 0.6,
    evidence: [nonCanvas ? 'non_canvas_signal' : 'no_canvas_signal'],
  })
}
