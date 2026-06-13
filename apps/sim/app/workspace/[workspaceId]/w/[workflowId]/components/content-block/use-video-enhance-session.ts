'use client'

import { useEffect, useState } from 'react'
import { requestJson } from '@/lib/api/client/request'
import {
  type GenerateWorkspaceVideoThumbnailsBody,
  generateWorkspaceVideoThumbnailsContract,
} from '@/lib/api/contracts/media-videos'

const COVER_FRAME_COUNT = 1

export function useVideoEnhanceSession({
  workspaceId,
  sourceFile,
  sourceVideoUrl,
}: {
  workspaceId: string
  sourceFile: GenerateWorkspaceVideoThumbnailsBody['sourceFile'] | null
  sourceVideoUrl: string
}) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [coverError, setCoverError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setCoverUrl(null)
    setCoverError(null)

    if (!workspaceId || !sourceFile || !sourceVideoUrl || typeof window === 'undefined') return

    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.src = sourceVideoUrl

    const cleanup = () => {
      video.removeAttribute('src')
      video.load()
    }

    const handleLoadedMetadata = () => {
      const durationSeconds = Number.isFinite(video.duration) ? video.duration : 0
      if (durationSeconds <= 0) {
        setCoverError('无法读取源视频时长。')
        return
      }

      requestJson(generateWorkspaceVideoThumbnailsContract, {
        body: {
          workspaceId,
          sourceFile,
          durationSeconds,
          frameCount: COVER_FRAME_COUNT,
        },
      })
        .then((result) => {
          if (!cancelled) setCoverUrl(result.thumbnails[0] ?? null)
        })
        .catch((error) => {
          if (!cancelled) {
            setCoverError(error instanceof Error ? error.message : '源视频封面生成失败。')
          }
        })
    }

    const handleError = () => {
      if (!cancelled) setCoverError('源视频封面不可用。')
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('error', handleError)

    return () => {
      cancelled = true
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('error', handleError)
      cleanup()
    }
  }, [sourceFile, sourceVideoUrl, workspaceId])

  return { coverUrl, coverError }
}
