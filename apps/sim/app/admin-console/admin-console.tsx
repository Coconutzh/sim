'use client'

import { useState } from 'react'
import {
  Ban,
  CircleDollarSign,
  Database,
  KeyRound,
  Loader2,
  Search,
  Shield,
  UserCog,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  getManagedModelOptions,
  getPlatformProviderLabel,
  PLATFORM_FUNCTIONS,
  PLATFORM_PROVIDERS,
  type PlatformFunctionId,
  type PlatformProviderId,
} from '@/lib/platform-models/catalog'
import {
  type AdminConsoleModelService,
  type AdminConsoleProviderKey,
  type AdminConsoleUser,
  useAdminConsoleAuditEvents,
  useAdminConsoleModelServices,
  useAdminConsoleProviderKeys,
  useAdminConsoleUsage,
  useAdminConsoleUsers,
  useApplyAdminConsoleCredits,
  useCreateAdminConsoleProviderKey,
  useDeleteAdminConsoleModelService,
  useDeleteAdminConsoleProviderKey,
  useUpdateAdminConsoleModelService,
  useUpdateAdminConsoleProviderKey,
  useUpdateAdminConsoleUser,
  useUpsertAdminConsoleModelService,
} from '@/hooks/queries/admin-console'
import { useImpersonateUser } from '@/hooks/queries/admin-users'

const PAGE_SIZE = 25 as const

const NAV_ITEMS = [
  { id: 'users', label: '用户与权限', icon: UserCog },
  { id: 'credits', label: '额度与积分', icon: CircleDollarSign },
  { id: 'api-keys', label: 'API Key 管理', icon: KeyRound },
  { id: 'usage', label: '使用记录', icon: Database },
] as const

const PROVIDERS = [
  'all',
  'openai',
  'anthropic',
  'google',
  'gemini',
  'mistral',
  'fireworks',
  'zhipu',
  'cerebras',
  'cohere',
  'deepseek',
  'ark',
  'evolink',
  'dashscope',
  'azure-openai',
  'azure-anthropic',
] as const

const USAGE_SOURCES = [
  'all',
  'workflow',
  'wand',
  'copilot',
  'workspace-chat',
  'mcp_copilot',
  'mothership_block',
  'knowledge-base',
  'voice-input',
] as const

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`
}

function statusBadge(user: AdminConsoleUser) {
  if (user.banned) return <Badge variant='red'>已封禁</Badge>
  if (user.billingBlocked) return <Badge variant='amber'>计费受限</Badge>
  return <Badge variant='green'>正常</Badge>
}

interface AdminConsoleProps {
  section: string
  embedded?: boolean
}

export function AdminConsole({ section, embedded = false }: AdminConsoleProps) {
  if (embedded) {
    return (
      <div className='text-[var(--text-primary)]'>
        {section === 'users' && <UsersPanel />}
        {section === 'credits' && <CreditsPanel />}
        {section === 'api-keys' && <ApiKeysPanel />}
        {section === 'usage' && <UsagePanel />}
      </div>
    )
  }

  return (
    <div className='min-h-screen bg-[var(--bg)] text-[var(--text-primary)]'>
      <div className='flex gap-6 px-8 py-8'>
        <aside className='w-[220px] shrink-0'>
          <div className='mb-5'>
            <p className='text-[var(--text-tertiary)] text-caption'>平台管理</p>
            <h1 className='font-semibold text-2xl'>管理员控制台</h1>
          </div>
          <nav className='flex flex-col gap-1'>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const active = section === item.id
              return (
                <Link
                  key={item.id}
                  href={`/admin-console/${item.id}`}
                  className={cn(
                    'flex h-9 items-center gap-2 rounded-md px-3 text-sm',
                    active
                      ? 'border border-[var(--border-primary)] bg-[var(--surface-active)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]'
                  )}
                >
                  <Icon className='h-4 w-4' />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </aside>
        <main className='min-w-0 flex-1'>
          {section === 'users' && <UsersPanel />}
          {section === 'credits' && <CreditsPanel />}
          {section === 'api-keys' && <ApiKeysPanel />}
          {section === 'usage' && <UsagePanel />}
        </main>
      </div>
    </div>
  )
}

function UsersPanel() {
  const router = useRouter()
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState({ limit: PAGE_SIZE, offset: 0, search: '' })
  const usersQuery = useAdminConsoleUsers(query)
  const updateUser = useUpdateAdminConsoleUser()
  const impersonateUser = useImpersonateUser()

  const submitSearch = () => setQuery({ limit: PAGE_SIZE, offset: 0, search: searchInput.trim() })

  const users = usersQuery.data?.users ?? []
  const total = usersQuery.data?.pagination.total ?? 0

  return (
    <section className='flex flex-col gap-5'>
      <PanelHeader
        icon={<UserCog className='h-5 w-5' />}
        title='用户与权限'
        description='搜索用户、调整平台角色、封禁账号、查看额度和积分余额。'
      />
      <div className='flex gap-2'>
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && submitSearch()}
          placeholder='搜索邮箱、名称或用户 ID'
          className='max-w-[420px]'
        />
        <Button variant='primary' onClick={submitSearch} disabled={usersQuery.isFetching}>
          <Search className='mr-2 h-4 w-4' />
          搜索
        </Button>
      </div>
      <DataPanel className='overflow-x-auto rounded-none border-x-0 p-0'>
        <Table className='min-w-[1120px] table-fixed'>
          <TableHeader>
            <TableRow>
              <TableHead className='w-[260px] whitespace-nowrap pl-4'>用户</TableHead>
              <TableHead className='w-[100px] whitespace-nowrap'>角色</TableHead>
              <TableHead className='w-[110px] whitespace-nowrap'>状态</TableHead>
              <TableHead className='w-[130px] whitespace-nowrap'>额度</TableHead>
              <TableHead className='w-[120px] whitespace-nowrap'>已用</TableHead>
              <TableHead className='w-[130px] whitespace-nowrap'>剩余</TableHead>
              <TableHead className='w-[120px] whitespace-nowrap'>积分</TableHead>
              <TableHead className='w-[250px] whitespace-nowrap pr-4 text-right'>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className='pl-4'>
                  <div className='min-w-0'>
                    <p className='truncate font-medium'>{user.name || '-'}</p>
                    <p className='truncate text-[var(--text-tertiary)] text-caption'>
                      {user.email}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={user.role === 'admin' ? 'blue' : 'gray'}>{user.role}</Badge>
                </TableCell>
                <TableCell>{statusBadge(user)}</TableCell>
                <TableCell className='whitespace-nowrap'>
                  {formatMoney(user.currentUsageLimit)}
                </TableCell>
                <TableCell className='whitespace-nowrap'>
                  {formatMoney(user.currentPeriodCost)}
                </TableCell>
                <TableCell className='whitespace-nowrap'>
                  {formatMoney(user.remainingUsage)}
                </TableCell>
                <TableCell className='whitespace-nowrap'>
                  {formatMoney(user.creditBalance)}
                </TableCell>
                <TableCell className='pr-4'>
                  <div className='flex flex-nowrap justify-end gap-1.5 whitespace-nowrap'>
                    <Button
                      variant='active'
                      className='h-7 min-w-[52px] whitespace-nowrap px-2 text-caption'
                      disabled={updateUser.isPending}
                      onClick={() =>
                        updateUser.mutate({
                          userId: user.id,
                          role: user.role === 'admin' ? 'user' : 'admin',
                          reason: 'Admin console role update',
                        })
                      }
                    >
                      {user.role === 'admin' ? '降级' : '设为管理员'}
                    </Button>
                    <Button
                      variant='active'
                      className='h-7 min-w-[44px] whitespace-nowrap px-2 text-caption'
                      disabled={updateUser.isPending}
                      onClick={() =>
                        updateUser.mutate({
                          userId: user.id,
                          banned: !user.banned,
                          reason: 'Admin console ban update',
                        })
                      }
                    >
                      {user.banned ? '解封' : '封禁'}
                    </Button>
                    <Button
                      variant='active'
                      className='h-7 min-w-[72px] whitespace-nowrap px-2 text-caption'
                      disabled={impersonateUser.isPending}
                      onClick={() =>
                        impersonateUser.mutate(
                          { userId: user.id },
                          { onSuccess: () => router.push('/workspace') }
                        )
                      }
                    >
                      模拟登录
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!usersQuery.isLoading && users.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className='py-8 text-center text-[var(--text-tertiary)]'>
                  没有找到用户
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {usersQuery.isLoading && <LoadingOverlay />}
      </DataPanel>
      <Pagination
        total={total}
        offset={query.offset}
        limit={PAGE_SIZE}
        onChange={(offset) => setQuery((current) => ({ ...current, offset }))}
      />
    </section>
  )
}

function CreditsPanel() {
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState({ limit: PAGE_SIZE, offset: 0, search: '' })
  const [selectedUserId, setSelectedUserId] = useState('')
  const [limit, setLimit] = useState('')
  const [creditAmount, setCreditAmount] = useState('')
  const [reason, setReason] = useState('')
  const [operation, setOperation] = useState<'add' | 'remove'>('add')
  const usersQuery = useAdminConsoleUsers(query)
  const updateUser = useUpdateAdminConsoleUser()
  const applyCredits = useApplyAdminConsoleCredits()
  const auditQuery = useAdminConsoleAuditEvents({ limit: 20, offset: 0 })

  const selectedUser = usersQuery.data?.users.find((user) => user.id === selectedUserId)

  const submitCredit = async () => {
    if (!selectedUserId) return
    const amount = Number.parseFloat(creditAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('请输入有效积分金额')
      return
    }
    await applyCredits.mutateAsync({ userId: selectedUserId, amount, operation, reason })
    setCreditAmount('')
    toast.success('积分已更新')
  }

  const submitLimit = async () => {
    if (!selectedUserId) return
    const currentUsageLimit = Number.parseFloat(limit)
    if (!Number.isFinite(currentUsageLimit) || currentUsageLimit < 0) {
      toast.error('请输入有效额度')
      return
    }
    await updateUser.mutateAsync({ userId: selectedUserId, currentUsageLimit, reason })
    toast.success('额度已更新')
  }

  const toggleBillingBlocked = async () => {
    if (!selectedUser) return
    await updateUser.mutateAsync({
      userId: selectedUser.id,
      billingBlocked: !selectedUser.billingBlocked,
      reason,
    })
    toast.success('Billing status updated')
  }

  return (
    <section className='flex flex-col gap-5'>
      <PanelHeader
        icon={<CircleDollarSign className='h-5 w-5' />}
        title='额度与积分'
        description='给用户分配额度、发放或扣减积分，并查看后台变更记录。'
      />
      <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]'>
        <DataPanel>
          <div className='mb-3 flex gap-2'>
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder='搜索需要调整的用户'
            />
            <Button
              variant='primary'
              onClick={() => setQuery({ limit: PAGE_SIZE, offset: 0, search: searchInput.trim() })}
            >
              搜索
            </Button>
          </div>
          <div className='flex flex-col divide-y divide-[var(--border-secondary)]'>
            {(usersQuery.data?.users ?? []).map((user) => (
              <button
                key={user.id}
                type='button'
                className={cn(
                  'flex items-center justify-between px-2 py-3 text-left',
                  selectedUserId === user.id && 'bg-[var(--surface-active)]'
                )}
                onClick={() => {
                  setSelectedUserId(user.id)
                  setLimit(user.currentUsageLimit.toString())
                }}
              >
                <span>
                  <span className='block font-medium text-sm'>{user.name || user.email}</span>
                  <span className='block text-[var(--text-tertiary)] text-caption'>
                    {user.email}
                  </span>
                </span>
                <span className='text-right text-caption'>
                  <span className='block'>额度 {formatMoney(user.currentUsageLimit)}</span>
                  <span className='block'>积分 {formatMoney(user.creditBalance)}</span>
                </span>
              </button>
            ))}
          </div>
        </DataPanel>
        <DataPanel className='flex flex-col gap-4'>
          <div>
            <h2 className='font-medium'>调整对象</h2>
            <p className='mt-1 text-[var(--text-tertiary)] text-caption'>
              {selectedUser ? selectedUser.email : '请选择一个用户'}
            </p>
          </div>
          {selectedUser && (
            <div className='flex flex-wrap gap-2'>
              {statusBadge(selectedUser)}
              <Badge variant='gray'>Remaining {formatMoney(selectedUser.remainingUsage)}</Badge>
            </div>
          )}
          <div className='flex flex-col gap-2'>
            <Label>使用额度</Label>
            <Input value={limit} onChange={(event) => setLimit(event.target.value)} />
            <Button
              variant='primary'
              disabled={!selectedUserId || updateUser.isPending}
              onClick={submitLimit}
            >
              保存额度
            </Button>
            <Button
              variant={selectedUser?.billingBlocked ? 'outline' : 'destructive'}
              disabled={!selectedUserId || updateUser.isPending}
              onClick={toggleBillingBlocked}
            >
              {selectedUser?.billingBlocked ? 'Unblock billing' : 'Mark billing blocked'}
            </Button>
          </div>
          <div className='flex flex-col gap-2'>
            <Label>积分金额</Label>
            <Input value={creditAmount} onChange={(event) => setCreditAmount(event.target.value)} />
            <div className='flex gap-2'>
              <Button
                variant={operation === 'add' ? 'primary' : 'outline'}
                onClick={() => setOperation('add')}
              >
                发放
              </Button>
              <Button
                variant={operation === 'remove' ? 'primary' : 'outline'}
                onClick={() => setOperation('remove')}
              >
                扣减
              </Button>
            </div>
            <Button
              variant='primary'
              disabled={!selectedUserId || applyCredits.isPending}
              onClick={submitCredit}
            >
              提交积分变更
            </Button>
          </div>
          <div className='flex flex-col gap-2'>
            <Label>变更原因</Label>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
        </DataPanel>
      </div>
      <AuditList events={auditQuery.data?.events ?? []} />
    </section>
  )
}

function ApiKeysPanel() {
  const keysQuery = useAdminConsoleProviderKeys()
  const createKey = useCreateAdminConsoleProviderKey()
  const updateKey = useUpdateAdminConsoleProviderKey()
  const deleteKey = useDeleteAdminConsoleProviderKey()
  const [providerId, setProviderId] = useState<PlatformProviderId>('openai')
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')

  const submit = async () => {
    await createKey.mutateAsync({
      providerId,
      label,
      apiKey,
      isDefault: true,
      priority: 100,
    })
    setLabel('')
    setApiKey('')
    toast.success('API Key 已保存')
  }

  return (
    <section className='flex flex-col gap-5'>
      <PanelHeader
        icon={<KeyRound className='h-5 w-5' />}
        title='API Key 管理'
        description='管理平台默认 provider key。前端只显示 masked key，不能读取明文。'
      />
      <DataPanel className='grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_120px]'>
        <div className='flex flex-col gap-2'>
          <Label>Provider</Label>
          <select
            value={providerId}
            onChange={(event) => setProviderId(event.target.value as PlatformProviderId)}
            className='h-9 rounded-md border border-[var(--border-primary)] bg-transparent px-3 text-sm'
          >
            {PLATFORM_PROVIDERS.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
        </div>
        <div className='flex flex-col gap-2'>
          <Label>标签</Label>
          <Input value={label} onChange={(event) => setLabel(event.target.value)} />
        </div>
        <div className='flex flex-col gap-2'>
          <Label>新 Key</Label>
          <Input
            type='password'
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </div>
        <div className='flex items-end'>
          <Button
            variant='primary'
            className='w-full'
            disabled={!label || !apiKey || createKey.isPending}
            onClick={submit}
          >
            新增
          </Button>
        </div>
      </DataPanel>
      <DataPanel className='grid gap-3'>
        <div className='text-sm text-[var(--text-secondary)]'>
          服务商列表始终展示。未配置时先添加 Key；Key 只会以脱敏形式显示。
        </div>
        {(keysQuery.data?.providers ?? []).map((provider) => (
          <div
            key={provider.providerId}
            className='rounded-lg border border-[var(--border-primary)] p-3'
          >
            <div className='flex items-center justify-between gap-3'>
              <div>
                <div className='font-medium'>{provider.label}</div>
                <div className='text-xs text-[var(--text-secondary)]'>
                  {provider.capabilities.join('、')} ·{' '}
                  {provider.keys.length ? `已配置 ${provider.keys.length} 个 Key` : '未配置'}
                </div>
              </div>
              <Badge
                variant={provider.keys.some((key) => key.status === 'active') ? 'green' : 'gray'}
              >
                {provider.keys.some((key) => key.status === 'active') ? '已配置' : '未配置'}
              </Badge>
            </div>
            {provider.keys.map((key) => (
              <ProviderKeyRow
                key={key.id}
                item={key}
                updateKey={updateKey.mutate}
                deleteKey={deleteKey.mutate}
              />
            ))}
          </div>
        ))}
      </DataPanel>
      <ModelServicesPanel />
    </section>
  )
}

function ModelServicesPanel() {
  const servicesQuery = useAdminConsoleModelServices()
  const upsertService = useUpsertAdminConsoleModelService()
  const deleteService = useDeleteAdminConsoleModelService()
  const updateService = useUpdateAdminConsoleModelService()
  const keysQuery = useAdminConsoleProviderKeys()
  const [providersToAdd, setProvidersToAdd] = useState<Record<string, string>>({})
  const [selectedModels, setSelectedModels] = useState<Record<string, string[]>>({})

  const activeProviderIds = new Set(
    (keysQuery.data?.providers ?? [])
      .filter((provider) => provider.keys.some((key) => key.status === 'active'))
      .map((provider) => provider.providerId)
  )

  const saveProvider = async (
    functionId: PlatformFunctionId,
    providerId: string,
    fallbackModels: string[]
  ) => {
    const definition = PLATFORM_FUNCTIONS.find((item) => item.id === functionId)
    const selectionKey = `${functionId}/${providerId}`
    const enabledModelIds = selectedModels[selectionKey] ?? fallbackModels
    const first = getManagedModelOptions(functionId).find(
      (model) => model.id === enabledModelIds[0] && model.providerId === providerId
    )
    if (!definition || !first || !providerId) return toast.error('请选择服务商和模型')
    await upsertService.mutateAsync({
      functionId,
      consumer: definition.consumer,
      capability: definition.capability,
      family: first.family,
      providerId: providerId as never,
      serviceKind: first.serviceKind,
      baseUrl: first.baseUrl,
      enabledModelIds,
      defaultModelId: enabledModelIds[0] ?? null,
      status: 'active',
    })
    setSelectedModels((current) => {
      const next = { ...current }
      delete next[selectionKey]
      return next
    })
    toast.success('功能模型配置已保存')
  }

  return (
    <div className='flex flex-col gap-3'>
      <PanelHeader
        icon={<Database className='h-5 w-5' />}
        title='模型服务配置'
        description='画布优先读取 sim-canvas；Hermes PPT 读取 hermes-ppt。已启用模型必须与 Provider Key 对应。'
      />
      <div className='grid gap-3'>
        {PLATFORM_FUNCTIONS.map((definition) => {
          const savedServices = (servicesQuery.data?.services ?? [])
            .filter(
              (service) =>
                service.consumer === definition.consumer &&
                service.capability === definition.capability
            )
            .sort((left, right) =>
              getPlatformProviderLabel(left.providerId).localeCompare(
                getPlatformProviderLabel(right.providerId),
                'zh-CN'
              )
            )
          const configuredProviderIds = new Set(savedServices.map((service) => service.providerId))
          const availableProviderIds = Array.from(
            new Set(getManagedModelOptions(definition.id).map((model) => model.providerId))
          ).filter(
            (providerId) =>
              activeProviderIds.has(providerId) && !configuredProviderIds.has(providerId)
          )
          const providerToAdd = providersToAdd[definition.id] ?? ''

          return (
            <DataPanel key={definition.id} className='flex flex-col gap-3'>
              <div>
                <div className='font-medium'>{definition.label}</div>
                <div className='text-xs text-[var(--text-secondary)]'>
                  {definition.multipleModels
                    ? '可同时启用多个服务商的已适配模型。'
                    : '每个服务商仅能选择一个已适配模型。'}
                </div>
              </div>
              {savedServices.map((service) => {
                const selectionKey = `${definition.id}/${service.providerId}`
                const models = selectedModels[selectionKey] ?? service.enabledModelIds
                const options = getManagedModelOptions(definition.id)
                  .filter((model) => model.providerId === service.providerId)
                  .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
                return (
                  <div
                    key={service.id}
                    className='grid gap-3 rounded border border-[var(--border-secondary)] p-3 md:grid-cols-[220px_minmax(0,1fr)_auto]'
                  >
                    <div>
                      <div className='font-medium'>
                        {getPlatformProviderLabel(service.providerId)}
                      </div>
                      <Badge variant={service.status === 'active' ? 'green' : 'gray'}>
                        {service.status}
                      </Badge>
                    </div>
                    <div className='flex flex-wrap gap-2'>
                      {options.map((model) => (
                        <Button
                          key={model.id}
                          variant={models.includes(model.id) ? 'primary' : 'outline'}
                          onClick={() =>
                            setSelectedModels((current) => ({
                              ...current,
                              [selectionKey]: definition.multipleModels
                                ? models.includes(model.id)
                                  ? models.filter((id) => id !== model.id)
                                  : [...models, model.id]
                                : [model.id],
                            }))
                          }
                        >
                          {model.label}
                        </Button>
                      ))}
                    </div>
                    <div className='flex flex-wrap items-start gap-2'>
                      <Button
                        variant='primary'
                        disabled={upsertService.isPending || models.length === 0}
                        onClick={() => saveProvider(definition.id, service.providerId, models)}
                      >
                        保存
                      </Button>
                      <Button
                        variant='active'
                        onClick={() =>
                          updateService.mutate({
                            serviceId: service.id,
                            body: { status: service.status === 'active' ? 'disabled' : 'active' },
                          })
                        }
                      >
                        {service.status === 'active' ? '停用' : '启用'}
                      </Button>
                      <Button
                        variant='destructive'
                        onClick={() => deleteService.mutate(service.id)}
                      >
                        移除
                      </Button>
                    </div>
                  </div>
                )
              })}
              {availableProviderIds.length > 0 && (
                <div className='flex flex-wrap items-end gap-2 rounded border border-dashed border-[var(--border-secondary)] p-3'>
                  <SelectField
                    label='添加服务商'
                    value={providerToAdd}
                    onChange={(value) =>
                      setProvidersToAdd((current) => ({ ...current, [definition.id]: value }))
                    }
                    options={['', ...availableProviderIds]}
                  />
                  <Button
                    variant='primary'
                    disabled={!providerToAdd}
                    onClick={() =>
                      setProvidersToAdd((current) => ({
                        ...current,
                        [definition.id]: providerToAdd,
                      }))
                    }
                  >
                    添加
                  </Button>
                  <p className='text-xs text-[var(--text-secondary)]'>添加后选择模型并保存。</p>
                </div>
              )}
              {savedServices.length === 0 && availableProviderIds.length === 0 && (
                <p className='text-amber-600 text-xs'>
                  没有可添加的服务商，请先配置并启用对应 API Key。
                </p>
              )}
              {providerToAdd &&
                (() => {
                  const selectionKey = `${definition.id}/${providerToAdd}`
                  const models = selectedModels[selectionKey] ?? []
                  const options = getManagedModelOptions(definition.id)
                    .filter((model) => model.providerId === providerToAdd)
                    .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
                  return (
                    <div className='grid gap-3 rounded border border-[var(--border-primary)] p-3 md:grid-cols-[220px_minmax(0,1fr)_auto]'>
                      <div className='font-medium'>{getPlatformProviderLabel(providerToAdd)}</div>
                      <div className='flex flex-wrap gap-2'>
                        {options.map((model) => (
                          <Button
                            key={model.id}
                            variant={models.includes(model.id) ? 'primary' : 'outline'}
                            onClick={() =>
                              setSelectedModels((current) => ({
                                ...current,
                                [selectionKey]: definition.multipleModels
                                  ? models.includes(model.id)
                                    ? models.filter((id) => id !== model.id)
                                    : [...models, model.id]
                                  : [model.id],
                              }))
                            }
                          >
                            {model.label}
                          </Button>
                        ))}
                      </div>
                      <Button
                        variant='primary'
                        disabled={upsertService.isPending || models.length === 0}
                        onClick={() => saveProvider(definition.id, providerToAdd, models)}
                      >
                        保存服务商
                      </Button>
                    </div>
                  )
                })()}
            </DataPanel>
          )
        })}
      </div>
      <DataPanel className='overflow-x-auto rounded-none border-x-0 p-0'>
        <Table className='min-w-[900px]'>
          <TableHeader>
            <TableRow>
              <TableHead>使用方</TableHead>
              <TableHead>能力 / 模型族</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>服务</TableHead>
              <TableHead>模型</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className='text-right'>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(servicesQuery.data?.services ?? []).map((service) => (
              <ModelServiceRow
                key={service.id}
                service={service}
                onDelete={(item) => deleteService.mutate(item.id)}
                onToggle={(item) =>
                  updateService.mutate({
                    serviceId: item.id,
                    body: { status: item.status === 'active' ? 'disabled' : 'active' },
                  })
                }
              />
            ))}
          </TableBody>
        </Table>
        {servicesQuery.isLoading && <LoadingOverlay />}
      </DataPanel>
    </div>
  )
}

function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  options: readonly T[]
}) {
  return (
    <div className='flex flex-col gap-2'>
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className='h-9 rounded-md border border-[var(--border-primary)] bg-transparent px-3 text-sm'
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  )
}

function ModelServiceRow({
  service,
  onDelete,
  onToggle,
}: {
  service: AdminConsoleModelService
  onDelete: (service: AdminConsoleModelService) => void
  onToggle: (service: AdminConsoleModelService) => void
}) {
  return (
    <TableRow>
      <TableCell>{service.consumer}</TableCell>
      <TableCell>
        {service.capability} / {service.family}
      </TableCell>
      <TableCell>{service.providerId}</TableCell>
      <TableCell>{service.serviceKind}</TableCell>
      <TableCell>{service.enabledModelIds.join(', ')}</TableCell>
      <TableCell>
        <Badge variant={service.status === 'active' ? 'green' : 'gray'}>{service.status}</Badge>
      </TableCell>
      <TableCell>
        <div className='flex justify-end gap-1.5'>
          <Button
            variant='active'
            className='h-7 px-2 text-caption'
            onClick={() => onToggle(service)}
          >
            {service.status === 'active' ? '停用' : '启用'}
          </Button>
          <Button
            variant='destructive'
            className='h-7 px-2 text-caption'
            onClick={() => onDelete(service)}
          >
            删除
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

function ProviderKeyRow({
  item,
  updateKey,
  deleteKey,
}: {
  item: AdminConsoleProviderKey
  updateKey: ReturnType<typeof useUpdateAdminConsoleProviderKey>['mutate']
  deleteKey: ReturnType<typeof useDeleteAdminConsoleProviderKey>['mutate']
}) {
  const [replacement, setReplacement] = useState('')

  return (
    <div className='mt-3 flex flex-wrap items-center gap-2 rounded border border-[var(--border-secondary)] p-2 text-xs'>
      <span className='font-medium'>{item.label}</span>
      <span className='font-mono'>{item.maskedKey}</span>
      <span>
        <Badge variant={item.status === 'active' ? 'green' : 'gray'}>{item.status}</Badge>
      </span>
      {item.isDefault && <Badge variant='blue'>主 Key</Badge>}
      <span className='text-[var(--text-secondary)]'>
        最近使用：{item.lastUsedAt ? new Date(item.lastUsedAt).toLocaleString() : '—'}
      </span>
      <div className='ml-auto flex flex-wrap items-center gap-1.5'>
        <Input
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
          placeholder='替换 key'
          type='password'
          className='h-7 w-[160px] shrink-0'
        />
        <Button
          variant='active'
          className='h-7 whitespace-nowrap px-2 text-caption'
          disabled={!replacement}
          onClick={() => {
            updateKey({ keyId: item.id, apiKey: replacement, reason: 'Key replacement' })
            setReplacement('')
          }}
        >
          替换
        </Button>
        <Button
          variant='active'
          className='h-7 whitespace-nowrap px-2 text-caption'
          onClick={() => updateKey({ keyId: item.id, isDefault: true })}
        >
          默认
        </Button>
        <Button
          variant='active'
          className='h-7 whitespace-nowrap px-2 text-caption'
          onClick={() =>
            updateKey({
              keyId: item.id,
              status: item.status === 'active' ? 'disabled' : 'active',
            })
          }
        >
          {item.status === 'active' ? '停用' : '启用'}
        </Button>
        <Button
          variant='destructive'
          className='h-7 whitespace-nowrap px-2 text-caption'
          onClick={() => deleteKey(item.id)}
        >
          删除
        </Button>
      </div>
    </div>
  )
}

function UsagePanel() {
  const [filterInput, setFilterInput] = useState({
    userId: '',
    providerId: 'all',
    source: 'all',
    workspaceId: '',
    startDate: '',
    endDate: '',
  })
  const [filters, setFilters] = useState({ limit: PAGE_SIZE, offset: 0 })
  const usageQuery = useAdminConsoleUsage(filters)
  const summary = usageQuery.data?.summary

  const applyFilters = () => {
    setFilters({
      limit: PAGE_SIZE,
      offset: 0,
      ...(filterInput.userId.trim() ? { userId: filterInput.userId.trim() } : {}),
      ...(filterInput.providerId !== 'all' ? { providerId: filterInput.providerId } : {}),
      ...(filterInput.source !== 'all' ? { source: filterInput.source } : {}),
      ...(filterInput.workspaceId.trim() ? { workspaceId: filterInput.workspaceId.trim() } : {}),
      ...(filterInput.startDate
        ? { startDate: new Date(filterInput.startDate).toISOString() }
        : {}),
      ...(filterInput.endDate ? { endDate: new Date(filterInput.endDate).toISOString() } : {}),
    })
  }

  return (
    <section className='flex flex-col gap-5'>
      <PanelHeader
        icon={<Database className='h-5 w-5' />}
        title='使用记录'
        description='按用户、provider、source、workspace 和时间范围查询使用明细。'
      />
      <div className='grid gap-3 md:grid-cols-4'>
        <Metric label='总消耗' value={formatMoney(summary?.totalCost ?? 0)} />
        <Metric label='调用次数' value={(summary?.totalCount ?? 0).toString()} />
        <Metric label='Source 数' value={(summary?.bySource.length ?? 0).toString()} />
        <Metric label='Provider 数' value={(summary?.byProvider.length ?? 0).toString()} />
      </div>
      <DataPanel className='grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_180px_minmax(0,1fr)_180px_180px_92px]'>
        <div className='flex flex-col gap-2'>
          <Label>用户 ID</Label>
          <Input
            value={filterInput.userId}
            onChange={(event) =>
              setFilterInput((current) => ({ ...current, userId: event.target.value }))
            }
            placeholder='user id'
          />
        </div>
        <div className='flex flex-col gap-2'>
          <Label>Provider</Label>
          <select
            value={filterInput.providerId}
            onChange={(event) =>
              setFilterInput((current) => ({ ...current, providerId: event.target.value }))
            }
            className='h-9 rounded-md border border-[var(--border-primary)] bg-transparent px-3 text-sm'
          >
            {PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        </div>
        <div className='flex flex-col gap-2'>
          <Label>Source</Label>
          <select
            value={filterInput.source}
            onChange={(event) =>
              setFilterInput((current) => ({ ...current, source: event.target.value }))
            }
            className='h-9 rounded-md border border-[var(--border-primary)] bg-transparent px-3 text-sm'
          >
            {USAGE_SOURCES.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </div>
        <div className='flex flex-col gap-2'>
          <Label>Workspace ID</Label>
          <Input
            value={filterInput.workspaceId}
            onChange={(event) =>
              setFilterInput((current) => ({ ...current, workspaceId: event.target.value }))
            }
            placeholder='workspace id'
          />
        </div>
        <div className='flex flex-col gap-2'>
          <Label>开始时间</Label>
          <Input
            type='datetime-local'
            value={filterInput.startDate}
            onChange={(event) =>
              setFilterInput((current) => ({ ...current, startDate: event.target.value }))
            }
          />
        </div>
        <div className='flex flex-col gap-2'>
          <Label>结束时间</Label>
          <Input
            type='datetime-local'
            value={filterInput.endDate}
            onChange={(event) =>
              setFilterInput((current) => ({ ...current, endDate: event.target.value }))
            }
          />
        </div>
        <div className='flex items-end'>
          <Button
            variant='primary'
            className='w-full'
            disabled={usageQuery.isFetching}
            onClick={applyFilters}
          >
            筛选
          </Button>
        </div>
      </DataPanel>
      <DataPanel className='overflow-x-auto rounded-none border-x-0 p-0'>
        <Table className='min-w-[1100px] table-fixed'>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>用户</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>描述</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead className='text-right'>成本</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(usageQuery.data?.logs ?? []).map((log) => (
              <TableRow key={log.id}>
                <TableCell>{new Date(log.createdAt).toLocaleString()}</TableCell>
                <TableCell>{log.userEmail ?? log.userId}</TableCell>
                <TableCell>{log.source}</TableCell>
                <TableCell>{log.description}</TableCell>
                <TableCell>{log.workspaceId ?? '-'}</TableCell>
                <TableCell className='text-right'>{formatMoney(log.cost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {usageQuery.isLoading && <LoadingOverlay />}
      </DataPanel>
      <Pagination
        total={usageQuery.data?.pagination.total ?? 0}
        offset={filters.offset}
        limit={PAGE_SIZE}
        onChange={(offset) => setFilters((current) => ({ ...current, offset }))}
      />
    </section>
  )
}
function PanelHeader({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className='flex items-start justify-between gap-4'>
      <div className='flex items-start gap-3'>
        <div className='flex h-9 w-9 items-center justify-center text-[var(--text-icon)]'>
          {icon}
        </div>
        <div>
          <h2 className='font-semibold text-xl'>{title}</h2>
          <p className='mt-1 text-[var(--text-secondary)] text-sm'>{description}</p>
        </div>
      </div>
      <Badge variant='gray'>
        <Shield className='mr-1 h-3 w-3' />
        超级管理员
      </Badge>
    </div>
  )
}

function DataPanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'relative rounded-[6px] border border-[var(--border-secondary)] bg-[var(--surface-primary)] p-4',
        className
      )}
    >
      {children}
    </div>
  )
}

function LoadingOverlay() {
  return (
    <div className='absolute inset-0 flex items-center justify-center bg-[var(--surface-primary)]/70'>
      <Loader2 className='h-5 w-5 animate-spin' />
    </div>
  )
}

function Pagination({
  total,
  offset,
  limit,
  onChange,
}: {
  total: number
  offset: number
  limit: number
  onChange: (offset: number) => void
}) {
  return (
    <div className='flex items-center justify-between text-[var(--text-secondary)] text-sm'>
      <span>
        {total} 条记录，第 {Math.floor(offset / limit) + 1} 页
      </span>
      <div className='flex gap-2'>
        <Button variant='active' disabled={offset === 0} onClick={() => onChange(offset - limit)}>
          上一页
        </Button>
        <Button
          variant='active'
          disabled={offset + limit >= total}
          onClick={() => onChange(offset + limit)}
        >
          下一页
        </Button>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-[6px] border border-[var(--border-secondary)] bg-[var(--surface-primary)] p-4'>
      <p className='text-[var(--text-tertiary)] text-caption'>{label}</p>
      <p className='mt-2 font-semibold text-2xl'>{value}</p>
    </div>
  )
}

function AuditList({
  events,
}: {
  events: Array<{
    id: string
    action: string
    reason: string | null
    actorEmail: string | null
    targetType: string
    targetId: string | null
    createdAt: string
  }>
}) {
  return (
    <DataPanel>
      <div className='mb-3 flex items-center gap-2'>
        <Ban className='h-4 w-4' />
        <h2 className='font-medium'>最近变更</h2>
      </div>
      <div className='flex flex-col divide-y divide-[var(--border-secondary)]'>
        {events.map((event) => (
          <div key={event.id} className='flex items-center justify-between gap-3 py-2 text-sm'>
            <div className='min-w-0'>
              <p className='truncate'>{event.action}</p>
              <p className='truncate text-[var(--text-tertiary)] text-caption'>
                {event.actorEmail ?? 'unknown'} · {event.targetType}:{event.targetId ?? '-'}
              </p>
            </div>
            <div className='text-right text-[var(--text-tertiary)] text-caption'>
              <p>{new Date(event.createdAt).toLocaleString()}</p>
              <p>{event.reason ?? '-'}</p>
            </div>
          </div>
        ))}
        {events.length === 0 && (
          <div className='py-6 text-center text-[var(--text-tertiary)] text-sm'>暂无变更记录</div>
        )}
      </div>
    </DataPanel>
  )
}
