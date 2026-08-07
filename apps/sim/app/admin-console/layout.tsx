import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'

export default async function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  const role = (session?.user as { role?: string | null } | undefined)?.role

  if (!session?.user?.id) {
    redirect('/login')
  }

  if (role !== 'admin') {
    redirect('/workspace')
  }

  return children
}
