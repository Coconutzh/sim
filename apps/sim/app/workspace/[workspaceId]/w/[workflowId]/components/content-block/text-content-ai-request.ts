import type { Message } from '@/providers/types'

export interface TextAiReferenceImageSource {
  url?: string
  type?: string
  name?: string
}

export interface HydratedTextAiReferenceImage {
  mimeType: string
  data: string
}

interface BuildTextContentAiUserMessageParams {
  prompt: string
  referenceContextText?: string
  referenceImages?: HydratedTextAiReferenceImage[]
}

function joinPromptWithReferenceContext(prompt: string, referenceContextText?: string): string {
  return [prompt.trim(), referenceContextText?.trim()].filter(Boolean).join('\n\n')
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

export async function hydrateReferenceImagesForTextAi(
  images: TextAiReferenceImageSource[],
  fetchImpl: typeof fetch = fetch
): Promise<HydratedTextAiReferenceImage[]> {
  const hydratedImages = await Promise.all(
    images.map(async (image) => {
      const url = image.url?.trim()
      if (!url) return null

      const response = await fetchImpl(url, { credentials: 'include' })
      if (!response.ok) {
        throw new Error(`Failed to fetch reference image: ${image.name || url}`)
      }

      const blob = await response.blob()
      return {
        mimeType: image.type || blob.type || 'image/png',
        data: arrayBufferToBase64(await blob.arrayBuffer()),
      } satisfies HydratedTextAiReferenceImage
    })
  )

  return hydratedImages.filter((image): image is HydratedTextAiReferenceImage => Boolean(image))
}

export function buildTextContentAiUserMessage({
  prompt,
  referenceContextText,
  referenceImages = [],
}: BuildTextContentAiUserMessageParams): Message {
  const content = joinPromptWithReferenceContext(prompt, referenceContextText)
  const parts =
    referenceImages.length > 0
      ? [
          { type: 'text' as const, text: content },
          ...referenceImages.map((image) => ({
            type: 'image' as const,
            mimeType: image.mimeType,
            data: image.data,
          })),
        ]
      : undefined

  return {
    role: 'user',
    content,
    parts,
  }
}
