'use client'

import { Coins } from 'lucide-react'
import { useMyCredits } from '@/hooks/queries/credits'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

interface CreditBalanceProps {
  isCollapsed: boolean
}

/** Compact entry point for a user's platform-media credit balance. */
export function CreditBalance({ isCollapsed }: CreditBalanceProps) {
  const { data } = useMyCredits()
  const { navigateToSettings } = useSettingsNavigation()
  const credits = data?.availableCredits
  const creditLabel = data?.isUnlimited ? '无限' : credits?.toLocaleString()

  return (
    <button
      type='button'
      title={creditLabel === undefined ? '加载积分中' : `可用积分：${creditLabel}`}
      onClick={() => navigateToSettings({ section: 'my-credits' })}
      className='mx-2 flex h-8 items-center gap-2 rounded-md px-2 text-[var(--text-secondary)] transition-colors hover-hover:bg-[var(--surface-hover)]'
    >
      <Coins className='h-4 w-4 flex-shrink-0' />
      {!isCollapsed && (
        <span className='text-sm tabular-nums'>{creditLabel ?? '—'} 积分</span>
      )}
    </button>
  )
}
