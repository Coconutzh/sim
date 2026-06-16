# 图片扩图位置、比例切换和异步生成修复方案

## 背景

当前图片内容节点的扩图功能有三个用户可见问题：

1. 扩图框内源图的位置没有被稳定保留。比如源图在扩图框左下角时，生成结果仍可能把源图放回正中。
2. 预设比例切换会累积放大。先选 `9:16`，再切换到其他比例，扩图框会越来越大。
3. 点击扩图后，如果点击画布其他位置，生成会被打断。期望行为是立即创建一个新图片节点，新节点和源节点出现引用线，新节点显示加载动画，后台生成不受画布其他操作影响。

## 相关文件

- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-block.tsx`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-outpaint-overlay.tsx`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-image-outpaint-session.ts`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-edit-geometry.ts`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-edit-geometry.test.ts`
- `apps/sim/lib/api/contracts/media-images.ts`
- `apps/sim/app/api/media/images/outpaint/route.ts`
- `apps/sim/lib/generated-media/image/image-generation-service.ts`
- `apps/sim/lib/generated-media/image/image-generation-service.test.ts`

## 根因分析

### 1. 扩图位置没有被稳定保留

前端当前会通过 `getPlacementFromFrame({ frame, subject })` 提交：

- `x`
- `y`
- `width`
- `height`
- `canvasWidth`
- `canvasHeight`

后端 `buildOutpaintGuideImages(...)` 也确实用这些 placement 值生成 layout guide 和 mask guide。

问题在于 `outpaintWorkspaceImage(...)` 最终只是把 `sourceImage`、`layoutGuide`、`maskGuide` 作为普通参考图传给 `generateImageWithProvider(...)`。这不是确定性的编辑/mask 约束，而是依赖模型理解参考图和文字提示。模型可能遵守目标比例，但忽略 layout 中源图的具体位置，把源图重新居中。

结论：placement 进入了请求，但没有被服务端以确定性方式强制落实。

### 2. 预设比例切换会累积放大

`fitFrameToAspectRatio(...)` 当前用现有 frame 作为下一次计算的最小尺寸：

```ts
let width = Math.max(frame.width, minWidth)
let height = Math.max(frame.height, minHeight)
```

这意味着比例切换只会扩张，不会回缩。选择 `9:16` 后高度被撑大，再切回横向比例时宽度又基于这个高度继续扩大，导致多次切换后扩图框越来越大。

结论：预设比例切换不应该复用已经被上一个预设比例放大的 frame 作为不可收缩基准。

### 3. 点击画布会中断生成

当前请求生命周期绑定在 `ImageOutpaintOverlay` 内部的 `useImageOutpaintSession(...)` 上。这个 hook 在组件卸载时通过 cleanup 调用 `abort()`。

同时 `ContentBlock` 有逻辑：当当前节点不再 selected，或者不满足图片编辑条件时，会关闭 `isImageOutpaintMode`。用户点击画布其他位置后，源节点取消选中，overlay 卸载，请求被 abort。

结论：扩图生成生命周期不应该绑定到临时 overlay UI 生命周期。

## 设计原则

1. 不新增平行状态系统。复用 `ContentBlock` 里现有 derived-node 创建、`contentReferences`、`generationStatus`、`generationError` 和 collaborative mutation 路径。
2. `ImageOutpaintOverlay` 只负责编辑和提交用户 intent，不负责长期持有生成请求。
3. 生成任务应该属于目标结果节点，而不是属于源节点上的临时 overlay。
4. 服务端必须使用 placement 做确定性几何约束，不能完全依赖模型理解 prompt。
5. 不改通用 React Flow 连接、拖拽引用、canvas 连接逻辑，除非有聚焦测试证明必须改。
6. API route 继续使用 `outpaintWorkspaceImageContract` 和 `parseRequest`，不引入 route-local Zod。
7. 使用 `generateId()` / `generateShortId()`，不使用 `crypto.randomUUID()`、`nanoid` 或 `uuid`。

## 修改方案

### 阶段 1：修复比例切换几何

在 `image-edit-geometry.ts` 中新增或调整纯函数，区分两种行为：

- 手动拖拽/缩放：继续使用 `resizeFrameToContainSubject(...)`，保持拖拽方向和锚点语义。
- 预设比例切换：使用稳定基准计算 frame，不让上一个预设比例的膨胀结果继续作为不可收缩下限。

建议实现方式：

1. 在 `ImageOutpaintOverlay` 中维护一个 `manualFrameRef` 或等价状态。
2. 用户移动或手动 resize 后，更新该基准。
3. 切换预设比例时，用该基准和 subject bounds 重新计算目标 frame。
4. 新 frame 只需要满足：
   - 包含 subject；
   - 符合目标 ratio；
   - 尽量保留用户原本选择的中心或相对 padding；
   - 不因连续切换比例而单调膨胀。

测试要求：

- `9:16 -> 16:9 -> 1:1 -> 4:3` 不持续变大。
- 切换后的 frame 始终包含 subject。
- 手动 resize 的锚点语义不退化。

### 阶段 2：提交扩图时立即创建 pending 结果节点

把扩图提交从“overlay 内请求，成功后创建节点”改为“先创建节点，再后台请求”。

在 `content-block.tsx` 中新增或改造 outpaint orchestration：

1. 用户点击提交后，从 overlay 收集：
   - source file
   - placement
   - resolution
   - targetAspectRatio
   - customAspectRatio
   - prompt
2. 立即创建新的 image content block：
   - `contentVariant: 'image'`
   - `file: null`
   - `aiPrompt: ''`
   - `aiModel: DEFAULT_IMAGE_REPAINT_MODEL`
   - `aiAspectRatio: mapOutpaintAspectRatioToImageAspectRatio(targetAspectRatio)`
   - `contentReferences: [{ sourceBlockId: sourceId, sourceVariant: 'image', role: 'image_reference' }]`
   - `generationKind: 'image_outpaint'`
   - `generationStatus: 'pending'`
   - `generationError: null`
   - 可选保存 outpaint 请求上下文，用于失败后重试
3. 创建源节点和新节点之间的引用 edge，方向和现有 `contentReferences` 匹配。
4. 调用 `collaborativeBatchAddBlocks(...)`。
5. 关闭 outpaint mode，但不要 abort 生成。
6. 后台调用 `requestJson(outpaintWorkspaceImageContract, ...)`。
7. 成功后：
   - `collaborativeSetSubblockValue(targetBlockId, 'file', uploadedFile)`
   - `collaborativeSetSubblockValue(targetBlockId, 'generationStatus', 'complete')`
   - 清空 `generationError`
8. 失败后：
   - `generationStatus: 'error'`
   - `generationError: message`
   - `file: null`

UI 显示：

- `ContentContentCard` 当前已有 cutout、video frame capture、video enhance 的 pending/error 展示模式。新增 `generationKind === 'image_outpaint'` 的 pending/error 分支即可。
- pending 文案可以是 `扩图中...`。
- error 文案可以是 `扩图失败，请重试。`

### 阶段 3：移除 overlay 请求生命周期耦合

`use-image-outpaint-session.ts` 当前职责过重。建议改成以下之一：

方案 A：保留文件，缩小为工具函数文件。

- 保留 `normalizeImageOutpaintFile(...)`。
- 移除 `useImageOutpaintSession(...)` 的请求、abort、isSubmitting 状态。
- `ImageOutpaintOverlay` 通过 props 调 `onSubmitOutpaint(params)`。

方案 B：如果保留 hook，则只能作为 overlay UI 状态辅助，不能在 cleanup 中 abort 请求。

推荐方案 A，边界更清楚。

### 阶段 4：服务端用 placement 做确定性几何约束

在 `image-generation-service.ts` 中调整 outpaint 流程。

当前流程：

1. 解析 source image。
2. 生成 layout guide 和 mask guide。
3. 将 source/layout/mask 作为参考图传给 provider。
4. 上传 provider 原始结果。

建议流程：

1. 解析 source image。
2. 根据 placement 和 resolution 生成 guide size 和 source region。
3. 生成 layout guide 和 mask guide。
4. 调 provider 时保留当前模型策略：`DEFAULT_IMAGE_REPAINT_MODEL`，服务端拥有模型选择。
5. prompt 增加归一化 placement 描述，例如：
   - original image region left/top/width/height as percentages of target canvas
   - preserve original image region at this exact region
6. provider 返回后，用 `sharp` 做确定性后处理：
   - 将生成结果 resize/crop 到 guide canvas 尺寸；
   - 将原 source image 按 `sourceRegion` resize 后 composite 回结果图的同一位置；
   - 上传 composite 后的最终图。

这样即使模型生成时把源图位置理解错，最终用户看到的源图区域仍会出现在扩图框指定位置。该方案不硬编码具体比例或位置，只使用用户提交的 placement。

注意：

- 仍然不能保证扩展区域的语义完美，但能保证源图区域位置不会漂移。
- 如果 provider 有真正 mask/edit API，可后续再接入；本次应优先做最小可验证修复。

### 阶段 5：补充测试

建议添加或更新：

1. `image-edit-geometry.test.ts`
   - 预设比例切换不累积放大。
   - 切换后 frame 包含 subject。
   - 手动 resize 锚点行为保持。

2. `image-generation-service.test.ts`
   - placement 位于左下角时，最终上传 buffer 中源图区域被 composite 到左下角。
   - `outpaintWorkspaceImage(...)` 仍使用 `DEFAULT_IMAGE_REPAINT_MODEL`。
   - `targetAspectRatio/customAspectRatio/original` 的 aspect ratio 解析保持已有行为。
   - guide 文件名仍唯一。

3. `content-block` 相关 focused 测试或可抽出的 orchestration 测试
   - 点击提交后立即创建 pending 结果节点。
   - 结果节点有 `generationKind: 'image_outpaint'` 和 `generationStatus: 'pending'`。
   - overlay 关闭或源节点取消选中不会 abort 请求。
   - 成功后只更新目标节点 file/status。
   - 失败后只更新目标节点 status/error。

4. API boundary 检查
   - route 继续使用 `outpaintWorkspaceImageContract` 和 `parseRequest`。
   - 不新增 route-local boundary Zod schema。

## 验证命令

根据实际改动运行：

```powershell
bunx vitest run apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-edit-geometry.test.ts
bunx vitest run apps/sim/lib/generated-media/image/image-generation-service.test.ts
bunx vitest run apps/sim/lib/api/contracts/media-images.test.ts apps/sim/app/api/media/images/outpaint/route.test.ts
bunx biome check <changed files>
bun run --cwd apps/sim type-check
```

如果改动了 API contract、route 或 hooks，再运行：

```powershell
bun run check:api-validation
```

## Goal 模式提示词

```text
你是一个资深软件工程师，在 D:\sim 仓库中修复图片内容节点的扩图 outpaint 功能。请先阅读 docs/image-outpaint-placement-async-bugfix-plan-zh.md，然后按真实代码链路实施，不要基于猜测改。

目标：
1. 扩图必须稳定尊重用户在扩图框中选择的源图位置。比如源图位于扩图框左下角，最终结果中的源图区域也必须位于左下角。
2. 扩图框预设比例切换不能累积放大。先选 9:16，再选 16:9、1:1、4:3，不应该因为继承上一比例的长边而越来越大。
3. 点击扩图提交后，立即创建一个新的图片结果节点，新节点与源节点出现引用线，新节点显示加载动画。后台生成不应因为用户点击画布其他位置、源节点取消选中、overlay 卸载而中断。

必须先做的调查：
- 用 rg/read 追踪这些文件和调用链：
  - apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-block.tsx
  - apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-outpaint-overlay.tsx
  - apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-image-outpaint-session.ts
  - apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-edit-geometry.ts
  - apps/sim/lib/api/contracts/media-images.ts
  - apps/sim/app/api/media/images/outpaint/route.ts
  - apps/sim/lib/generated-media/image/image-generation-service.ts
- 对比现有 cutout、video_frame_capture、video_enhance 的 pending 节点和 generationStatus 模式，复用现有路径，不新建平行状态系统。

实现要求：
1. 调整比例切换几何：
   - 手动 resize 继续使用现有 resizeFrameToContainSubject 语义。
   - 预设比例切换使用稳定基准 frame 重新计算，不让上一次预设比例撑大的 frame 成为不可收缩下限。
   - 保证 frame 始终包含 subject。

2. 重构 outpaint 提交流程：
   - ImageOutpaintOverlay 只负责编辑 frame 和提交参数。
   - 不要让 overlay hook 持有长期请求并在卸载时 abort。
   - 在 ContentBlock 中点击提交后立即创建结果 image content node。
   - 结果节点写入 file: null、generationKind: 'image_outpaint'、generationStatus: 'pending'、generationError: null、contentReferences。
   - 创建源节点和结果节点之间的引用 edge，方向必须与 contentReferences 匹配。
   - 关闭 outpaint mode 不能中断后台生成。
   - 后台 requestJson(outpaintWorkspaceImageContract, ...) 成功后只更新目标结果节点 file/status；失败后只更新目标结果节点 status/error。

3. 修复服务端 placement 约束：
   - 保留 outpaintWorkspaceImageContract、parseRequest 和服务端模型所有权。
   - buildOutpaintGuideImages 继续基于 placement 生成 layout/mask guide。
   - provider prompt 增加 placement 的归一化描述，但不要硬编码某个比例或位置。
   - provider 返回后用 sharp 做确定性后处理：将生成结果规范到目标 canvas 尺寸，再把源图按 placement/sourceRegion 精确 composite 回最终图。
   - 上传 composite 后的最终图，确保源图区域不会漂移到中心。

约束：
- 不允许过耦合，不允许硬编码具体比例、具体位置或具体节点 id。
- 不改通用 React Flow 连接行为、workflow.tsx、reference drag 行为，除非有聚焦 failing test 证明必须改。
- 不新增 route-local boundary Zod schema；API route 继续使用 contract + parseRequest。
- 使用 absolute imports。
- 使用 createLogger from @sim/logger；不要 console.log。
- 使用 generateId()/generateShortId() from @sim/utils/id；不要 crypto.randomUUID/nanoid/uuid。
- 使用 bun/bunx，不使用 npm/npx。
- 保持 scope tight，不要重构无关文件，不要回滚用户未要求的改动。

测试要求：
- 更新或新增 image-edit-geometry.test.ts，覆盖 9:16 -> 16:9 -> 1:1 -> 4:3 不累积放大，并始终包含 subject。
- 更新 image-generation-service.test.ts，覆盖 placement 在非中心区域时最终上传图会把源图 composite 到对应区域。
- 覆盖 outpaint pending 结果节点创建、成功更新目标节点、失败写入 generationError、overlay 卸载不 abort 的行为。优先抽出可测试的小函数，避免把 content-block.tsx 测试做得过重。
- 保留或补充 route/contract 测试，确认 outpaint route 没有 route-local Zod。

验证：
- 至少运行相关 vitest：
  - bunx vitest run apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-edit-geometry.test.ts
  - bunx vitest run apps/sim/lib/generated-media/image/image-generation-service.test.ts
  - 以及你新增/修改的 focused tests
- 运行 bunx biome check <changed files>
- 运行 bun run --cwd apps/sim type-check
- 如果改了 API contract、route 或 hook，运行 bun run check:api-validation

最终回复必须说明：
- 修改了哪些文件。
- 三个用户问题分别如何解决。
- 哪些验证命令实际运行了，结果如何。
- 如果有未跑的验证或残余风险，明确写出。
```
