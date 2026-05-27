interface HomeProps {
  chatId?: string
  workspaceId: string
}

export async function Home({ chatId, workspaceId }: HomeProps) {
  const { LowMemoryHomeClient } = await import(
    '@/app/workspace/[workspaceId]/home/low-memory-home-client'
  )
  return <LowMemoryHomeClient chatId={chatId} workspaceId={workspaceId} />
}
