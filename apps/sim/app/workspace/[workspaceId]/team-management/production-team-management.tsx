'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Loader2, Plus, Shield, Trash2, UserPlus, Users } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  toast,
} from '@/components/emcn'
import type { WorkgroupMember } from '@/lib/api/contracts/collaboration'
import { useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import { useLiteCanvasNavigation } from '@/app/workspace/[workspaceId]/use-lite-canvas-navigation'
import {
  useAddWorkgroupMember,
  useCreateWorkgroup,
  useDisciplines,
  useMyWorkgroups,
  useOrganizationWorkgroups,
  useRemoveWorkgroupMember,
  useUpdateWorkgroupMember,
  useWorkgroupMembers,
} from '@/hooks/queries/collaboration'

type WorkgroupRole = 'admin' | 'member'
type ProductionWorkgroupRole = WorkgroupRole | 'org_admin' | 'project_admin' | null

function roleLabel(role: ProductionWorkgroupRole) {
  if (role === 'org_admin') return '项目管理员'
  if (role === 'project_admin') return '项目总控'
  if (role === 'admin') return '团队管理员'
  if (role === 'member') return '成员'
  return '未加入'
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : '操作失败'
}

export function ProductionTeamManagement() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: session } = useSession()
  const canvas = useLiteCanvasNavigation({ workspaceId })
  const activeWorkgroup = canvas.activeWorkgroup
  const organizationId = activeWorkgroup?.organizationId
  const { data: myWorkgroupsData } = useMyWorkgroups(true)
  const { data: disciplinesData } = useDisciplines()
  const { data: organizationWorkgroupsData, isLoading: isLoadingWorkgroups } =
    useOrganizationWorkgroups(organizationId)
  const createWorkgroup = useCreateWorkgroup()
  const addMember = useAddWorkgroupMember()
  const updateMember = useUpdateWorkgroupMember()
  const removeMember = useRemoveWorkgroupMember()

  const [selectedWorkgroupId, setSelectedWorkgroupId] = useState<string>('')
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDisciplineId, setNewTeamDisciplineId] = useState('')
  const [memberTarget, setMemberTarget] = useState('')
  const [memberRole, setMemberRole] = useState<WorkgroupRole>('member')
  const [memberToRemove, setMemberToRemove] = useState<WorkgroupMember | null>(null)

  const organizationWorkgroups = organizationWorkgroupsData?.workgroups ?? []
  const selectedWorkgroup =
    organizationWorkgroups.find((workgroup) => workgroup.id === selectedWorkgroupId) ??
    organizationWorkgroups.find((workgroup) => workgroup.id === activeWorkgroup?.id) ??
    organizationWorkgroups[0]
  const canCreateTeam = canvas.isProjectAdmin
  const canManageSelected =
    selectedWorkgroup?.currentUserRole === 'org_admin' ||
    selectedWorkgroup?.currentUserRole === 'project_admin' ||
    selectedWorkgroup?.currentUserRole === 'admin'
  const canOverrideTeamAdmin =
    session?.user?.role === 'admin' || selectedWorkgroup?.currentUserRole === 'org_admin'
  const { data: membersData, isLoading: isLoadingMembers } = useWorkgroupMembers(
    canManageSelected ? selectedWorkgroup?.id : undefined
  )
  const members = membersData?.members ?? []
  const adminCount = members.filter((member) => member.role === 'admin').length

  const disciplineOptions = useMemo<ComboboxOption[]>(
    () =>
      (disciplinesData?.disciplines ?? []).map((discipline) => ({
        value: discipline.id,
        label: discipline.name,
      })),
    [disciplinesData?.disciplines]
  )

  useEffect(() => {
    if (!selectedWorkgroupId && activeWorkgroup?.id) {
      setSelectedWorkgroupId(activeWorkgroup.id)
    }
  }, [activeWorkgroup?.id, selectedWorkgroupId])

  useEffect(() => {
    if (!newTeamDisciplineId && disciplineOptions[0]?.value) {
      setNewTeamDisciplineId(disciplineOptions[0].value)
    }
  }, [disciplineOptions, newTeamDisciplineId])

  const handleCreateTeam = async () => {
    if (!organizationId || !newTeamName.trim() || !newTeamDisciplineId || !canCreateTeam) return
    try {
      const result = await createWorkgroup.mutateAsync({
        organizationId,
        name: newTeamName.trim(),
        disciplineId: newTeamDisciplineId,
      })
      setNewTeamName('')
      setSelectedWorkgroupId(result.workgroup.id)
      toast.success('团队已创建')
    } catch (error) {
      toast.error(readError(error))
    }
  }

  const handleAddMember = async () => {
    if (!selectedWorkgroup?.id || !memberTarget.trim() || !canManageSelected) return
    const target = memberTarget.trim()
    try {
      await addMember.mutateAsync({
        workgroupId: selectedWorkgroup.id,
        organizationId,
        role: memberRole,
        ...(target.includes('@') ? { email: target } : { userId: target }),
      })
      setMemberTarget('')
      setMemberRole('member')
      toast.success('成员已加入团队')
    } catch (error) {
      toast.error(readError(error))
    }
  }

  const handleRoleChange = async (userId: string, role: WorkgroupRole) => {
    if (!selectedWorkgroup?.id) return
    try {
      await updateMember.mutateAsync({ workgroupId: selectedWorkgroup.id, userId, role })
      toast.success('角色已更新')
    } catch (error) {
      toast.error(readError(error))
    }
  }

  const handleRemoveMember = async () => {
    if (!selectedWorkgroup?.id || !memberToRemove) return
    try {
      await removeMember.mutateAsync({
        organizationId,
        workgroupId: selectedWorkgroup.id,
        userId: memberToRemove.userId,
      })
      setMemberToRemove(null)
      toast.success('成员已移除')
    } catch (error) {
      toast.error(readError(error))
    }
  }

  if (!activeWorkgroup && !isLoadingWorkgroups) {
    return (
      <div className='flex h-full items-center justify-center bg-[var(--bg)] p-6 text-center'>
        <div>
          <Users className='mx-auto h-8 w-8 text-[var(--text-tertiary)]' />
          <div className='mt-3 font-medium text-[13px] text-[var(--text-primary)]'>
            当前账号还没有项目团队
          </div>
          <div className='mt-1 text-[12px] text-[var(--text-tertiary)]'>
            请先由项目管理员分配团队，或接受项目邀请。
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='h-full overflow-y-auto bg-[var(--bg)] [scrollbar-gutter:stable_both-edges]'>
      <div className='mx-auto flex min-h-full w-full max-w-[84rem] flex-col px-4 py-8 sm:px-6 lg:px-10'>
        <header className='flex flex-col gap-3 border-[var(--border)] border-b pb-5 md:flex-row md:items-end md:justify-between'>
          <div className='min-w-0'>
            <div className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
              <Shield className='h-4 w-4' />
              {activeWorkgroup?.organization.name ?? '项目'}
            </div>
            <h1 className='mt-2 font-semibold text-[28px] text-[var(--text-primary)]'>团队管理</h1>
            <p className='mt-2 max-w-[46rem] text-[14px] text-[var(--text-muted)] leading-6'>
              管理项目里的团队和成员。项目管理员可以创建团队；团队管理员可以维护本团队成员。
            </p>
          </div>
          {selectedWorkgroup?.teamWorkspaceId ? (
            <Link
              href={`/workspace/${selectedWorkgroup.teamWorkspaceId}/w`}
              className='inline-flex h-[30px] items-center justify-center rounded-[5px] bg-[var(--brand-secondary)] px-2 py-1.5 font-medium text-[12px] text-[var(--text-primary)] transition-colors'
            >
              打开团队画布
            </Link>
          ) : null}
        </header>

        <main className='grid min-h-[620px] gap-4 py-5 lg:grid-cols-[320px_1fr]'>
          <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='border-[var(--border)] border-b px-4 py-3'>
              <div className='font-semibold text-[13px] text-[var(--text-primary)]'>项目团队</div>
              <div className='mt-1 text-[12px] text-[var(--text-tertiary)]'>
                {organizationWorkgroups.length} 个团队
              </div>
            </div>
            <div className='space-y-2 p-2'>
              {isLoadingWorkgroups ? (
                <div className='flex items-center gap-2 px-2 py-3 text-[12px] text-[var(--text-tertiary)]'>
                  <Loader2 className='h-3.5 w-3.5 animate-spin' />
                  加载团队...
                </div>
              ) : (
                organizationWorkgroups.map((workgroup) => (
                  <Button
                    key={workgroup.id}
                    type='button'
                    variant='ghost'
                    className={cn(
                      'flex h-auto w-full items-center justify-between gap-3 rounded-[8px] px-3 py-2 text-left',
                      selectedWorkgroup?.id === workgroup.id
                        ? 'bg-[var(--surface-active)]'
                        : 'hover-hover:bg-[var(--surface-hover)]'
                    )}
                    onClick={() => setSelectedWorkgroupId(workgroup.id)}
                  >
                    <div className='min-w-0'>
                      <div className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                        {workgroup.name}
                      </div>
                      <div className='mt-0.5 truncate text-[11px] text-[var(--text-tertiary)]'>
                        {workgroup.disciplineName} / {workgroup.memberCount} 人
                      </div>
                    </div>
                    <Badge
                      variant='gray-secondary'
                      size='sm'
                      className='shrink-0 rounded-full px-2'
                    >
                      {roleLabel(workgroup.currentUserRole)}
                    </Badge>
                  </Button>
                ))
              )}
            </div>

            {canCreateTeam ? (
              <div className='border-[var(--border)] border-t p-3'>
                <div className='mb-2 font-medium text-[12px] text-[var(--text-secondary)]'>
                  新建团队
                </div>
                <div className='space-y-2'>
                  <Input
                    value={newTeamName}
                    onChange={(event) => setNewTeamName(event.target.value)}
                    placeholder='团队名称'
                  />
                  <Combobox
                    value={newTeamDisciplineId}
                    options={disciplineOptions}
                    onChange={setNewTeamDisciplineId}
                    placeholder='选择工种'
                    searchable
                  />
                  <Button
                    type='button'
                    className='w-full'
                    disabled={createWorkgroup.isPending || !newTeamName.trim()}
                    onClick={() => void handleCreateTeam()}
                  >
                    {createWorkgroup.isPending ? (
                      <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                    ) : (
                      <Plus className='mr-1.5 h-3.5 w-3.5' />
                    )}
                    创建团队
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            {selectedWorkgroup ? (
              <div className='flex h-full flex-col'>
                <div className='border-[var(--border)] border-b px-4 py-3'>
                  <div className='flex flex-col gap-3 md:flex-row md:items-start md:justify-between'>
                    <div className='min-w-0'>
                      <h2 className='truncate font-semibold text-[17px] text-[var(--text-primary)]'>
                        {selectedWorkgroup.name}
                      </h2>
                      <div className='mt-1 text-[12px] text-[var(--text-tertiary)]'>
                        {selectedWorkgroup.disciplineName} /{' '}
                        {roleLabel(selectedWorkgroup.currentUserRole)}
                      </div>
                    </div>
                    {selectedWorkgroup.teamWorkspaceId ? (
                      <Link
                        href={`/workspace/${selectedWorkgroup.teamWorkspaceId}/w`}
                        className='inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12px] text-[var(--text-secondary)] transition-colors hover-hover:bg-[var(--surface-hover)] hover-hover:text-[var(--text-primary)]'
                      >
                        团队画布
                        <ArrowRight className='h-3.5 w-3.5' />
                      </Link>
                    ) : null}
                  </div>
                </div>

                {!canManageSelected ? (
                  <div className='flex min-h-[420px] flex-col items-center justify-center p-6 text-center'>
                    <Shield className='h-8 w-8 text-[var(--text-tertiary)]' />
                    <div className='mt-3 font-medium text-[13px] text-[var(--text-primary)]'>
                      没有管理权限
                    </div>
                    <div className='mt-1 max-w-[26rem] text-[12px] text-[var(--text-tertiary)] leading-5'>
                      只有项目管理员或该团队管理员可以管理成员。普通成员可从左侧胶囊邀请新成员加入自己的团队。
                    </div>
                  </div>
                ) : (
                  <div className='flex-1 space-y-4 p-4'>
                    <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'>
                      <div className='flex items-center justify-between gap-3 border-[var(--border)] border-b px-3 py-2'>
                        <div className='font-semibold text-[13px] text-[var(--text-primary)]'>
                          成员
                        </div>
                        <Badge variant='gray-secondary' size='sm' className='rounded-full px-2'>
                          {members.length}
                        </Badge>
                      </div>
                      <div className='divide-y divide-[var(--border)]'>
                        {isLoadingMembers ? (
                          <div className='flex items-center gap-2 px-3 py-4 text-[12px] text-[var(--text-tertiary)]'>
                            <Loader2 className='h-3.5 w-3.5 animate-spin' />
                            加载成员...
                          </div>
                        ) : members.length === 0 ? (
                          <div className='px-3 py-8 text-center text-[12px] text-[var(--text-tertiary)]'>
                            暂无成员
                          </div>
                        ) : (
                          members.map((member) => (
                            <div
                              key={member.userId}
                              className='flex flex-col gap-2 px-3 py-3 md:flex-row md:items-center md:justify-between'
                            >
                              <div className='min-w-0'>
                                <div className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                                  {member.name || member.email}
                                </div>
                                <div className='mt-0.5 truncate text-[11px] text-[var(--text-tertiary)]'>
                                  {member.email}
                                </div>
                              </div>
                              <div className='flex shrink-0 flex-wrap justify-end gap-1'>
                                {(['member', 'admin'] as WorkgroupRole[]).map((role) => (
                                  <Button
                                    key={role}
                                    type='button'
                                    size='sm'
                                    variant={member.role === role ? 'active' : 'ghost'}
                                    disabled={
                                      updateMember.isPending ||
                                      (member.accountRole === 'admin' && role !== 'admin') ||
                                      (member.role === 'admin' &&
                                        role !== 'admin' &&
                                        (!canOverrideTeamAdmin || adminCount <= 1))
                                    }
                                    onClick={() => void handleRoleChange(member.userId, role)}
                                  >
                                    {roleLabel(role)}
                                  </Button>
                                ))}
                                <Button
                                  type='button'
                                  size='sm'
                                  variant='ghost'
                                  disabled={
                                    removeMember.isPending ||
                                    member.userId === session?.user?.id ||
                                    member.accountRole === 'admin' ||
                                    (member.role === 'admin' &&
                                      (adminCount <= 1 || !canOverrideTeamAdmin))
                                  }
                                  onClick={() => setMemberToRemove(member)}
                                >
                                  <Trash2 className='mr-1 h-3.5 w-3.5' />
                                  移除
                                </Button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </section>

                    <section className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                      <div className='mb-3 font-semibold text-[13px] text-[var(--text-primary)]'>
                        直接添加成员
                      </div>
                      <div className='grid gap-2 md:grid-cols-[1fr_160px_auto]'>
                        <Input
                          value={memberTarget}
                          onChange={(event) => setMemberTarget(event.target.value)}
                          placeholder='输入用户 ID 或已注册邮箱'
                        />
                        <div className='flex rounded-[6px] border border-[var(--border)] bg-[var(--surface-1)] p-0.5'>
                          {(['member', 'admin'] as WorkgroupRole[]).map((role) => (
                            <Button
                              key={role}
                              type='button'
                              size='sm'
                              variant={memberRole === role ? 'active' : 'ghost'}
                              className={cn(
                                'h-7 flex-1 rounded-[5px] px-2 text-[12px]',
                                memberRole !== role && 'text-[var(--text-tertiary)]'
                              )}
                              onClick={() => setMemberRole(role)}
                            >
                              {roleLabel(role)}
                            </Button>
                          ))}
                        </div>
                        <Button
                          type='button'
                          disabled={addMember.isPending || !memberTarget.trim()}
                          onClick={() => void handleAddMember()}
                        >
                          {addMember.isPending ? (
                            <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                          ) : (
                            <UserPlus className='mr-1.5 h-3.5 w-3.5' />
                          )}
                          添加
                        </Button>
                      </div>
                    </section>
                  </div>
                )}
              </div>
            ) : (
              <div className='flex min-h-[520px] flex-col items-center justify-center p-6 text-center'>
                <Users className='h-8 w-8 text-[var(--text-tertiary)]' />
                <div className='mt-3 font-medium text-[13px] text-[var(--text-primary)]'>
                  暂无团队
                </div>
                <div className='mt-1 text-[12px] text-[var(--text-tertiary)]'>
                  项目管理员可以先创建一个团队。
                </div>
              </div>
            )}
          </section>
        </main>
      </div>
      <Modal
        open={Boolean(memberToRemove)}
        onOpenChange={(open) => !open && setMemberToRemove(null)}
      >
        <ModalContent size='sm'>
          <ModalHeader>移除成员</ModalHeader>
          <ModalBody>
            <div className='space-y-2 text-[13px] text-[var(--text-secondary)]'>
              <p>
                确认将{' '}
                <span className='font-medium text-[var(--text-primary)]'>
                  {memberToRemove?.name || memberToRemove?.email || '该成员'}
                </span>{' '}
                从 {selectedWorkgroup?.name ?? '当前团队'} 移除吗？
              </p>
              <p className='text-[12px] text-[var(--text-error)]'>
                移除后，对方将失去当前团队画布访问权限；如需恢复，需要重新添加或邀请。
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button type='button' variant='default' onClick={() => setMemberToRemove(null)}>
              取消
            </Button>
            <Button
              type='button'
              variant='destructive'
              disabled={removeMember.isPending}
              onClick={() => void handleRemoveMember()}
            >
              {removeMember.isPending ? (
                <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
              ) : (
                <Trash2 className='mr-1.5 h-3.5 w-3.5' />
              )}
              移除
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
