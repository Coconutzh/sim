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
- 媒体分析已具备 prompt / metadata / stored context 的能力边界，不会在没有真实分析证据时假装看过文件。
- 旧 planner 仍保留为 `legacy` 和显式 `hybrid` fallback，而不是默认主路径。

但完整目标仍不能标记完成：

- 默认 `model_tool_loop` 下的 API/SSE/browser smoke 需要基于当前 commit 重新跑一轮。
- `media.analyze_node_media` 当前没有拉取和分析二进制媒体 bytes；只能基于 prompt、safe metadata、stored media context。
- Tool result `outputRef` 目前是 prompt 内稳定引用，不是可跨轮读取的大结果持久化存储。
- Canvas summary cache 仍是计划项，不是独立缓存实现。
- 旧 planner 仍在代码中作为显式 legacy/hybrid 路径存在，需要继续保留或后续逐步下线。

## 2. 阶段 1-9 完成度

| 阶段 | 方案目标 | 当前状态 | 证据 | 缺口 |
| --- | --- | --- | --- | --- |
| 1. 隔离和 Thread Memory | 新聊天不继承旧聊天；当前 chat 内保存摘要、问题、观察 | 代码侧完成 | `memory.ts` 使用 `local-canvas-agent:v2:thread:{userId}:{workspaceId}:{workflowId}:{agentCode}:{chatId}`；`canPersistLocalAgentThreadMemory()` 要求 `chatId`；`runtime-foundation.test.ts` 覆盖 user/workspace/workflow/agent/chat 隔离和无 chat 不持久化 | 尚未实现独立 canvas summary cache |
| 2. 工种 Skill 基础版 | 不同工种加载不同 skill；team override 生效；不暴露内部 persona | 代码侧基本完成 | `skills.ts` 按 organization、agentCode、teamWorkspaceId 查询；`mergeAgentSkillRows()` 合并 template 与 team override；`context-manager.ts` 注入 `Enabled Skills` 并裁剪；`runtime-foundation.test.ts` 覆盖 skill merge；`actor.test.ts` 覆盖不 role-play fallback persona | 还没有按 skill 限定不同工具组；方案也把它列为后续 |
| 3. Tool Descriptor | 工具 schema、读写、破坏性、并发、summarizer 结构化 | 完成并增强 | `tool-descriptor.ts` 定义 `LocalAgentToolDescriptor`、`inputSchema`、`outputSchema`、`isReadOnly`、`isDestructive`、`isConcurrencySafe`；`tool-executor-bridge.ts` 校验 input/output；`tool-executor-bridge.test.ts` 覆盖 output schema 失败转失败结果 | 目前只有媒体工具声明了具体 `outputSchema`，其他工具后续可逐步补齐 |
| 4. AgentDecision Prompt | 模型每轮返回下一步 decision；parser 和 prompt layer | 完成 | `decision.ts` 支持 `tool_call`、`tool_calls`、`ask_confirmation`、`ask_clarification`、`final_answer`；prompt 包含 patch protocol、媒体边界、并发规则、manual confirmation 规则；`decision.test.ts` 覆盖解析和 prompt 关键规则 | 需要真实模型 smoke 验证 prompt 在当前默认路径下的稳定性 |
| 5. 新 Tool Loop | 支持 model -> tool -> observation -> model；step limit；abort；失败恢复；apply/verify | 代码侧完成 | `tool-loop.ts` 默认 `model_tool_loop`；模型工具调用经过 descriptor 和 policy 校验；apply/generate 成功后自动 verify；decision 不可用不静默 fallback；`tool-loop.test.ts` 覆盖默认模式、hybrid 显式 fallback、并发读工具、mutation policy、manual mode、确认、verify、abort | 当前默认路径的 API/SSE/browser 证据需要重跑 |
| 6. Patch 主路径迁移 | 内容链和节点修改不再依赖固定 fallback | 主路径完成，legacy 保留 | `tool-loop.test.ts` 覆盖模型直接构造内容链 patch、选中 text/image/video/audio update patch；`decision.ts` 明确内容链结构由请求决定，不强制 text->image->video->audio | `planner.ts` 仍有 `buildContentChainPlan()`，但只应作为显式 legacy/hybrid fallback；后续可继续削减 legacy 覆盖面 |
| 7. Tool Result Budget | 大结果不撑爆上下文；摘要和 ref | 部分完成 | `tool-result-budget.ts` 限制 recent observations、单个 output preview、整体 prompt 长度，并生成稳定 `outputRef`；`decision.test.ts`、`tool-result-budget.test.ts` 覆盖预算化 prompt | 没有实现持久化 `ToolResultRef` / `storageKey`，不能跨轮按 ref 读取完整大结果 |
| 8. 媒体分析工具 | 选中视频/图片/音频可分析；无 file 不假装分析真实媒体 | 基础版完成，真实二进制分析未完成 | `media-tools.ts` 支持 image/video/audio、`analysisGoal`、prompt/file metadata/stored context；输出 `mediaContentAccess`；`media-tools.test.ts` 覆盖 stored context、file metadata only、prompt only、非媒体拒绝；`tool-loop.test.ts` 覆盖读取选中视频后调用媒体分析且不写画布 | 没有下载/解码/抽帧/转写真实媒体 bytes；只能基于已有上下文和 metadata |
| 9. 灰度和回归 | 新旧路径可切换；完成自动和手工 smoke | 部分完成 | env/payload 支持 `legacy|hybrid|model_tool_loop`；默认已切 `model_tool_loop`；`docs/local-canvas-agent-phase-2-code-validation-and-manual-smoke-zh.md` 有历史 API/SSE/browser/provider evidence；本轮自动测试已覆盖 19 files / 182 tests | 当前 commit 下尚未重跑默认 `model_tool_loop` API/SSE/browser smoke |

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

## 4. 当前已验证命令

最近一次当前 checkout 验证：

- `cd apps/sim; bun run test lib/copilot/request/lifecycle/local-canvas-agent`：19 files / 182 tests passed
- `bunx biome check --no-errors-on-unmatched <changed files>`：passed
- `bunx tsc --noEmit --pretty false --project apps/sim/tsconfig.json --ignoreDeprecations 6.0`：passed
- `bun run check:api-validation`：passed，`440/415/25`
- `git diff --check`：passed

## 5. 仍需补齐的验收证据

在标记完整目标完成前，还需要至少补齐以下证据：

| 项目 | 需要的当前证据 | 原因 |
| --- | --- | --- |
| 默认 `model_tool_loop` API/SSE smoke | 当前 commit 下发起非画布、内容链、选中节点更新、manual Confirm/Revise、媒体描述请求，确认 SSE/tool events 和 workflow state | 默认模式已从 hybrid 改为 model_tool_loop，历史 smoke 不能完全代表当前行为 |
| Browser smoke | ReactFlow DOM 在当前 commit 下展示内容链创建和选中节点字段更新结果 | API 成功不等于前端同步成功 |
| 真实 provider/generation smoke | 至少 text/image/video/audio 中关键生成路径没有迟到写回、字段安全、verify 正确 | 单元测试覆盖 fake provider，真实 provider 仍需运行证据 |
| 媒体真实二进制分析决策 | 产品上明确是否本阶段要实现抽帧/下载/转写；如果不做，应把阶段 8 定义为基础版 | 当前实现不会假装分析二进制，但也没有真正分析二进制 |
| Tool result ref 持久化决策 | 明确是否需要跨轮 `ToolResultRef` 存储；如果需要，实现 storageKey/read back | 当前 `outputRef` 只用于 prompt 内预算化引用 |

## 6. 推荐下一步

优先顺序：

1. 基于当前 commit 重跑默认 `model_tool_loop` API/SSE smoke，并更新本审计或 phase-2 smoke 文档。
2. 跑最小 browser smoke：内容链创建 DOM、选中节点更新 DOM。
3. 决定阶段 8 是否要求真实二进制媒体分析；若要求，再设计 provider/文件读取/隐私边界。
4. 决定阶段 7 是否要求持久化 ToolResultRef；若要求，再实现 ref store。

在以上当前证据补齐前，不应调用 `update_goal complete`。
