'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Combobox,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'

export interface ProjectOption {
  id: string
  name: string
}

export interface CreatePersonalCanvasInput {
  canvasName: string
  projectId?: string
  projectName?: string
}

interface CreateWorkspaceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (input: CreatePersonalCanvasInput) => Promise<void>
  isCreating: boolean
  projects: ProjectOption[]
}

/** Modal for selecting a project and naming a new personal draft canvas. */
export function CreateWorkspaceModal({
  open,
  onOpenChange,
  onConfirm,
  isCreating,
  projects,
}: CreateWorkspaceModalProps) {
  const [canvasName, setCanvasName] = useState('')
  const [projectMode, setProjectMode] = useState<'existing' | 'new'>('existing')
  const [projectId, setProjectId] = useState('')
  const [projectName, setProjectName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setCanvasName('')
      setProjectMode('existing')
      setProjectId('')
      setProjectName('')
    }
  }, [open])

  const canSubmit =
    Boolean(canvasName.trim()) &&
    !isCreating &&
    (projectMode === 'existing' ? Boolean(projectId) : Boolean(projectName.trim()))

  const handleSubmit = async () => {
    if (!canSubmit) return
    await onConfirm({
      canvasName: canvasName.trim(),
      ...(projectMode === 'existing' ? { projectId } : { projectName: projectName.trim() }),
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    void handleSubmit()
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        size='sm'
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <ModalHeader>新建个人画布</ModalHeader>
        <ModalBody>
          <div className='space-y-3'>
            <Combobox
              value={projectMode}
              onChange={(value) => setProjectMode(value as 'existing' | 'new')}
              options={[
                { value: 'existing', label: '已有项目' },
                { value: 'new', label: '新建项目' },
              ]}
              placeholder='选择项目方式'
              disabled={isCreating}
            />
            {projectMode === 'existing' ? (
              <Combobox
                value={projectId}
                onChange={setProjectId}
                options={projects.map((project) => ({ value: project.id, label: project.name }))}
                placeholder={projects.length > 0 ? '选择已有项目' : '暂无可用项目'}
                disabled={isCreating || projects.length === 0}
              />
            ) : (
              <Input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder='项目名称'
                maxLength={120}
                autoComplete='off'
                disabled={isCreating}
              />
            )}
            <Input
              ref={inputRef}
              value={canvasName}
              onChange={(event) => setCanvasName(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='画布名称'
              maxLength={100}
              autoComplete='off'
              autoCorrect='off'
              autoCapitalize='off'
              spellCheck={false}
              disabled={isCreating}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={() => onOpenChange(false)} disabled={isCreating}>
            取消
          </Button>
          <Button variant='primary' onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {isCreating ? '创建中...' : '创建画布'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
