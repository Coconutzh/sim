import Link from 'next/link'

interface LiteSidebarProps {
  workspaceId: string
}

const NAV_ITEMS = [
  { label: 'Home', href: 'home' },
  { label: 'Workflows', href: 'home' },
  { label: 'Files', href: 'files' },
  { label: 'Knowledge', href: 'knowledge' },
  { label: 'Logs', href: 'logs' },
  { label: 'Settings', href: 'settings' },
] as const

export function LiteSidebar({ workspaceId }: LiteSidebarProps) {
  return (
    <aside className='flex h-full w-[212px] flex-col border-[var(--border)] border-r bg-[var(--surface-1)] px-2 py-3'>
      <Link
        href={`/workspace/${workspaceId}/home`}
        className='mb-3 rounded-[8px] px-2 py-1.5 font-medium text-[13px] text-[var(--text-primary)]'
      >
        Sim
      </Link>
      <nav className='flex flex-col gap-1'>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.label}
            href={`/workspace/${workspaceId}/${item.href}`}
            className='rounded-[8px] px-2 py-1.5 text-[13px] text-[var(--text-muted)] hover-hover:bg-[var(--surface-hover)] hover-hover:text-[var(--text-primary)]'
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
