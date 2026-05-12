# TapNow Prune Removal Summary

## Purpose

This document summarizes the integrations physically removed during the TapNow-oriented pruning work. It answers four questions:

1. Which integrations have already been removed
2. Which repo paths were deleted in each batch
3. Which references were intentionally preserved
4. How to reintroduce a removed integration later without rediscovering the same edges

## Removal Batches

| Batch | Commit | Integrations | Notes |
| --- | --- | --- | --- |
| 1A | `22ab4f24f` | `browser_use`, `crowdstrike`, `devin`, `dspy` | Early low-dependency physical removal batch |
| 2A | `f54e4040b` | `youtube` | Removed tool integration only; preserved media embed references |
| 2B | `42031b74e` | `stagehand` | Removed tools, API routes, contract, Next tracing include, dependency |
| 3 | `39d7d03ae` | `spotify` | Removed tools, block, OAuth wiring; preserved note-block embeds and CSP |
| 4 | `c25feeadd` | `wealthbox` | Removed tools, block, selectors, selector routes, OAuth wiring |

## Deleted Scope By Batch

### Batch 1A

Removed the following integration roots:

- `apps/sim/tools/browser_use/**`
- `apps/sim/tools/crowdstrike/**`
- `apps/sim/tools/devin/**`
- `apps/sim/tools/dspy/**`
- related block and registry wiring removed in the same batch

### Batch 2A: `youtube`

Deleted:

- `apps/sim/tools/youtube/**`
- `apps/sim/blocks/blocks/youtube.ts`
- `apps/sim/tools/registry.ts` youtube tool registrations
- `apps/sim/blocks/registry.ts` youtube block registration

Intentionally preserved:

- `apps/sim/app/academy/**` YouTube lesson playback
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-block.tsx` YouTube embed support
- `apps/sim/lib/core/security/csp.ts` YouTube iframe allowlist
- docs/blog references were left untouched

### Batch 2B: `stagehand`

Deleted:

- `apps/sim/tools/stagehand/**`
- `apps/sim/blocks/blocks/stagehand.ts`
- `apps/sim/app/api/tools/stagehand/**`
- `apps/sim/lib/api/contracts/tools/stagehand.ts`
- `apps/sim/tools/registry.ts` stagehand registrations
- `apps/sim/blocks/registry.ts` stagehand block registration
- `apps/sim/next.config.ts` stagehand tracing include
- `apps/sim/package.json` and `bun.lock` stagehand dependency

Intentionally preserved:

- docs/blog references were left untouched

### Batch 3: `spotify`

Deleted:

- `apps/sim/tools/spotify/**`
- `apps/sim/blocks/blocks/spotify.ts`
- `apps/sim/tools/registry.ts` spotify tool registrations
- `apps/sim/blocks/registry.ts` spotify block registration
- `apps/sim/lib/oauth/oauth.ts` spotify provider catalog entry
- `apps/sim/lib/oauth/types.ts` spotify provider union entries
- `apps/sim/lib/auth/auth.ts` spotify Better Auth provider registration
- `apps/sim/lib/oauth/*.test.ts` spotify provider test cases

Intentionally preserved:

- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-block.tsx` Spotify embed support
- `apps/sim/lib/core/security/csp.ts` `open.spotify.com` allowlist
- docs/blog references were left untouched

### Batch 4: `wealthbox`

Deleted:

- `apps/sim/tools/wealthbox/**`
- `apps/sim/blocks/blocks/wealthbox.ts`
- `apps/sim/hooks/selectors/providers/wealthbox/selectors.ts`
- `apps/sim/lib/api/contracts/selectors/wealthbox.ts`
- `apps/sim/app/api/tools/wealthbox/**`
- `apps/sim/app/api/auth/oauth/wealthbox/**`
- `apps/sim/tools/registry.ts` wealthbox tool registrations
- `apps/sim/blocks/registry.ts` wealthbox block registration
- `apps/sim/hooks/selectors/registry.ts` wealthbox selector registration
- `apps/sim/hooks/selectors/types.ts` wealthbox selector key
- `apps/sim/lib/oauth/oauth.ts` wealthbox provider catalog entry
- `apps/sim/lib/oauth/types.ts` wealthbox provider union entries
- `apps/sim/lib/auth/auth.ts` wealthbox Better Auth provider registration
- `apps/sim/app/(landing)/integrations/data/**` wealthbox landing entry

Intentionally preserved:

- docs/blog references were left untouched

## References Intentionally Kept

These are not deletion misses. They were deliberately kept to avoid mixing product-surface pruning with content cleanup:

- `apps/docs/**` removed integrations may still have docs pages and tool metadata
- `apps/sim/content/blog/**` historical posts may still mention removed integrations
- media embed support in note blocks and CSP was preserved for `youtube` and `spotify`

If you want the public docs surface to exactly match the pruned product surface, that should be a separate docs cleanup batch.

## Reintegration Guide

### Reintroducing a tools-only integration

Examples: `youtube`, `spotify`

Restore or recreate:

- `apps/sim/tools/<service>/**`
- `apps/sim/blocks/blocks/<service>.ts`
- `apps/sim/tools/registry.ts`
- `apps/sim/blocks/registry.ts`
- optionally landing metadata under `apps/sim/app/(landing)/integrations/data/**`

Also restore OAuth provider wiring if the integration uses connected accounts:

- `apps/sim/lib/oauth/oauth.ts`
- `apps/sim/lib/oauth/types.ts`
- `apps/sim/lib/auth/auth.ts`
- related provider tests

### Reintroducing a runtime-coupled integration

Example: `stagehand`

Restore everything from the tools-only checklist, plus:

- `apps/sim/app/api/tools/<service>/**`
- route contracts under `apps/sim/lib/api/contracts/**`
- runtime config such as `apps/sim/next.config.ts`
- package dependency in `apps/sim/package.json`
- lockfile updates in `bun.lock`

### Reintroducing a selector and OAuth-coupled integration

Example: `wealthbox`

Restore everything from the tools-only checklist, plus:

- selector contracts under `apps/sim/lib/api/contracts/selectors/**`
- selector provider files under `apps/sim/hooks/selectors/providers/**`
- selector registry/type entries
- `/api/tools/<service>/**` selector routes
- `/api/auth/oauth/<service>/**` selector routes
- OAuth provider wiring in `lib/oauth` and `lib/auth`

## Operational Rule

For future pruning work, keep using the same rule set:

- remove one service family per commit
- keep the working tree clean between batches
- preserve intentionally out-of-scope references explicitly in docs
- use Git history as the archive instead of moving dead integrations into a holding folder
