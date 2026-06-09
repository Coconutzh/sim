import { executeLocalAgentModelRequest } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/config'
import { buildLocalAgentRoleSystemPrompt } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/prompts'
import type {
  CanvasNodeDetail,
  CanvasNodeSummary,
  LocalAgentContext,
  LocalAgentObservation,
  LocalAgentPlan,
  LocalAgentToolCall,
  LocalCanvasNodeKind,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const INTERNAL_FIELD_PATTERNS = [
  /"workflowId"/,
  /"workspaceId"/,
  /"capabilities"/,
  /"fields"/,
  /\bsystemPrompt\b/i,
  /\bpersona\b/i,
  /\bprofile instructions\b/i,
  /\bworkflowId\b/,
  /\bworkspaceId\b/,
  /\bcapabilities\b/,
  /(?:我是|作为|这里是).{0,18}(?:agent|代理|助手|角色|负责人|统筹|导演)/i,
  /(?:各位|各组|团队|成员).{0,18}(?:注意|同步|请看|请确认|大家)/,
  /(?:以|用).{0,12}(?:agent|代理|角色|负责人|统筹|导演).{0,12}(?:身份|口吻|视角)/i,
]

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function isMutationTool(toolName: LocalAgentToolCall['name']): boolean {
  return (
    toolName === 'canvas.apply_patch' ||
    toolName === 'canvas.generate_node_output' ||
    toolName === 'materialize_file' ||
    toolName === 'update_task_result' ||
    toolName === 'submit_task_result'
  )
}

function hasFailedObservation(observations: LocalAgentObservation[]): boolean {
  return observations.some((observation) => !observation.success)
}

export function selectLocalAgentNextToolCall(params: {
  observations: LocalAgentObservation[]
  candidates: LocalAgentToolCall[]
}): LocalAgentToolCall | null {
  for (const candidate of params.candidates) {
    if (hasFailedObservation(params.observations) && isMutationTool(candidate.name)) {
      continue
    }
    return candidate
  }
  return null
}

function asNodeSummary(value: unknown): CanvasNodeSummary | null {
  const record = asRecord(value)
  const position = asRecord(record.position)
  const capabilities = asRecord(record.capabilities)
  if (
    typeof record.id !== 'string' ||
    typeof record.name !== 'string' ||
    typeof record.blockType !== 'string' ||
    typeof record.kind !== 'string' ||
    typeof record.summary !== 'string'
  ) {
    return null
  }
  return {
    id: record.id,
    name: record.name,
    blockType: record.blockType,
    kind: record.kind as CanvasNodeSummary['kind'],
    position: {
      x: typeof position.x === 'number' ? position.x : 0,
      y: typeof position.y === 'number' ? position.y : 0,
    },
    selected: record.selected === true,
    summary: record.summary,
    capabilities: {
      canRead: capabilities.canRead === true,
      canWrite: capabilities.canWrite === true,
      canGenerate: capabilities.canGenerate === true,
      canReferenceFile: capabilities.canReferenceFile === true,
    },
  }
}

function asNodeDetail(value: unknown): CanvasNodeDetail | null {
  const summary = asNodeSummary(value)
  if (!summary) return null
  const record = asRecord(value)
  return {
    ...summary,
    fields: asRecord(record.fields),
    textContent: typeof record.textContent === 'string' ? record.textContent : undefined,
    file: record.file && typeof record.file === 'object' ? asRecord(record.file) : null,
  }
}

function getReadSummaryOutput(observations: LocalAgentObservation[]): {
  nodes: CanvasNodeSummary[]
  edges: Array<{ source: string; target: string }>
} | null {
  const output = observations.find(
    (observation) => observation.toolName === 'canvas.read_summary'
  )?.output
  const record = asRecord(output)
  const nodes = Array.isArray(record.nodes)
    ? record.nodes.map(asNodeSummary).filter((node): node is CanvasNodeSummary => Boolean(node))
    : []
  const edges = Array.isArray(record.edges)
    ? record.edges.flatMap((edge) => {
        const item = asRecord(edge)
        return typeof item.source === 'string' && typeof item.target === 'string'
          ? [{ source: item.source, target: item.target }]
          : []
      })
    : []
  return nodes.length || edges.length ? { nodes, edges } : null
}

function getSelectedDetails(observations: LocalAgentObservation[]): CanvasNodeDetail[] {
  const output = observations.find(
    (observation) => observation.toolName === 'canvas.read_selected_nodes'
  )?.output
  if (!Array.isArray(output)) return []
  return output.map(asNodeDetail).filter((node): node is CanvasNodeDetail => Boolean(node))
}

function getSearchOutput(observations: LocalAgentObservation[]): CanvasNodeSummary[] {
  const output = observations.find(
    (observation) => observation.toolName === 'canvas.search_nodes'
  )?.output
  if (!Array.isArray(output)) return []
  return output.map(asNodeSummary).filter((node): node is CanvasNodeSummary => Boolean(node))
}

function nodeLabel(node: Pick<CanvasNodeSummary, 'name' | 'kind'>): string {
  const kindLabel =
    node.kind === 'text'
      ? '文本'
      : node.kind === 'image'
        ? '图片'
        : node.kind === 'video'
          ? '视频'
          : node.kind === 'audio'
            ? '音频'
            : node.kind
  return `${node.name}（${kindLabel}）`
}

function includesAny(message: string, terms: string[]): boolean {
  const normalized = message.toLowerCase()
  return terms.some((term) => normalized.includes(term.toLowerCase()))
}

const REQUESTED_KIND_TERMS: Array<{ kind: LocalCanvasNodeKind; terms: string[] }> = [
  { kind: 'image', terms: ['图片', '图像', '视觉', '主视觉', 'image'] },
  { kind: 'video', terms: ['视频', '镜头', '画面动态', 'video'] },
  { kind: 'audio', terms: ['音频', '音乐', '配乐', '声音', 'audio', 'music'] },
  { kind: 'text', terms: ['文本', '文案', '脚本', '口播', 'caption', 'copy', 'text'] },
]

function inferRequestedKinds(message: string): LocalCanvasNodeKind[] {
  const normalized = message.toLowerCase()
  return REQUESTED_KIND_TERMS.map(({ kind, terms }) => {
    const indexes = terms
      .map((term) => normalized.indexOf(term.toLowerCase()))
      .filter((index) => index >= 0)
    return indexes.length ? { kind, index: Math.min(...indexes) } : null
  })
    .filter((item): item is { kind: LocalCanvasNodeKind; index: number } => Boolean(item))
    .sort((a, b) => a.index - b.index)
    .map((item) => item.kind)
}

function resolveTargetSelectedDetail(
  context: LocalAgentContext,
  details: CanvasNodeDetail[]
): CanvasNodeDetail {
  const requestedKinds = inferRequestedKinds(context.message)
  for (const kind of requestedKinds) {
    const matched = details.find((detail) => detail.kind === kind)
    if (matched) return matched
  }
  const selectedSet = new Set(context.selectedNodeIds)
  return details.find((detail) => selectedSet.has(detail.id)) ?? details[0]
}

function buildNodeMap(nodes: CanvasNodeSummary[]): Map<string, CanvasNodeSummary> {
  return new Map(nodes.map((node) => [node.id, node]))
}

function describeConnections(params: {
  nodes: CanvasNodeSummary[]
  edges: Array<{ source: string; target: string }>
}): string[] {
  const nodeById = new Map(params.nodes.map((node) => [node.id, node]))
  return params.edges.map((edge) => {
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    return `${source ? nodeLabel(source) : edge.source} -> ${
      target ? nodeLabel(target) : edge.target
    }`
  })
}

function describeNodeConnectionRole(params: {
  node: CanvasNodeSummary
  nodes: CanvasNodeSummary[]
  edges: Array<{ source: string; target: string }>
}): string[] {
  const nodeById = buildNodeMap(params.nodes)
  const incoming = params.edges
    .filter((edge) => edge.target === params.node.id)
    .map((edge) => nodeById.get(edge.source))
    .filter((node): node is CanvasNodeSummary => Boolean(node))
  const outgoing = params.edges
    .filter((edge) => edge.source === params.node.id)
    .map((edge) => nodeById.get(edge.target))
    .filter((node): node is CanvasNodeSummary => Boolean(node))
  return [
    ...incoming.map((node) => `作为 target，接收来自 ${nodeLabel(node)} 的连接`),
    ...outgoing.map((node) => `作为 source，连接到 ${nodeLabel(node)}`),
    incoming.length || outgoing.length ? '' : '当前没有识别到与其他节点的连接',
  ].filter(Boolean)
}

function collectGraphNodes(params: {
  startIds: string[]
  direction: 'downstream' | 'upstream'
  nodes: CanvasNodeSummary[]
  edges: Array<{ source: string; target: string }>
}): CanvasNodeSummary[] {
  const nodeById = buildNodeMap(params.nodes)
  const seen = new Set(params.startIds)
  const queue = [...params.startIds]
  const result: CanvasNodeSummary[] = []
  while (queue.length) {
    const current = queue.shift()
    if (!current) continue
    const nextIds = params.edges.flatMap((edge) => {
      if (params.direction === 'downstream' && edge.source === current) return [edge.target]
      if (params.direction === 'upstream' && edge.target === current) return [edge.source]
      return []
    })
    for (const nextId of nextIds) {
      if (seen.has(nextId)) continue
      seen.add(nextId)
      const node = nodeById.get(nextId)
      if (!node) continue
      result.push(node)
      queue.push(nextId)
    }
  }
  return result
}

function extractText(detail: CanvasNodeDetail): string {
  if (detail.textContent?.trim()) return detail.textContent.trim()
  const contentHtml = detail.fields.contentHtml
  if (typeof contentHtml === 'string') {
    return contentHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
  return detail.summary
}

function splitSellingPoints(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const sentences = normalized
    .split(/[。；;]/)
    .map((item) => item.trim())
    .filter(Boolean)
  const candidates = sentences
    .map((item) =>
      item
        .replace(/^方案[一二三四五六七八九十]+[:：]?\s*/, '')
        .replace(/^品牌主张[:：]\s*/, '')
        .trim()
    )
    .filter((item) => item.length >= 8)
    .filter((item) => !/^这里为您准备/.test(item))
  const prioritized = candidates.filter((item) =>
    /性能|设计|高效|未来|美学|感官|治愈|食材|仪式感|自信|肌肤|品质|体验|年轻|短视频/.test(item)
  )
  const fallbackChunks = normalized
    .split(/[，,、]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 6)
  const fallbackPoints = [
    fallbackChunks.length
      ? `核心主张清晰：${fallbackChunks.slice(0, 2).join('，')}`
      : normalized
        ? `核心主张清晰：${normalized.slice(0, 80)}`
        : '',
    fallbackChunks.length > 2
      ? `短视频表达有抓手：${fallbackChunks.slice(2, 4).join('，')}`
      : '短视频表达有抓手：可以直接转成更短、更有节奏的口播句。',
    fallbackChunks.length > 4
      ? `转化场景明确：${fallbackChunks.slice(4, 6).join('，')}`
      : '转化场景明确：适合继续延展成主视觉、视频镜头和配乐节点。',
  ].filter(Boolean)
  return [...prioritized, ...candidates, ...fallbackPoints]
    .filter((item, index, all) => all.indexOf(item) === index)
    .slice(0, 3)
}

function describeVideoParameters(parameters: Record<string, unknown>): string {
  const knownKeys = new Set(['duration', 'resolution', 'aspectRatioPreset'])
  const parts = [
    typeof parameters.duration === 'number' || typeof parameters.duration === 'string'
      ? `时长 ${parameters.duration} 秒`
      : '',
    typeof parameters.resolution === 'string' ? `分辨率 ${parameters.resolution}` : '',
    typeof parameters.aspectRatioPreset === 'string' ? `画幅 ${parameters.aspectRatioPreset}` : '',
    ...Object.entries(parameters)
      .filter(([key, value]) => !knownKeys.has(key) && value !== undefined && value !== null)
      .map(([key, value]) => {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          return `${key}=${value}`
        }
        return `${key}=${JSON.stringify(value)}`
      }),
  ].filter(Boolean)
  return parts.length ? parts.join('，') : '已设置参数，但未识别到明确的时长或分辨率'
}

function describeAudioParameters(parameters: Record<string, unknown>): string {
  const parts = Object.entries(parameters)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return `${key}=${value}`
      }
      return `${key}=${JSON.stringify(value)}`
    })
  return parts.length ? parts.join('，') : '未看到明确参数'
}

function buildSelectedAnswer(
  context: LocalAgentContext,
  details: CanvasNodeDetail[],
  readSummary?: {
    nodes: CanvasNodeSummary[]
    edges: Array<{ source: string; target: string }>
  } | null
): string | null {
  if (!details.length) return null
  const first = resolveTargetSelectedDetail(context, details)
  const message = context.message

  if (first.kind === 'text') {
    const text = extractText(first)
    const points = splitSellingPoints(text)
    if (/卖点|关键|提炼|总结/.test(message) && points.length > 0) {
      return [
        `基于选中的 ${nodeLabel(first)}，可以提炼出 3 个关键卖点：`,
        ...points.map((point, index) => `${index + 1}. ${point}`),
      ].join('\n')
    }
    return [`选中的 ${nodeLabel(first)} 主要内容是：${first.summary}`, text].join('\n')
  }

  if (first.kind === 'image') {
    const prompt = typeof first.fields.aiPrompt === 'string' ? first.fields.aiPrompt : ''
    const model = typeof first.fields.aiModel === 'string' ? first.fields.aiModel : ''
    const ratio = typeof first.fields.aiAspectRatio === 'string' ? first.fields.aiAspectRatio : ''
    const file = first.file
    return [
      `选中的 ${nodeLabel(first)} 视觉方向主要来自它的提示词：${prompt || first.summary}`,
      model ? `模型：${model}` : '',
      ratio ? `画幅比例：${ratio}` : '',
      file && typeof file.name === 'string'
        ? `已有文件：${file.name}`
        : '当前没有可识别的图片文件。',
      '适合在后面接一个视频节点，用同一视觉方向做镜头推进、氛围延展或产品展示。',
    ]
      .filter(Boolean)
      .join('\n')
  }

  if (first.kind === 'video') {
    const prompt = typeof first.fields.videoPrompt === 'string' ? first.fields.videoPrompt : ''
    const modelFamily =
      typeof first.fields.videoModelFamily === 'string' ? first.fields.videoModelFamily : ''
    const parameters = asRecord(first.fields.videoParameters)
    const file = first.file
    return [
      `选中的 ${nodeLabel(first)} 设置检查如下：`,
      prompt ? `- 视频提示词：已填写，方向是“${prompt}”。` : '- 视频提示词：未填写。',
      modelFamily ? `- 模型族：${modelFamily}。` : '- 模型族：未明确设置。',
      Object.keys(parameters).length
        ? `- 生成参数：${describeVideoParameters(parameters)}。`
        : '- 生成参数：未看到明确的时长/分辨率参数。',
      file && typeof file.name === 'string'
        ? `- 已有生成文件：${file.name}。`
        : '- 当前没有视频文件。',
      prompt && modelFamily ? '整体看，基础生成设置是完整的。' : '建议补齐缺失字段后再生成。',
    ].join('\n')
  }

  if (first.kind === 'audio') {
    const prompt = typeof first.fields.audioPrompt === 'string' ? first.fields.audioPrompt : ''
    const model = typeof first.fields.audioModel === 'string' ? first.fields.audioModel : ''
    const parameters = asRecord(first.fields.audioParameters)
    const file = first.file
    const upstreamVideos =
      readSummary?.edges
        .filter((edge) => edge.target === first.id)
        .map((edge) => readSummary.nodes.find((node) => node.id === edge.source))
        .filter((node): node is CanvasNodeSummary => Boolean(node && node.kind === 'video')) ?? []
    return [
      `选中的 ${nodeLabel(first)} 音频设置如下：`,
      prompt ? `- 音频提示词：${prompt}。` : '- 音频提示词：未填写。',
      model ? `- 模型：${model}。` : '- 模型：未明确设置。',
      `- 生成参数：${describeAudioParameters(parameters)}。`,
      file && typeof file.name === 'string'
        ? `- 已有生成文件：${file.name}。`
        : '- 当前没有音频文件。',
      upstreamVideos.length
        ? `- 上游视频：${upstreamVideos.map(nodeLabel).join('、')}。当前音频适合作为这些视频的节奏和氛围补充；如果视频偏动感，建议强化节奏、鼓点和段落推进。`
        : '- 当前没有识别到直接连接到这个音频节点的上游视频；建议先确认视频节点，再按视频节奏调整音乐。',
    ]
      .filter(Boolean)
      .join('\n')
  }

  return `选中的 ${nodeLabel(first)} 当前可读，但第一版暂不支持深入编辑。摘要：${first.summary}`
}

function formatFileName(file: Record<string, unknown> | null | undefined): string {
  return file && typeof file.name === 'string' ? file.name : '无文件'
}

function formatNodeSummary(node: CanvasNodeSummary): string {
  return `- ${nodeLabel(node)}：${node.summary}`
}

function formatNodeDetail(detail: CanvasNodeDetail): string {
  if (detail.kind === 'text') {
    return [
      `${nodeLabel(detail)}`,
      `内容：${extractText(detail) || detail.summary || '空文本'}`,
    ].join('\n')
  }

  if (detail.kind === 'image') {
    const prompt = typeof detail.fields.aiPrompt === 'string' ? detail.fields.aiPrompt : ''
    const model = typeof detail.fields.aiModel === 'string' ? detail.fields.aiModel : ''
    const ratio = typeof detail.fields.aiAspectRatio === 'string' ? detail.fields.aiAspectRatio : ''
    return [
      `${nodeLabel(detail)}`,
      `提示词：${prompt || detail.summary || '未填写'}`,
      model ? `模型：${model}` : '',
      ratio ? `画幅比例：${ratio}` : '',
      `文件：${formatFileName(detail.file)}`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  if (detail.kind === 'video') {
    const prompt = typeof detail.fields.videoPrompt === 'string' ? detail.fields.videoPrompt : ''
    const modelFamily =
      typeof detail.fields.videoModelFamily === 'string' ? detail.fields.videoModelFamily : ''
    return [
      `${nodeLabel(detail)}`,
      `视频提示词：${prompt || '未填写'}`,
      modelFamily ? `模型族：${modelFamily}` : '',
      `生成参数：${describeVideoParameters(asRecord(detail.fields.videoParameters))}`,
      `文件：${formatFileName(detail.file)}`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  if (detail.kind === 'audio') {
    const prompt = typeof detail.fields.audioPrompt === 'string' ? detail.fields.audioPrompt : ''
    const model = typeof detail.fields.audioModel === 'string' ? detail.fields.audioModel : ''
    return [
      `${nodeLabel(detail)}`,
      `音频提示词：${prompt || detail.summary || '未填写'}`,
      model ? `模型：${model}` : '',
      `生成参数：${describeAudioParameters(asRecord(detail.fields.audioParameters))}`,
      `文件：${formatFileName(detail.file)}`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  return `${nodeLabel(detail)}：${detail.summary}`
}

function buildUserFacingObservationContext(observations: LocalAgentObservation[]): string {
  const parts: string[] = []
  const readSummary = getReadSummaryOutput(observations)
  if (readSummary) {
    parts.push(
      [
        '画布节点：',
        ...readSummary.nodes.map(formatNodeSummary),
        '连接关系：',
        ...(describeConnections(readSummary).length
          ? describeConnections(readSummary).map((connection) => `- ${connection}`)
          : ['- 当前没有识别到节点连接。']),
      ].join('\n')
    )
  }

  const selectedDetails = getSelectedDetails(observations)
  if (selectedDetails.length) {
    parts.push(['选中节点详情：', ...selectedDetails.map(formatNodeDetail)].join('\n\n'))
  }

  const searchResults = getSearchOutput(observations)
  if (searchResults.length) {
    parts.push(['搜索结果：', ...searchResults.map(formatNodeSummary)].join('\n'))
  }

  const toolResults = observations
    .filter(
      (observation) =>
        observation.toolName !== 'planner' &&
        observation.toolName !== 'canvas.read_summary' &&
        observation.toolName !== 'canvas.read_selected_nodes'
    )
    .map(
      (observation) =>
        `- ${observation.toolName}：${observation.success ? '成功' : '失败'}，${observation.summary}`
    )
  if (toolResults.length) parts.push(['工具结果：', ...toolResults].join('\n'))

  return parts.join('\n\n') || '暂无可用画布观察。'
}

function buildSearchAnswer(
  context: LocalAgentContext,
  observations: LocalAgentObservation[]
): string | null {
  if (!includesAny(context.message, ['找到', '搜索', '包含', '含有', '定位', 'search'])) {
    return null
  }
  const readSummary = getReadSummaryOutput(observations)
  const results = getSearchOutput(observations)
  if (!readSummary) return null
  if (!results.length) {
    return '我没有在当前画布节点的标题、类型、摘要或可读字段里找到匹配内容。'
  }
  return [
    `我在当前画布中找到 ${results.length} 个匹配节点：`,
    ...results.flatMap((node) => [
      `- ${nodeLabel(node)}：${node.summary}`,
      ...describeNodeConnectionRole({
        node,
        nodes: readSummary.nodes,
        edges: readSummary.edges,
      }).map((line) => `  - ${line}`),
    ]),
  ].join('\n')
}

function buildGraphReasoningAnswer(
  context: LocalAgentContext,
  observations: LocalAgentObservation[]
): string | null {
  const readSummary = getReadSummaryOutput(observations)
  if (!readSummary) return null
  const message = context.message
  const selectedDetails = getSelectedDetails(observations)
  const selectedIds = selectedDetails.length
    ? selectedDetails.map((node) => node.id)
    : context.selectedNodeIds

  if (includesAny(message, ['孤立', '未连接', '没有连接', '没连接', 'isolated'])) {
    const connected = new Set(
      readSummary.edges.flatMap((edge) => [edge.source, edge.target]).filter(Boolean)
    )
    const isolated = readSummary.nodes.filter((node) => !connected.has(node.id))
    if (!isolated.length) return '当前画布没有识别到孤立节点，所有节点都至少参与了一条连接。'
    return [
      `当前画布有 ${isolated.length} 个孤立节点：`,
      ...isolated.map((node) => `- ${nodeLabel(node)}：${node.summary}`),
      '建议先根据内容语义手动确认连接方向；我不会在未确认的情况下自动改动这些连接。',
    ].join('\n')
  }

  const wantsDownstream = includesAny(message, ['下游', '后面', '之后', '连接到了', '连到后'])
  const wantsUpstream = includesAny(message, ['上游', '前面', '之前', '来源'])
  if (!wantsDownstream && !wantsUpstream) return null

  const fallbackStartIds = includesAny(message, ['图片', 'image'])
    ? readSummary.nodes.filter((node) => node.kind === 'image').map((node) => node.id)
    : []
  const startIds = selectedIds.length ? selectedIds : fallbackStartIds
  const startNodes = startIds
    .map((id) => readSummary.nodes.find((node) => node.id === id))
    .filter((node): node is CanvasNodeSummary => Boolean(node))
  if (!startNodes.length) {
    return '我没有找到可作为上下游分析起点的节点。请先选中一个节点，或在问题里明确节点名称。'
  }

  const direction = wantsUpstream ? 'upstream' : 'downstream'
  const related = collectGraphNodes({
    startIds: startNodes.map((node) => node.id),
    direction,
    nodes: readSummary.nodes,
    edges: readSummary.edges,
  })
  const directionLabel = direction === 'downstream' ? '后面的下游节点' : '前面的上游节点'
  if (!related.length) {
    return `${startNodes.map(nodeLabel).join('、')} 当前没有识别到${directionLabel}。`
  }
  return [
    `以 ${startNodes.map(nodeLabel).join('、')} 为起点，${directionLabel}包括：`,
    ...related.map((node) => `- ${nodeLabel(node)}：${node.summary}`),
    '这些判断来自当前画布连接关系；我没有修改画布。',
  ].join('\n')
}

function buildCanvasAnswer(
  context: LocalAgentContext,
  observations: LocalAgentObservation[]
): string {
  const summary = getReadSummaryOutput(observations)
  if (!summary) return '我已读取当前画布，但没有拿到可解释的节点结构。'
  const nodes = summary.nodes
  const connections = describeConnections(summary)
  const nodeLines = nodes.map((node) => `- ${nodeLabel(node)}：${node.summary}`)
  const connectionLines = connections.length
    ? connections.map((connection) => `- ${connection}`)
    : ['- 当前没有识别到节点连接。']

  if (/流程|缺少|环节|判断|像/.test(context.message)) {
    const kinds = new Set(nodes.map((node) => node.kind))
    const missing = [
      !kinds.has('text') ? '脚本/文案节点' : '',
      !kinds.has('image') ? '主视觉图片节点' : '',
      !kinds.has('video') ? '视频生成节点' : '',
      !kinds.has('audio') ? '配乐/音频节点' : '',
    ].filter(Boolean)
    return [
      '这个画布目前像一个内容生产流程：从文案或创意说明出发，延展到视觉素材，再进入视频/音频产出。',
      '当前节点：',
      ...nodeLines,
      '当前连接关系：',
      ...connectionLines,
      missing.length
        ? `建议补齐：${missing.join('、')}。`
        : '基础链路已经比较完整，可以继续细化提示词和生成参数。',
    ].join('\n')
  }

  return ['当前画布内容节点如下：', ...nodeLines, '连接关系：', ...connectionLines].join('\n')
}

function clipText(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 10))}...`
}

function formatContextToolOutput(observation: LocalAgentObservation): string[] {
  const output = asRecord(observation.output)
  if (observation.toolName === 'read_file') {
    const contexts = Array.isArray(output.contexts) ? output.contexts : []
    const files = Array.isArray(output.files) ? output.files : []
    const contextLines = contexts.slice(0, 3).flatMap((item) => {
      const record = asRecord(item)
      const tag = typeof record.tag === 'string' ? record.tag : 'file'
      const content = typeof record.content === 'string' ? clipText(record.content) : ''
      return content ? [`- 文件 ${tag}：${content}`] : [`- 文件 ${tag}`]
    })
    if (contextLines.length) return contextLines
    return files.slice(0, 3).map((item) => {
      const record = asRecord(item)
      const name = typeof record.name === 'string' ? record.name : 'attached file'
      return `- 文件 ${name}：已读取附件元数据`
    })
  }

  if (observation.toolName === 'materialize_file') {
    const output = asRecord(observation.output)
    const nestedOutput = asRecord(output.output)
    const succeeded = Array.isArray(nestedOutput.succeeded) ? nestedOutput.succeeded : []
    const resources = Array.isArray(output.resources) ? output.resources : []
    const saved = succeeded.map((item) => (typeof item === 'string' ? item : '')).filter(Boolean)
    const resourceNames = resources
      .map((item) => {
        const record = asRecord(item)
        return typeof record.title === 'string' ? record.title : ''
      })
      .filter(Boolean)
    const names = saved.length ? saved : resourceNames
    return names.length
      ? names.map((name) => `- 文件 ${name}：已保存到工作区`)
      : ['- 文件：已保存到工作区']
  }

  if (observation.toolName === 'query_knowledge' || observation.toolName === 'search_docs') {
    const results = Array.isArray(output.results) ? output.results : []
    const label = observation.toolName === 'query_knowledge' ? '知识库' : '文档'
    if (!results.length) return [`- ${label}：没有找到匹配内容`]
    return results.slice(0, 4).map((item) => {
      const record = asRecord(item)
      const tag = typeof record.tag === 'string' ? record.tag : label
      const content = typeof record.content === 'string' ? clipText(record.content) : ''
      return content ? `- ${label} ${tag}：${content}` : `- ${label} ${tag}`
    })
  }

  if (observation.toolName === 'read_tasks') {
    const tasks = Array.isArray(output.tasks) ? output.tasks : []
    if (!tasks.length) return ['- 任务：当前 workflow 没有读取到生产任务']
    return tasks.slice(0, 5).map((item) => {
      const record = asRecord(item)
      const title = typeof record.title === 'string' ? record.title : '未命名任务'
      const status = typeof record.status === 'string' ? record.status : 'unknown'
      const assignee =
        typeof record.assigneeWorkgroup === 'string' ? `，负责组：${record.assigneeWorkgroup}` : ''
      const dueAt =
        typeof record.dueAt === 'string' && record.dueAt ? `，截止：${record.dueAt}` : ''
      return `- 任务 ${title}：状态 ${status}${assignee}${dueAt}`
    })
  }

  if (
    observation.toolName === 'update_task_result' ||
    observation.toolName === 'submit_task_result'
  ) {
    const task = asRecord(output.task)
    const title = typeof task.title === 'string' ? task.title : '未命名任务'
    const status = typeof task.status === 'string' ? task.status : 'unknown'
    const resultNodeId =
      typeof task.resultNodeId === 'string' ? `，结果节点：${task.resultNodeId}` : ''
    const prefix = observation.toolName === 'submit_task_result' ? '已提交任务' : '已更新任务'
    return [`- ${prefix} ${title}：状态 ${status}${resultNodeId}`]
  }

  if (observation.toolName === 'search_workspace') {
    const content = typeof output.content === 'string' ? clipText(output.content, 500) : ''
    return content ? [`- 工作区：${content}`] : ['- 工作区：已读取工作区上下文']
  }

  return [`- ${observation.summary}`]
}

function buildContextToolAnswer(observations: LocalAgentObservation[]): string | null {
  const contextObservations = observations.filter(
    (observation) =>
      observation.toolName === 'read_file' ||
      observation.toolName === 'search_workspace' ||
      observation.toolName === 'materialize_file' ||
      observation.toolName === 'query_knowledge' ||
      observation.toolName === 'search_docs' ||
      observation.toolName === 'read_tasks' ||
      observation.toolName === 'update_task_result' ||
      observation.toolName === 'submit_task_result'
  )
  if (!contextObservations.length) return null
  const failed = contextObservations.find((observation) => !observation.success)
  if (failed) return `我没有读取到对应上下文：${failed.summary}`
  const lines = contextObservations.flatMap(formatContextToolOutput)
  return [
    hasContextWriteObservation(contextObservations)
      ? '我已处理相关上下文动作，结果如下：'
      : '我已读取相关上下文，摘要如下：',
    ...lines,
    '我没有修改画布。',
  ].join('\n')
}

function hasContextWriteObservation(observations: LocalAgentObservation[]): boolean {
  return observations.some(
    (observation) =>
      observation.toolName === 'materialize_file' ||
      observation.toolName === 'update_task_result' ||
      observation.toolName === 'submit_task_result'
  )
}

function inferConsultTheme(message: string): string {
  const cleaned = message
    .replace(/^(你好|您好|请|帮我|我想|想)\s*/g, '')
    .replace(/(?:先|先帮我)?(?:告诉我|说说|讲讲|讨论一下|和我讨论一下|聊聊)/g, '')
    .replace(/[，,。；;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || message.trim() || '这个内容生产工作流'
}

function buildConsultDesignAnswer(context: LocalAgentContext): string {
  const theme = inferConsultTheme(context.message)
  const isShortVideo = /短视频|视频|video/i.test(theme)
  const isXiaohongshu = /小红书|xiaohongshu|rednote/i.test(theme)
  const platform = isXiaohongshu ? '小红书' : isShortVideo ? '短视频平台' : '当前平台'
  return [
    `可以，我们先不改画布，先把“${theme}”的工作流设计清楚。`,
    '',
    '我建议先按 4 个生产环节拆：',
    `1. 脚本/种草文案：明确受众、开场钩子、核心卖点和行动引导，适配${platform}的短句节奏。`,
    '2. 主视觉：把脚本里的主体、场景、情绪和画幅固化成可复用的图片提示词。',
    '3. 视频：用主视觉或脚本继续扩展镜头运动、时长、节奏和结尾字幕空间。',
    '4. 配乐：根据视频氛围选择节奏、情绪和段落推进，避免和口播抢信息。',
    '',
    '在真正创建节点前，我想先确认 3 点：',
    '- 你希望它偏种草、剧情、治愈，还是偏教程说明？',
    '- 视频大概做 5 秒、10 秒，还是更长？',
    '- 需要口播文案，还是只做画面和音乐氛围？',
  ].join('\n')
}

export function buildDeterministicLocalAgentAnswer(params: {
  context: LocalAgentContext
  plan?: LocalAgentPlan
  observations: LocalAgentObservation[]
}): string {
  if (params.plan?.userIntent === 'consult_design') {
    return buildConsultDesignAnswer(params.context)
  }

  const generateObservations = params.observations.filter(
    (observation) => observation.toolName === 'canvas.generate_node_output'
  )
  if (
    generateObservations.length > 0 &&
    params.observations.every((observation) => observation.success)
  ) {
    const verified = params.observations.some(
      (observation) => observation.toolName === 'canvas.verify_patch' && observation.success
    )
    return verified
      ? '已生成内容并写回选中节点，验证也已完成。'
      : '已生成内容并写回选中节点，但还没有完成二次验证。'
  }

  const patchObservations = params.observations.filter(
    (observation) => observation.toolName === 'canvas.apply_patch'
  )
  if (
    patchObservations.length > 0 &&
    params.observations.every((observation) => observation.success)
  ) {
    const verified = params.observations.some(
      (observation) => observation.toolName === 'canvas.verify_patch' && observation.success
    )
    return verified ? '已完成画布修改，并完成验证。' : '已应用画布修改，但还没有完成二次验证。'
  }

  const proposalObservations = params.observations.filter(
    (observation) => observation.toolName === 'canvas.propose_patch'
  )
  if (
    proposalObservations.length > 0 &&
    params.observations.every((observation) => observation.success)
  ) {
    return '已准备好画布修改方案，但还没有修改画布。请确认后再执行。'
  }

  const selectedAnswer = buildSelectedAnswer(
    params.context,
    getSelectedDetails(params.observations),
    getReadSummaryOutput(params.observations)
  )
  const contextToolAnswer = buildContextToolAnswer(params.observations)
  if (contextToolAnswer && hasContextWriteObservation(params.observations)) {
    return contextToolAnswer
  }
  const searchAnswer = buildSearchAnswer(params.context, params.observations)
  if (searchAnswer) return searchAnswer
  const graphAnswer = buildGraphReasoningAnswer(params.context, params.observations)
  if (graphAnswer) return graphAnswer
  if (selectedAnswer) return selectedAnswer
  if (contextToolAnswer) return contextToolAnswer
  return buildCanvasAnswer(params.context, params.observations)
}

function buildActorPrompt(params: {
  context: LocalAgentContext
  plan: LocalAgentPlan
  observations: LocalAgentObservation[]
}): string {
  const observationText = buildUserFacingObservationContext(params.observations)
  return [
    `User request:\n${params.context.message}`,
    `Plan goal:\n${params.plan.goal}`,
    `Success criteria:\n${params.plan.successCriteria.join('\n')}`,
    `Canvas observations:\n${observationText || 'none'}`,
    [
      'Answer in Chinese for the user.',
      'Do not say or imply that you are the chief director, a director agent, or any named persona unless the user explicitly asks for that style.',
      'Do not expose raw JSON, workflowId, workspaceId, internal fields, capabilities, or database IDs unless the user explicitly asks for IDs.',
      'For canvas summary questions, explain node types, content meaning, and connections.',
      'For selected-node questions, use selected node details and answer the requested analysis instead of repeating the raw node content.',
    ].join('\n'),
  ].join('\n\n')
}

export function hasInternalFieldLeak(answer: string): boolean {
  const trimmed = answer.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return true
  return INTERNAL_FIELD_PATTERNS.some((pattern) => pattern.test(answer))
}

export async function buildLocalAgentAnswer(params: {
  context: LocalAgentContext
  plan: LocalAgentPlan
  observations: LocalAgentObservation[]
}): Promise<string> {
  const fallback = buildDeterministicLocalAgentAnswer(params)
  if (params.plan.userIntent === 'consult_design' && fallback.trim()) return fallback
  const isDeterministicCompletion =
    params.observations.every((observation) => observation.success) &&
    params.observations.some(
      (observation) =>
        observation.toolName === 'canvas.apply_patch' ||
        observation.toolName === 'canvas.generate_node_output'
    )
  if (isDeterministicCompletion && fallback.trim()) return fallback

  const isReadOnlyUnderstanding =
    !params.plan.patch &&
    !(params.plan.generateNodeIds?.length ?? 0) &&
    params.observations.some(
      (observation) =>
        observation.toolName === 'canvas.read_summary' ||
        observation.toolName === 'canvas.read_selected_nodes'
    )
  if (isReadOnlyUnderstanding && fallback.trim()) return fallback

  try {
    const response = await executeLocalAgentModelRequest(params.context.model, {
      role: 'actor',
      workspaceId: params.context.workspaceId,
      systemPrompt: buildLocalAgentRoleSystemPrompt({
        context: params.context,
        role: 'actor',
        roleInstruction:
          'You are the Actor in a local canvas agent runtime. Convert tool observations into useful user-facing answers or concise completion reports.',
      }),
      prompt: buildActorPrompt(params),
      temperature: params.context.thinkingLevel === 'extra' ? 0.2 : 0.05,
      maxTokens: params.context.thinkingLevel === 'extra' ? 3000 : 1800,
      abortSignal: params.context.options.abortSignal,
    })
    const answer = response.content?.trim()
    if (answer && !hasInternalFieldLeak(answer)) return answer
  } catch {}
  return fallback
}
