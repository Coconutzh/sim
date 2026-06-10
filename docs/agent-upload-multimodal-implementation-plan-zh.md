# Agent 上传附件多模态读取实现方案

## 背景

目标是在不影响任何现有功能的前提下，让右侧 workflow Copilot / local canvas agent 能读取用户本轮上传的图片和 PDF 内容。图片应通过模型多模态能力读取；PDF 必须先渲染为页面图片，再作为视觉输入交给模型。

现有实现已经具备部分基础能力：

- 右侧 Copilot 上传走 workspace file，附件带有 `workspaceFileId` 和 `storageContext: 'workspace'`。
- `buildCopilotRequestPayload` 会把附件转换成可读提示，例如 `read("files/by-id/...")`。
- VFS 读取图片时可返回 base64 image attachment。
- local canvas agent 的 `media.analyze_node_media` 已能读取画布图片节点，并用 Google 多模态模型分析图片 bytes。
- PDF 目前主要通过 `unpdf` 抽取文本，没有渲染为页面图片。

差距是：用户上传附件没有被统一预处理成多模态 message parts，也没有 PDF 页面渲染链路。

## 必读代码路径

先阅读这些文件，按现有结构实现，不要重构无关代码：

- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments.ts`
- `apps/sim/app/workspace/[workspaceId]/home/components/user-input/user-input.tsx`
- `apps/sim/lib/copilot/chat/payload.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/context-manager.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/context-tools.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/media-tools.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/models/config.ts`
- `apps/sim/providers/types.ts`
- `apps/sim/providers/google/utils.ts`
- `apps/sim/lib/copilot/vfs/file-reader.ts`
- `apps/sim/lib/file-parsers/pdf-parser.ts`

## 实现边界

必须保留现有能力：

- `read_file` 仍可读取文本解析结果。
- VFS、workspace file、mothership upload fallback 不被删除。
- PDF 文本抽取可作为 fallback，但不能作为本需求的主路径。
- 如果当前 provider 不支持 image parts，必须降级到文本/VFS，不得声称看过图片或 PDF 页面。

## 新增模块

新增 server-only helper：

`apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/attachment-vision.ts`

建议导出：

```ts
export interface AttachmentVisionBundle {
  contexts: LocalAgentAttachedContext[]
  limitations: string[]
  analyzedFileCount: number
  analyzedImageCount: number
}

export async function analyzeAttachmentVision(params: {
  context: LocalAgentContext
  question: string
  fileName?: string
  maxFiles?: number
  maxPdfPages?: number
}): Promise<AttachmentVisionBundle>
```

职责：

- 从 `context.attachments` 中筛选 `storageContext === 'workspace'` 且有 `id` 的附件。
- 支持图片：`image/jpeg`、`image/png`、`image/webp`、`image/gif` 等 provider 可接受格式。
- 支持 PDF：`application/pdf` 或 `.pdf`。
- 控制预算：默认最多 3 个文件，每个 PDF 默认最多 3 页。
- 读取失败、渲染失败、模型不支持、超预算时返回 limitations，不抛出阻断整个 agent。

## 图片处理

图片附件处理规则：

- 读取 workspace file bytes。
- 复用或抽取 `apps/sim/lib/copilot/vfs/file-reader.ts` 中的图片检测、resize、compress 逻辑，避免复制大块逻辑。
- 最长边控制在 1568 左右。
- 单张压缩后不超过 5MB。
- 生成 provider message parts：

```ts
[
  { type: 'text', text: 'Uploaded image "<name>" rendered for visual analysis.' },
  { type: 'image', mimeType, data: base64 }
]
```

## PDF 渲染

PDF 附件处理规则：

- 不要只使用 `unpdf` 文本抽取。
- 新增 PDF page render helper，例如：

`apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/pdf-renderer.ts`

建议 API：

```ts
export async function renderPdfPagesToImages(params: {
  buffer: Buffer
  maxPages: number
  maxDimension: number
  maxBytesPerPage: number
}): Promise<Array<{ pageNumber: number; mimeType: 'image/png' | 'image/jpeg'; data: string }>>
```

依赖选择：

- 先检查 `package.json` 是否已有可用 PDF 渲染依赖。
- 如没有，添加最小 server-only 依赖，优先选择 `pdfjs-dist` + `@napi-rs/canvas`，或仓库里已可用的等价方案。
- 更新 lockfile。

渲染规则：

- 默认只渲染前 3 页。
- 每页渲染为 PNG/JPEG，再压缩到预算内。
- 每页 image part 前加文本 part：

```ts
{ type: 'text', text: 'PDF "<name>" page 1 rendered image.' }
```

- 如果 PDF 页数超过预算，在 vision summary 中说明只分析了前 N 页。
- 渲染失败时 `logger.warn`，fallback 到现有文本解析，不阻断请求。

## 模型能力判断

当前 `ProviderRequest['messages']` 已支持：

```ts
parts?: Array<
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string }
>
```

Google provider 已能把 image part 转换为 Gemini `inlineData`。

local canvas agent 中只在以下情况启用视觉输入：

- `context.model.provider === 'google'`
- 或 `getProviderFromModel(context.model.model) === 'google'`

其它 provider：

- 不调用多模态分析。
- 返回 limitation：当前模型不支持附件视觉读取。
- 继续使用现有文本/VFS fallback。

## 接入 read_file

修改：

`apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/context-tools.ts`

在 `readFileContext` 中：

1. 保留现有 `fileContexts` 和 `readWorkspaceAttachmentContext` 行为。
2. 当命中附件且附件是图片或 PDF 时，调用 `analyzeAttachmentVision(...)`。
3. 把返回的视觉摘要追加到 `output.contexts`：

```ts
{
  type: 'file_vision',
  tag: '@<filename>',
  content: '<model visual summary and limitations>'
}
```

4. `summary` 应区分文本读取和视觉读取，例如：

`Read 1 attached file context(s), including visual analysis`

5. 视觉分析失败时不要让 `read_file` 失败，除非文本/VFS 也完全找不到匹配文件。

## 模型调用

在 `attachment-vision.ts` 中通过现有函数调用模型：

```ts
await executeLocalAgentModelRequest(context.model, {
  role: 'decision',
  workspaceId: context.workspaceId,
  systemPrompt: buildLocalAgentRoleSystemPrompt({
    context,
    role: 'decision',
    roleInstruction:
      'Analyze uploaded image/PDF page images for a local canvas agent. Return concise factual observations only. Do not expose storage paths, keys, file ids, workspace ids, or internal identifiers.',
  }),
  prompt: question,
  temperature: 0,
  maxTokens: 2000,
  messages: [
    {
      role: 'user',
      content: null,
      parts,
    },
  ],
  abortSignal: context.options.abortSignal,
})
```

Prompt 要求：

- 中文输出。
- 只描述图片或 PDF 页面中能看到的事实。
- 不暴露 storage key、workspaceId、workflowId、fileId。
- 如果只分析了部分页数或部分文件，明确说明。
- 如果渲染/读取失败，说明限制，不编造内容。

## 安全与日志

- 使用 `createLogger` from `@sim/logger`。
- 不使用 `console.log`。
- 不在用户可见内容里输出 key/path/id。
- logger 可记录 file name、mime type、页数、耗时、错误 message，但避免记录 base64。
- 所有失败都应是 warn + fallback，避免阻断主 agent 流程。

## 测试要求

至少新增或更新 Vitest：

1. 图片 workspace attachment 被 `read_file` 命中时，会调用 `executeLocalAgentModelRequest`，并传入 image part。
2. PDF workspace attachment 被 `read_file` 命中时，会调用 PDF render helper，生成多个 image parts，并传给模型。
3. 非 Google provider 不调用多模态模型，只返回现有文本/VFS fallback 和 limitation。
4. PDF 渲染失败不阻断 `read_file`。
5. 超过页数或文件数预算时，返回 limitations。
6. 用户可见的 vision summary 不包含 workspace id、storage key、file id。

优先测试文件：

- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/context-tools.test.ts`
- 新增 `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/attachment-vision.test.ts`
- 如拆 PDF renderer，新增 `pdf-renderer.test.ts`

## 验证命令

优先运行：

```bash
bun test apps/sim/lib/copilot/request/lifecycle/local-canvas-agent
bun run check:api-validation
```

如果 `bun` 不在 PATH，Windows 上先尝试：

```powershell
C:\Users\saasd\.bun\bin\bun.exe test apps/sim/lib/copilot/request/lifecycle/local-canvas-agent
C:\Users\saasd\.bun\bin\bun.exe run check:api-validation
```

最终回复必须说明实际运行了哪些命令，以及是否通过。

## 不要做的事

- 不要把 PDF 继续当纯文本处理来完成本需求。
- 不要删除现有 `read_file`、VFS、workspace file 或文本解析路径。
- 不要新增 route-local Zod schema。
- 不要重构无关 provider、UI 或上传系统。
- 不要让非视觉模型假装看过图片或 PDF。
- 不要暴露内部路径、storage key、workspace id、workflow id、file id。

## Codex Goal 短提示

如果交互框有 4000 字限制，不要粘贴完整方案。直接粘贴下面短提示：

```text
请进入 Goal 模式。

目标：按照 docs/agent-upload-multimodal-implementation-plan-zh.md 实现右侧 workflow Copilot / local canvas agent 的上传附件多模态读取能力：图片直接作为视觉输入，PDF 先渲染为页面图片再作为视觉输入；保留现有 read_file/VFS/文本解析 fallback，不影响现有功能。

执行要求：
1. 先阅读文档中的“必读代码路径”和 AGENTS.md。
2. 按文档实现，保持改动集中。
3. 新增必要测试。
4. 运行文档中的验证命令。
5. 最终汇报改动文件、实际运行命令、测试结果、任何未解决限制。
```

如果 Codex 支持显式 goal 指令，也可以用更短版本：

```text
Goal: Implement docs/agent-upload-multimodal-implementation-plan-zh.md end to end. Preserve existing behavior, add tests, run validation, and report results.
```
