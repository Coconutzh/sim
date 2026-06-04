import type { ComponentType, SVGProps } from 'react'
import {
  CalendarClock,
  Clapperboard,
  ClipboardCheck,
  Lightbulb,
  ListChecks,
  Music4,
  PenLine,
  ScrollText,
  Sparkles,
  UploadCloud,
} from 'lucide-react'
import type { CopilotSkillCard } from '@/lib/api/contracts/copilot-skill-cards'
import type { AgentCode } from '@/lib/collaboration/definitions'

export type CopilotSkillActionKind = 'prompt' | 'create_task' | 'submit_task'

export interface CopilotConfiguredSkillAction {
  id: string
  name: string
  description: string | null
  enabled?: boolean
}

export interface CopilotSkillActionCard {
  id: string
  title: string
  description: string
  prompt: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  actionKind?: CopilotSkillActionKind
  taskDraft?: {
    title: string
    description?: string
    dueAtOffsetHours?: number
  }
}

const DIRECTOR_SKILL_ACTION_CARDS: CopilotSkillActionCard[] = [
  {
    id: 'director-task-breakdown',
    title: '拆分任务',
    description: '把目标拆成可派发、可验收的执行清单',
    icon: ListChecks,
    prompt:
      '请以导演组的方式帮我拆分当前目标。先基于已有上下文判断任务边界；如果信息不足，先问我最多 3 个关键问题。输出请包含：阶段、具体任务、建议负责工种、依赖关系、验收标准、风险提醒，以及建议的下一步。',
  },
  {
    id: 'director-set-ddl',
    title: '设置 DDL',
    description: '给某个工种创建带截止时间的生产任务',
    icon: CalendarClock,
    actionKind: 'create_task',
    prompt:
      '请帮我把当前事项整理成一个生产任务，并建议负责工种、DDL、验收标准和风险提醒。',
    taskDraft: {
      title: '新生产任务',
      description: '请补充任务背景、交付内容、验收标准和依赖风险。',
      dueAtOffsetHours: 24,
    },
  },
  {
    id: 'director-dialogue-draft',
    title: '写台词脚本',
    description: '生成带节奏和动作提示的对白初稿',
    icon: ScrollText,
    prompt:
      '请以导演和编剧的视角帮我写一版台词脚本。如果上下文不足，先询问题材、人物关系、场景和情绪目标；如果上下文足够，请按场景、角色、对白、动作提示、镜头或节奏建议输出，并保持语言自然、有画面感。',
  },
]

const TEAM_SKILL_ACTION_CARDS: Partial<Record<AgentCode, CopilotSkillActionCard[]>> = {
  lighting_sound: [
    {
      id: 'lighting-sound-cue-check',
      title: '检查 Cue 点',
      description: '梳理灯光/音响节点与同步风险',
      icon: Lightbulb,
      prompt:
        '请以灯光/音响团队视角检查当前方案的 Cue 点。输出请包含：Cue 编号、触发时机、设备/声场要求、与画面或演员动作的同步点、可能风险，以及需要导演组确认的问题。',
    },
  ],
  stage_design: [
    {
      id: 'stage-design-submit-node',
      title: '提交节点',
      description: '把当前选中画布节点提交给导演审核',
      icon: UploadCloud,
      actionKind: 'submit_task',
      prompt:
        '请帮我整理当前选中舞美节点的提交说明，包含设计意图、空间关系、交付内容、依赖和需要导演审核的重点。',
    },
  ],
  visual: [
    {
      id: 'visual-storyboard-review',
      title: '分镜检查',
      description: '检查视觉叙事、屏幕适配和素材缺口',
      icon: Clapperboard,
      prompt:
        '请以视觉团队视角检查当前分镜或素材方案。输出请包含：叙事节奏、屏幕适配、素材规格、缺口清单、风险，以及下一步需要补齐的素材。',
    },
  ],
  production: [
    {
      id: 'production-schedule-risk',
      title: '排期风险',
      description: '整理制片排期、资源和审批链风险',
      icon: ClipboardCheck,
      prompt:
        '请以制片团队视角检查当前事项的排期风险。输出请包含：资源需求、关键日期、审批链、冲突点、风险等级和建议协调动作。',
    },
  ],
  music: [
    {
      id: 'music-emotion-curve',
      title: '情绪曲线',
      description: '分析音乐段落与舞台节奏匹配',
      icon: Music4,
      prompt:
        '请以音乐团队视角分析当前段落的情绪曲线。输出请包含：段落目标、情绪转折、节拍或速度建议、与画面/动作同步点、版权或制作风险。',
    },
  ],
  props_costume: [
    {
      id: 'props-costume-style-match',
      title: '风格匹配',
      description: '检查道具服装与角色和舞台风格一致性',
      icon: PenLine,
      prompt:
        '请以道具/服装团队视角检查当前方案的风格匹配。输出请包含：角色/场景需求、材质色彩、制作周期、维护风险、与舞台动作的冲突点。',
    },
  ],
  special_effects: [
    {
      id: 'special-effects-safety-check',
      title: '特效安全',
      description: '检查触发时序、机械边界和应急预案',
      icon: Sparkles,
      prompt:
        '请以特效团队视角检查当前方案。输出请包含：触发时序、设备边界、安全距离、联动依赖、应急预案和需要导演确认的风险。',
    },
  ],
}

const DEFAULT_SKILL_ACTION_CARDS: CopilotSkillActionCard[] = [
  {
    id: 'team-next-step',
    title: '下一步建议',
    description: '把当前上下文整理成可执行动作',
    icon: ListChecks,
    prompt:
      '请基于当前画布和对话上下文，从我的工种视角整理下一步行动。输出请包含：目标、具体动作、依赖、需要确认的问题和交付标准。',
  },
]

function getDefaultCards(agentCode?: AgentCode): CopilotSkillActionCard[] {
  if (agentCode === 'chief_director' || agentCode === 'show_director') {
    return DIRECTOR_SKILL_ACTION_CARDS
  }
  return TEAM_SKILL_ACTION_CARDS[agentCode ?? 'production'] ?? DEFAULT_SKILL_ACTION_CARDS
}

function getManagedCardIcon(actionKind: CopilotSkillActionKind) {
  if (actionKind === 'create_task') return CalendarClock
  if (actionKind === 'submit_task') return UploadCloud
  return Sparkles
}

function getManagedSkillCards(cards?: CopilotSkillCard[]): CopilotSkillActionCard[] {
  return (cards ?? [])
    .filter((card) => card.enabled)
    .map((card) => ({
      id: `managed-skill-card-${card.id}`,
      title: card.title,
      description: card.description,
      icon: getManagedCardIcon(card.actionKind),
      prompt: card.prompt,
      actionKind: card.actionKind,
      taskDraft: card.taskDraft
        ? {
            title: card.taskDraft.title,
            description: card.taskDraft.description ?? undefined,
            dueAtOffsetHours: card.taskDraft.dueAtOffsetHours ?? undefined,
          }
        : undefined,
    }))
}

function getConfiguredSkillCards(
  skills?: CopilotConfiguredSkillAction[]
): CopilotSkillActionCard[] {
  return (skills ?? [])
    .filter((skill) => skill.enabled !== false)
    .map((skill) => ({
      id: `configured-skill-${skill.id}`,
      title: skill.name,
      description: skill.description ?? '使用团队配置的知识规范生成建议',
      icon: Sparkles,
      prompt: `请调用并遵循团队 Skill「${skill.name}」的知识规范，结合当前画布和对话上下文给出可执行建议。`,
    }))
}

export function getCopilotSkillActionCards(
  agentCode?: AgentCode,
  configuredSkills?: CopilotConfiguredSkillAction[],
  managedCards?: CopilotSkillCard[]
): CopilotSkillActionCard[] {
  const defaultCards = getDefaultCards(agentCode)
  const managedSkillCards = getManagedSkillCards(managedCards)
  const configuredCards = getConfiguredSkillCards(configuredSkills)
  const existingIds = new Set(defaultCards.map((card) => card.id))
  return [
    ...defaultCards,
    ...managedSkillCards.filter((card) => !existingIds.has(card.id)).slice(0, 6),
    ...configuredCards.filter((card) => !existingIds.has(card.id)).slice(0, 4),
  ]
}
