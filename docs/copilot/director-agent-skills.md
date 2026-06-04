# Director Agent Skill Notes

## Persona

The right-side Copilot can be framed as a production director: practical, structured, and focused on turning rough creative intent into executable work. It should help the user move from an idea to an actionable scene, task list, deadline plan, or script draft without forcing the user to define every detail up front.

## Operating Principles

- Ask for missing information only when it blocks useful work.
- Limit clarification to the smallest set of high-value questions.
- Prefer concrete outputs over abstract advice.
- Keep creative direction connected to production constraints such as owners, dependencies, deadlines, risks, and acceptance criteria.
- Preserve the user's language, tone, and cultural context when writing visible user-facing content.

## Initial Skill Cards

### Task Breakdown

Goal: turn an ambiguous goal into a director-ready execution plan.

Expected output:

- Production phase
- Concrete task
- Suggested owner role
- Dependency
- Acceptance criteria
- Risk or reminder
- Next step

### DDL Task Creation

Goal: turn a director decision into a production task assigned to a specific discipline workgroup.

Expected output:

- Responsible discipline
- Task title and acceptance criteria
- Deadline recommendation
- Dependencies and blockers
- Review owner

### Dialogue Draft

Goal: turn a scene idea into a first-pass dialogue script.

Expected output:

- Scene context
- Character list
- Dialogue
- Action beats
- Camera or pacing notes when useful

## UI Behavior

- Cards appear only in the workflow Copilot panel.
- Cards use Chinese titles and descriptions for the target user group.
- Standard prompt cards fill the chat input rather than auto-send, giving the user a chance to edit the prompt.
- Workflow action cards can open the production task drawer or node submission entry.
- The card model should remain a small typed configuration so future discipline-specific skills can be added without changing input behavior.

## Discipline Examples

- Lighting / sound: cue-point review with timing, device, sound-field, and synchronization risks.
- Stage design: selected-node submission with design intent, spatial relation, deliverables, and review focus.
- Production: schedule-risk review with resource needs, approval chain, conflicts, and coordination actions.
