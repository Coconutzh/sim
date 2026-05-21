'use client'

import type { ReactNode } from 'react'

export type CanvasMode = 'personal' | 'team' | 'showcase'

interface PresenceAvatar {
  id: string
  name: string
  avatarUrl?: string | null
  role?: string
}

interface CanvasModeHeaderProps {
  canvasMode: CanvasMode
  organizationName: string
  disciplineName: string
  workgroupName: string
  userRole: string
  agentName: string
  visibilityText: string
  permissionText: string
  versionText?: string
  presenceAvatars?: PresenceAvatar[]
  actions?: ReactNode
}

const MODE_LABELS: Record<CanvasMode, string> = {
  personal: '个人草稿画布',
  team: '团队画布',
  showcase: '展示画布',
}

const MODE_TONES: Record<CanvasMode, string> = {
  personal: 'bg-[#e8f0d8] text-[#53622d]',
  team: 'bg-[#dcebf6] text-[#28516d]',
  showcase: 'bg-[#f3e2cb] text-[#8a4e1f]',
}

export function CanvasModeHeader({
  canvasMode,
  organizationName,
  disciplineName,
  workgroupName,
  userRole,
  agentName,
  visibilityText,
  permissionText,
  versionText,
  presenceAvatars = [],
  actions,
}: CanvasModeHeaderProps) {
  return (
    <section className='rounded-[2rem] border border-[#e2d8c7] bg-white p-6 shadow-sm'>
      <div className='flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between'>
        <div>
          <div className='flex flex-wrap items-center gap-2'>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${MODE_TONES[canvasMode]}`}
            >
              {MODE_LABELS[canvasMode]}
            </span>
            {versionText && (
              <span className='rounded-full bg-[#f7f4ed] px-3 py-1 text-xs font-semibold text-[#6f6256]'>
                {versionText}
              </span>
            )}
          </div>
          <h1 className='mt-4 text-3xl font-semibold tracking-tight text-[#271f18]'>
            {MODE_LABELS[canvasMode]}
          </h1>
          <p className='mt-3 max-w-3xl text-sm leading-6 text-[#6f6256]'>{visibilityText}</p>
        </div>
        {actions && <div className='flex flex-wrap gap-2'>{actions}</div>}
      </div>

      <div className='mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5'>
        <HeaderFact label='项目/组织' value={organizationName} />
        <HeaderFact label='工种' value={disciplineName} />
        <HeaderFact label='团队' value={workgroupName} />
        <HeaderFact label='当前身份' value={userRole} />
        <HeaderFact label='当前 Agent' value={agentName} />
      </div>

      <div className='mt-5 flex flex-col gap-4 rounded-2xl bg-[#fbf8f2] p-4 md:flex-row md:items-center md:justify-between'>
        <p className='text-sm font-medium text-[#6f6256]'>{permissionText}</p>
        {canvasMode === 'team' && (
          <div className='flex items-center gap-3'>
            <span className='text-xs font-semibold uppercase tracking-[0.18em] text-[#9b5b2e]'>
              在线协作
            </span>
            {presenceAvatars.length > 0 ? (
              <div className='flex -space-x-2'>
                {presenceAvatars.map((avatar) => (
                  <div
                    key={avatar.id}
                    title={`${avatar.name}${avatar.role ? ` · ${avatar.role}` : ''}`}
                    className='flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#271f18] text-xs font-semibold text-white'
                  >
                    {avatar.avatarUrl ? (
                      <img
                        alt={avatar.name}
                        className='h-full w-full rounded-full object-cover'
                        src={avatar.avatarUrl}
                      />
                    ) : (
                      avatar.name.slice(0, 1).toUpperCase()
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <span className='text-sm text-[#8a7b6d]'>暂无同画布在线成员</span>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function HeaderFact({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-2xl border border-[#eee4d6] bg-[#fbf8f2] p-4'>
      <div className='text-xs font-semibold uppercase tracking-[0.18em] text-[#9b5b2e]'>
        {label}
      </div>
      <div className='mt-2 truncate text-sm font-semibold text-[#271f18]'>{value}</div>
    </div>
  )
}
