'use client'

import { useEffect, useState } from 'react'
import { requestJson } from '@/lib/api/client/request'
import {
  getContentCanvasModelsContract,
  type ContentCanvasModelAvailabilitySnapshot,
} from '@/lib/api/contracts/content-canvas'

const availabilityCache = new Map<string, ContentCanvasModelAvailabilitySnapshot>()
const availabilityRequestCache = new Map<string, Promise<ContentCanvasModelAvailabilitySnapshot>>()

async function loadContentCanvasModelAvailability(workspaceId: string) {
  const cached = availabilityCache.get(workspaceId)
  if (cached) return cached

  const pending = availabilityRequestCache.get(workspaceId)
  if (pending) return pending

  const request = requestJson(getContentCanvasModelsContract, {
    query: { workspaceId },
  })
    .then((response) => {
      availabilityCache.set(workspaceId, response.models)
      availabilityRequestCache.delete(workspaceId)
      return response.models
    })
    .catch((error) => {
      availabilityRequestCache.delete(workspaceId)
      throw error
    })

  availabilityRequestCache.set(workspaceId, request)
  return request
}

export function useContentCanvasModelAvailability(workspaceId?: string) {
  const [availability, setAvailability] = useState<ContentCanvasModelAvailabilitySnapshot | null>(
    workspaceId ? availabilityCache.get(workspaceId) ?? null : null
  )

  useEffect(() => {
    let cancelled = false

    if (!workspaceId) {
      setAvailability(null)
      return
    }

    const cached = availabilityCache.get(workspaceId)
    if (cached) {
      setAvailability(cached)
      return
    }

    loadContentCanvasModelAvailability(workspaceId)
      .then((snapshot) => {
        if (!cancelled) {
          setAvailability(snapshot)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailability(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId])

  return availability
}
