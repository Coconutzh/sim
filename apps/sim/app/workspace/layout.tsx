'use client'

import type React from 'react'
import dynamic from 'next/dynamic'

interface WorkspaceRootLayoutProps {
  children: React.ReactNode
}

const FullWorkspaceRootLayout = dynamic(
  () =>
    import('@/app/workspace/workspace-full-root-layout').then(
      (module) => module.WorkspaceFullRootLayout
    ),
  { ssr: false }
)

export default function WorkspaceRootLayout({ children }: WorkspaceRootLayoutProps) {
  if (process.env.NEXT_PUBLIC_SIM_LOW_MEMORY_DEV === 'true') {
    return <div className='workspace-root'>{children}</div>
  }

  return <FullWorkspaceRootLayout>{children}</FullWorkspaceRootLayout>
}
