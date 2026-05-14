# Copilot Workflow Debug Notes

## Current status

- The running app is this repository on `http://localhost:3000`.
- `DISABLE_AUTH=true` is enabled locally, so requests use the anonymous user.
- Redis is not configured locally. Copilot stream buffers and file preview sessions now fall back to in-memory storage.
- `/api/copilot/models` now falls back to local static model metadata when the remote Copilot backend model endpoint fails.
- The default Copilot backend base URL is normalized to `https://www.copilot.sim.ai`.
- Workflow Copilot requests now retry `/api/mcp` when the legacy `/api/copilot` backend route returns `404`.

## What still blocks end-to-end workflow generation

- The right-side Copilot agent still cannot complete a real request without `COPILOT_API_KEY`.
- After normalizing the backend domain, workflow chat now fails with a clear remote `401 Unauthorized`, which confirms the missing key is the current hard blocker.
- Text-to-image and image-to-video execution also need real provider keys. No OpenAI, Gemini, Runway, Luma, MiniMax, or Fal keys currently exist in local `.env`, workspace BYOK rows, or workspace environment entries.

## Required configuration for the target flow

- `COPILOT_API_KEY`
  File: `apps/sim/.env`
  Purpose: authenticates Sim server requests to the remote Copilot backend used by the right-side agent.

- `SIM_AGENT_API_URL`
  File: `apps/sim/.env`
  Purpose: optional override for the remote Copilot backend. Default now resolves to `https://www.copilot.sim.ai`.

- `OPENAI_API_KEY`
  File: `apps/sim/.env`
  Purpose: Image Generator server-side fallback key.

- `GEMINI_API_KEY`
  File: `apps/sim/.env`
  Purpose: Veo video generation fallback key.

- `RUNWAY_API_KEY`
  File: `apps/sim/.env`
  Purpose: Runway video generation fallback key.

- `LUMA_API_KEY`
  File: `apps/sim/.env`
  Purpose: Luma video generation fallback key.

- `MINIMAX_API_KEY`
  File: `apps/sim/.env`
  Purpose: MiniMax video generation fallback key.

- `FAL_API_KEY`
  File: `apps/sim/.env`
  Purpose: Fal.ai video generation fallback key.

- `NEXT_PUBLIC_OPENAI_IMAGE_CONFIGURED`
- `NEXT_PUBLIC_VEO_CONFIGURED`
- `NEXT_PUBLIC_RUNWAY_CONFIGURED`
- `NEXT_PUBLIC_LUMA_CONFIGURED`
- `NEXT_PUBLIC_MINIMAX_CONFIGURED`
- `NEXT_PUBLIC_FAL_CONFIGURED`
  File: `apps/sim/.env`
  Purpose: optional UI flags to hide per-block API key inputs when the corresponding server-side key is already configured.

## Right-side agent -> left canvas flow

- UI entry: `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/panel/panel.tsx`
- Chat transport hook: `apps/sim/app/workspace/[workspaceId]/home/hooks/use-chat.ts`
- Workflow panel uses `getWorkflowCopilotUseChatOptions()` and sends requests to `/api/mothership/chat`.
- Server entry: `apps/sim/app/api/mothership/chat/route.ts`
- Unified handler: `apps/sim/lib/copilot/chat/post.ts`
- When a `workflowId` is present, the request becomes a workflow Copilot branch and is forwarded to the remote Copilot backend through `runCopilotLifecycle()`.
- Remote agent planning does not directly mutate the browser canvas.
- Tool execution happens through Sim's server-side tool execution pipeline.
- Workflow edits are applied by `apps/sim/lib/copilot/tools/server/workflow/edit-workflow/index.ts`.
- After a successful `edit_workflow` tool result, the panel calls `handleCopilotToolResult()`, fetches `/api/workflows/[id]/state`, and writes a proposed diff into `useWorkflowDiffStore`.
- Diff state lives in `apps/sim/stores/workflow-diff/store.ts`.
- Accepting the proposed changes happens in `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/diff-controls/diff-controls.tsx`.
- The visible effect is: right-side agent proposes workflow mutations, Sim persists/broadcasts them, then the frontend shows them as an accept/reject diff before they become the current canvas state.

## Media generation wiring

- Image block: `apps/sim/blocks/blocks/image_generator.ts`
- OpenAI image tool: `apps/sim/tools/openai/image.ts`
- Video blocks: `apps/sim/blocks/blocks/video_generator.ts`
- Video route: `apps/sim/app/api/tools/video/route.ts`
- Video contracts: `apps/sim/lib/api/contracts/tools/media/video.ts`
- Video tools:
  `apps/sim/tools/video/runway.ts`
  `apps/sim/tools/video/veo.ts`
  `apps/sim/tools/video/luma.ts`
  `apps/sim/tools/video/minimax.ts`
  `apps/sim/tools/video/falai.ts`

## Practical next step

- Add a valid `COPILOT_API_KEY` to `apps/sim/.env`.
- Add at least one real image provider key and one real video provider key to `apps/sim/.env`.
- Restart the local app.
- Then test in the browser with a workflow in workspace `984aa29f-0821-4b86-92f6-752854e2f33e` and prompt the right-side agent to create a text-to-image-to-video workflow.
