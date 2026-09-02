'use client'

import { type ChangeEvent, type FormEvent, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Loader2, Paperclip, Upload } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, Input, Textarea, toast } from '@/components/emcn'
import type { CreateProductionTaskBody } from '@/lib/api/contracts/production-tasks'
import { useCreateMobileProductionTask, useMobileProject } from '@/hooks/queries/mobile-production'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'

interface MobileNewTaskPageProps {
  workspaceId: string
}

interface AttachmentDraft {
  name: string
  source: 'workspace_file'
  workspaceFileId: string
  url?: string
  key?: string
  contentType?: string
  size?: number
}

export function MobileNewTaskPage({ workspaceId }: MobileNewTaskPageProps) {
  const router = useRouter()
  const projectQuery = useMobileProject(workspaceId)
  const createTask = useCreateMobileProductionTask()
  const uploadFile = useUploadWorkspaceFile()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [assigneeWorkgroupId, setAssigneeWorkgroupId] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [description, setDescription] = useState('')
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const workgroups = projectQuery.data?.assignableWorkgroups ?? []
  const selectedWorkgroup = useMemo(
    () => workgroups.find((workgroup) => workgroup.id === assigneeWorkgroupId),
    [assigneeWorkgroupId, workgroups]
  )

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    setIsUploading(true)
    try {
      const uploaded = await Promise.all(
        files.map((file) => uploadFile.mutateAsync({ workspaceId, file, skipToast: true }))
      )
      setAttachments((current) => [
        ...current,
        ...uploaded.map((result) => ({
          source: 'workspace_file' as const,
          name: result.file.name,
          workspaceFileId: result.file.id,
          url: result.file.url,
          key: result.file.key,
          contentType: result.file.type,
          size: result.file.size,
        })),
      ])
    } catch (error) {
      toast({ message: error instanceof Error ? error.message : '附件上传失败', duration: 2600 })
    } finally {
      setIsUploading(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!title.trim() || !assigneeWorkgroupId) {
      toast({ message: '请填写任务标题并选择负责团队', duration: 2400 })
      return
    }
    const body: CreateProductionTaskBody = {
      workspaceId,
      title: title.trim(),
      assigneeWorkgroupId,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      description: description.trim() || null,
      attachments,
    }
    try {
      const result = await createTask.mutateAsync(body)
      router.replace(`/mobile/project/${workspaceId}/task/${result.task.id}`)
    } catch (error) {
      toast({ message: error instanceof Error ? error.message : '发布任务失败', duration: 2800 })
    }
  }

  if (projectQuery.isLoading) {
    return (
      <div className='flex min-h-[100dvh] items-center justify-center text-[13px]'>
        正在加载表单
      </div>
    )
  }
  if (projectQuery.isError || !projectQuery.data?.project.canCreateProductionTask) {
    return (
      <div className='min-h-[100dvh] p-4'>
        <Link
          href={`/mobile/project/${workspaceId}`}
          className='inline-flex h-11 items-center rounded-md px-2'
        >
          <ArrowLeft className='mr-2 h-5 w-5' />
          返回项目
        </Link>
        <p className='mt-10 text-center text-[13px] text-[var(--text-secondary)]'>
          当前账号无权发布任务
        </p>
      </div>
    )
  }

  return (
    <div className='min-h-[100dvh]'>
      <header className='sticky top-0 z-20 border-[var(--border)] border-b bg-[var(--bg)] pt-[env(safe-area-inset-top)]'>
        <div className='mx-auto flex h-14 max-w-3xl items-center gap-2 px-3'>
          <Link
            href={`/mobile/project/${workspaceId}`}
            aria-label='返回'
            className='flex h-11 w-11 items-center justify-center rounded-md'
          >
            <ArrowLeft className='h-5 w-5' />
          </Link>
          <h1 className='font-semibold text-[16px]'>发布任务</h1>
        </div>
      </header>
      <form
        onSubmit={handleSubmit}
        className='mx-auto max-w-3xl space-y-4 px-3 pt-4 pb-[calc(96px+env(safe-area-inset-bottom))]'
      >
        <div className='block space-y-2 font-medium text-[12px]'>
          <span className='block'>任务标题</span>
          <Input
            id='mobile-task-title'
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder='请输入任务标题'
            className='h-12 text-[14px]'
            maxLength={160}
          />
        </div>
        <div className='block space-y-2 font-medium text-[12px]'>
          <span className='block'>负责团队</span>
          <select
            id='mobile-task-assignee'
            value={assigneeWorkgroupId}
            onChange={(event) => setAssigneeWorkgroupId(event.target.value)}
            className='h-12 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 text-[14px]'
          >
            <option value=''>请选择负责团队</option>
            {workgroups.map((workgroup) => (
              <option key={workgroup.id} value={workgroup.id}>
                {workgroup.disciplineName ? `${workgroup.disciplineName} / ` : ''}
                {workgroup.name}
              </option>
            ))}
          </select>
          {selectedWorkgroup ? (
            <span className='text-[11px] text-[var(--text-tertiary)]'>
              将分派给 {selectedWorkgroup.name}
            </span>
          ) : null}
        </div>
        <div className='block space-y-2 font-medium text-[12px]'>
          <span className='block'>DDL</span>
          <input
            id='mobile-task-due'
            type='datetime-local'
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            className='h-12 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 text-[14px]'
          />
        </div>
        <div className='block space-y-2 font-medium text-[12px]'>
          <span className='block'>任务说明</span>
          <Textarea
            id='mobile-task-description'
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder='补充背景、交付要求和验收标准'
            className='min-h-36 text-[14px]'
            maxLength={4000}
          />
        </div>
        <div className='space-y-3 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-3'>
          <div className='flex items-center justify-between'>
            <span className='flex items-center gap-2 font-medium text-[12px]'>
              <Paperclip className='h-4 w-4' />
              附件
            </span>
            <Button
              type='button'
              variant='outline'
              className='h-11'
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              <Upload className='mr-2 h-4 w-4' />
              选择文件
            </Button>
            <input
              ref={fileInputRef}
              type='file'
              multiple
              className='hidden'
              onChange={(event) => void handleFiles(event)}
            />
          </div>
          {attachments.length > 0 ? (
            <div className='space-y-2'>
              {attachments.map((attachment) => (
                <div
                  key={attachment.workspaceFileId}
                  className='flex min-h-11 items-center justify-between gap-2 rounded-md bg-[var(--surface-2)] px-3 text-[12px]'
                >
                  <span className='min-w-0 break-all'>{attachment.name}</span>
                  <button
                    type='button'
                    className='h-11 px-2 text-[var(--badge-red-text)]'
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter(
                          (item) => item.workspaceFileId !== attachment.workspaceFileId
                        )
                      )
                    }
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className='text-[11px] text-[var(--text-tertiary)]'>可从相册或文件中选择附件</p>
          )}
        </div>
        <div className='fixed inset-x-0 bottom-0 z-20 border-[var(--border)] border-t bg-[var(--bg)] px-3 pt-2 pb-[calc(8px+env(safe-area-inset-bottom))]'>
          <div className='mx-auto max-w-3xl'>
            <Button
              type='submit'
              className='h-12 w-full'
              disabled={
                createTask.isPending || isUploading || !title.trim() || !assigneeWorkgroupId
              }
            >
              {createTask.isPending ? (
                <>
                  <Loader2 className='mr-2 h-5 w-5 animate-spin' />
                  发布中
                </>
              ) : (
                '发布任务'
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
