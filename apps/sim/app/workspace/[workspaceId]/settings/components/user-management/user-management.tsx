'use client'

import { useState } from 'react'
import { Search, UserPlus } from 'lucide-react'
import {
  Badge,
  Button,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import {
  type AdminConsoleUser,
  useAdminConsoleUserMemberships,
  useAdminConsoleUsers,
  useCreateAdminConsoleUser,
  useSetAdminConsoleOrganizationMembership,
  useSetAdminConsoleWorkgroupMembership,
  useUpdateAdminConsoleUser,
} from '@/hooks/queries/admin-console'

const PAGE_SIZE = 25 as const

function roleBadge(role: string) {
  return <Badge variant={role === 'admin' || role === 'owner' ? 'blue' : 'gray'}>{role}</Badge>
}

export function UserManagement() {
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState({ limit: PAGE_SIZE, offset: 0, search: '' })
  const [selectedUserId, setSelectedUserId] = useState('')
  const [createForm, setCreateForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'user' as 'user' | 'admin',
  })
  const [organizationForm, setOrganizationForm] = useState({
    organizationId: '',
    role: 'member' as 'owner' | 'admin' | 'member',
    reason: '',
  })
  const [workgroupForm, setWorkgroupForm] = useState({
    workgroupId: '',
    role: 'member' as 'admin' | 'member',
    reason: '',
  })

  const usersQuery = useAdminConsoleUsers(query)
  const createUser = useCreateAdminConsoleUser()
  const updateUser = useUpdateAdminConsoleUser()
  const membershipsQuery = useAdminConsoleUserMemberships(selectedUserId)
  const setOrganizationMembership = useSetAdminConsoleOrganizationMembership()
  const setWorkgroupMembership = useSetAdminConsoleWorkgroupMembership()

  const users = usersQuery.data?.users ?? []
  const selectedUser = users.find((user) => user.id === selectedUserId)
  const memberships = membershipsQuery.data

  const submitSearch = () => setQuery({ limit: PAGE_SIZE, offset: 0, search: searchInput.trim() })

  const submitCreateUser = async () => {
    if (!createForm.name.trim() || !createForm.email.trim() || !createForm.password) {
      toast.error('请填写名称、邮箱和初始密码')
      return
    }
    await createUser.mutateAsync(createForm)
    setCreateForm({ name: '', email: '', password: '', role: 'user' })
    toast.success('用户已创建')
  }

  const submitOrganization = async () => {
    if (!selectedUserId || !organizationForm.organizationId) return
    await setOrganizationMembership.mutateAsync({ userId: selectedUserId, ...organizationForm })
    toast.success('组织/项目角色已更新')
  }

  const submitWorkgroup = async () => {
    if (!selectedUserId || !workgroupForm.workgroupId) return
    await setWorkgroupMembership.mutateAsync({ userId: selectedUserId, ...workgroupForm })
    toast.success('工种/团队角色已更新')
  }

  return (
    <section className='flex flex-col gap-5 text-[var(--text-primary)]'>
      <div>
        <h2 className='font-semibold text-xl'>用户管理</h2>
        <p className='mt-1 text-[var(--text-secondary)] text-sm'>
          创建用户，管理超级管理员、组织项目角色和工种团队角色。
        </p>
      </div>

      <div className='rounded-md border border-[var(--border-primary)] bg-[var(--surface-primary)] p-4'>
        <div className='mb-3 flex items-center gap-2'>
          <UserPlus className='h-[16px] w-[16px] text-[var(--text-icon)]' />
          <h3 className='font-medium'>创建用户</h3>
        </div>
        <div className='grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_140px_90px]'>
          <Input
            value={createForm.name}
            onChange={(event) => setCreateForm((form) => ({ ...form, name: event.target.value }))}
            placeholder='名称'
          />
          <Input
            value={createForm.email}
            onChange={(event) => setCreateForm((form) => ({ ...form, email: event.target.value }))}
            placeholder='邮箱'
          />
          <Input
            type='password'
            value={createForm.password}
            onChange={(event) =>
              setCreateForm((form) => ({ ...form, password: event.target.value }))
            }
            placeholder='初始密码'
          />
          <select
            value={createForm.role}
            onChange={(event) =>
              setCreateForm((form) => ({
                ...form,
                role: event.target.value as 'user' | 'admin',
              }))
            }
            className='h-9 rounded-md border border-[var(--border-primary)] bg-transparent px-3 text-sm'
          >
            <option value='user'>普通用户</option>
            <option value='admin'>超级管理员</option>
          </select>
          <Button variant='primary' disabled={createUser.isPending} onClick={submitCreateUser}>
            创建
          </Button>
        </div>
      </div>

      <div className='grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]'>
        <div className='rounded-md border border-[var(--border-primary)] bg-[var(--surface-primary)] p-4'>
          <div className='mb-3 flex gap-2'>
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submitSearch()}
              placeholder='搜索邮箱、名称或用户 ID'
            />
            <Button variant='primary' onClick={submitSearch} disabled={usersQuery.isFetching}>
              <Search className='mr-2 h-4 w-4' />
              搜索
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户</TableHead>
                <TableHead>平台角色</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  selected={selectedUserId === user.id}
                  onSelect={() => setSelectedUserId(user.id)}
                />
              ))}
            </TableBody>
          </Table>
        </div>

        <div className='flex flex-col gap-4 rounded-md border border-[var(--border-primary)] bg-[var(--surface-primary)] p-4'>
          <div>
            <h3 className='font-medium'>用户详情</h3>
            <p className='mt-1 text-[var(--text-tertiary)] text-caption'>
              {selectedUser ? selectedUser.email : '请选择一个用户'}
            </p>
          </div>

          {selectedUser && (
            <>
              <div className='flex items-center justify-between gap-3'>
                <div>
                  <Label>超级管理员</Label>
                  <p className='text-[var(--text-tertiary)] text-caption'>
                    控制是否可以进入平台管理设置。
                  </p>
                </div>
                <Button
                  variant={selectedUser.role === 'admin' ? 'outline' : 'primary'}
                  disabled={updateUser.isPending}
                  onClick={() =>
                    updateUser.mutate({
                      userId: selectedUser.id,
                      role: selectedUser.role === 'admin' ? 'user' : 'admin',
                      reason: 'User management platform role update',
                    })
                  }
                >
                  {selectedUser.role === 'admin' ? '取消' : '设为'}
                </Button>
              </div>

              <div className='border-t border-[var(--border-secondary)] pt-4'>
                <h4 className='mb-2 font-medium'>组织/项目</h4>
                <div className='mb-3 flex flex-col gap-1'>
                  {(memberships?.organizationMemberships ?? []).map((item) => (
                    <div key={item.organizationId} className='flex items-center justify-between'>
                      <span className='text-sm'>{item.organizationName}</span>
                      {roleBadge(item.role)}
                    </div>
                  ))}
                  {(memberships?.organizationMemberships ?? []).length === 0 && (
                    <p className='text-[var(--text-tertiary)] text-caption'>暂无组织/项目归属</p>
                  )}
                </div>
                <div className='flex flex-col gap-2'>
                  <select
                    value={organizationForm.organizationId}
                    onChange={(event) =>
                      setOrganizationForm((form) => ({
                        ...form,
                        organizationId: event.target.value,
                      }))
                    }
                    className='h-9 rounded-md border border-[var(--border-primary)] bg-transparent px-3 text-sm'
                  >
                    <option value=''>选择组织/项目</option>
                    {(memberships?.organizations ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={organizationForm.role}
                    onChange={(event) =>
                      setOrganizationForm((form) => ({
                        ...form,
                        role: event.target.value as 'owner' | 'admin' | 'member',
                      }))
                    }
                    className='h-9 rounded-md border border-[var(--border-primary)] bg-transparent px-3 text-sm'
                  >
                    <option value='member'>成员</option>
                    <option value='admin'>项目管理员</option>
                    <option value='owner'>Owner</option>
                  </select>
                  <Textarea
                    value={organizationForm.reason}
                    onChange={(event) =>
                      setOrganizationForm((form) => ({ ...form, reason: event.target.value }))
                    }
                    placeholder='变更原因'
                  />
                  <Button
                    variant='primary'
                    disabled={!organizationForm.organizationId || setOrganizationMembership.isPending}
                    onClick={submitOrganization}
                  >
                    保存组织/项目角色
                  </Button>
                </div>
              </div>

              <div className='border-t border-[var(--border-secondary)] pt-4'>
                <h4 className='mb-2 font-medium'>工种/团队</h4>
                <div className='mb-3 flex flex-col gap-1'>
                  {(memberships?.workgroupMemberships ?? []).map((item) => (
                    <div key={item.workgroupId} className='flex items-center justify-between'>
                      <span className='text-sm'>{item.workgroupName}</span>
                      {roleBadge(item.role)}
                    </div>
                  ))}
                  {(memberships?.workgroupMemberships ?? []).length === 0 && (
                    <p className='text-[var(--text-tertiary)] text-caption'>暂无工种/团队归属</p>
                  )}
                </div>
                <div className='flex flex-col gap-2'>
                  <select
                    value={workgroupForm.workgroupId}
                    onChange={(event) =>
                      setWorkgroupForm((form) => ({ ...form, workgroupId: event.target.value }))
                    }
                    className='h-9 rounded-md border border-[var(--border-primary)] bg-transparent px-3 text-sm'
                  >
                    <option value=''>选择工种/团队</option>
                    {(memberships?.workgroups ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.organizationName} / {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={workgroupForm.role}
                    onChange={(event) =>
                      setWorkgroupForm((form) => ({
                        ...form,
                        role: event.target.value as 'admin' | 'member',
                      }))
                    }
                    className='h-9 rounded-md border border-[var(--border-primary)] bg-transparent px-3 text-sm'
                  >
                    <option value='member'>团队成员</option>
                    <option value='admin'>团队管理员</option>
                  </select>
                  <Textarea
                    value={workgroupForm.reason}
                    onChange={(event) =>
                      setWorkgroupForm((form) => ({ ...form, reason: event.target.value }))
                    }
                    placeholder='变更原因'
                  />
                  <Button
                    variant='primary'
                    disabled={!workgroupForm.workgroupId || setWorkgroupMembership.isPending}
                    onClick={submitWorkgroup}
                  >
                    保存工种/团队角色
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function UserRow({
  user,
  selected,
  onSelect,
}: {
  user: AdminConsoleUser
  selected: boolean
  onSelect: () => void
}) {
  return (
    <TableRow
      className={cn('cursor-pointer', selected && 'bg-[var(--surface-active)]')}
      onClick={onSelect}
    >
      <TableCell>
        <div className='min-w-0'>
          <p className='truncate font-medium'>{user.name || '-'}</p>
          <p className='truncate text-[var(--text-tertiary)] text-caption'>{user.email}</p>
        </div>
      </TableCell>
      <TableCell>{roleBadge(user.role)}</TableCell>
      <TableCell>
        <Badge variant={user.banned ? 'red' : 'green'}>{user.banned ? '已封禁' : '正常'}</Badge>
      </TableCell>
    </TableRow>
  )
}
