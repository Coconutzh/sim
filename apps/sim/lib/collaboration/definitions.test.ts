/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { AGENT_CODES, DISCIPLINES, getAgentProfile } from '@/lib/collaboration/definitions'

describe('collaboration definitions', () => {
  it('defines 10 agent profiles and 11 displayed disciplines', () => {
    expect(AGENT_CODES).toHaveLength(10)
    expect(DISCIPLINES).toHaveLength(11)
  })

  it('maps PMO to the chief director agent', () => {
    const pmo = DISCIPLINES.find((discipline) => discipline.code === 'pmo')
    expect(pmo?.agentCode).toBe('chief_director')
    expect(getAgentProfile(pmo?.agentCode ?? '')).toMatchObject({ code: 'chief_director' })
  })
})
