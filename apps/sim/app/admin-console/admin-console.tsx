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
  const [providerId, setProviderId] = useState<Exclude<(typeof PROVIDERS)[number], 'all'>>('openai')
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
            onChange={(event) =>
              setProviderId(event.target.value as Exclude<(typeof PROVIDERS)[number], 'all'>)
            }
            className='h-9 rounded-md border border-[var(--border-primary)] bg-transparent px-3 text-sm'
          >
            {PROVIDERS.filter((provider) => provider !== 'all').map((provider) => (
              <option key={provider} value={provider}>
                {provider}
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
      <DataPanel className='overflow-x-auto rounded-none border-x-0 p-0'>
        <Table className='min-w-[980px] table-fixed'>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>标签</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>默认</TableHead>
              <TableHead>最后使用</TableHead>
              <TableHead className='w-[320px] whitespace-nowrap pr-4 text-right'>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(keysQuery.data?.keys ?? []).map((key) => (
              <ProviderKeyRow key={key.id} item={key} updateKey={updateKey.mutate} />
            ))}
          </TableBody>
        </Table>
        {keysQuery.isLoading && <LoadingOverlay />}
      </DataPanel>
      <ModelServicesPanel />
    </section>
  )
}

function ModelServicesPanel() {
  const servicesQuery = useAdminConsoleModelServices()
  const upsertService = useUpsertAdminConsoleModelService()
  const [consumer, setConsumer] = useState<'sim-canvas' | 'hermes-agent' | 'hermes-ppt'>(
    'sim-canvas'
  )
  const [capability, setCapability] = useState('image')
  const [family, setFamily] = useState('image')
  const [providerId, setProviderId] = useState<Exclude<(typeof PROVIDERS)[number], 'all'>>('openai')
  const [serviceKind, setServiceKind] = useState('openai-compatible')
  const [baseUrl, setBaseUrl] = useState('')
  const [modelIds, setModelIds] = useState('')
  const [defaultModelId, setDefaultModelId] = useState('')

  const submit = async () => {
    const enabledModelIds = modelIds
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    if (enabledModelIds.length === 0) {
      toast.error('至少填写一个可用模型 ID')
      return
    }
    await upsertService.mutateAsync({
      consumer,
      capability,
      family,
      providerId,
      serviceKind,
      baseUrl: baseUrl.trim() || null,
      enabledModelIds,
      defaultModelId: defaultModelId.trim() || null,
      status: 'active',
      priority: 100,
    })
    toast.success('模型服务配置已保存')
  }

  return (
    <div className='flex flex-col gap-3'>
      <PanelHeader
        icon={<Database className='h-5 w-5' />}
        title='模型服务配置'
        description='画布优先读取 sim-canvas；Hermes PPT 读取 hermes-ppt。已启用模型必须与 Provider Key 对应。'
      />
      <DataPanel className='grid gap-3 md:grid-cols-3'>
        <SelectField
          label='使用方'
          value={consumer}
          onChange={setConsumer}
          options={['sim-canvas', 'hermes-agent', 'hermes-ppt']}
        />
        <TextField
          label='能力'
          value={capability}
          onChange={setCapability}
          placeholder='例如 image、text'
        />
        <TextField
          label='模型族'
          value={family}
          onChange={setFamily}
          placeholder='例如 image、gemini'
        />
        <SelectField
          label='Provider'
          value={providerId}
          onChange={setProviderId}
          options={PROVIDERS.filter((item) => item !== 'all')}
        />
        <TextField
          label='服务类型'
          value={serviceKind}
          onChange={setServiceKind}
          placeholder='例如 openai-compatible'
        />
        <TextField
          label='Base URL（可选）'
          value={baseUrl}
          onChange={setBaseUrl}
          placeholder='https://api.example.com/v1'
        />
        <TextField
          label='可用模型（逗号分隔）'
          value={modelIds}
          onChange={setModelIds}
          placeholder='gpt-image-1,imagen-3.0-generate-002'
        />
        <TextField
          label='默认模型（可选）'
          value={defaultModelId}
          onChange={setDefaultModelId}
          placeholder='默认使用的模型 ID'
        />
        <div className='flex items-end'>
          <Button
            variant='primary'
            className='w-full'
            disabled={upsertService.isPending}
            onClick={submit}
          >
            保存服务
          </Button>
        </div>
      </DataPanel>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {(servicesQuery.data?.services ?? []).map((service) => (
              <ModelServiceRow key={service.id} service={service} />
            ))}
          </TableBody>
        </Table>
        {servicesQuery.isLoading && <LoadingOverlay />}
      </DataPanel>
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className='flex flex-col gap-2'>
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
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

function ModelServiceRow({ service }: { service: AdminConsoleModelService }) {
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
    </TableRow>
  )
}

function ProviderKeyRow({
  item,
  updateKey,
}: {
  item: AdminConsoleProviderKey
  updateKey: ReturnType<typeof useUpdateAdminConsoleProviderKey>['mutate']
}) {
  const [replacement, setReplacement] = useState('')

  return (
    <TableRow>
      <TableCell>{item.providerId}</TableCell>
      <TableCell>{item.label}</TableCell>
      <TableCell>{item.maskedKey}</TableCell>
      <TableCell>
        <Badge variant={item.status === 'active' ? 'green' : 'gray'}>{item.status}</Badge>
      </TableCell>
      <TableCell>{item.isDefault ? <Badge variant='blue'>默认</Badge> : '-'}</TableCell>
      <TableCell>{item.lastUsedAt ? new Date(item.lastUsedAt).toLocaleString() : '-'}</TableCell>
      <TableCell className='pr-4'>
        <div className='flex flex-nowrap justify-end gap-1.5 whitespace-nowrap'>
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
        </div>
      </TableCell>
    </TableRow>
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
