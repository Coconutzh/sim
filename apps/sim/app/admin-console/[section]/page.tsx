import { AdminConsole } from '@/app/admin-console/admin-console'

const VALID_SECTIONS = new Set(['users', 'credits', 'api-keys', 'usage'])

interface PageProps {
  params: Promise<{ section: string }>
}

export default async function AdminConsoleSectionPage({ params }: PageProps) {
  const { section } = await params
  return <AdminConsole section={VALID_SECTIONS.has(section) ? section : 'users'} />
}
