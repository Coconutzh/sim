'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button, Tooltip } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

interface CanvasThemeToggleProps {
  avoidTopRightChrome?: boolean
  className?: string
}

export function CanvasThemeToggle({
  avoidTopRightChrome = false,
  className,
}: CanvasThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const isDark = isMounted && resolvedTheme === 'dark'
  const nextTheme = isDark ? 'light' : 'dark'
  const label = isMounted ? `Switch to ${nextTheme} mode` : 'Switch color theme'
  const Icon = isDark ? Sun : Moon

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          type='button'
          variant='default'
          aria-label={label}
          className={cn(
            'nodrag nopan absolute right-4 z-20 h-[36px] w-[36px] rounded-lg p-0 shadow-sm',
            avoidTopRightChrome ? 'top-14' : 'top-4',
            'bg-[var(--surface-1)] text-[var(--text-icon)] hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-primary)]',
            className
          )}
          onClick={() => setTheme(nextTheme)}
        >
          <Icon className='h-[16px] w-[16px]' />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side='left'>{label}</Tooltip.Content>
    </Tooltip.Root>
  )
}
