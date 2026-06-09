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

当前可以把本阶段模型驱动工具循环目标视为达到完成边界：

- 默认 `model_tool_loop` 的 non-canvas、consult、content-chain、manual Confirm/Revise、selected-node field update、provider generation、abort 和 browser DOM smoke 已在 2026-06-09 当前工作树重跑通过。
- `media.analyze_node_media` 已能在 image 节点有 storage key/url 且当前模型 provider 支持图片 message parts 时读取图片 bytes 并调用多模态模型；video/audio 仍只基于 prompt、safe metadata、stored media context。
- Tool result `outputRef` 已从 prompt 内稳定引用推进到当前 thread 下的持久化 `ToolResultRef` / storageKey；下一轮 prompt 会看到 ref 摘要和 preview，可按 ref 回读完整私有输出。
- Canvas summary cache 已落到 workflow hash 派生缓存，不放进 chat memory；画布变化后 hash 变更自然失效。
- 旧 planner 仍在代码中作为显式 legacy/hybrid 路径存在，不再是默认主路径；是否逐步下线属于后续清理，不阻塞本阶段完成。

## 2. 阶段 1-9 完成度

| 阶段 | 方案目标 | 当前状态 | 证据 | 缺口 |
| --- | --- | --- | --- | --- |
| 1. 隔离和 Thread Memory | 新聊天不继承旧聊天；当前 chat 内保存摘要、问题、观察 | 代码侧完成 | `memory.ts` 使用 `local-canvas-agent:v2:thread:{userId}:{workspaceId}:{workflowId}:{agentCode}:{chatId}`；`canPersistLocalAgentThreadMemory()` 要求 `chatId`；`runtime-foundation.test.ts` 覆盖 user/workspace/workflow/agent/chat 隔离、无 chat 不持久化、ToolResultRef scope 和 canvas summary cache hash key | User Preference Memory 仍后置，避免新聊天被旧聊天污染 |
| 2. 工种 Skill 基础版 | 不同工种加载不同 skill；team override 生效；不暴露内部 persona | 代码侧基本完成 | `skills.ts` 按 organization、agentCode、teamWorkspaceId 查询；`mergeAgentSkillRows()` 合并 template 与 team override；`context-manager.ts` 注入 `Enabled Skills` 并裁剪；`runtime-foundation.test.ts` 覆盖 skill merge；`actor.test.ts` 覆盖不 role-play fallback persona | 还没有按 skill 限定不同工具组；方案也把它列为后续 |
| 3. Tool Descriptor | 工具 schema、读写、破坏性、并发、summarizer 结构化 | 完成并增强 | `tool-descriptor.ts` 定义 `LocalAgentToolDescriptor`、`inputSchema`、`outputSchema`、`isReadOnly`、`isDestructive`、`isConcurrencySafe`；canvas read/search/inspect 与 media tool 有具体 `outputSchema`；`tool-executor-bridge.ts` 校验 input/output；`tool-executor-bridge.test.ts` 覆盖 output schema 失败转失败结果 | 写入/生成类动态输出后续可继续补齐 outputSchema |
| 4. AgentDecision Prompt | 模型每轮返回下一步 decision；parser 和 prompt layer | 完成 | `decision.ts` 支持 `tool_call`、`tool_calls`、`ask_confirmation`、`ask_clarification`、`final_answer`；prompt 包含 patch protocol、媒体边界、并发规则、manual confirmation 规则，并明确 `patch.operations` 必须是 operation object array；`decision.test.ts` 覆盖解析和 prompt 关键规则；2026-06-09 API/SSE smoke 覆盖模型输出 `type/action`、stringified patch operations 后仍能执行 | 后续可继续增加更多 provider/model 变体样本 |
| 5. 新 Tool Loop | 支持 model -> tool -> observation -> model；step limit；abort；失败恢复；apply/verify | 代码侧完成 | `tool-loop.ts` 默认 `model_tool_loop`；模型工具调用经过 descriptor 和 policy 校验；apply/generate 成功后自动 verify；decision 不可用不静默 fallback；首次 malformed decision 会作为 observation 回灌重试；apply 成功后的 malformed verify 会复用 pending verification；mutation + verify 成功后 final decision 不可用会返回 deterministic 完成回复；`tool-loop.test.ts` 覆盖默认模式、hybrid 显式 fallback、并发读工具、mutation policy、manual mode、确认、verify、abort 与错误恢复；2026-06-09 non-canvas / consult / content-chain / selected / manual / provider / abort smoke 通过 | 无阻塞缺口 |
| 6. Patch 主路径迁移 | 内容链和节点修改不再依赖固定 fallback | 主路径完成，legacy 保留 | `tool-loop.test.ts` 覆盖模型直接构造内容链 patch、选中 text/image/video/audio update patch；`decision.ts` 明确内容链结构由请求决定，不强制 text->image->video->audio | `planner.ts` 仍有 `buildContentChainPlan()`，但只应作为显式 legacy/hybrid fallback；后续可继续削减 legacy 覆盖面 |
| 7. Tool Result Budget | 大结果不撑爆上下文；摘要和 ref | 基础版完成 | `tool-result-budget.ts` 限制 recent observations、单个 output preview、整体 prompt 长度；`memory.ts` 持久化 `ToolResultRef` storageKey 并提供按 ref 回读 helper；`decision.test.ts` 覆盖下一轮 prompt 注入 ref 摘要且不暴露 storageKey | 当前没有新增模型工具让模型主动按 ref 拉取完整输出；需要时可再加只读 `read_tool_result_ref` |
| 8. 媒体分析工具 | 选中视频/图片/音频可分析；无 file 不假装分析真实媒体 | image binary 基础版完成 | `media-tools.ts` 支持 image/video/audio、`analysisGoal`、prompt/file metadata/stored context；image 节点在 provider 支持图片 message parts 时可下载 storage/url 图片 bytes 并通过多模态模型产出 `binary_image_analysis`；输出 `mediaContentAccess`；`media-tools.test.ts` 覆盖 stored context、binary image、provider 不支持时降级、file metadata only、prompt only、非媒体拒绝；`tool-loop.test.ts` 覆盖读取选中视频后调用媒体分析且不写画布 | video/audio 仍没有抽帧/转写，只能基于 stored context、prompt 和 metadata |
| 9. 灰度和回归 | 新旧路径可切换；完成自动和手工 smoke | 完成 | env/payload 支持 `legacy|hybrid|model_tool_loop`；默认已切 `model_tool_loop`；`docs/local-canvas-agent-phase-2-code-validation-and-manual-smoke-zh.md` 记录 API/SSE、browser、provider、abort evidence；本轮自动测试已覆盖 19 files / 199 tests；2026-06-09 当前工作树重跑 non-canvas / consult / content-chain / manual / selected / provider / abort / browser smoke | image/video/audio 字段 smoke 复用旧 workflow 时 diff 可能幂等，若要证明 diff 可新建 fresh workflow 重跑 |

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

- `cd apps/sim; bun run test lib/copilot/request/lifecycle/local-canvas-agent`：19 files / 199 tests passed
- `bunx biome check --no-errors-on-unmatched <changed files>`：passed
- `bunx tsc --noEmit --pretty false --project apps/sim/tsconfig.json --ignoreDeprecations 6.0`：passed
- `bun run check:api-validation`：passed，`440/415/25`
- `git diff --check`：passed

2026-06-09 当前默认 `model_tool_loop` 最小 smoke：

- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tmp-local-canvas-agent-phase2-smoke.ps1`：通过 non-canvas / consult / content-chain API/SSE；disposable workflow `f6dba9e7-5aeb-48aa-91e3-1e22620efaf7`；mutation `canvas.apply_patch` 与 `canvas.verify_patch` 均 success；state 变为 5 blocks / 3 edges。
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tmp-local-canvas-agent-phase2-playwright-current.ps1`：Playwright `1 passed (1.6m)`；同 workflow ReactFlow DOM 为 5 nodes / 3 edges，包含 `火星露营` 脚本和 image/video/audio placeholder。
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tmp-local-canvas-agent-phase2-manual.ps1`：通过 manual plan / Revise / Confirm；Confirm workflow `3e6e29e2-e0b2-46e1-9b09-61ee93b69ebb` 变为 5 blocks / 3 edges，包含 text/image/video/audio，且原始命令未写入字段。
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tmp-local-canvas-agent-phase2-field.ps1`：通过 selected text update；workflow `c0cdbda4-b652-4e83-a000-697e58cee16a` 中 text node `38926e22-8e2d-4830-a80e-e60cbb1b08b6` 的 `contentHtml` 更新为包含“哈喽宝子们”“冲鸭”的年轻语气，`canvas.apply_patch` 与 `canvas.verify_patch` 均 success。
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tmp-local-canvas-agent-phase2-field-browser-current.ps1`：Playwright `1 passed (1.7m)`；ReactFlow DOM 为 5 nodes / 3 edges，并包含更新后的“哈喽宝子们”“冲鸭”。
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tmp-local-canvas-agent-phase2-media-fields-fixed.ps1`：通过 image/video/audio selected field update 的 tool events、verify success、目标字段包含 expected content，且未误触发 `canvas.generate_node_output`；因为复用已修改 workflow，部分 `fieldChanged=false` 属于幂等边界。
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tmp-local-canvas-agent-phase2-provider.ps1`：text/image/audio/video 全部真实 provider 生成并写回目标字段，`canvas.generate_node_output` 与 `canvas.verify_patch` 均 success，SSE 未泄露 file key/url/path。
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tmp-local-canvas-agent-phase2-abort.ps1`：video provider 生成中看到 `canvas.generate_node_output` call 后 abort/stop 均 HTTP 200；workflow `263db904-5fd2-4e19-a563-6801bff32316` 在 35 秒后 hash 不变，无迟到写回。

## 5. 后续增强和非阻塞边界

以下项目不阻塞本阶段完成，但建议在后续阶段继续推进：

| 项目 | 需要的当前证据 | 原因 |
| --- | --- | --- |
| 媒体真实二进制分析决策 | 决定是否把 video 抽帧和 audio 转写纳入下一阶段 | 当前本阶段边界是 image binary 基础版 + video/audio prompt、metadata、stored context；不会假装看过真实视频或听过音频 |
| Tool result ref 工具化决策 | 如模型需要主动读取完整历史工具结果，可新增只读 `read_tool_result_ref` | 当前 runtime 已持久化 ref 并提供服务端 read back helper，但没有暴露为模型工具 |
| 幂等 field smoke | 如要再次证明 image/video/audio 的真实字段 diff，可新建 fresh workflow 重跑 | 3032 当前证据复用了已修改 workflow，能证明 tool/verify/目标字段和不误触发生成，但部分 `fieldChanged=false` |

## 6. 推荐下一步

优先顺序：

1. 合并本阶段后，开始下一阶段前先决定 video 抽帧、audio 转写是否进入媒体工具范围。
2. 如果要让模型跨轮读取完整大工具结果，再加只读 `read_tool_result_ref` 工具。
3. 若需要更强的 image/video/audio 字段 diff 证据，新建 disposable workflow 重跑 selected media field smoke。

以上均为后续增强项；本阶段目标可标记完成。
