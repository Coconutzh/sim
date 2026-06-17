'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Download, Loader2, Maximize2, RefreshCw, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/core/utils/cn'

const logger = createLogger('ImageToolbarActions')

interface UploadedFileValue {
  id?: string
  name?: string
  path?: string
  key?: string
  size?: number
  type?: string
  context?: string
}

interface ImageToolbarActionsProps {
  file: UploadedFileValue
  imageSrc: string
  nodeName?: string
  isReplacing?: boolean
  onReplace: () => void
  onError: (message: string) => void
}

const TOOL_BUTTON_CLASS =
  'inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm hover-hover:bg-[var(--surface-3)] disabled:cursor-not-allowed disabled:opacity-60'

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
}

function getKeyFileName(key?: string): string {
  const lastSegment = key?.split('/').filter(Boolean).at(-1)?.trim()
  if (!lastSegment) return ''

  try {
    return decodeURIComponent(lastSegment)
  } catch {
    return lastSegment
  }
}

function sanitizeDownloadName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
}

function getFileExtension(fileName: string): string {
  const match = fileName.match(/\.([a-z0-9]{2,5})$/i)
  return match?.[1]?.toLowerCase() ?? ''
}

export function inferImageFileName(file: UploadedFileValue, nodeName?: string): string {
  const keyFileName = getKeyFileName(file.key)
  const rawName = nodeName?.trim() || file.name?.trim() || keyFileName || 'image'
  const safeName = sanitizeDownloadName(rawName) || 'image'
  if (getFileExtension(safeName)) return safeName

  const extension =
    getFileExtension(file.name?.trim() ?? '') ||
    getFileExtension(keyFileName) ||
    IMAGE_EXTENSION_BY_MIME[file.type?.toLowerCase() ?? ''] ||
    'png'
  return `${safeName}.${extension}`
}

function getDownloadUrl(file: UploadedFileValue, imageSrc: string): string {
  const key = file.key?.trim()
  if (!key) return imageSrc

  const context = file.context?.trim() || 'workspace'
  return `/api/files/serve/${encodeURIComponent(key)}?context=${encodeURIComponent(
    context
  )}&t=${Date.now()}`
}

function clickDownloadLink(url: string, fileName: string): void {
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

async function downloadImage(file: UploadedFileValue, imageSrc: string, fileName: string) {
  const downloadUrl = getDownloadUrl(file, imageSrc)

  try {
    const response = await fetch(downloadUrl, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Download failed with status ${response.status}`)

    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    try {
      clickDownloadLink(objectUrl, fileName)
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  } catch (error) {
    if (!file.key && imageSrc) {
      logger.warn('Falling back to direct image download', { error })
      clickDownloadLink(imageSrc, fileName)
      return
    }

    throw error
  }
}

export function ImageToolbarActions({
  file,
  imageSrc,
  nodeName,
  isReplacing = false,
  onReplace,
  onError,
}: ImageToolbarActionsProps) {
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const fileName = useMemo(() => inferImageFileName(file, nodeName), [file, nodeName])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!isFullscreenOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setIsFullscreenOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isFullscreenOpen])

  const handleDownload = useCallback(async () => {
    if (isDownloading) return

    setIsDownloading(true)
    try {
      await downloadImage(file, imageSrc, fileName)
    } catch (error) {
      logger.error('Failed to download image', { error, fileName })
      onError('Failed to download image.')
    } finally {
      setIsDownloading(false)
    }
  }, [file, fileName, imageSrc, isDownloading, onError])

  const fullscreenLayer =
    mounted && isFullscreenOpen
      ? createPortal(
          <div
            className='nodrag nopan fixed inset-0 z-[1000] flex flex-col bg-black/90'
            role='dialog'
            aria-modal='true'
            aria-label='Fullscreen image preview'
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <div className='flex h-14 shrink-0 items-center justify-end gap-2 px-4'>
              <button
                type='button'
                aria-label='Download image'
                title='Download image'
                disabled={isDownloading}
                onClick={(event) => {
                  event.stopPropagation()
                  void handleDownload()
                }}
                className='inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white shadow-sm hover-hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60'
              >
                {isDownloading ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <Download className='h-4 w-4' />
                )}
              </button>
              <button
                type='button'
                aria-label='Close fullscreen image'
                title='Close fullscreen image'
                onClick={(event) => {
                  event.stopPropagation()
                  setIsFullscreenOpen(false)
                }}
                className='inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white shadow-sm hover-hover:bg-white/20'
              >
                <X className='h-4 w-4' />
              </button>
            </div>
            <div className='flex min-h-0 flex-1 items-center justify-center px-4 pb-4'>
              <img
                src={imageSrc}
                alt={file.name || nodeName || 'Fullscreen image'}
                className='max-h-full max-w-full object-contain'
              />
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <>
      <button
        type='button'
        aria-label='Replace image'
        title='Replace image'
        disabled={isReplacing}
        onPointerDown={(event) => {
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.stopPropagation()
          onReplace()
        }}
        className={TOOL_BUTTON_CLASS}
      >
        {isReplacing ? (
          <Loader2 className='h-3.5 w-3.5 animate-spin' />
        ) : (
          <RefreshCw className='h-3.5 w-3.5' />
        )}
      </button>
      <button
        type='button'
        aria-label='Download image'
        title='Download image'
        disabled={isDownloading}
        onPointerDown={(event) => {
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.stopPropagation()
          void handleDownload()
        }}
        className={TOOL_BUTTON_CLASS}
      >
        {isDownloading ? (
          <Loader2 className='h-3.5 w-3.5 animate-spin' />
        ) : (
          <Download className='h-3.5 w-3.5' />
        )}
      </button>
      <button
        type='button'
        aria-label='Fullscreen image'
        title='Fullscreen image'
        onPointerDown={(event) => {
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.stopPropagation()
          setIsFullscreenOpen(true)
        }}
        className={cn(TOOL_BUTTON_CLASS, isFullscreenOpen && 'bg-[var(--surface-3)]')}
      >
        <Maximize2 className='h-3.5 w-3.5' />
      </button>
      {fullscreenLayer}
    </>
  )
}
