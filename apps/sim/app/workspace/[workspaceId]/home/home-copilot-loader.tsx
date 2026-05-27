'use client'

import { useState } from 'react'
import { MessageSquare } from 'lucide-react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/emcn'

const HomeCopilot = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/home/home-copilot').then((module) => module.HomeCopilot),
  {
    ssr: false,
    loading: () => <div className='h-full bg-[var(--bg)]' />,
  }
)

interface HomeCopilotLoaderProps {
  chatId?: string
}

export function HomeCopilotLoader({ chatId }: HomeCopilotLoaderProps) {
  const [isOpen, setIsOpen] = useState(Boolean(chatId))

  if (isOpen) {
    return <HomeCopilot chatId={chatId} />
  }

  return (
    <div className='mt-10 flex flex-col items-center'>
      <h2 className='mb-4 text-[13px] text-[var(--text-muted)]'>Or ask Copilot to help</h2>
      <Button
        type='button'
        variant='outline'
        onClick={() => setIsOpen(true)}
        className='gap-2 rounded-[8px]'
      >
        <MessageSquare className='h-[15px] w-[15px]' />
        Load Copilot
      </Button>
    </div>
  )
}
