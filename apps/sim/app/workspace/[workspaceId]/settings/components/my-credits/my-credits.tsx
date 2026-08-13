'use client'

import { Coins } from 'lucide-react'
import { useMyCreditLedger, useMyCredits } from '@/hooks/queries/credits'

function describeEntry(eventType: string): string {
  const labels: Record<string, string> = {
    reserve: '生成冻结',
    settle: '生成扣除',
    release: '生成失败返还',
    admin_adjust: '管理员调整',
  }
  return labels[eventType] ?? eventType
}

/** Read-only personal platform-credit balance and transaction history. */
export function MyCredits() {
  const wallet = useMyCredits()
  const ledger = useMyCreditLedger()
  const balance = wallet.data

  return (
    <div className='space-y-6'>
      <div className='grid gap-3 sm:grid-cols-3'>
        {[
          ['可用积分', balance?.isUnlimited ? '无限' : balance?.availableCredits],
          ['冻结中', balance?.reservedCredits],
          ['累计消耗', balance?.totalConsumedCredits],
        ].map(([label, value]) => (
          <div key={String(label)} className='rounded-lg border border-[var(--border)] p-4'>
            <div className='text-sm text-[var(--text-secondary)]'>{label}</div>
            <div className='mt-2 flex items-center gap-2 text-xl font-medium'>
              <Coins className='h-5 w-5' />
              {typeof value === 'number' ? value.toLocaleString() : value ?? '—'}
            </div>
          </div>
        ))}
      </div>
      <p className='text-sm text-[var(--text-secondary)]'>
        图片、视频、音频和可编辑 PPT 的生成会消耗积分；失败或取消会自动返还。
      </p>
      <div className='overflow-hidden rounded-lg border border-[var(--border)]'>
        <div className='border-b border-[var(--border)] px-4 py-3 font-medium'>积分明细</div>
        {ledger.data?.entries.length === 0 && (
          <div className='p-4 text-sm text-[var(--text-secondary)]'>暂无积分记录</div>
        )}
        {ledger.data?.entries.map((entry) => (
          <div
            key={entry.id}
            className='flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-3 last:border-0'
          >
            <div>
              <div className='text-sm'>
                {describeEntry(entry.eventType)}
                {entry.modelId ? ` · ${entry.modelId}` : ''}
              </div>
              <div className='text-xs text-[var(--text-secondary)]'>
                {new Date(entry.createdAt).toLocaleString()}
              </div>
            </div>
            <div
              className={
                entry.availableDelta >= 0
                  ? 'text-sm tabular-nums text-[var(--success)]'
                  : 'text-sm tabular-nums'
              }
            >
              {entry.availableDelta > 0 ? '+' : ''}
              {entry.availableDelta}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
