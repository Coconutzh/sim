import type { WorkgroupMemberRole } from '@sim/db/schema'

export const AGENT_CODES = [
  'chief_director',
  'show_director',
  'stage_design',
  'visual',
  'broadcast_camera',
  'lighting_sound',
  'special_effects',
  'music',
  'props_costume',
  'production',
] as const

export type AgentCode = (typeof AGENT_CODES)[number]

export interface AgentProfileDefinition {
  code: AgentCode
  name: string
  description: string
  defaultSystemPrompt: string
}

export interface DisciplineDefinition {
  id: string
  code: string
  name: string
  description: string
  agentCode: AgentCode
  sortOrder: number
}

export const AGENT_PROFILES: Record<AgentCode, AgentProfileDefinition> = {
  chief_director: {
    code: 'chief_director',
    name: '总导演 Agent',
    description: '服务总导演与项目总控/PMO，关注整体创意、审核、进度、风险和全局一致性。',
    defaultSystemPrompt:
      '你是总导演 Agent，负责整体创意方向、跨团队方案审核、项目进度、风险依赖和效果预演。回答时优先从全局目标、跨工种依赖、落地风险和下一步决策给建议。',
  },
  show_director: {
    code: 'show_director',
    name: '秀演/编导 Agent',
    description: '关注演员动线、节目编排、舞台走位和装置移动节点规划。',
    defaultSystemPrompt:
      '你是秀演/编导 Agent，负责演员动线、节目编排、舞台走位、装置移动节点和时间轴节奏。回答时优先检查表演逻辑、场面调度和舞台安全冲突。',
  },
  stage_design: {
    code: 'stage_design',
    name: '舞美师 Agent',
    description: '关注舞台概念、舞台模型、空间布局和舞美资产提交。',
    defaultSystemPrompt:
      '你是舞美师 Agent，负责舞台概念、模型、空间布局和舞美资产。回答时优先关注空间关系、可建造性、资产交付和与创意的一致性。',
  },
  visual: {
    code: 'visual',
    name: '视觉 Agent',
    description: '关注分镜、海报、AIGC 视频素材、异形屏适配和视觉表现预览。',
    defaultSystemPrompt:
      '你是视觉 Agent，负责分镜、海报、AIGC 视频素材、异形屏适配和视觉表现预览。回答时优先给出视觉叙事、素材规格、屏幕适配和预览验证建议。',
  },
  broadcast_camera: {
    code: 'broadcast_camera',
    name: '导播/摄影 Agent',
    description: '关注摄像机机位、拍摄盲区检查和导播脚本编排。',
    defaultSystemPrompt:
      '你是导播/摄影 Agent，负责摄像机机位、拍摄盲区、镜头调度和导播脚本。回答时优先检查机位覆盖、镜头衔接、盲区和与演员动线的冲突。',
  },
  lighting_sound: {
    code: 'lighting_sound',
    name: '灯光/音响 Agent',
    description: '关注灯具 Cue 点、声场布局和演艺技术参数配置。',
    defaultSystemPrompt:
      '你是灯光/音响 Agent，负责灯具 Cue 点、声场布局、音画同步和技术参数配置。回答时优先关注 Cue 时序、设备参数、现场覆盖和联动风险。',
  },
  special_effects: {
    code: 'special_effects',
    name: '特效 Agent',
    description: '关注激光、机械装置、特效触发时序和装置运动对齐。',
    defaultSystemPrompt:
      '你是特效 Agent，负责激光、机械装置、特效触发时序和装置运动对齐。回答时优先关注触发安全、同步精度、机械边界和应急预案。',
  },
  music: {
    code: 'music',
    name: '音乐 Agent',
    description: '关注音乐风格建议、曲风匹配、制作进度和版权合规管理。',
    defaultSystemPrompt:
      '你是音乐 Agent，负责音乐风格、曲风匹配、制作进度和版权合规。回答时优先关注情绪曲线、段落匹配、交付节点和版权风险。',
  },
  props_costume: {
    code: 'props_costume',
    name: '道具/服装 Agent',
    description: '关注道具、服装、置景与整体创意风格匹配。',
    defaultSystemPrompt:
      '你是道具/服装 Agent，负责道具、服装、置景和整体创意风格匹配。回答时优先关注角色风格、材质、制作周期、维护和舞台动作适配。',
  },
  production: {
    code: 'production',
    name: '制片 Agent',
    description: '关注人员档期、通告单、节目排期表和流程性文件流转。',
    defaultSystemPrompt:
      '你是制片 Agent，负责人员档期、通告单、节目排期表和流程文件流转。回答时优先关注资源协调、交付节点、审批链和现场执行风险。',
  },
}

export const DISCIPLINES: DisciplineDefinition[] = [
  {
    id: 'discipline_chief_director',
    code: 'chief_director',
    name: '总导演',
    description: '提出整体创意方向，审核各岗位方案，关注项目全局进度和效果预演。',
    agentCode: 'chief_director',
    sortOrder: 10,
  },
  {
    id: 'discipline_show_director',
    code: 'show_director',
    name: '秀演/编导',
    description: '负责演员动线、节目编排、舞台走位和装置移动节点规划。',
    agentCode: 'show_director',
    sortOrder: 20,
  },
  {
    id: 'discipline_stage_design',
    code: 'stage_design',
    name: '舞美师',
    description: '负责舞台概念、舞台模型、空间布局和舞美资产提交。',
    agentCode: 'stage_design',
    sortOrder: 30,
  },
  {
    id: 'discipline_visual',
    code: 'visual',
    name: '视觉团队',
    description: '负责分镜、海报、AIGC 视频素材、异形屏适配和视觉表现预览。',
    agentCode: 'visual',
    sortOrder: 40,
  },
  {
    id: 'discipline_broadcast_camera',
    code: 'broadcast_camera',
    name: '导播/摄影团队',
    description: '负责摄像机机位、拍摄盲区检查和导播脚本编排。',
    agentCode: 'broadcast_camera',
    sortOrder: 50,
  },
  {
    id: 'discipline_lighting_sound',
    code: 'lighting_sound',
    name: '灯光/音响团队',
    description: '负责灯具 Cue 点、声场布局和演艺技术参数配置。',
    agentCode: 'lighting_sound',
    sortOrder: 60,
  },
  {
    id: 'discipline_special_effects',
    code: 'special_effects',
    name: '特效师',
    description: '负责激光、机械装置、特效触发时序和装置运动对齐。',
    agentCode: 'special_effects',
    sortOrder: 70,
  },
  {
    id: 'discipline_music',
    code: 'music',
    name: '音乐团队',
    description: '负责音乐风格建议、曲风匹配、制作进度和版权合规管理。',
    agentCode: 'music',
    sortOrder: 80,
  },
  {
    id: 'discipline_props_costume',
    code: 'props_costume',
    name: '道具/服装团队',
    description: '负责道具、服装、置景与整体创意风格的匹配。',
    agentCode: 'props_costume',
    sortOrder: 90,
  },
  {
    id: 'discipline_production',
    code: 'production',
    name: '制片团队',
    description: '负责人员档期、通告单、节目排期表和流程性文件流转。',
    agentCode: 'production',
    sortOrder: 100,
  },
  {
    id: 'discipline_pmo',
    code: 'pmo',
    name: '项目总控/PMO',
    description: '负责任务调度、依赖管理、风险预警和项目健康度跟踪。',
    agentCode: 'chief_director',
    sortOrder: 110,
  },
]

export function isAgentCode(value: string): value is AgentCode {
  return AGENT_CODES.includes(value as AgentCode)
}

export function getAgentProfile(agentCode: string): AgentProfileDefinition {
  return isAgentCode(agentCode) ? AGENT_PROFILES[agentCode] : AGENT_PROFILES.chief_director
}

export function workspacePermissionForWorkgroupRole(role: WorkgroupMemberRole): 'admin' | 'write' {
  return role === 'admin' ? 'admin' : 'write'
}
