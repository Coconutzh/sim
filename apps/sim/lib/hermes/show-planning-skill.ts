import type { LocalAgentSkill } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

export const SHOW_PLANNING_SKILL_ID = 'builtin-show-planning'
export const SHOW_PLANNING_WORKFLOW_PRESET = 'show_planning_v1'

export const SHOW_PLANNING_SKILL_DESCRIPTION =
  'Use when turning a rough brief plus references into a structured event/show proposal with positioning, concept, structure, programs, lineup, visual system, and PPT-ready summary.'

export const SHOW_PLANNING_SKILL_CONTENT = `# Show Planning

Use this skill for festival shows, gala proposals, city event proposals, themed activity proposals, brand event planning, cultural-tourism event planning, and concept deck workflows that start from a rough event/show/activity brief.

Do not use this skill for ordinary PPT-only work, document-to-slides conversion, deck polishing, product decks, report decks, or standalone presentation generation without event/show/activity proposal planning.

## First canvas write
For a new show-planning proposal, the first canvas mutation must create the standard scaffold:

\`\`\`json
{
  "taskType": "create_chain",
  "fields": {
    "workflowPreset": "${SHOW_PLANNING_WORKFLOW_PRESET}"
  }
}
\`\`\`

Do not create individual planning nodes manually before the scaffold exists.

## Required order
1. Project understanding
2. Project positioning
3. Core concept
4. Overall structure
5. Program design
6. Program confirmation
7. Per-program detail generation
8. Per-program visual plan generation
9. Program image/video media generation
10. Resource lineup
11. Visual system summary
12. Final synthesis

Do not start from the celebrity list or the PPT page outline.

## Workflow expectations
- Build a structured brief from the user's conversation and references
- Create the proposal on canvas as separate structured planning nodes
- Use text nodes for planning sections and one presentation node for the final deck
- Save machine-readable planning data in node fields when possible
- Pause after overall structure for user review
- Pause again after program design for user review
- Only continue to lineup, visual system, and PPT after those checkpoints are approved
- Hermes may write the overall program pool/control node, but must not directly write every per-program detailed plan after user confirmation
- After program review is approved, SIM dynamically creates per-program detail text nodes, per-program visual plan text nodes, image nodes, and key-program video nodes
- Per-program detail text, per-program visual text, images, and videos must be generated through node-level generation, using aiPrompt/videoPrompt and generationTargets
- After node-level generation completes, continue with resource lineup, visual summary, total proposal summary, and PPT

## Required planning sections
1. 项目定位
2. 核心概念
3. 整体结构
4. 节目方案总控
5. 用户确认节目池
6. 每个节目的节目详细方案文本节点
7. 每个节目的节目视觉方案文本节点
8. 每个节目的图片节点，重点节目可加视频节点
9. 资源阵容
10. 视觉系统汇总
11. 总策划案

## Output standards
- Keep each section distinct
- Make later sections traceable to the core concept
- Separate confirmed facts from assumptions
- Prefer concise structured planning language over vague slogans
- Ensure the final summary can be passed into a PPT node

## Review checkpoints
- Structure review: confirm chapter logic and emotional arc before generating programs
- Program review: confirm program pool before generating per-program details, visual plans, media, lineup, visual summary, and PPT

## PPT rule
Only create or update the presentation node after the summary node is ready. The presentation prompt should reference the final planning summary and its linked planning nodes.
`

export function buildShowPlanningSkill(): LocalAgentSkill {
  return {
    id: SHOW_PLANNING_SKILL_ID,
    name: 'show-planning',
    description: SHOW_PLANNING_SKILL_DESCRIPTION,
    content: SHOW_PLANNING_SKILL_CONTENT,
    enabled: true,
    source: 'workspace',
  }
}
