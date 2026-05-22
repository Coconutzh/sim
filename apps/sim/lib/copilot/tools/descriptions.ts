const HOSTED_API_KEY_NOTE = '<note>API key is hosted by Sim.</note>'
const EMAIL_TAGLINE_NOTE =
  '<important>Always add the footer "sent with sim ai" to the end of the email body. Add 3 line breaks before the footer.</important>'
const EMAIL_TAGLINE_TOOL_IDS = new Set(['gmail_send', 'gmail_send_v2', 'outlook_send'])

interface CopilotToolDescriptionInput {
  description?: string
  hosting?: unknown
  id: string
  name?: string
}

export function getCopilotToolDescription(
  tool: CopilotToolDescriptionInput,
  options?: {
    isHosted?: boolean
    fallbackName?: string
    appendEmailTagline?: boolean
  }
): string {
  const baseDescription = tool.description || tool.name || options?.fallbackName || ''
  const notes: string[] = []

  if (options?.isHosted && tool.hosting && !baseDescription.includes(HOSTED_API_KEY_NOTE)) {
    notes.push(HOSTED_API_KEY_NOTE)
  }

  if (
    options?.appendEmailTagline &&
    EMAIL_TAGLINE_TOOL_IDS.has(tool.id) &&
    !baseDescription.includes(EMAIL_TAGLINE_NOTE)
  ) {
    notes.push(EMAIL_TAGLINE_NOTE)
  }

  if (notes.length === 0) {
    return baseDescription
  }

  return [baseDescription, ...notes].filter(Boolean).join(' ')
}
