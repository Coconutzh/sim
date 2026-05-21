'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { WorkbenchStatusCard } from '@/components/workbench/workbench-status-card'
import { useSession } from '@/lib/auth/auth-client'
import { getWorkbenchAccessIssue } from '@/lib/workbench/access-errors'
import {
  useAddWorkgroupMember,
  useMyWorkgroups,
  useRemoveWorkgroupMember,
  useSetActiveWorkgroup,
  useUpdateWorkgroupMember,
  useWorkgroupMembers,
} from '@/hooks/queries/collaboration'

export default function TeamManagementPage() {
  const { data: session, isPending } = useSession()
  const {
    data: workgroupData,
    error: workgroupError,
    isLoading,
  } = useMyWorkgroups(Boolean(session?.user))
  const setActiveWorkgroup = useSetActiveWorkgroup()
  const [selectedWorkgroupId, setSelectedWorkgroupId] = useState<string | null>(null)
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')

  const activeWorkgroupId =
    selectedWorkgroupId ?? workgroupData?.defaultWorkgroupId ?? workgroupData?.workgroups[0]?.id
  const activeWorkgroup = useMemo(
    () => workgroupData?.workgroups.find((item) => item.id === activeWorkgroupId) ?? null,
    [activeWorkgroupId, workgroupData?.workgroups]
  )
  const { data: membersData, error: membersError } = useWorkgroupMembers(
    activeWorkgroup?.role === 'admin' ? activeWorkgroup.id : undefined
  )
  const addMember = useAddWorkgroupMember()
  const updateMember = useUpdateWorkgroupMember()
  const removeMember = useRemoveWorkgroupMember()

  if (isPending || isLoading) {
    return (
      <div className='flex min-h-screen items-center justify-center text-muted-foreground'>
        加载团队管理...
      </div>
    )
  }

  const accessIssue = getWorkbenchAccessIssue(workgroupError ?? membersError)
  if (accessIssue) {
    return <WorkbenchStatusCard {...accessIssue} />
  }

  if (!activeWorkgroup || activeWorkgroup.role !== 'admin') {
    return (
      <main className='min-h-screen bg-[#f7f4ed] px-6 py-10'>
        <section className='mx-auto max-w-3xl rounded-[2rem] border border-[#e2d8c7] bg-white p-8 shadow-sm'>
          <Link href='/workbench' className='text-sm font-semibold text-[#9b5b2e]'>
            返回工作台
          </Link>
          <h1 className='mt-4 text-3xl font-semibold tracking-tight text-[#271f18]'>
            需要团队管理员权限
          </h1>
          <p className='mt-3 text-[#6f6256]'>普通成员不能拉人进团队或修改团队成员角色。</p>
        </section>
      </main>
    )
  }

  const mutationIssue = getWorkbenchAccessIssue(
    addMember.error ?? updateMember.error ?? removeMember.error
  )

  return (
    <main className='min-h-screen bg-[#f7f4ed] px-6 py-8 text-[#271f18]'>
      <section className='mx-auto max-w-6xl space-y-5'>
        <div className='rounded-[2rem] border border-[#e2d8c7] bg-white p-6 shadow-sm'>
          <Link href='/workbench' className='text-sm font-semibold text-[#9b5b2e]'>
            返回工作台
          </Link>
          <div className='mt-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
            <div>
              <h1 className='text-3xl font-semibold tracking-tight'>团队管理</h1>
              <p className='mt-3 text-[#6f6256]'>
                管理当前工种团队成员。加入成员后会同步团队画布 workspace 权限。
              </p>
            </div>
            <select
              className='rounded-xl border border-[#d8cbb8] bg-[#fbf8f2] px-4 py-3 text-sm outline-none'
              value={activeWorkgroup.id}
              onChange={(event) => {
                setSelectedWorkgroupId(event.target.value)
                setActiveWorkgroup.mutate(event.target.value)
              }}
            >
              {workgroupData?.workgroups.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.discipline.name} / {item.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <form
          className='grid gap-3 rounded-[1.5rem] border border-[#e2d8c7] bg-white p-5 shadow-sm md:grid-cols-[1fr_180px_auto]'
          onSubmit={(event) => {
            event.preventDefault()
            if (!userId.trim()) return
            addMember.mutate({ workgroupId: activeWorkgroup.id, userId: userId.trim(), role })
            setUserId('')
          }}
        >
          <input
            className='rounded-xl border border-[#d8cbb8] bg-[#fbf8f2] px-4 py-3 text-sm outline-none'
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder='输入要加入团队的 userId'
          />
          <select
            className='rounded-xl border border-[#d8cbb8] bg-[#fbf8f2] px-4 py-3 text-sm outline-none'
            value={role}
            onChange={(event) => setRole(event.target.value as 'admin' | 'member')}
          >
            <option value='member'>成员</option>
            <option value='admin'>团队管理员</option>
          </select>
          <button
            className='rounded-xl bg-[#271f18] px-5 py-3 text-sm font-semibold text-white'
            type='submit'
          >
            添加成员
          </button>
        </form>

        {mutationIssue && (
          <div className='rounded-[1.5rem] border border-[#e2d8c7] bg-white p-5 text-[#9b5b2e] shadow-sm'>
            {mutationIssue.message}
          </div>
        )}

        <div className='overflow-hidden rounded-[1.5rem] border border-[#e2d8c7] bg-white shadow-sm'>
          <div className='grid grid-cols-[1.2fr_1fr_160px_180px] border-b border-[#eee4d6] px-5 py-3 text-sm font-semibold text-[#6f6256]'>
            <span>成员</span>
            <span>邮箱</span>
            <span>角色</span>
            <span>操作</span>
          </div>
          {(membersData?.members ?? []).map((member) => (
            <div
              key={member.userId}
              className='grid grid-cols-[1.2fr_1fr_160px_180px] items-center border-b border-[#f2eadf] px-5 py-4 text-sm last:border-b-0'
            >
              <span className='font-medium'>{member.name}</span>
              <span className='text-[#6f6256]'>{member.email}</span>
              <select
                className='mr-4 rounded-lg border border-[#d8cbb8] bg-[#fbf8f2] px-3 py-2 text-sm outline-none'
                value={member.role}
                onChange={(event) =>
                  updateMember.mutate({
                    workgroupId: activeWorkgroup.id,
                    userId: member.userId,
                    role: event.target.value as 'admin' | 'member',
                  })
                }
              >
                <option value='member'>成员</option>
                <option value='admin'>团队管理员</option>
              </select>
              <button
                className='rounded-lg border border-[#d8cbb8] px-3 py-2 text-sm text-[#9b5b2e] hover:bg-[#f7f4ed]'
                type='button'
                onClick={() =>
                  removeMember.mutate({ workgroupId: activeWorkgroup.id, userId: member.userId })
                }
              >
                移除
              </button>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
