# Local Canvas Agent 模型驱动方案完成度审计

日期：2026-06-09

工作区：`E:\project\sim`

审计对象：

- 方案文档：`docs/local-canvas-agent-model-driven-tool-loop-plan-zh.md`
- 代码路径：`apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/`
- 当前分支：`fix/low-memory-canvas-interactions`
- 当前代码侧基准：本文件创建前的 HEAD 为 `43f3412b6 feat: validate local canvas tool outputs`

本文用于防止把“已有实现”误判为“完整方案已结束”。结论按当前 checkout 和已跑验证整理；没有当前证据的项目不视为完成。

## 1. 总体结论

Local Canvas Agent 已经从旧的规则 planner 主路径，推进到模型驱动工具循环主路径：

- 默认 runtime mode 已是 `model_tool_loop`。
- 模型每轮输出 `AgentDecision`。
- runtime 负责工具 schema、权限、读写策略、并发安全、destructive guard、apply 后 verify。
- 内容链和选中节点修改已有模型 patch 主路径测试。
- 媒体分析已具备 prompt / metadata / stored context 的能力边界，并新增 image 节点二进制读取 + 视觉模型分析路径；没有真实分析证据时仍不会假装看过文件。
- 旧 planner 仍保留为 `legacy` 和显式 `hybrid` fallback，而不是默认主路径。

当前仍不建议标记完整目标完成：

- 默认 `model_tool_loop` 的最小 API/SSE + Browser 内容链回归已在 2026-06-09 重跑通过，但 selected-node、manual Confirm/Revise、真实 provider、abort 等更宽覆盖仍主要来自 2026-06-08 证据；若要求“全部当前 commit 重新证明”，还需要继续重跑这些 smoke。
- `media.analyze_node_media` 已能在 image 节点有 storage key/url 且当前模型 provider 支持图片 message parts 时读取图片 bytes 并调用多模态模型；video/audio 仍只基于 prompt、safe metadata、stored media context。
- Tool result `outputRef` 已从 prompt 内稳定引用推进到当前 thread 下的持久化 `ToolResultRef` / storageKey；下一轮 prompt 会看到 ref 摘要和 preview，可按 ref 回读完整私有输出。
- Canvas summary cache 已落到 workflow hash 派生缓存，不放进 chat memory；画布变化后 hash 变更自然失效。
- 旧 planner 仍在代码中作为显式 legacy/hybrid 路径存在，需要继续保留或后续逐步下线。

## 2. 阶段 1-9 完成度

| 阶段 | 方案目标 | 当前状态 | 证据 | 缺口 |
| --- | --- | --- | --- | --- |
| 1. 隔离和 Thread Memory | 新聊天不继承旧聊天；当前 chat 内保存摘要、问题、观察 | 代码侧完成 | `memory.ts` 使用 `local-canvas-agent:v2:thread:{userId}:{workspaceId}:{workflowId}:{agentCode}:{chatId}`；`canPersistLocalAgentThreadMemory()` 要求 `chatId`；`runtime-foundation.test.ts` 覆盖 user/workspace/workflow/agent/chat 隔离、无 chat 不持久化、ToolResultRef scope 和 canvas summary cache hash key | User Preference Memory 仍后置，避免新聊天被旧聊天污染 |
| 2. 工种 Skill 基础版 | 不同工种加载不同 skill；team override 生效；不暴露内部 persona | 代码侧基本完成 | `skills.ts` 按 organization、agentCode、teamWorkspaceId 查询；`mergeAgentSkillRows()` 合并 template 与 team override；`context-manager.ts` 注入 `Enabled Skills` 并裁剪；`runtime-foundation.test.ts` 覆盖 skill merge；`actor.test.ts` 覆盖不 role-play fallback persona | 还没有按 skill 限定不同工具组；方案也把它列为后续 |
| 3. Tool Descriptor | 工具 schema、读写、破坏性、并发、summarizer 结构化 | 完成并增强 | `tool-descriptor.ts` 定义 `LocalAgentToolDescriptor`、`inputSchema`、`outputSchema`、`isReadOnly`、`isDestructive`、`isConcurrencySafe`；canvas read/search/inspect 与 media tool 有具体 `outputSchema`；`tool-executor-bridge.ts` 校验 input/output；`tool-executor-bridge.test.ts` 覆盖 output schema 失败转失败结果 | 写入/生成类动态输出后续可继续补齐 outputSchema |
| 4. AgentDecision Prompt | 模型每轮返回下一步 decision；parser 和 prompt layer | 完成 | `decision.ts` 支持 `tool_call`、`tool_calls`、`ask_confirmation`、`ask_clarification`、`final_answer`；prompt 包含 patch protocol、媒体边界、并发规则、manual confirmation 规则；`decision.test.ts` 覆盖解析和 prompt 关键规则；2026-06-09 API/SSE smoke 覆盖模型输出 `type/action`、stringified patch operations 后仍能执行 | 更宽的 selected/manual/provider smoke 仍可继续按当前 commit 重跑 |
| 5. 新 Tool Loop | 支持 model -> tool -> observation -> model；step limit；abort；失败恢复；apply/verify | 代码侧完成 | `tool-loop.ts` 默认 `model_tool_loop`；模型工具调用经过 descriptor 和 policy 校验；apply/generate 成功后自动 verify；decision 不可用不静默 fallback；`tool-loop.test.ts` 覆盖默认模式、hybrid 显式 fallback、并发读工具、mutation policy、manual mode、确认、verify、abort；2026-06-09 non-canvas / consult / content-chain API/SSE smoke 通过 | 当前 commit 下还可继续补 selected/manual/provider/abort 全量 smoke |
| 6. Patch 主路径迁移 | 内容链和节点修改不再依赖固定 fallback | 主路径完成，legacy 保留 | `tool-loop.test.ts` 覆盖模型直接构造内容链 patch、选中 text/image/video/audio update patch；`decision.ts` 明确内容链结构由请求决定，不强制 text->image->video->audio | `planner.ts` 仍有 `buildContentChainPlan()`，但只应作为显式 legacy/hybrid fallback；后续可继续削减 legacy 覆盖面 |
| 7. Tool Result Budget | 大结果不撑爆上下文；摘要和 ref | 基础版完成 | `tool-result-budget.ts` 限制 recent observations、单个 output preview、整体 prompt 长度；`memory.ts` 持久化 `ToolResultRef` storageKey 并提供按 ref 回读 helper；`decision.test.ts` 覆盖下一轮 prompt 注入 ref 摘要且不暴露 storageKey | 当前没有新增模型工具让模型主动按 ref 拉取完整输出；需要时可再加只读 `read_tool_result_ref` |
| 8. 媒体分析工具 | 选中视频/图片/音频可分析；无 file 不假装分析真实媒体 | image binary 基础版完成 | `media-tools.ts` 支持 image/video/audio、`analysisGoal`、prompt/file metadata/stored context；image 节点在 provider 支持图片 message parts 时可下载 storage/url 图片 bytes 并通过多模态模型产出 `binary_image_analysis`；输出 `mediaContentAccess`；`media-tools.test.ts` 覆盖 stored context、binary image、provider 不支持时降级、file metadata only、prompt only、非媒体拒绝；`tool-loop.test.ts` 覆盖读取选中视频后调用媒体分析且不写画布 | video/audio 仍没有抽帧/转写，只能基于 stored context、prompt 和 metadata |
| 9. 灰度和回归 | 新旧路径可切换；完成自动和手工 smoke | 部分完成 | env/payload 支持 `legacy|hybrid|model_tool_loop`；默认已切 `model_tool_loop`；`docs/local-canvas-agent-phase-2-code-validation-and-manual-smoke-zh.md` 有历史 API/SSE/browser/provider evidence；本轮自动测试已覆盖 19 files / 195 tests；2026-06-09 最小 API/SSE + Browser 内容链回归通过 | selected/manual/provider/abort 的当前 commit 全量重跑还可补强 |

## 3. 当前关键行为链路

### 3.1 默认模型工具循环

```text
runLocalAgentToolLoop()
  -> resolveLocalCanvasAgentRuntimeMode()
  -> default model_tool_loop
  -> requestLocalAgentDecision()
  -> descriptor 校验 input / policy / destructive / concurrency
  -> executeLocalAgentTool()
  -> descriptor outputSchema 校验
  -> observationFromToolResult()
  -> 下一轮 decision 或 final_answer
```

关键文件：

- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/tool-loop.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/decision.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/tool-descriptor.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/tool-executor-bridge.ts`

### 3.2 内容链创建

当前主路径的期望不是代码写死四节点，而是：

```text
模型理解用户请求
  -> 模型构造 LocalCanvasPatch
  -> canvas.apply_patch
  -> canvas.verify_patch
  -> final_answer
```

代码只负责：

- patch schema 和 adapter 字段白名单。
- 禁止伪造 `file`。
- connect/layout 引用校验。
- 写入后 verify。

证据：

- `tool-loop.test.ts` 的 model-authored short-video content-chain patch 测试。
- `decision.ts` prompt 明确“Patch examples are recipes, not fixed templates”。

### 3.3 选中节点修改

当前主路径：

```text
canvas.read_selected_nodes
  -> 模型基于节点 kind 和字段构造 update_node patch
  -> canvas.apply_patch
  -> canvas.verify_patch
```

证据：

- `tool-loop.test.ts` 覆盖 text/image/video/audio 四类选中节点字段更新。
- 更新测试校验 patch 不直接包含用户原始命令句。

### 3.4 媒体描述

当前主路径：

```text
canvas.read_selected_nodes
  -> media.analyze_node_media
  -> final_answer
```

输出能力边界：

| `mediaContentAccess.contentEvidence` | 可说 | 不可说 |
| --- | --- | --- |
| `prompt_only` | 只能基于 prompt 描述 | 不能说看过真实图片/视频/音频 |
| `file_metadata_only` | 可说已有文件、文件名、类型、大小等 safe metadata | 不能描述真实画面/声音内容 |
| `stored_media_context` | 可基于已存媒体上下文描述 | 不能声称进行了新的二进制分析 |
| `binary_image_analysis` | 可基于工具返回的真实图片 bytes 视觉分析描述 | 不能把 image 证据外推成 video/audio 真实内容 |

## 4. 当前已验证命令

最近一次当前 checkout 验证：

- `cd apps/sim; bun run test lib/copilot/request/lifecycle/local-canvas-agent`：19 files / 195 tests passed
- `bunx biome check --no-errors-on-unmatched <changed files>`：passed
- `bunx tsc --noEmit --pretty false --project apps/sim/tsconfig.json --ignoreDeprecations 6.0`：passed
- `bun run check:api-validation`：passed，`440/415/25`
- `git diff --check`：passed

2026-06-09 当前默认 `model_tool_loop` 最小 smoke：

- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tmp-local-canvas-agent-phase2-smoke.ps1`：通过 non-canvas / consult / content-chain API/SSE；disposable workflow `f6dba9e7-5aeb-48aa-91e3-1e22620efaf7`；mutation `canvas.apply_patch` 与 `canvas.verify_patch` 均 success；state 变为 5 blocks / 3 edges。
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tmp-local-canvas-agent-phase2-playwright-current.ps1`：Playwright `1 passed (1.6m)`；同 workflow ReactFlow DOM 为 5 nodes / 3 edges，包含 `火星露营` 脚本和 image/video/audio placeholder。

## 5. 仍需补齐的验收证据

在标记完整目标完成前，还需要至少补齐以下证据：

| 项目 | 需要的当前证据 | 原因 |
| --- | --- | --- |
| 默认 `model_tool_loop` API/SSE smoke | 当前 commit 下发起选中节点更新、manual Confirm/Revise、媒体描述请求，确认 SSE/tool events 和 workflow state | non-canvas、consult、内容链创建已在 2026-06-09 重跑；更宽场景仍可补齐 |
| Browser smoke | ReactFlow DOM 在当前 commit 下展示选中节点字段更新结果 | 内容链 DOM 已在 2026-06-09 重跑；选中节点更新 DOM 仍是 2026-06-08 证据 |
| 真实 provider/generation smoke | 至少 text/image/video/audio 中关键生成路径没有迟到写回、字段安全、verify 正确 | 单元测试覆盖 fake provider，真实 provider 仍需运行证据 |
| 媒体真实二进制分析决策 | 产品上明确 video 抽帧和 audio 转写是否本阶段必须做；如果不做，应把阶段 8 定义为 image binary + video/audio metadata 基础版 | 当前 image 在 provider 支持图片 message parts 时可真实读取 bytes 交给视觉模型；video/audio 仍不做抽帧/转写 |
| Tool result ref 工具化决策 | 明确是否需要模型主动调用 ref 读取工具；如果需要，新增只读 `read_tool_result_ref` | 当前 runtime 已持久化 ref 并提供服务端 read back helper，但没有暴露为模型工具 |

## 6. 推荐下一步

优先顺序：

1. 基于当前 commit 继续重跑 selected-node、manual Confirm/Revise、provider generation、abort 和媒体描述 smoke，补齐与 2026-06-08 同等覆盖。
2. 跑选中节点更新 browser smoke，确认字段更新后的 ReactFlow DOM 同步仍通过。
3. 决定阶段 8 是否继续扩展到 video 抽帧和 audio 转写；当前已完成 image binary 分析基础链路。
4. 决定阶段 7 是否需要模型可调用的 `read_tool_result_ref`；当前已完成 ref store 和服务端回读 helper。

在以上当前证据补齐前，不应调用 `update_goal complete`。
