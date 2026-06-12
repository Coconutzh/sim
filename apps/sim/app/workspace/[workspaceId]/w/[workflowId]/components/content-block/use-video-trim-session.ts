'use client'

import type { RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { requestJson } from '@/lib/api/client/request'
import {
  type GenerateWorkspaceVideoThumbnailsBody,
  generateWorkspaceVideoThumbnailsContract,
} from '@/lib/api/contracts/media-videos'
import {
  createDefaultVideoTrimRange,
  getVideoTrimKeyboardStep,
  moveVideoTrimRange,
  normalizeVideoTrimRange,
  positionVideoTrimRangeAtTime,
  resizeVideoTrimRange,
  setVideoTrimInPoint,
  setVideoTrimOutPoint,
  type VideoTrimEdge,
  type VideoTrimRange,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/video-trim-utils'

interface UseVideoTrimSessionOptions {
  videoRef: RefObject<HTMLVideoElement | null>
  videoSrc: string
  workspaceId: string
  sourceFile: GenerateWorkspaceVideoThumbnailsBody['sourceFile'] | null
  onCancel: () => void
  onConfirm: (range: VideoTrimRange) => void | Promise<void>
}

interface VideoTrimPointerInteraction {
  mode: 'move' | VideoTrimEdge
  startX: number
  range: VideoTrimRange
}

const THUMBNAIL_COUNT = 12

export function useVideoTrimSession({
  videoRef,
  videoSrc,
  workspaceId,
  sourceFile,
  onCancel,
  onConfirm,
}: UseVideoTrimSessionOptions) {
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [range, setRange] = useState<VideoTrimRange>({ startSeconds: 0, endSeconds: 0 })
  const [thumbnails, setThumbnails] = useState<string[]>([])
  const [activeEdge, setActiveEdge] = useState<VideoTrimEdge | null>(null)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [thumbnailError, setThumbnailError] = useState<string | null>(null)
  const interactionRef = useRef<VideoTrimPointerInteraction | null>(null)
  const rangeRef = useRef<VideoTrimRange>(range)

  const retainedDurationSeconds = Math.max(0, range.endSeconds - range.startSeconds)

  const formattedRetainedDuration = useMemo(
    () => `${retainedDurationSeconds.toFixed(2)}s`,
    [retainedDurationSeconds]
  )

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const updateDuration = () => {
      const nextDuration = Number.isFinite(video.duration) ? video.duration : 0
      setDurationSeconds(nextDuration)
      const defaultRange = createDefaultVideoTrimRange(nextDuration)
      rangeRef.current = defaultRange
      setRange(defaultRange)
      if (nextDuration > 0) {
        video.currentTime = 0
      }
    }

    updateDuration()
    video.addEventListener('loadedmetadata', updateDuration)
    return () => {
      video.removeEventListener('loadedmetadata', updateDuration)
    }
  }, [videoRef])

  useEffect(() => {
    let cancelled = false
    setThumbnails([])
    setThumbnailError(null)

    if (!workspaceId || !sourceFile || !videoSrc || durationSeconds <= 0) return

    requestJson(generateWorkspaceVideoThumbnailsContract, {
      body: {
        workspaceId,
        sourceFile,
        durationSeconds,
        frameCount: THUMBNAIL_COUNT,
      },
    })
      .then((result) => {
        if (!cancelled) setThumbnails(result.thumbnails)
      })
      .catch((error) => {
        if (!cancelled) {
          setThumbnailError(
            error instanceof Error ? error.message : 'Failed to capture thumbnails.'
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [durationSeconds, sourceFile, videoSrc, workspaceId])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const stopAtOutPoint = () => {
      if (video.currentTime < range.endSeconds) return
      video.pause()
      video.currentTime = range.endSeconds
    }

    video.addEventListener('timeupdate', stopAtOutPoint)
    return () => {
      video.removeEventListener('timeupdate', stopAtOutPoint)
    }
  }, [range.endSeconds, videoRef])

  const setPreviewTime = useCallback(
    (timeSeconds: number) => {
      const video = videoRef.current
      if (!video || durationSeconds <= 0) return
      video.currentTime = Math.min(durationSeconds, Math.max(0, timeSeconds))
    },
    [durationSeconds, videoRef]
  )

  const updateRange = useCallback(
    (nextRange: VideoTrimRange) => {
      const normalizedRange = normalizeVideoTrimRange(nextRange, durationSeconds)
      rangeRef.current = normalizedRange
      setRange(normalizedRange)
      setPreviewTime(normalizedRange.startSeconds)
      return normalizedRange
    },
    [durationSeconds, setPreviewTime]
  )

  const beginPointerInteraction = useCallback(
    (mode: 'move' | VideoTrimEdge, clientX: number) => {
      interactionRef.current = { mode, startX: clientX, range }
      if (mode === 'start' || mode === 'end') {
        setActiveEdge(mode)
      }
    },
    [range]
  )

  const beginTimelinePointerInteraction = useCallback(
    (clientX: number, timelineLeft: number, timelineWidth: number) => {
      if (durationSeconds <= 0 || timelineWidth <= 0) return

      const timeSeconds = ((clientX - timelineLeft) / timelineWidth) * durationSeconds
      const nextRange = updateRange(
        positionVideoTrimRangeAtTime(rangeRef.current, durationSeconds, timeSeconds)
      )
      interactionRef.current = { mode: 'move', startX: clientX, range: nextRange }
    },
    [durationSeconds, updateRange]
  )

  const updatePointerInteraction = useCallback(
    (clientX: number, timelineWidth: number) => {
      const interaction = interactionRef.current
      if (!interaction || durationSeconds <= 0 || timelineWidth <= 0) return

      const deltaSeconds = ((clientX - interaction.startX) / timelineWidth) * durationSeconds
      if (interaction.mode === 'move') {
        updateRange(moveVideoTrimRange(interaction.range, durationSeconds, deltaSeconds))
        return
      }

      updateRange(
        resizeVideoTrimRange(interaction.range, durationSeconds, interaction.mode, deltaSeconds)
      )
    },
    [durationSeconds, updateRange]
  )

  const endPointerInteraction = useCallback(() => {
    interactionRef.current = null
  }, [])

  const confirmCurrentRange = useCallback(() => {
    return onConfirm(rangeRef.current)
  }, [onConfirm])

  const togglePlayback = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      if (video.currentTime < range.startSeconds || video.currentTime >= range.endSeconds) {
        video.currentTime = range.startSeconds
      }
      void video.play()
      return
    }

    video.pause()
  }, [range.endSeconds, range.startSeconds, videoRef])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (durationSeconds <= 0) return

      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        void confirmCurrentRange()
        return
      }

      if (event.key === ' ') {
        event.preventDefault()
        togglePlayback()
        return
      }

      if (event.key === 'i' || event.key === 'I') {
        event.preventDefault()
        updateRange(setVideoTrimInPoint(range, durationSeconds, videoRef.current?.currentTime ?? 0))
        return
      }

      if (event.key === 'o' || event.key === 'O') {
        event.preventDefault()
        updateRange(
          setVideoTrimOutPoint(range, durationSeconds, videoRef.current?.currentTime ?? 0)
        )
        return
      }

      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

      event.preventDefault()
      const direction = event.key === 'ArrowLeft' ? -1 : 1
      const step = getVideoTrimKeyboardStep(event) * direction

      if (activeEdge) {
        updateRange(resizeVideoTrimRange(range, durationSeconds, activeEdge, step))
        return
      }

      updateRange(moveVideoTrimRange(range, durationSeconds, step))
    },
    [
      activeEdge,
      confirmCurrentRange,
      durationSeconds,
      onCancel,
      range,
      togglePlayback,
      updateRange,
      videoRef,
    ]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])

  return {
    durationSeconds,
    range,
    thumbnails,
    thumbnailError,
    activeEdge,
    isHelpOpen,
    formattedRetainedDuration,
    setActiveEdge,
    setIsHelpOpen,
    beginPointerInteraction,
    beginTimelinePointerInteraction,
    updatePointerInteraction,
    endPointerInteraction,
    confirmCurrentRange,
    togglePlayback,
  }
}
