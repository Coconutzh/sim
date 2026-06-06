import { getContentCanvasModelOptions } from '@/lib/content-canvas/model-catalog'

export const DEFAULT_IMAGE_AI_MODEL = 'jimeng-4.5' as const
export const DEFAULT_IMAGE_ASPECT_RATIO = 'auto' as const

export const IMAGE_ASPECT_RATIO_OPTIONS = [
  { id: 'auto', label: '鑷€傚簲(4K)' },
  { id: '1:1', label: '1:1' },
  { id: '4:3', label: '4:3' },
  { id: '3:4', label: '3:4' },
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
  { id: '3:2', label: '3:2' },
  { id: '2:3', label: '2:3' },
  { id: '21:9', label: '21:9' },
] as const

export type ImageGenerationModelId =
  | 'jimeng-4.5'
  | 'jimeng-4.0'
  | 'gemini-3.1-flash-image-preview'
export type ImageAspectRatioValue = (typeof IMAGE_ASPECT_RATIO_OPTIONS)[number]['id']

const IMAGE_ASPECT_RATIO_TO_NUMERIC: Record<Exclude<ImageAspectRatioValue, 'auto'>, number> = {
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '3:2': 3 / 2,
  '2:3': 2 / 3,
  '21:9': 21 / 9,
}

const IMAGE_ASPECT_RATIO_TO_PROVIDER_SIZE: Record<ImageAspectRatioValue, string> = {
  auto: '4K',
  '1:1': '2048x2048',
  '4:3': '2304x1728',
  '3:4': '1728x2304',
  '16:9': '2560x1440',
  '9:16': '1440x2560',
  '3:2': '2496x1664',
  '2:3': '1664x2496',
  '21:9': '3136x1344',
}

export function getImageGenerationModelOptions(
  enabledModelIds?: readonly string[]
): ReadonlyArray<{
  id: ImageGenerationModelId
  label: string
  description: string
}> {
  const options = getContentCanvasModelOptions('image') as Array<{
    id: ImageGenerationModelId
    label: string
    description: string
  }>
  if (!enabledModelIds) return options

  const enabledSet = new Set(enabledModelIds)
  return options.filter((option) => enabledSet.has(option.id))
}

export function getImageAspectRatioOptions() {
  return IMAGE_ASPECT_RATIO_OPTIONS
}

export function mapImageAspectRatioToProviderSize(value: ImageAspectRatioValue): string {
  return IMAGE_ASPECT_RATIO_TO_PROVIDER_SIZE[value]
}

export function getNearestSupportedImageAspectRatio(
  width: number,
  height: number
): Exclude<ImageAspectRatioValue, 'auto'> | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  const ratio = width / height
  let nearest: Exclude<ImageAspectRatioValue, 'auto'> | null = null
  let smallestDistance = Number.POSITIVE_INFINITY

  for (const [candidate, candidateRatio] of Object.entries(IMAGE_ASPECT_RATIO_TO_NUMERIC) as Array<
    [Exclude<ImageAspectRatioValue, 'auto'>, number]
  >) {
    const distance = Math.abs(Math.log(ratio / candidateRatio))
    if (distance < smallestDistance) {
      smallestDistance = distance
      nearest = candidate
    }
  }

  return nearest
}

export function getResolvedImageAspectRatio({
  storedAspectRatio,
  inferredAspectRatio,
}: {
  storedAspectRatio?: string | null
  inferredAspectRatio?: Exclude<ImageAspectRatioValue, 'auto'> | null
}): ImageAspectRatioValue {
  if (storedAspectRatio && storedAspectRatio !== 'auto') {
    return storedAspectRatio as ImageAspectRatioValue
  }
  if (inferredAspectRatio) {
    return inferredAspectRatio
  }
  if (storedAspectRatio === 'auto') {
    return 'auto'
  }
  return DEFAULT_IMAGE_ASPECT_RATIO
}
