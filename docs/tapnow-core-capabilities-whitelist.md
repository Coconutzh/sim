# TapNow Core Capabilities Whitelist

## Goal

This document defines the retained capability whitelist for the TapNow-oriented rebuild of this repository.

The purpose is not to keep the current "everything platform" shape. The purpose is to keep only the layers that directly support:

- fast canvas authoring
- AI-assisted workflow building and editing
- real-time collaboration
- runnable and debuggable agent workflows
- a small number of general-purpose integrations

Anything outside this whitelist should be treated as a candidate for hiding, postponing, or physical removal.

## P0: Must Keep

### 1. Canvas Core

This is the product center and should remain intact.

Key code:

- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/workflow.tsx`
- `apps/sim/hooks/use-collaborative-workflow.ts`
- `apps/sim/stores/workflows/workflow/store.ts`
- `apps/sim/stores/workflows/registry/store.ts`
- `apps/sim/app/api/workflows/[id]/route.ts`
- `apps/sim/app/api/workflows/[id]/state/route.ts`

Recommended retained core block types:

- `start_trigger`
- `agent`
- `api`
- `function`
- `condition`
- `router`
- `response`
- `loop`
- `parallel`
- `variables`
- `note`
- `webhook_request`
- `generic_webhook`
- `chat_trigger`

### 2. Agent Core

This is the main "AI node on the canvas" capability and should remain intact.

Key code:

- `apps/sim/blocks/blocks/agent.ts`
- `apps/sim/executor/handlers/agent/agent-handler.ts`
- `apps/sim/executor/handlers/registry.ts`
- `apps/sim/providers/**`

Retained product responsibilities:

- model selection
- reasoning / verbosity controls
- tool-enabled execution
- structured output
- memory and context wiring

### 3. Workflow Execution and Debugging

TapNow-style editing is incomplete without fast run-and-debug loops.

Key code:

- `apps/sim/app/api/workflows/[id]/execute/route.ts`
- `apps/sim/lib/workflows/executor/execute-workflow.ts`
- `apps/sim/background/workflow-execution.ts`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution.ts`

Retained product responsibilities:

- manual execution
- async execution
- SSE/log streaming
- block-level execution status
- cancel and resume flows where already supported

### 4. Copilot and AI Workflow Editing

This is one of the most important retained differentiators.

Key code:

- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/panel/panel.tsx`
- `apps/sim/app/api/mothership/chat/route.ts`
- `apps/sim/app/api/v1/copilot/chat/route.ts`
- `apps/sim/lib/copilot/tools/handlers/workflow/mutations.ts`
- `apps/sim/app/api/workflows/[id]/autolayout/route.ts`

Retained product responsibilities:

- natural-language workflow editing
- diff-based workflow mutation review
- AI-assisted node creation and rewiring
- auto-layout after graph edits

### 5. Realtime Collaboration

If multi-user editing remains part of the product direction, this layer should stay whole.

Key code:

- `apps/sim/app/workspace/providers/socket-provider.tsx`
- `apps/realtime/src/index.ts`
- `apps/realtime/src/middleware/auth.ts`
- `apps/realtime/src/handlers/workflow.ts`
- `apps/realtime/src/handlers/operations.ts`
- `apps/realtime/src/handlers/subblocks.ts`
- `apps/realtime/src/handlers/variables.ts`
- `apps/realtime/src/handlers/presence.ts`
- `apps/realtime/src/routes/http.ts`
- `packages/realtime-protocol/**`

Retained product responsibilities:

- join/leave workflow rooms
- operation broadcast
- cursor and selection presence
- collaborative subblock and variable editing
- workflow deploy/update/delete callbacks from `apps/sim`

### 6. Knowledge and Files

These should stay because they directly support agent usefulness and workflow inputs.

Key code:

- `apps/sim/app/api/knowledge/**`
- `apps/sim/lib/knowledge/service/**`
- `apps/sim/connectors/registry.ts`
- `apps/sim/app/api/files/**`
- `apps/sim/app/api/files/upload/route.ts`
- `apps/sim/lib/uploads/**`

Retained product responsibilities:

- knowledge base CRUD
- document ingest and search
- file upload and retrieval
- file use inside agent and workflow runs

### 7. Webhook and Schedule Ingress

These are the smallest useful automation entrypoints and should stay.

Key code:

- `apps/sim/app/api/webhooks/**`
- `apps/sim/app/api/webhooks/trigger/[path]/route.ts`
- `apps/sim/lib/webhooks/processor/**`
- `apps/sim/app/api/schedules/**`
- `apps/sim/triggers/registry.ts`

Retained product responsibilities:

- external trigger entry
- deployable webhook workflows
- scheduled workflow runs

## P1: Small Curated Integration Set

Only keep general-purpose integrations that strengthen the core product loop. Do not keep a long-tail marketplace.

Recommended retained categories:

- generic HTTP/API calling
- search
- file parsing and file writing
- MCP
- a very small number of collaboration/productivity integrations when there is a clear product use case

Recommended retained integration families:

- `http_request`
- `search_tool`
- `file_parser`
- `file_parser_v2`
- `file_parser_v3`
- `file_append`
- `file_write`
- `mcp`
- optionally `slack`
- optionally `gmail`
- optionally `notion`

Rule:

- if an integration is not needed for the main demo path, it should not be in the first retained set

## Not In Whitelist

The following categories should not expand during the TapNow-oriented rebuild:

- long-tail CRM integrations
- long-tail HR / ATS integrations
- long-tail ads / analytics integrations
- media tool integrations that are not part of the core creation loop
- vertical agent products such as `agentmail` and `agentphone`
- browser automation families unless they become central to the product direction again
- broad public-platform surfaces that do not improve the canvas editing loop

Already removed examples include:

- `youtube` tool integration
- `spotify`
- `stagehand`
- `wealthbox`
- `browser_use`
- `crowdstrike`
- `devin`
- `dspy`

## Reintegration Rule

A removed service should only be reintroduced if it passes all of the following:

1. It improves the core path of build -> edit -> run -> debug -> collaborate.
2. It is general-purpose enough to matter to many workflows, not one narrow vertical.
3. It does not add disproportionate OAuth, selector, webhook, or product-surface complexity.
4. It has a clear owner in `tools`, `blocks`, optional `triggers`, and API/auth wiring.

If a service fails any of these checks, keep it out of the retained set.

## Operational Rule

Use this whitelist as the decision source for future pruning work:

- keep P0 intact
- keep P1 small
- remove one service family per commit
- document intentional preserved references
- use Git history as the archive, not a dead-code holding folder
