'use client'

import { ArrowRight, Loader2, PenLine, Plus } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/emcn'
import { useLiteCanvasNavigation } from '@/app/workspace/[workspaceId]/use-lite-canvas-navigation'
import { CreateWorkspaceModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/create-workspace-modal/create-workspace-modal'

export default function PersonalWorkflowsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const canvas = useLiteCanvasNavigation({ workspaceId })
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  return (
    <div className='h-full overflow-y-auto bg-[var(--bg)] [scrollbar-gutter:stable_both-edges]'>
      <div className='mx-auto flex min-h-full w-full max-w-[72rem] flex-col px-4 py-8 sm:px-6 lg:px-10'>
        <header className='flex flex-col gap-3 border-[var(--border)] border-b pb-5 md:flex-row md:items-end md:justify-between'>
          <div className='min-w-0'>
            <div className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
              <PenLine className='h-4 w-4' />
              {canvas.activeWorkgroup
                ? `${canvas.activeWorkgroup.discipline.name} / ${canvas.activeWorkgroup.name}`
                : '个人画布'}
            </div>
            <h1 className='mt-2 font-semibold text-[28px] text-[var(--text-primary)]'>
              Personal Workflows
            </h1>
            <p className='mt-2 max-w-[44rem] text-[14px] text-[var(--text-muted)] leading-6'>
              这里仅用于个人草稿和测试，不会和项目团队画布混在一起。需要协作时请回到 Team Canvas。
            </p>
          </div>
          <Button
            type='button'
            onClick={() => setIsCreateModalOpen(true)}
            disabled={!canvas.canCreatePersonalCanvas || canvas.isCreatingPersonalWorkspace}
          >
            {canvas.isCreatingPersonalWorkspace ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <Plus className='mr-2 h-4 w-4' />
            )}
            新建个人画布
          </Button>
        </header>

        <main className='mt-5'>
          {canvas.personalDraftWorkspaces.length === 0 ? (
            <div className='flex min-h-[280px] flex-col items-center justify-center rounded-[8px] border border-[var(--border)] border-dashed bg-[var(--surface-1)] p-6 text-center'>
              <PenLine className='h-8 w-8 text-[var(--text-tertiary)]' />
              <div className='mt-3 font-medium text-[13px] text-[var(--text-primary)]'>
                还没有个人画布
              </div>
              <div className='mt-1 text-[12px] text-[var(--text-tertiary)]'>
                新建后会自动进入个人画布工作区。
              </div>
            </div>
          ) : (
            <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
              {canvas.personalDraftWorkspaces.map((workspace) => (
                <Link
                  key={workspace.id}
                  href={`/workspace/${workspace.id}/w`}
                  className='group rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-4 transition-colors hover-hover:bg-[var(--surface-hover)]'
                >
                  <div className='flex items-start justify-between gap-3'>
                    <div className='flex h-10 w-10 items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'>
                      <PenLine className='h-[18px] w-[18px] text-[var(--text-icon)]' />
                    </div>
                    <ArrowRight className='h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-0.5' />
                  </div>
                  <h2 className='mt-5 truncate font-medium text-[16px] text-[var(--text-primary)]'>
                    {workspace.name}
                  </h2>
                  <p className='mt-2 text-[12px] text-[var(--text-muted)] leading-5'>
                    个人测试画布，独立于团队画布。
                  </p>
                </Link>
              ))}
            </div>
          )}
        </main>
      </div>

      <CreateWorkspaceModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onConfirm={async (name) => {
          await canvas.createPersonalCanvas(name)
          setIsCreateModalOpen(false)
        }}
        isCreating={canvas.isCreatingPersonalWorkspace}
      />
    </div>
  )
}
