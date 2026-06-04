'use client'

import { useMemo, useState } from 'react'
import { CalendarClock, Pencil, Plus, Sparkles, Trash2, UploadCloud } from 'lucide-react'
import {
  Button,
  Checkbox,
  Combobox,
  type ComboboxOption,
  FormField,
  Input,
  Loader,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
import type { AgentTemplate, WorkgroupAdminSummary } from '@/lib/api/contracts/collaboration'
import type {
  CopilotSkillCard,
  CopilotSkillCardActionKind,
  CreateCopilotSkillCardBody,
  UpdateCopilotSkillCardBody,
} from '@/lib/api/contracts/copilot-skill-cards'
import { cn } from '@/lib/core/utils/cn'
import {
  useCreateCopilotSkillCard,
  useDeleteCopilotSkillCard,
  useOrganizationCopilotSkillCards,
  useUpdateCopilotSkillCard,
} from '@/hooks/queries/copilot-skill-cards'

interface CopilotSkillCardManagerProps {
  organizationId: string
  selectedAgentCode: AgentTemplate['code'] | ''
  agentTemplates: AgentTemplate[]
  workgroups: WorkgroupAdminSummary[]
}

interface SkillCardDraft {
  title: string
  description: string
  prompt: string
  actionKind: CopilotSkillCardActionKind
  workgroupId: string
  taskTitle: string
  taskDescription: string
  dueAtOffsetHours: string
  enabled: boolean
  sortOrder: string
}

const EMPTY_DRAFT: SkillCardDraft = {
  title: '',
  description: '',
  prompt: '',
  actionKind: 'prompt',
  workgroupId: '',
  taskTitle: '',
  taskDescription: '',
  dueAtOffsetHours: '24',
  enabled: true,
  sortOrder: '0',
}

const ACTION_OPTIONS: ComboboxOption[] = [
  { value: 'prompt', label: '填充 Prompt' },
  { value: 'create_task', label: '打开任务抽屉' },
  { value: 'submit_task', label: '提交选中节点' },
]

function getActionIcon(actionKind: CopilotSkillCardActionKind) {
  if (actionKind === 'create_task') return CalendarClock
  if (actionKind === 'submit_task') return UploadCloud
  return Sparkles
}

function buildTaskDraft(draft: SkillCardDraft) {
  if (draft.actionKind !== 'create_task') return null
  const title = draft.taskTitle.trim() || draft.title.trim()
  return {
    title,
    description: draft.taskDescription.trim() || null,
    dueAtOffsetHours: Number(draft.dueAtOffsetHours) || 24,
  }
}

function toCreateBody(
  agentCode: AgentTemplate['code'],
  draft: SkillCardDraft
): CreateCopilotSkillCardBody {
  return {
    agentCode,
    workgroupId: draft.workgroupId || null,
    title: draft.title.trim(),
    description: draft.description.trim(),
    prompt: draft.prompt.trim(),
    actionKind: draft.actionKind,
    taskDraft: buildTaskDraft(draft),
    enabled: draft.enabled,
    sortOrder: Number(draft.sortOrder) || 0,
  }
}

function toUpdateBody(draft: SkillCardDraft): UpdateCopilotSkillCardBody {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    prompt: draft.prompt.trim(),
    actionKind: draft.actionKind,
    taskDraft: buildTaskDraft(draft),
    enabled: draft.enabled,
    sortOrder: Number(draft.sortOrder) || 0,
  }
}

function draftFromCard(card: CopilotSkillCard): SkillCardDraft {
  return {
    title: card.title,
    description: card.description,
    prompt: card.prompt,
    actionKind: card.actionKind,
    workgroupId: card.workgroupId ?? '',
    taskTitle: card.taskDraft?.title ?? card.title,
    taskDescription: card.taskDraft?.description ?? '',
    dueAtOffsetHours: String(card.taskDraft?.dueAtOffsetHours ?? 24),
    enabled: card.enabled,
    sortOrder: String(card.sortOrder),
  }
}

export function CopilotSkillCardManager({
  organizationId,
  selectedAgentCode,
  agentTemplates,
  workgroups,
}: CopilotSkillCardManagerProps) {
  const activeAgentCode = selectedAgentCode || agentTemplates[0]?.code || ''
  const activeAgent = agentTemplates.find((agent) => agent.code === activeAgentCode)
  const { data, isLoading } = useOrganizationCopilotSkillCards(
    organizationId,
    activeAgentCode ? { agentCode: activeAgentCode } : {}
  )
  const createCard = useCreateCopilotSkillCard()
  const updateCard = useUpdateCopilotSkillCard()
  const deleteCard = useDeleteCopilotSkillCard()
  const [draft, setDraft] = useState<SkillCardDraft>(EMPTY_DRAFT)
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  const [cardPendingDelete, setCardPendingDelete] = useState<CopilotSkillCard | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const cards = data?.cards ?? []
  const matchingWorkgroups = useMemo(
    () =>
      workgroups.filter((workgroup) => !activeAgentCode || workgroup.agentCode === activeAgentCode),
    [activeAgentCode, workgroups]
  )
  const scopeOptions = useMemo<ComboboxOption[]>(
    () => [
      { value: 'project', label: '项目通用' },
      ...matchingWorkgroups.map((workgroup) => ({
        value: workgroup.id,
        label: workgroup.name,
      })),
    ],
    [matchingWorkgroups]
  )
  const isBusy = createCard.isPending || updateCard.isPending || deleteCard.isPending
  const canSave = Boolean(
    activeAgentCode && draft.title.trim() && draft.description.trim() && draft.prompt.trim()
  )

  const updateDraft = <Key extends keyof SkillCardDraft>(key: Key, value: SkillCardDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setStatus(null)
  }

  const resetDraft = () => {
    setDraft(EMPTY_DRAFT)
    setEditingCardId(null)
    setStatus(null)
  }

  const handleSave = async () => {
    if (!activeAgentCode || !canSave) return
    try {
      const nextStatus = editingCardId ? 'Skill 卡已更新。' : 'Skill 卡已创建。'
      if (editingCardId) {
        await updateCard.mutateAsync({ cardId: editingCardId, body: toUpdateBody(draft) })
      } else {
        await createCard.mutateAsync({
          organizationId,
          body: toCreateBody(activeAgentCode, draft),
        })
      }
      resetDraft()
      setStatus(nextStatus)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存 Skill 卡失败。')
    }
  }

  const handleToggle = async (card: CopilotSkillCard) => {
    try {
      await updateCard.mutateAsync({
        cardId: card.id,
        body: { enabled: !card.enabled },
      })
      setStatus(card.enabled ? 'Skill 卡已停用。' : 'Skill 卡已启用。')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '更新 Skill 卡失败。')
    }
  }

  const handleDelete = async () => {
    if (!cardPendingDelete) return
    try {
      await deleteCard.mutateAsync(cardPendingDelete.id)
      if (editingCardId === cardPendingDelete.id) resetDraft()
      setCardPendingDelete(null)
      setStatus('Skill 卡已删除。')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '删除 Skill 卡失败。')
    }
  }

  return (
    <>
      <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
        <div className='flex flex-wrap items-start justify-between gap-3 border-[var(--border)] border-b px-4 py-3'>
          <div>
            <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
              Copilot Skill 卡后台
            </h3>
            <p className='mt-1 text-[12px] text-[var(--text-muted)]'>
              为当前 Agent 配置右侧聊天框快捷卡，可设为项目通用或某个团队专属。
            </p>
          </div>
          <span className='rounded-[8px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]'>
            {cards.length} 张卡片
          </span>
        </div>

        <div className='grid gap-4 p-4 xl:grid-cols-[minmax(280px,0.7fr)_minmax(0,1fr)]'>
          <div className='grid gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
            <div className='font-medium text-[12px] text-[var(--text-primary)]'>
              {editingCardId ? '编辑卡片' : '新建卡片'}
            </div>
            <FormField label='作用范围' htmlFor='skill-card-scope'>
              <Combobox
                id='skill-card-scope'
                value={draft.workgroupId || 'project'}
                options={scopeOptions}
                onChange={(value) => updateDraft('workgroupId', value === 'project' ? '' : value)}
                disabled={Boolean(editingCardId)}
                size='sm'
                searchable
                emptyMessage='暂无可选团队'
              />
            </FormField>
            <FormField label='动作' htmlFor='skill-card-action'>
              <Combobox
                id='skill-card-action'
                value={draft.actionKind}
                options={ACTION_OPTIONS}
                onChange={(value) => updateDraft('actionKind', value as CopilotSkillCardActionKind)}
                size='sm'
              />
            </FormField>
            <FormField label='卡片标题' htmlFor='skill-card-title'>
              <Input
                id='skill-card-title'
                value={draft.title}
                onChange={(event) => updateDraft('title', event.target.value)}
                placeholder='例如：拆分任务'
              />
            </FormField>
            <FormField label='说明' htmlFor='skill-card-description'>
              <Input
                id='skill-card-description'
                value={draft.description}
                onChange={(event) => updateDraft('description', event.target.value)}
                placeholder='一句话说明'
              />
            </FormField>
            <FormField label='Prompt' htmlFor='skill-card-prompt'>
              <Textarea
                id='skill-card-prompt'
                value={draft.prompt}
                onChange={(event) => updateDraft('prompt', event.target.value)}
                placeholder='点击卡片后填入 Copilot 的 Prompt 或动作说明'
                className='min-h-[96px]'
              />
            </FormField>
            {draft.actionKind === 'create_task' && (
              <div className='grid gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-2'>
                <Input
                  value={draft.taskTitle}
                  onChange={(event) => updateDraft('taskTitle', event.target.value)}
                  placeholder='任务草稿标题'
                />
                <Textarea
                  value={draft.taskDescription}
                  onChange={(event) => updateDraft('taskDescription', event.target.value)}
                  placeholder='任务草稿说明'
                  className='min-h-[64px]'
                />
                <Input
                  value={draft.dueAtOffsetHours}
                  onChange={(event) => updateDraft('dueAtOffsetHours', event.target.value)}
                  placeholder='默认 DDL 小时数'
                />
              </div>
            )}
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <label
                htmlFor='skill-card-enabled'
                className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'
              >
                <Checkbox
                  id='skill-card-enabled'
                  size='sm'
                  checked={draft.enabled}
                  onCheckedChange={(checked) => updateDraft('enabled', checked === true)}
                />
                启用
              </label>
              <Input
                value={draft.sortOrder}
                onChange={(event) => updateDraft('sortOrder', event.target.value)}
                aria-label='Skill card sort order'
                className='h-[30px] w-[72px]'
              />
            </div>
            <div className='flex flex-wrap gap-2'>
              <Button
                type='button'
                size='sm'
                variant='primary'
                disabled={!canSave || isBusy}
                onClick={() => void handleSave()}
              >
                {isBusy ? (
                  <Loader className='mr-2 h-[13px] w-[13px]' animate />
                ) : (
                  <Plus className='mr-2 h-[13px] w-[13px]' />
                )}
                {editingCardId ? '保存卡片' : '创建卡片'}
              </Button>
              {editingCardId && (
                <Button type='button' size='sm' variant='secondary' onClick={resetDraft}>
                  取消
                </Button>
              )}
            </div>
            {status && <div className='text-[12px] text-[var(--text-muted)]'>{status}</div>}
          </div>

          <div className='grid content-start gap-2'>
            {isLoading ? (
              <div className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
                <Loader className='h-[13px] w-[13px]' animate />
                正在加载 Skill 卡...
              </div>
            ) : cards.length === 0 ? (
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12px] text-[var(--text-muted)]'>
                {activeAgent?.name ?? '当前 Agent'} 暂无后台配置卡片，将使用代码内默认卡片。
              </div>
            ) : (
              cards.map((card) => {
                const ActionIcon = getActionIcon(card.actionKind)
                return (
                  <div
                    key={card.id}
                    className={cn(
                      'grid gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 md:grid-cols-[minmax(0,1fr)_auto]',
                      !card.enabled && 'opacity-60'
                    )}
                  >
                    <div className='min-w-0'>
                      <div className='flex items-center gap-2'>
                        <ActionIcon className='h-[14px] w-[14px] text-[var(--text-icon)]' />
                        <span className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                          {card.title}
                        </span>
                        <span className='shrink-0 rounded-[6px] border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]'>
                          {card.workgroup?.name ?? '项目通用'}
                        </span>
                      </div>
                      <p className='mt-1 text-[12px] text-[var(--text-muted)]'>
                        {card.description}
                      </p>
                      <p className='mt-1 line-clamp-2 text-[11px] text-[var(--text-muted)]'>
                        {card.prompt}
                      </p>
                    </div>
                    <div className='flex flex-wrap items-center gap-2 md:justify-end'>
                      <Button
                        type='button'
                        size='sm'
                        variant='secondary'
                        disabled={isBusy}
                        onClick={() => handleToggle(card)}
                      >
                        {card.enabled ? '停用' : '启用'}
                      </Button>
                      <Button
                        type='button'
                        size='sm'
                        variant='secondary'
                        onClick={() => {
                          setEditingCardId(card.id)
                          setDraft(draftFromCard(card))
                          setStatus(null)
                        }}
                      >
                        <Pencil className='mr-1.5 h-[13px] w-[13px]' />
                        编辑
                      </Button>
                      <Button
                        type='button'
                        size='sm'
                        variant='default'
                        disabled={isBusy}
                        onClick={() => setCardPendingDelete(card)}
                      >
                        <Trash2 className='mr-1.5 h-[13px] w-[13px]' />
                        删除
                      </Button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </section>

      <Modal
        open={Boolean(cardPendingDelete)}
        onOpenChange={(open) => !open && setCardPendingDelete(null)}
      >
        <ModalContent size='sm'>
          <ModalHeader>删除 Skill 卡</ModalHeader>
          <ModalBody className='space-y-2 text-[12px] text-[var(--text-secondary)]'>
            <p>确认删除「{cardPendingDelete?.title}」吗？删除后右侧 Copilot 不再显示这张快捷卡。</p>
            <p className='text-[var(--text-error)]'>这个操作不能撤销。</p>
          </ModalBody>
          <ModalFooter>
            <Button type='button' variant='default' onClick={() => setCardPendingDelete(null)}>
              取消
            </Button>
            <Button
              type='button'
              variant='destructive'
              disabled={deleteCard.isPending}
              onClick={() => void handleDelete()}
            >
              删除
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
