import type {
  CanvasSnapshot,
  LocalAgentPlan,
  LocalCanvasGenerationTarget,
  LocalCanvasNodeKind,
  LocalCanvasPatchOperation,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import { SHOW_PLANNING_WORKFLOW_PRESET } from '@/lib/hermes/show-planning-skill'

export type ShowPlanningSection =
  | 'positioning'
  | 'concept'
  | 'structure'
  | 'programs'
  | 'lineup'
  | 'visual'
  | 'summary'

interface ShowPlanningNodeSpec {
  clientNodeId: string
  title: string
  section: ShowPlanningSection
  x: number
  y: number
}

interface ProgramVisualSpec {
  id: string
  name: string
  chapter?: string
  order?: number
  durationMinutes?: number
  summary?: string
  priority?: 'key' | 'normal'
  needsImage?: boolean
  needsVideo?: boolean
}

const PROGRAM_VISUAL_LIMIT = 12
const PROGRAM_DETAIL_NODE_PREFIX = 'planning-program-detail-'
const PROGRAM_VISUAL_PLAN_NODE_PREFIX = 'planning-program-visual-plan-'
const PROGRAM_IMAGE_NODE_PREFIX = 'planning-program-image-'
const PROGRAM_VIDEO_NODE_PREFIX = 'planning-program-video-'
const VISUAL_SUMMARY_NODE_ID = 'planning-visual-summary'

const SHOW_PLANNING_NODE_ORDER: ShowPlanningNodeSpec[] = [
  {
    clientNodeId: 'planning-positioning',
    title: '项目定位',
    section: 'positioning',
    x: 120,
    y: 120,
  },
  { clientNodeId: 'planning-concept', title: '核心概念', section: 'concept', x: 520, y: 120 },
  { clientNodeId: 'planning-structure', title: '整体结构', section: 'structure', x: 920, y: 120 },
  { clientNodeId: 'planning-programs', title: '节目方案', section: 'programs', x: 1320, y: 120 },
  { clientNodeId: 'planning-lineup', title: '资源阵容', section: 'lineup', x: 1720, y: 120 },
  { clientNodeId: 'planning-visual', title: '视觉系统总控', section: 'visual', x: 2120, y: 120 },
  { clientNodeId: 'planning-summary', title: '总策划案', section: 'summary', x: 2520, y: 120 },
]

function placeholderHtml(title: string): string {
  return `<p>${title}</p><p>等待 Hermes 生成内容</p>`
}

function visualPlaceholderHtml(title: string, body: string): string {
  return `<h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function nodeExists(snapshot: CanvasSnapshot, nodeId: string): boolean {
  return snapshot.nodes.some((node) => node.id === nodeId)
}

function findPlanningNodeId(params: {
  snapshot: CanvasSnapshot
  nodeId: string
  section?: string
  kind?: LocalCanvasNodeKind
}): string | null {
  if (nodeExists(params.snapshot, params.nodeId)) return params.nodeId
  if (params.section) {
    const bySection = params.snapshot.nodes.find(
      (node) => node.values.planningSection === params.section
    )
    if (bySection) return bySection.id
  }
  if (params.kind) {
    const byKind = params.snapshot.nodes.find((node) => node.kind === params.kind)
    if (byKind) return byKind.id
  }
  return null
}

function hasEdge(snapshot: CanvasSnapshot, source: string, target: string): boolean {
  return snapshot.edges.some((edge) => edge.source === source && edge.target === target)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function valueRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return valueRecord(parsed)
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function programNameFromRecord(record: Record<string, unknown>, fallback: string): string {
  return (
    readString(record.name) ||
    readString(record.title) ||
    readString(record.programName) ||
    readString(record.programTitle) ||
    readString(record.节目名) ||
    readString(record.节目名称) ||
    fallback
  )
}

function programChapterFromRecord(record: Record<string, unknown>): string | undefined {
  return (
    readString(record.chapter) ||
    readString(record.section) ||
    readString(record.part) ||
    readString(record.章节) ||
    undefined
  )
}

function programSummaryFromRecord(record: Record<string, unknown>): string | undefined {
  return (
    readString(record.summary) ||
    readString(record.description) ||
    readString(record.synopsis) ||
    readString(record.idea) ||
    readString(record.简介) ||
    readString(record.节目简介) ||
    readString(record.创意说明) ||
    undefined
  )
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function programOrderFromRecord(
  record: Record<string, unknown>,
  fallback: number
): number | undefined {
  return (
    readNumber(record.order) ||
    readNumber(record.index) ||
    readNumber(record.sequence) ||
    readNumber(record.序号) ||
    fallback
  )
}

function programDurationFromRecord(record: Record<string, unknown>): number | undefined {
  return (
    readNumber(record.durationMinutes) ||
    readNumber(record.duration) ||
    readNumber(record.minutes) ||
    readNumber(record.时长) ||
    readNumber(record.节目时长)
  )
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (['true', 'yes', 'y', '1', '是', '需要', '重点'].includes(normalized)) return true
  if (['false', 'no', 'n', '0', '否', '不需要'].includes(normalized)) return false
  return undefined
}

function programPriorityFromRecord(record: Record<string, unknown>): 'key' | 'normal' {
  const priority =
    readString(record.priority) ||
    readString(record.importance) ||
    readString(record.level) ||
    readString(record.优先级) ||
    readString(record.重要性)
  if (/key|core|hero|main|重点|核心|主打|压轴/.test(priority.toLowerCase())) return 'key'
  return 'normal'
}

function programNeedsImageFromRecord(record: Record<string, unknown>): boolean {
  return (
    readBoolean(record.needsImage) ??
    readBoolean(record.generateImage) ??
    readBoolean(record.需要图片) ??
    true
  )
}

function programNeedsVideoFromRecord(
  record: Record<string, unknown>,
  priority: 'key' | 'normal'
): boolean {
  return (
    readBoolean(record.needsVideo) ??
    readBoolean(record.generateVideo) ??
    readBoolean(record.需要视频) ??
    priority === 'key'
  )
}

function collectProgramsFromValue(value: unknown, output: ProgramVisualSpec[]): void {
  if (output.length >= PROGRAM_VISUAL_LIMIT) return

  if (Array.isArray(value)) {
    value.forEach((item) => collectProgramsFromValue(item, output))
    return
  }

  const record = valueRecord(value)
  if (!record) return

  const nestedKeys = [
    'programs',
    'programPlan',
    'programList',
    'items',
    '节目',
    '节目列表',
    '节目方案',
  ]
  for (const key of nestedKeys) {
    if (record[key] !== undefined) collectProgramsFromValue(record[key], output)
  }

  const name = programNameFromRecord(record, '')
  if (!name) return
  const priority = programPriorityFromRecord(record)
  output.push({
    id: readString(record.id) || readString(record.programId) || `program-${output.length + 1}`,
    name,
    chapter: programChapterFromRecord(record),
    order: programOrderFromRecord(record, output.length + 1),
    durationMinutes: programDurationFromRecord(record),
    summary: programSummaryFromRecord(record),
    priority,
    needsImage: programNeedsImageFromRecord(record),
    needsVideo: programNeedsVideoFromRecord(record, priority),
  })
}

function collectProgramsFromText(contentHtml: string): ProgramVisualSpec[] {
  const text = stripHtml(contentHtml)
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const programs: ProgramVisualSpec[] = []

  for (const line of lines) {
    if (programs.length >= PROGRAM_VISUAL_LIMIT) break
    const quoted = line.match(/《([^》]{2,80})》/)
    if (quoted?.[1]) {
      programs.push({ id: `program-${programs.length + 1}`, name: `《${quoted[1]}》` })
      continue
    }

    const numbered = line.match(/^(?:\d+[.、)]|[-*])\s*(.+)$/)
    if (numbered?.[1] && /节目|歌|舞|秀|短片|合唱|开场|尾声|篇章/.test(numbered[1])) {
      programs.push({
        id: `program-${programs.length + 1}`,
        name: numbered[1].slice(0, 80),
      })
    }
  }

  return programs
}

function fallbackPrograms(): ProgramVisualSpec[] {
  return [
    { id: 'program-1', name: '开场视觉方案', chapter: '开场', order: 1, priority: 'key' },
    { id: 'program-2', name: '核心篇章视觉方案', chapter: '主体', order: 2, priority: 'key' },
    { id: 'program-3', name: '收束段落视觉方案', chapter: '结尾', order: 3, priority: 'normal' },
  ]
}

function readProgramVisualSpecs(
  snapshot: CanvasSnapshot,
  programNodeId: string
): ProgramVisualSpec[] {
  const programNode = snapshot.nodes.find((node) => node.id === programNodeId)
  if (!programNode) return fallbackPrograms()

  const fromData: ProgramVisualSpec[] = []
  collectProgramsFromValue(programNode.values.planningData, fromData)
  const uniqueFromData = uniquePrograms(fromData)
  if (uniqueFromData.length > 0) return uniqueFromData.slice(0, PROGRAM_VISUAL_LIMIT)

  const contentHtml = readString(programNode.values.contentHtml)
  const fromText = uniquePrograms(collectProgramsFromText(contentHtml))
  if (fromText.length > 0) return fromText.slice(0, PROGRAM_VISUAL_LIMIT)

  return fallbackPrograms()
}

function uniquePrograms(programs: ProgramVisualSpec[]): ProgramVisualSpec[] {
  const seen = new Set<string>()
  return programs.filter((program) => {
    const key = program.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildProgramContextLine(program: ProgramVisualSpec): string {
  return [
    `节目名称：${program.name}`,
    program.chapter ? `所属篇章：${program.chapter}` : '',
    program.order ? `顺序：${program.order}` : '',
    program.durationMinutes ? `建议时长：${program.durationMinutes}分钟` : '',
    program.priority === 'key' ? '重要级别：重点节目' : '重要级别：常规节目',
    program.summary ? `已确认摘要：${program.summary}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildProgramDetailPrompt(program: ProgramVisualSpec): string {
  return [
    '你是大型活动/晚会节目策划导演。请基于上游“节目方案总控”节点和已确认节目池，为单个节目生成完整节目详细方案。',
    buildProgramContextLine(program),
    '输出要求：',
    '1. 节目定位与核心看点',
    '2. 表演形式、人物/团队、舞台行动线',
    '3. 音乐、文本、互动或技术段落设计',
    '4. 时长、节奏、转场与风险提示',
    '5. 可交给视觉方案节点继续深化的关键视觉线索',
    '请用中文结构化输出，不要生成 PPT 文案，不要替其他节目展开。',
  ].join('\n')
}

function buildProgramVisualPlanPrompt(program: ProgramVisualSpec, detailNodeId: string): string {
  return [
    '你是舞美视觉总监。请读取上游节目详细方案节点，并结合“视觉系统总控”节点，为单个节目生成节目视觉方案。',
    buildProgramContextLine(program),
    `上游节目详细方案节点：${detailNodeId}`,
    '输出要求：',
    '1. 核心画面概念与视觉母题',
    '2. 舞台空间、屏幕、灯光、装置、影像层次',
    '3. 色彩、材质、字体/符号、国潮/科技表达方式',
    '4. 关键画面分镜和转场',
    '5. 可直接用于图片节点的生图提示词',
    '6. 重点节目需要给出视频节点的动态镜头提示词',
    '请用中文结构化输出，保持与整台视觉系统一致。',
  ].join('\n')
}

function buildProgramImagePrompt(program: ProgramVisualSpec, visualPlanNodeId: string): string {
  return [
    `为节目“${program.name}”生成一张 16:9 舞台关键视觉概念图。`,
    `请读取节目视觉方案节点 ${visualPlanNodeId} 的核心画面、色彩、空间、舞美和影像要求。`,
    '画面应适合晚会策划 PPT 展示：舞台完整可见，人物/装置/屏幕/灯光关系清晰，国潮与科技感并存，避免文字水印和过度抽象。',
  ].join('\n')
}

function buildProgramVideoPrompt(program: ProgramVisualSpec, visualPlanNodeId: string): string {
  return [
    `为重点节目“${program.name}”生成 16:9 短视频镜头。`,
    `请读取节目视觉方案节点 ${visualPlanNodeId} 的分镜、舞美、灯光和动态影像要求。`,
    '镜头建议 5-8 秒：从空间建立到核心视觉亮点，运动稳定，节奏年轻，国潮科技质感明确，适合策划汇报预览。',
  ].join('\n')
}

function upsertNodeOperation(params: {
  snapshot: CanvasSnapshot
  nodeId: string
  clientNodeId?: string
  kind: 'text' | 'image' | 'video'
  title: string
  position: { x: number; y: number }
  fields: Record<string, unknown>
}): LocalCanvasPatchOperation {
  if (nodeExists(params.snapshot, params.nodeId)) {
    return {
      type: 'update_node',
      operationId: `show_planning:update:${params.nodeId}`,
      nodeId: params.nodeId,
      fields: params.fields,
    }
  }

  return {
    type: 'create_node',
    operationId: `show_planning:create:${params.nodeId}`,
    clientNodeId: params.clientNodeId ?? params.nodeId,
    nodeId: params.nodeId,
    kind: params.kind,
    title: params.title,
    position: params.position,
    fields: params.fields,
  }
}

function upsertTextNodeOperation(params: Omit<Parameters<typeof upsertNodeOperation>[0], 'kind'>) {
  return upsertNodeOperation({ ...params, kind: 'text' })
}

function connectIfMissing(params: {
  snapshot: CanvasSnapshot
  sourceNodeId: string
  targetNodeId: string
  operationId: string
}): LocalCanvasPatchOperation | null {
  if (hasEdge(params.snapshot, params.sourceNodeId, params.targetNodeId)) return null
  return {
    type: 'connect',
    operationId: params.operationId,
    sourceNodeId: params.sourceNodeId,
    targetNodeId: params.targetNodeId,
  }
}

function addContentReferenceIfMissing(_params: {
  snapshot: CanvasSnapshot
  consumerNodeId: string
  sourceNodeId: string
  operationId: string
}): LocalCanvasPatchOperation | null {
  return null
}

export function buildShowPlanningScaffoldOperations(): LocalCanvasPatchOperation[] {
  const operations: LocalCanvasPatchOperation[] = SHOW_PLANNING_NODE_ORDER.map((node, index) => ({
    type: 'create_node',
    operationId: `show_planning:create:${index + 1}`,
    clientNodeId: node.clientNodeId,
    kind: 'text',
    title: node.title,
    position: { x: node.x, y: node.y },
    fields: {
      contentHtml: placeholderHtml(node.title),
      planningSection: node.section,
      planningStage: node.section,
      planningStatus: node.section === 'positioning' ? 'draft' : 'pending_review',
      approvalNotes: '',
    },
  }))

  for (let index = 0; index < SHOW_PLANNING_NODE_ORDER.length - 1; index += 1) {
    operations.push({
      type: 'connect',
      operationId: `show_planning:connect:${index + 1}`,
      sourceNodeId: SHOW_PLANNING_NODE_ORDER[index].clientNodeId,
      targetNodeId: SHOW_PLANNING_NODE_ORDER[index + 1].clientNodeId,
    })
  }

  operations.push({
    type: 'create_node',
    operationId: 'show_planning:create:presentation',
    clientNodeId: 'planning-presentation',
    kind: 'presentation',
    title: '策划提案 PPT',
    position: { x: 2920, y: 420 },
    fields: {
      presentationPrompt:
        '基于已确认的总策划案节点，生成一份结构清晰、适合正式汇报的中文策划 PPT。',
      presentationSlideCountMode: 'auto',
      presentationSlideCount: 10,
      presentationStatus: 'idle',
    },
  })
  operations.push({
    type: 'add_content_reference',
    operationId: 'show_planning:reference:summary_to_presentation',
    consumerNodeId: 'planning-presentation',
    sourceNodeId: 'planning-summary',
    role: 'text_context',
  })

  return operations
}

export function buildProgramDrivenVisualSystemPlan(
  snapshot: CanvasSnapshot
): LocalAgentPlan | null {
  const programNodeId = findPlanningNodeId({
    snapshot,
    nodeId: 'planning-programs',
    section: 'programs',
  })
  const visualNodeId = findPlanningNodeId({
    snapshot,
    nodeId: 'planning-visual',
    section: 'visual',
  })
  const summaryNodeId = findPlanningNodeId({
    snapshot,
    nodeId: 'planning-summary',
    section: 'summary',
  })
  const presentationNodeId = findPlanningNodeId({
    snapshot,
    nodeId: 'planning-presentation',
    kind: 'presentation',
  })

  if (!programNodeId || !visualNodeId || !summaryNodeId) {
    return null
  }

  const programs = readProgramVisualSpecs(snapshot, programNodeId)
  const generationTargets: LocalCanvasGenerationTarget[] = []
  const operations: LocalCanvasPatchOperation[] = [
    upsertTextNodeOperation({
      snapshot,
      nodeId: visualNodeId,
      title: '视觉系统总控',
      position: { x: 2120, y: 120 },
      fields: {
        contentHtml: visualPlaceholderHtml(
          '视觉系统总控',
          '请基于已确认的节目方案，定义整台项目的主视觉方向、舞美母题、色彩系统、材质、光影语言、镜头语言，以及所有节目视觉节点需要共同遵守的生成约束。'
        ),
        planningSection: 'visual',
        planningStage: 'visual_master',
        planningStatus: 'pending_review',
        planningData: JSON.stringify({
          visualNodeMode: 'program_driven',
          programCount: programs.length,
          programNames: programs.map((program) => program.name),
        }),
        approvalNotes: '',
      },
    }),
  ]

  programs.forEach((program, index) => {
    const detailNodeId = `${PROGRAM_DETAIL_NODE_PREFIX}${index + 1}`
    const visualPlanNodeId = `${PROGRAM_VISUAL_PLAN_NODE_PREFIX}${index + 1}`
    const imageNodeId = `${PROGRAM_IMAGE_NODE_PREFIX}${index + 1}`
    const videoNodeId = `${PROGRAM_VIDEO_NODE_PREFIX}${index + 1}`
    const programData = {
      sourceProgramId: program.id,
      sourceProgramName: program.name,
      sourceChapter: program.chapter ?? '',
      order: program.order ?? index + 1,
      durationMinutes: program.durationMinutes ?? null,
      summary: program.summary ?? '',
      priority: program.priority ?? 'normal',
      needsImage: program.needsImage ?? true,
      needsVideo: program.needsVideo ?? program.priority === 'key',
    }

    operations.push(
      upsertTextNodeOperation({
        snapshot,
        nodeId: detailNodeId,
        title: `节目详细方案｜${program.name}`,
        position: { x: 1320, y: 420 + index * 260 },
        fields: {
          aiPrompt: buildProgramDetailPrompt(program),
          contentHtml: visualPlaceholderHtml(
            `节目详细方案｜${program.name}`,
            '等待文本生成：节目定位、表演形式、行动线、转场和视觉线索。'
          ),
          planningSection: 'program_detail',
          planningStage: 'program_detail',
          planningStatus: 'pending_generation',
          planningData: JSON.stringify(programData),
          approvalNotes: '',
        },
      }),
      upsertTextNodeOperation({
        snapshot,
        nodeId: visualPlanNodeId,
        title: `节目视觉方案｜${program.name}`,
        position: { x: 2120, y: 420 + index * 260 },
        fields: {
          aiPrompt: buildProgramVisualPlanPrompt(program, detailNodeId),
          contentHtml: visualPlaceholderHtml(
            `节目视觉方案｜${program.name}`,
            '等待文本生成：核心画面、舞美空间、灯光影像、关键分镜和媒体提示词。'
          ),
          planningSection: 'program_visual_plan',
          planningStage: 'program_visual_plan',
          planningStatus: 'pending_generation',
          planningData: JSON.stringify({
            ...programData,
            sourceProgramDetailNodeId: detailNodeId,
          }),
          approvalNotes: '',
        },
      }),
      upsertNodeOperation({
        snapshot,
        nodeId: imageNodeId,
        kind: 'image',
        title: `节目关键视觉图｜${program.name}`,
        position: { x: 2520, y: 420 + index * 260 },
        fields: {
          aiPrompt: buildProgramImagePrompt(program, visualPlanNodeId),
          aiAspectRatio: '16:9',
        },
      })
    )

    if (programData.needsVideo) {
      operations.push(
        upsertNodeOperation({
          snapshot,
          nodeId: videoNodeId,
          kind: 'video',
          title: `节目动态视觉视频｜${program.name}`,
          position: { x: 2920, y: 420 + index * 260 },
          fields: {
            videoPrompt: buildProgramVideoPrompt(program, visualPlanNodeId),
            videoFrameAspectRatioPreset: '16:9',
          },
        })
      )
    }

    generationTargets.push(
      { clientNodeId: detailNodeId, kind: 'text', reason: `生成节目“${program.name}”详细方案` },
      {
        clientNodeId: visualPlanNodeId,
        kind: 'text',
        reason: `生成节目“${program.name}”视觉方案`,
      },
      { clientNodeId: imageNodeId, kind: 'image', reason: `生成节目“${program.name}”关键视觉图` }
    )

    const programsToDetail = connectIfMissing({
      snapshot,
      sourceNodeId: programNodeId,
      targetNodeId: detailNodeId,
      operationId: `show_planning:connect:programs_to_detail:${index + 1}`,
    })
    if (programsToDetail) operations.push(programsToDetail)

    const detailToVisualPlan = connectIfMissing({
      snapshot,
      sourceNodeId: detailNodeId,
      targetNodeId: visualPlanNodeId,
      operationId: `show_planning:connect:detail_to_visual_plan:${index + 1}`,
    })
    if (detailToVisualPlan) operations.push(detailToVisualPlan)

    const visualToProgramPlan = connectIfMissing({
      snapshot,
      sourceNodeId: visualNodeId,
      targetNodeId: visualPlanNodeId,
      operationId: `show_planning:connect:visual_to_program_plan:${index + 1}`,
    })
    if (visualToProgramPlan) operations.push(visualToProgramPlan)

    const visualPlanToImage = connectIfMissing({
      snapshot,
      sourceNodeId: visualPlanNodeId,
      targetNodeId: imageNodeId,
      operationId: `show_planning:connect:visual_plan_to_image:${index + 1}`,
    })
    if (visualPlanToImage) operations.push(visualPlanToImage)

    if (programData.needsVideo) {
      const imageToVideo = connectIfMissing({
        snapshot,
        sourceNodeId: imageNodeId,
        targetNodeId: videoNodeId,
        operationId: `show_planning:connect:image_to_video:${index + 1}`,
      })
      if (imageToVideo) operations.push(imageToVideo)
    }

    const detailReference = addContentReferenceIfMissing({
      snapshot,
      consumerNodeId: visualPlanNodeId,
      sourceNodeId: detailNodeId,
      operationId: `show_planning:reference:detail_to_visual_plan:${index + 1}`,
    })
    if (detailReference) operations.push(detailReference)

    const visualMasterReference = addContentReferenceIfMissing({
      snapshot,
      consumerNodeId: visualPlanNodeId,
      sourceNodeId: visualNodeId,
      operationId: `show_planning:reference:visual_master_to_visual_plan:${index + 1}`,
    })
    if (visualMasterReference) operations.push(visualMasterReference)
  })

  operations.push(
    upsertTextNodeOperation({
      snapshot,
      nodeId: VISUAL_SUMMARY_NODE_ID,
      title: '视觉系统汇总',
      position: { x: 2520, y: 420 },
      fields: {
        aiPrompt:
          '请汇总视觉系统总控、所有节目视觉方案、节目关键视觉图和动态视频节点，形成总策划案/PPT 可用的视觉系统章节。重点说明整台视觉主张、各节目差异、关键画面清单、可投放的图片/视频资产及后续深化建议。',
        contentHtml: visualPlaceholderHtml(
          '视觉系统汇总',
          '等待文本生成：汇总视觉总控、节目视觉方案、图片和视频资产，形成 PPT 可用章节。'
        ),
        planningSection: 'visual',
        planningStage: 'visual_summary',
        planningStatus: 'pending_generation',
        planningData: JSON.stringify({
          visualNodeMode: 'program_driven',
          sourceProgramCount: programs.length,
        }),
        approvalNotes: '',
      },
    })
  )

  programs.forEach((program, index) => {
    const detailNodeId = `${PROGRAM_DETAIL_NODE_PREFIX}${index + 1}`
    const visualPlanNodeId = `${PROGRAM_VISUAL_PLAN_NODE_PREFIX}${index + 1}`
    const imageNodeId = `${PROGRAM_IMAGE_NODE_PREFIX}${index + 1}`
    const videoNodeId = `${PROGRAM_VIDEO_NODE_PREFIX}${index + 1}`
    const needsVideo = program.needsVideo ?? program.priority === 'key'

    const visualPlanToSummary = connectIfMissing({
      snapshot,
      sourceNodeId: visualPlanNodeId,
      targetNodeId: VISUAL_SUMMARY_NODE_ID,
      operationId: `show_planning:connect:visual_plan_to_visual_summary:${index + 1}`,
    })
    if (visualPlanToSummary) operations.push(visualPlanToSummary)

    const imageToSummary = connectIfMissing({
      snapshot,
      sourceNodeId: imageNodeId,
      targetNodeId: VISUAL_SUMMARY_NODE_ID,
      operationId: `show_planning:connect:image_to_visual_summary:${index + 1}`,
    })
    if (imageToSummary) operations.push(imageToSummary)

    if (needsVideo) {
      const videoToSummary = connectIfMissing({
        snapshot,
        sourceNodeId: videoNodeId,
        targetNodeId: VISUAL_SUMMARY_NODE_ID,
        operationId: `show_planning:connect:video_to_visual_summary:${index + 1}`,
      })
      if (videoToSummary) operations.push(videoToSummary)
    }

    const detailSummaryReference = addContentReferenceIfMissing({
      snapshot,
      consumerNodeId: summaryNodeId,
      sourceNodeId: detailNodeId,
      operationId: `show_planning:reference:detail_to_summary:${index + 1}`,
    })
    if (detailSummaryReference) operations.push(detailSummaryReference)

    const visualSummaryReference = addContentReferenceIfMissing({
      snapshot,
      consumerNodeId: VISUAL_SUMMARY_NODE_ID,
      sourceNodeId: visualPlanNodeId,
      operationId: `show_planning:reference:visual_plan_to_visual_summary:${index + 1}`,
    })
    if (visualSummaryReference) operations.push(visualSummaryReference)

    const imageSummaryReference = addContentReferenceIfMissing({
      snapshot,
      consumerNodeId: VISUAL_SUMMARY_NODE_ID,
      sourceNodeId: imageNodeId,
      operationId: `show_planning:reference:image_to_visual_summary:${index + 1}`,
    })
    if (imageSummaryReference) operations.push(imageSummaryReference)

    if (needsVideo) {
      const videoSummaryReference = addContentReferenceIfMissing({
        snapshot,
        consumerNodeId: VISUAL_SUMMARY_NODE_ID,
        sourceNodeId: videoNodeId,
        operationId: `show_planning:reference:video_to_visual_summary:${index + 1}`,
      })
      if (videoSummaryReference) operations.push(videoSummaryReference)
    }
  })

  const visualSummaryToPlanningSummary = connectIfMissing({
    snapshot,
    sourceNodeId: VISUAL_SUMMARY_NODE_ID,
    targetNodeId: summaryNodeId,
    operationId: 'show_planning:connect:visual_summary_to_summary',
  })
  if (visualSummaryToPlanningSummary) operations.push(visualSummaryToPlanningSummary)

  const planningSummaryReference = addContentReferenceIfMissing({
    snapshot,
    consumerNodeId: summaryNodeId,
    sourceNodeId: VISUAL_SUMMARY_NODE_ID,
    operationId: 'show_planning:reference:visual_summary_to_summary',
  })
  if (planningSummaryReference) operations.push(planningSummaryReference)

  generationTargets.push({
    clientNodeId: VISUAL_SUMMARY_NODE_ID,
    kind: 'text',
    reason: '汇总节目视觉方案、图片和视频资产',
  })

  return {
    goal: 'Create and generate program detail, visual plan, and media nodes after program review approval.',
    risk: 'medium',
    userIntent: 'generate_output',
    mutationPolicy: 'allow_mutation',
    requiresUserConfirmation: false,
    requiresClarification: false,
    steps: [
      {
        id: 'create_program_production_nodes',
        title: 'Create program detail, visual plan, image, and video nodes',
        intent: 'create',
        toolHints: ['canvas.apply_patch', 'canvas.verify_patch'],
        expectedObservation:
          'Program detail, visual plan, image, video, and visual summary nodes are connected on the canvas.',
      },
      {
        id: 'generate_program_production_outputs',
        title: 'Generate program detail, visual plan, and media outputs',
        intent: 'generate',
        toolHints: ['canvas.generate_node_output', 'canvas.verify_patch'],
        expectedObservation:
          'Text, image, and video generation outputs are verified for the created program nodes.',
      },
    ],
    successCriteria: [
      'Each confirmed program has a generated detail node and visual plan node.',
      'Each confirmed program has a generated key visual image node.',
      'Key programs have generated dynamic video nodes.',
      'The visual summary is available as upstream context for the final planning summary and PPT.',
    ],
    patch: {
      operations,
      reason:
        'Program review was approved, so the confirmed program plan can now drive per-program detail, visual, and media generation.',
    },
    generationTargets,
  }
}

export function readShowPlanningCheckpoint(
  taskFields: Record<string, unknown>
): LocalAgentPlan['checkpoint'] {
  const stage =
    typeof taskFields.planningCheckpointStage === 'string' ? taskFields.planningCheckpointStage : ''
  if (stage === 'structure_review') {
    return {
      kind: 'business_checkpoint',
      stage,
      question: '整体结构已生成。请先确认章节逻辑和情绪走向，确认后我再继续展开节目方案。',
      resumeMessage: '整体结构已确认，请继续基于当前画布生成节目方案节点内容。',
      targetNodeIds: ['planning-structure'],
    }
  }
  if (stage === 'program_review') {
    return {
      kind: 'business_checkpoint',
      stage,
      question:
        '节目方案已生成。请确认节目池方向，确认后我会按节目数量创建节目详细方案、节目视觉方案、图片和重点视频节点，并调用节点生成能力完成内容与媒体。',
      resumeMessage:
        '节目方案已确认。节目详细方案、节目视觉方案、图片和重点视频节点已创建并生成，请继续生成资源阵容、汇总视觉系统、总策划案，并为 presentation 节点准备最终汇报内容。',
      targetNodeIds: ['planning-programs'],
    }
  }
  return undefined
}

export function isShowPlanningPreset(taskFields: Record<string, unknown> | undefined): boolean {
  return taskFields?.workflowPreset === SHOW_PLANNING_WORKFLOW_PRESET
}

export function buildShowPlanningScaffoldGenerationTargets(): LocalCanvasGenerationTarget[] {
  return []
}
