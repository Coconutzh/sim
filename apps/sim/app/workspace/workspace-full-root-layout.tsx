'use client'

import type React from 'react'
import { useSession } from '@/lib/auth/auth-client'
import { SocketProvider } from '@/app/workspace/providers/socket-provider'

interface WorkspaceFullRootLayoutProps {
  children: React.ReactNode
}

export function WorkspaceFullRootLayout({ children }: WorkspaceFullRootLayoutProps) {
  const session = useSession()

  const user = session.data?.user
    ? {
        id: session.data.user.id,
        name: session.data.user.name ?? undefined,
        email: session.data.user.email,
      }
    : undefined

  return (
    <SocketProvider user={user}>
      <div className='workspace-root'>{children}</div>
    </SocketProvider>
  )
}
