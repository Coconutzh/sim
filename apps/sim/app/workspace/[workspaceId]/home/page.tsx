import type { Metadata } from 'next'
import { Home } from './home'

export const metadata: Metadata = {
  title: 'Home',
}

interface HomePageProps {
  params: Promise<{
    workspaceId: string
  }>
}

export default async function HomePage({ params }: HomePageProps) {
  const { workspaceId } = await params
  return <Home workspaceId={workspaceId} />
}
