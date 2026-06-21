# Image Outpaint Bugfix Goal

## Objective

Fix the image content-node outpaint flow in `D:\sim`.

Outpaint must always use the image currently displayed by the source node, must honor the selected outpaint ratio/frame parameters through the server and provider request, and must create result-node reference edges that match the existing `contentReferences` convention.

Do not modify generic React Flow connection behavior, reference dragging, `workflow.tsx`, or shared canvas connection handlers unless a focused failing test proves it is required.

## Primary Files

- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-image-outpaint-session.ts`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-outpaint-overlay.tsx`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-block.tsx`
- `apps/sim/app/api/media/images/outpaint/route.ts`
- `apps/sim/lib/generated-media/image/image-generation-service.ts`
- `apps/sim/lib/generated-media/image/providers.ts`
- `apps/sim/lib/uploads/contexts/workspace/workspace-file-manager.ts`
- `apps/sim/lib/uploads/utils/file-utils.ts`
- `apps/sim/lib/api/contracts/media-images.ts`
- `apps/sim/lib/workflows/content-references.ts` for reading/tests unless behavior change is proven necessary

## Required Investigation

Use `rg` and read the real call chain before editing:

- `useImageOutpaintSession`
- `/api/media/images/outpaint`
- `outpaintWorkspaceImage`
- `hydrateImageReferenceContext`
- `generateImageWithProvider`
- `resolveUserFileUrl`, `file.path`, `file.url`, `file.key`, `file.id`
- `createImageOutpaintVariantNode`
- `findMatchingContentReferenceEdgeIds`

## Required Fixes

### 1. Source Image Identity

Current likely root cause: UI displays `file.path` or `file.url`, but server hydration can prefer `file.id`. If dirty metadata has `id` pointing to image B while `path/key/url` points to image A, outpaint uses B.

Add a small server-side helper, for example:

`apps/sim/lib/generated-media/image/media-edit-files.ts`

Behavior:

- Input: `workspaceId` and `UserFileLike`.
- Prefer storage identity resolved from `file.key`, `file.path`, or `file.url`, because that is what the user sees.
- Reuse existing helpers such as `extractStorageKey` / internal URL parsing where appropriate.
- Resolved key must belong to the current workspace and workspace context.
- If both `id` and key exist but resolve to different workspace records, use the key/path record and log `logger.warn` using `createLogger` from `@sim/logger`.
- If only `id` exists, fall back to `getWorkspaceFile(workspaceId, id)` for legacy data.
- If only key/path/url exists, resolve by key. Add a small explicit helper such as `getWorkspaceFileByKey(workspaceId, key)` if needed; do not list all files.
- Return canonical `UserFileLike` with consistent `id`, `name`, `url`, `key`, `size`, `type`, `context`, and `base64`.
- Fetch base64 from the canonical workspace file record using `fetchWorkspaceFileBuffer`.
- Do not inline this parsing inside `outpaintWorkspaceImage`.

Use the helper in `outpaintWorkspaceImage`. If repaint/erase/cutout can share the helper with a small safe change, update them too; otherwise keep this bugfix focused on outpaint.

### 2. Client File Normalization

In `use-image-outpaint-session.ts`, make `normalizeFile` preserve the current display identity:

- `url` comes from `resolveUserFileUrl(file)`.
- `key` prefers `file.key`, but if missing and `url/path` is an internal file URL, derive the storage key from it.
- Do not disable outpaint for legacy data that lacks `file.key` when a valid internal `path/url` can provide it.
- Keep `requestJson(outpaintWorkspaceImageContract, ...)`.

### 3. Outpaint Aspect Ratio

Current likely bug: `targetAspectRatio/customAspectRatio` reach the route but `outpaintWorkspaceImage` ignores them and sends `aspectRatio: 'auto'`.

Add a pure function near the outpaint service, for example:

`resolveOutpaintAspectRatio({ targetAspectRatio, customAspectRatio, placement })`

Semantics:

- Fixed ratios return themselves: `1:1`, `4:3`, `3:4`, `16:9`, `9:16`, `21:9`.
- `custom` maps `customAspectRatio` to the nearest supported `ImageAspectRatioValue` unless the provider truly supports arbitrary ratios. Do not send unsupported arbitrary strings.
- `original` uses the final outpaint frame/canvas ratio represented by `placement.canvasWidth / placement.canvasHeight`, mapped to the nearest supported ratio.
- Do not default outpaint to `aspectRatio: 'auto'` unless there is an explicit tested fallback reason.

Pass the resolved ratio into `generateImageWithProvider`.

### 4. Provider Request Shape

Do not do a broad provider rewrite unless tests prove it is required.

For Gemini-compatible/Evolink, inspect `buildGeminiCompatibleImageRequestBody` and existing provider tests. Make the smallest safe correction so outpaint does not send invalid combinations such as `size: 'auto'` with `quality: '2K'` and `image_urls` when a concrete supported ratio is available.

Preserve existing stable-to-preview fallback behavior for `gemini-3-pro-image`.

### 5. Unique Guide Image Identity

`buildOutpaintGuideImages` must not use fixed guide names/keys like `outpaint-layout-guide.png` and `outpaint-mask-guide.png`.

- Use `generateShortId()` from `@sim/utils/id`.
- Example names: `outpaint-layout-guide-${requestId}.png` and `outpaint-mask-guide-${requestId}.png`.
- Keep base64 inline when possible.
- If provider upload occurs, use only the URL returned by that upload.

### 6. Result Edge Direction

In `createImageOutpaintVariantNode`:

- Keep `contentReferences` on the result node:

```ts
{ sourceBlockId: id, sourceVariant: 'image', role: 'image_reference' }
```

Here `id` is the original source image node.

- For normal image references, the edge must be result node -> source node. If `targetBlockId` is the new result node:

```ts
source: targetBlockId
target: id
```

- Compute source/target handles from node positions like `createReferencedContentNode` / `createExistingContentReference`; do not hardcode right/left.
- Ensure `findMatchingContentReferenceEdgeIds({ targetBlockId: resultBlockId, reference })` matches the created edge.
- Do not modify React Flow connect handlers, reference drag behavior, `workflow.tsx`, `content-references.ts` behavior, or `content-reference-edges.ts` behavior unless a focused test proves it is necessary.

## Tests

Add or update focused tests for:

1. File identity mismatch: `file.id` resolves to B, `file.key/path/url` resolves to A; media edit helper uses A and logs warn.
2. ID-only fallback still works for legacy data.
3. Outpaint `targetAspectRatio/customAspectRatio` reach `generateImageWithProvider` and are not always `auto`.
4. `original` and `custom` ratio mapping is deterministic.
5. Guide image names differ across consecutive outpaint guide builds.
6. `createImageOutpaintVariantNode` creates edge result -> source and `findMatchingContentReferenceEdgeIds` can match it.
7. Route still uses `outpaintWorkspaceImageContract` and `parseRequest`; no route-local Zod schemas.

## Validation

Run:

```powershell
bunx vitest run <changed test files>
bunx biome check <changed files>
bun run --cwd apps/sim type-check
```

If API contract boundary files, routes, or hooks changed, also run:

```powershell
bun run check:api-validation
```

## Repo Rules

- Use absolute imports.
- Use `createLogger` from `@sim/logger`; no `console.log`.
- Use `generateId()` / `generateShortId()` from `@sim/utils/id`; no `crypto.randomUUID`, `nanoid`, or `uuid`.
- Do not add route-local boundary Zod schemas.
- Use `bun` / `bunx`, not `npm` / `npx`.
- Keep scope tight and ignore unrelated dirty files.

## Final Delivery Requirements

Final response must state:

- How source image identity now avoids A/B cross-image generation.
- How outpaint ratio reaches service/provider.
- How guide names avoid fixed-name collisions.
- How outpaint edge direction matches `contentReferences`.
- Explicit confirmation that generic React Flow connect, reference drag, and workflow canvas connection logic were not changed.
- Exact validation commands run and results.
