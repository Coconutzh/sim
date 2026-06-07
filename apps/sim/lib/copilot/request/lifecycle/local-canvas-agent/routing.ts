import type { LocalAgentContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

export type LocalCanvasAgentRoutingKind = 'canvas' | 'non_canvas' | 'ambiguous'

export interface LocalCanvasAgentRoutingDecision {
  kind: LocalCanvasAgentRoutingKind
  reason: string
}

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

const CANVAS_TERMS = [
  '画布',
  '节点',
  '工作流',
  'workflow',
  'canvas',
  '选中',
  '当前节点',
  '内容链',
  '文案',
  '脚本',
  '主视觉',
  '图片',
  '图像',
  '视频',
  '音频',
  '配乐',
  '生成',
  '写回',
  '连接',
  '布局',
  '整理',
  '补齐',
  '创建',
  '新建',
  '修改',
  '更新',
  '提示词',
  'prompt',
] as const

function includesAny(value: string, terms: readonly string[]): boolean {
  const normalized = value.toLowerCase()
  return terms.some((term) => normalized.includes(term.toLowerCase()))
}

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value))
}

function hasCanvasContext(context: LocalAgentContext): boolean {
  return (
    context.selectedNodeIds.length > 0 ||
    Boolean(context.attachments?.length) ||
    Boolean(context.attachedContexts?.length)
  )
}

export function classifyLocalCanvasAgentRouting(
  context: LocalAgentContext
): LocalCanvasAgentRoutingDecision {
  const message = context.message.trim()
  if (!message) {
    return { kind: 'ambiguous', reason: 'empty user message' }
  }

  if (hasCanvasContext(context)) {
    return { kind: 'canvas', reason: 'request includes selected canvas nodes or attached context' }
  }

  const hasCanvasIntent = includesAny(message, CANVAS_TERMS)
  if (hasCanvasIntent) {
    return { kind: 'canvas', reason: 'message includes canvas intent' }
  }

  const hasNonCanvasIntent =
    includesAny(message, NON_CANVAS_TERMS) || matchesAny(message, NON_CANVAS_PATTERNS)
  if (hasNonCanvasIntent) {
    return { kind: 'non_canvas', reason: 'message is clearly outside current canvas operations' }
  }

  return { kind: 'ambiguous', reason: 'no clear non-canvas intent detected' }
}

export function shouldRunLocalCanvasAgent(context: LocalAgentContext): boolean {
  return classifyLocalCanvasAgentRouting(context).kind !== 'non_canvas'
}
