# Local Canvas Agent 后续单线推进、复用评估与全覆盖测试方案

日期：2026-06-08

工作区：`E:\project\sim`

当前分支：`fix/low-memory-canvas-interactions`

外部参考源码：`E:\project\claudecode源码\claude-code-source-code`

## 0. 本文边界与当前基线

本文用于阶段一之后继续推进右侧 Copilot 中的 Local Canvas Agent。后续不并行做，按单线、可提交、可回滚的小阶段推进。本文只写方案，不包含业务代码实现。

本次写作前已核对当前 checkout：

- `git status --short --branch`：跟踪文件干净，仅剩 `.vitest-cache/`、`tmp-*`、`tmp-local-canvas-agent-*` 等未跟踪临时/日志文件。
- `git log --oneline -5`：最近提交包含 `51f3aec8f fix local canvas formatting checks`、`896b93295 add local canvas memory compression`、`eb60b96bf implement local canvas intent policy`。
- 已按 UTF-8 读取阶段一审计、手工清单、复测记录和 runtime design 文档。
- 已只读审阅当前 `local-canvas-agent` runtime、planner、tool loop、context/memory、canvas tools/verify、右侧 Copilot UI live refresh 和相关 tests。
- 已只读审阅 `E:\project\claudecode源码\claude-code-source-code` 中 agent/tool/context/memory/abort/skill/task 相关逻辑，结论见第 6 节。

当前基线判断：

- 右侧 Copilot 与画布已经打通：`apps/sim/lib/copilot/request/lifecycle/run.ts` 在 `workflowCopilotMode === 'content_canvas_v1'` 时进入 `runLocalCanvasAgent()`。
- Agent 具备第一阶段核心闭环：routing、intent policy、context resolving、selected nodes、adapter registry、canvas tools、patch/verify、generation writeback、abort、redaction、manual Confirm/Revise、memory compression 和 UI reload 兜底。
- 但 Agent 能力仍是“第一阶段可用原型”，不是成熟内容生产 Agent：内容链生成质量偏模板化；planner 仍有 deterministic fallback 把用户请求过度加工进节点字段的风险；“先讨论/先规划”类需求已由 intent policy 拦住一部分，但仍需要更稳的意图判定、会话任务状态和 follow-up 语义；长期记忆已起步，但还没达到长会话、长任务、跨任务/团队协作的稳定状态。

## 1. 为什么后续不建议并行做

后续工作表面上可以拆成 intent、planner、UI、memory、generation、team/task 多条线，但它们在真实运行链路上高度耦合：

```text
UserInput / CopilotTab
  -> /api/mothership/chat stream
  -> runLocalCanvasAgent
  -> routing + intent policy
  -> resolveLocalAgentContext + memory
  -> planner
  -> tool-loop
  -> canvas/context/generation/task tools
  -> verify
  -> final answer
  -> memory update
  -> CopilotTab reload + workflow store + ReactFlow DOM
```

并行开发的主要风险：

- intent 改动会直接改变 planner 和 tool-loop 是否允许 mutate；planner 同时改动会让失败难定位。
- memory 如果提前记住错误的“已完成步骤”，会污染后续 follow-up；因此长期记忆可以提前，但必须在 completion/verify 语义稳定后推进。
- UI live refresh、verify 和 planner 任何一层不一致，都会出现“后端改了、UI 没变”或“UI 看似变了、verify 没过”的问题。
- generation、file redaction、context compression 共用 tool output 和 observation 管道，不能独立只改 provider。
- team/task scope 会引入权限、共享可见性和多用户语义，必须建立在单用户画布闭环稳定之上。

因此建议用“单线阶段门”推进：每阶段只引入一个主要行为变化，完成单元/入口/UI/手工证据后提交；失败时可以独立回滚。

## 2. 当前能力和主要缺口

### 2.1 Agent 与画布打通状态

已打通部分：

- 入口：`run.ts` 把 `content_canvas_v1` 请求交给 `local-canvas-agent/runtime.ts`。
- 上下文：`context-manager.ts` 解析 `workspaceId/workflowId/chatId/userId`、选中节点、附件、手工 contexts、个人 history、agent profile、skills、permissions。
- 画布读取：`canvas-context.ts` 和 `node-adapters/*` 能读取 text/image/video/audio，document/table/image_editor 至少可识别并安全只读。
- 写画布：`canvas-tools.ts` 的 `canvas.apply_patch` 经 `canvas-patch.ts` 转成 `editWorkflowServerTool` 操作，之后走 `canvas-verify.ts`。
- 生成写回：`canvas.generate_node_output` 对 text 写 `contentHtml`，image/video/audio 写 `file`，并返回 `verifiedField` 供字段级 verify。
- UI 同步：`copilot-tab.tsx` 在 local canvas mutation tool success、stream end、send settled 时调用 `useWorkflowRegistry.getState().loadWorkflowState(workflowId)`；`workflow.tsx` 有 `reconcileDisplayNodePositions()` 处理 position-only reload。

现阶段对用户可见的能力：

- 可以总结当前画布、读取选中节点、搜索节点、说明上下游关系。
- 可以创建 text/image/video/audio 内容链并连接、布局。
- 可以更新选中节点的 text/image/video/audio 关键字段。
- 可以触发 text/image/video/audio 生成并写回。
- 可以在 manual 模式提出 plan 并等待 Confirm/Revise。
- 可以在 Stop 后尽量阻止本地后续写回。

### 2.2 用户观察到的问题如何解释

用户手工样本：

```text
你好，我想做一个小红书的小猫ai视频生成工作流，先告诉我工作流如何设计，和我讨论一下
```

预期：先讨论方案，不应自动读当前画布并围绕已有节点答非所问，更不应改画布。

当前代码层根因可能是多层叠加，不应靠硬编码“先讨论”解决：

- `intent.ts` 已有 consult/propose/mutate/generate/read policy，但 consult 仍主要是启发式正则。它应该综合“用户是否要求执行”“是否引用当前画布”“是否要求先讨论/先规划”“是否上轮已有 open question”“是否存在 pending plan”等信号，给出带 confidence 的 policy。
- `planner.ts` 仍有 deterministic fallback。对于内容链请求，`buildFallbackPatch()` 会快速创建固定 text-image-video-audio 链；这对 D-01 有价值，但对“先讨论”类 intent 必须被 policy 层明确禁止。
- 早期内容链字段来自 `buildContentChainFields()`，会从用户请求抽取主题，但仍偏模板化；如果抽取失败或 prompt 不够具体，就会把用户原始请求过多写入节点字段，造成“粗糙”和“像把我的文案塞进节点”的感受。
- `buildLocalAgentAnswer()` 会根据 observations 回答，如果只读工具先读了当前画布，用户又不是问当前画布，就容易被 existing canvas context 带偏。

产品层判断：这是第一阶段之后必须修的体验漏洞，不应等到很后面的多用户阶段。正确方向不是写死“用户说先讨论就不允许改画布”，而是做 Intent/Task Policy v2：让模型和规则共同判断“现在应该讨论、提案、执行、生成、还是拒绝/澄清”，并把 mutation policy 作为 tool-loop 硬约束。

### 2.3 当前长期记忆是否已经提前

当前已存在初版长期记忆和上下文压缩：

- `types.ts` 中 `LocalAgentMemoryData` 包含 `conversationSummary`、`canvasSummary`、`taskState.completedSteps/openQuestions/lastObservation`。
- `memory.ts` 使用 `memory` 表按 `user/workspace/workflow/agent/chat` 存取 personal scope memory。
- `models/summarizer.ts` 在每轮后生成/合并 memory，并有 deterministic fallback 和敏感信息清洗。
- `context-manager.ts` 会把 memory 压入 `Long-Term Memory` layer，并按模型窗口估算字符预算。

但它还只是“可用起点”，不是完整长期记忆能力：

- scope 固定 personal，team/task scope 尚未实现。
- memory key 绑定 chat，跨 chat 的同一工作流任务连续性有限。
- canvasSummary 主要来自读 summary observation，不等价于版本化 canvas cache。
- completedSteps 只按工具成功粗略归类，还需要与 verify、abort、failure 语义绑定，避免把失败/取消写成完成。
- context budget 是字符估算，不是正式 token counting 和 category heatmap。

结论：长期记忆可以提前到后续单线的前半段，但不要放在 intent/verify 之前。建议先完成 Intent/Task Policy v2 和 Planner v2 的安全边界，再做 Memory/Context v2，这样长上下文会记住正确任务状态，而不是放大错误。

## 3. 全局阶段地图：阶段二到阶段八

上一版文档把第一条执行线拆成 `2.0` 到 `2.9`，本意是“阶段一之后的下一个大阶段内部分解”，但容易误读成后续只做到阶段二。这里补充完整阶段地图：后续不并行推进，但路线图应覆盖阶段二到阶段八。

| 大阶段 | 阶段目标 | 依赖关系 | 主要产出 | 不做什么 |
|---|---|---|---|---|
| 阶段二：单用户画布 Agent 稳定化 | 修正“讨论 vs 执行”、内容链质量、patch/verify、UI 生命周期、generation 写回和初版 memory | 阶段一已接通右侧 Copilot 与画布 | `Intent/Task Policy v2`、`Planner v2`、`Patch/Verify v2`、`UI Lifecycle v2`、`Generation Adapter v2`、`Tool Loop v2` | 不做多人协作，不扩大权限，不做 shell/file-system agent |
| 阶段三：Canvas Node Adapter 和工具面扩展 | 从 text/image/video/audio 扩到 document/table/image_editor，并统一节点 schema/capability | 阶段二的 patch/verify 可定位 | adapter registry v2、node schema registry、document/table/image_editor 安全读写、content reference 规范化 | 不做复杂多 Agent；不让 unsupported 节点盲写 |
| 阶段四：生成与资产流水线产品化 | 把生成服务从“同步写回工具”升级到可观察、可恢复、可取消的资产流水线 | 阶段二的 generation adapter 和 UI lifecycle | generation job state、progress events、provider retry/fallback、quota/cost guard、asset provenance、上游媒体引用链 | 不承诺远端 provider 真撤销，只保证本地不迟到写回 |
| 阶段五：长期记忆和上下文压缩完整版 | 支持长会话、长任务、跨轮追踪，不每轮塞全量 history | 阶段二可提前做 v1，但完整版依赖 verify/task 语义 | typed memory、canvas summary cache、task state memory、relevance selection、token budget、stale/failure guard | 不把可从当前画布/DB 推导的状态写成永久记忆 |
| 阶段六：Team / Task Scope 与工种权限 | 从 personal agent 扩展到 workgroup/team/task 可见性和生产任务闭环 | 阶段五 memory scope 和阶段三 adapter 权限 | scope resolver、team/task memory key、工种 profile/skill override、task read/update/submit、审计日志 | 不绕过 workspace/workgroup/task 权限；不把 personal history 暴露给 team |
| 阶段七：多工种 / 多 Agent 协作 | 支持导演、灯光、舞美、剪辑等 Agent 的任务分派、handoff、审核和返工 | 阶段六权限和 task scope 稳定 | coordinator、agent handoff、review/approval、冲突处理、协作 UI、任务通知 | 不做无边界 swarm；不允许 Agent 间私自改共享画布 |
| 阶段八：评测、观测和发布硬化 | 把能力从“能跑”变成可发布、可回归、可定位 | 所有前序阶段 | eval harness、浏览器自动化、SSE replay、observability dashboard、安全扫描、回滚手册、迁移文档 | 不继续堆 prompt 解决系统性问题 |

推荐的单线顺序：

```text
阶段二稳定化
  -> 阶段三扩展节点能力
  -> 阶段四产品化生成流水线
  -> 阶段五补齐长期记忆完整版
  -> 阶段六引入 team/task scope
  -> 阶段七做多 Agent 协作
  -> 阶段八做发布级评测和观测
```

阶段五可以“部分提前”：当前代码已有 `memory.ts`、`models/summarizer.ts`、`context-manager.ts` 的 memory/compression v1，因此阶段二内可以先做“绑定 verify 语义的 Memory/Context v2”。但阶段五完整版仍应放在 patch/verify、task scope 语义明确之后，否则长期记忆会放大错误完成态、失败态或权限边界不清的问题。

### 阶段三详细方向：Canvas Node Adapter 和工具面扩展

目标：

- 让 `CanvasNodeAdapter` 不只是 text/image/video/audio 的读取封装，而成为所有画布节点的能力声明、字段 schema、读写策略和 verify 策略来源。
- 将 document/table/image_editor 从“可识别、只读、拒绝盲写”推进到“可安全读写基础字段”，为后续 task 交付和多工种协作打基础。

要改的文件：

- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/types.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/*`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/canvas-patch.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/canvas-verify.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/canvas-tools.ts`
- `apps/sim/stores/workflows/workflow/validation.ts`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/**`

具体实现：

- 为 adapter 增加 `schemaVersion`、`readableFields`、`writableFields`、`generationSpec`、`verifyStrategy`、`redactionStrategy`。
- document adapter：支持读取标题、文件名、解析摘要、页数/类型；第一步只允许更新 title/description，不允许直接改文件内容。
- table adapter：支持读取 columns、rowCount、sampleRows；第一步允许写入 metadata 或导入生成后的 table asset，不直接做大规模表格编辑。
- image_editor adapter：支持读取 sourceImage、editPrompt、outputFile；第一步允许更新 editPrompt，不自动覆盖 sourceImage。
- `canvas.inspect_schema` 输出 adapter schema，让 planner 不再猜字段名。
- `canvas.verify_patch` 对不同 kind 走 adapter verify strategy。

测试方案：

- `node-adapters/*.test.ts`：每种节点的 summary/detail/schema/redaction。
- `canvas-patch.test.ts`：新增节点 kind 的 create/update 校验。
- `canvas-verify.test.ts`：document/table/image_editor 的只读拒绝、允许字段更新和字段级失败定位。
- 手工 H-02 回归：unsupported/readonly 类型不被盲写；支持的基础字段能写且 verify 指出字段。

验收标准：

- 所有节点类型在 `canvas.inspect_schema` 中有明确能力声明。
- planner 不再靠硬编码字段名猜 document/table/image_editor。
- 不支持的写入明确拒绝，支持的基础字段可 verify。

### 阶段四详细方向：生成与资产流水线产品化

目标：

- 将 `canvas.generate_node_output` 从“调用 provider 后立即写回”升级为可观察、可取消、可恢复、可追踪来源的生成流水线。
- 支持真实生产中常见的慢生成、多媒体依赖、provider 失败、额度不足和刷新后继续查看结果。

要改的文件：

- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/canvas-tools.ts`
- `apps/sim/lib/generated-media/{image,video,audio}/**`
- `apps/sim/app/api/media/{images,videos,audios}/generate/**`
- `apps/sim/lib/content-canvas/text-executor.ts`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/**`
- 后续可能新增 generation job contract/route/service。

具体实现：

- 定义 generation job 状态：`queued/running/succeeded/failed/cancelled/writeback_pending/writeback_verified`。
- Agent tool 先创建 job，再根据能力选择同步等待或后台轮询；短文本可同步，多媒体优先 job 化。
- 生成结果写回时记录 provenance：prompt、model、parameters、source node ids、source file ids、安全 file metadata。
- UI 展示 generation progress，不只显示“Reading canvas/已完成”。
- provider error 分类：auth/quota/model-not-found/safety/timeout/cancelled/unknown，并映射到用户可理解文案。
- abort 后 job 可继续在 provider 侧完成，但本地 writeback 必须检查 request/session 是否仍有效；过期结果只保留 job 记录，不偷偷改画布。

测试方案：

- fake provider unit：success/failure/timeout/abort/writeback skipped。
- generation service tests：abortSignal 传递、provider error 分类。
- `canvas-tools.test.ts`：job 成功写回、失败不清空旧值、late result 不写回。
- UI tests：progress 状态、失败状态、刷新后读取 job 状态。
- opt-in real smoke：image/video/audio 各一条，手工记录 provider、耗时、file writeback、preview。

验收标准：

- 真实生成不再是黑盒长请求；能看到状态、错误和写回结果。
- Stop 后本地不迟到写回。
- 生成资产可追踪来源和参数。

### 阶段五详细方向：长期记忆和上下文压缩完整版

目标：

- 支持长会话、长任务、跨轮 follow-up，不再依赖最近 N 条消息或每次读取全画布。
- 记忆必须可过期、可验证、可按 scope 隔离，并且不能保存 secrets 或失败完成态。

要改的文件：

- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/memory.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/models/summarizer.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/context-manager.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/types.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/redaction.ts`
- 可能新增 `memory-relevance.ts`、`context-budget.ts`、`canvas-summary-cache.ts`。

具体实现：

- typed memory：`conversation`、`canvas`、`task_state`、`user_preference`、`decision`、`open_question`。
- memory manifest：context 先加载短 manifest，再按当前 query/intent 选取 detail，避免全部塞进 prompt。
- canvas summary cache：记录 workflow state version/hash、node count、edge count、关键节点摘要；state hash 变更后自动标 stale。
- task state memory：`goal`、`completedSteps`、`openQuestions`、`lastObservation`、`blockedReason`、`lastVerifiedMutation`。
- token budget：按 profile/skills/canvas/selected/files/history/memory/userRequest/toolResults 分类预算，输出可测试的截断原因。
- failure guard：verify failed、aborted、pending plan 未确认、provider failed 都不能写入 completedSteps。
- redaction guard：memory 保存前二次扫描 private key、URL、storage path、workspace/chat/user IDs。

测试方案：

- `summarizer.test.ts`：成功/失败/取消/consult/propose/confirm 分支。
- `context-manager.test.ts`：大历史、大画布、大附件下 User Request 和 selected detail 不被挤掉。
- `memory.test.ts`：key 隔离、stale canvas summary、scope 字段兼容。
- security tests：secrets 不进入 memory/context/final answer。
- 手工长会话：讨论 -> 补充偏好 -> 执行 -> 修改 -> 取消 -> 追问状态。

验收标准：

- 长会话能记住用户确认过的目标和偏好。
- 新任务不会被旧 memory 误导。
- memory 不保存 secrets、不保存失败完成态。

### 阶段六详细方向：Team / Task Scope 与工种权限

目标：

- 从 personal agent 扩展到 workgroup/team/task scope，让 Agent 能服务真实协作流程，但权限和可见性必须先行。

要改的文件：

- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/context-manager.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/permissions.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/workgroup-profile.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/skills.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/memory.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/context-tools.ts`
- `apps/sim/lib/production-tasks/**`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/production-tasks/**`

具体实现：

- `LocalAgentSessionScopeResolver` 输出 personal/team/task scope、可读 history、可写 tools、memory visibility。
- team scope：只允许 workgroup 成员读取；加载 team workspace 的 profile/skills override；memory key 带 workgroup/teamWorkspaceId。
- task scope：绑定 production task；source/assignee workgroup、resultWorkflowId/resultNodeId、review 状态决定可写范围。
- context tools：`read_tasks/update_task_result/submit_task_result` 必须经过 task 权限和 workflow 权限双重校验。
- 审计日志：team/task scope 的读写记录 userId、taskId、workflowId、nodeId、toolName、result。
- UI：右侧 Copilot 清楚显示当前是 personal/team/task agent，不混淆用户私聊和团队任务。

测试方案：

- scope resolver matrix：个人画布、团队画布、任务画布、无权限用户。
- memory isolation：用户 A/B、team A/B、task A/B 不串。
- production task service tests：read/update/submit 权限。
- UI tests：skill cards create_task/submit_task 和 selected node 绑定。
- 手工：个人历史不出现在团队；团队任务可提交选中节点；无权限用户被拒绝。

验收标准：

- 不绕过现有 workspace/workgroup/task 权限。
- team/task memory 和 personal memory 明确隔离。
- 任务提交、审核、返工有可审计链路。

### 阶段七详细方向：多工种 / 多 Agent 协作

目标：

- 在阶段六权限稳定后，引入多工种 Agent 协作：由 coordinator 识别任务、分派给工种 Agent、收集结果、审核并写回画布。

要改的文件：

- 新增或扩展 `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/coordinator/*`
- `apps/sim/lib/copilot/skill-action-registry.ts`
- `apps/sim/hooks/queries/collaboration.ts`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/**`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/production-tasks/**`
- `apps/sim/lib/production-tasks/**`

具体实现：

- Coordinator 只做任务拆解、分派、合并和审核，不直接绕过工种权限写画布。
- 工种 Agent 有明确 profile、skills、allowed tools、scope 和 output contract。
- handoff message：包含任务目标、输入节点、期望输出、验收标准、截止时间、可写范围。
- review flow：工种结果先作为 proposal/submission，经过 Confirm 或 reviewer 批准后写回。
- 冲突处理：两个 Agent 修改同一节点字段时必须进入冲突解决，不自动覆盖。
- UI：展示 Agent activity、pending reviews、task status、结果节点。

测试方案：

- coordinator plan tests：复杂需求拆成工种任务，不生成无权限写操作。
- handoff contract tests：必填字段、allowed tools、scope。
- conflict tests：同一 nodeId+field 多写冲突。
- review/approval tests：未批准不写回，批准后 verify。
- 手工：导演创建任务 -> 工种生成结果 -> 提交 -> 审核 -> 写回画布。

验收标准：

- 多 Agent 不等于并发乱改画布；所有写入都可追踪、可审核、可回滚。
- 用户能看懂每个 Agent 做了什么、为什么需要确认。

### 阶段八详细方向：评测、观测和发布硬化

目标：

- 建立发布级质量体系，让 Local Canvas Agent 的每次变更都能被自动化和手工证据覆盖。

要改的文件：

- `docs/local-canvas-agent-*.md`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/**/*.test.ts`
- `apps/sim/app/workspace/[workspaceId]/**/*.test.tsx`
- 可能新增 `apps/sim/e2e/local-canvas-agent/**` 或 repo 现有浏览器测试目录。
- logging/observability 相关服务和 dashboard 配置。

具体实现：

- Eval harness：把 A-H 手工用例转成可 replay 的 API/SSE fixtures，断言 tool calls、state diff、final answer。
- Browser automation：覆盖 ReactFlow DOM nodes/edges/position、Confirm/Revise、Stop、生成状态。
- Observability：记录 intent decision、plan kind、tool count、verify success/failure、abort reason、generation duration、redaction hits。
- Security scan：测试集泄露 grep、secret redaction、scope isolation、tool allowlist。
- Release gates：最小单元、入口/API、UI、api-validation、type-check、biome、关键手工 smoke。
- Rollback playbook：每个阶段 commit/flag 可回滚；旧 `content-canvas-agent.ts` 何时删除或冻结。

测试方案：

- 每个 PR 自动跑最小 local-canvas-agent 单元。
- 每个阶段 PR 跑对应 UI/API targeted tests。
- 每个 release candidate 跑浏览器 smoke + provider opt-in smoke。
- 每次 prompt/guard 改动跑泄露复查。

验收标准：

- 新增能力都有自动化断言和手工 smoke。
- 线上问题能通过 log 中的 chatId/streamId/workflowId/toolName/verify result 定位。
- 可以安全回滚到上一阶段。

## 4. 第一条执行线：阶段二内部拆分

### 阶段 2.0：冻结验收基线和可复现测试夹具

目标：把“第一阶段已经接通”转成可反复验证的基线，避免后续改动时不知道是 agent、UI、provider 还是测试数据坏了。

要改的文件：

- `docs/local-canvas-agent-phase-1-manual-test-checklist-zh.md`
- `docs/local-canvas-agent-phase-1-retest-notes-zh.md`
- 新增测试夹具时优先放在 `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/*.test.ts` 或 `apps/sim/app/workspace/[workspaceId]/.../*.test.tsx`

具体实现思路：

- 固化一套最小 seed workflow：空白 workflow、完整 text-image-video-audio 内容链、带孤立节点 workflow、带 document/table/image_editor 只读节点 workflow。
- 为手工清单每项记录四类断言：SSE/tool events、后端 workflow state diff/hash、ReactFlow DOM、最终回答。
- 把“browser evidence”和“API/SSE evidence”分开记录，不再用服务端单元测试替代浏览器证据。
- 保留 C 组临时日志不提交，但在 docs 中写出如何复现。

数据流/调用链变化：无业务数据流变化。

新增/修改测试：

- 补 `planner.test.ts` 中“先讨论小红书小猫 AI 视频工作流”必须 `consult_design/read_only/no patch`。
- 补 `runtime.test.ts` 中 consult intent 不调用 mutation tool。
- 补 `copilot-tab.test.tsx` 中 local mutation tool success 触发 workflow reload，non-mutation 不触发。

手工验证：

- 用当前浏览器页面复测 A-03、D-01、F-01、H-04 四个最容易暴露入口/写回/刷新/取消问题的点。
- 每次记录 `chatId`、`workflowId`、Network 中 `/api/mothership/chat` 和 `/api/mothership/chat/abort`，以及 ReactFlow nodes/edges 数量。

风险和回滚点：

- 只改文档和测试夹具，风险低。
- 如测试夹具过重，先只落单元夹具，不落浏览器自动化。

验收标准：

- 有一份能按顺序复测的 checklist。
- 任一失败都能定位到 routing/intent/planner/tool/verify/UI/provider/security 中至少一层。

### 阶段 2.1：Intent / Task Policy v2，先解决“讨论 vs 执行”

目标：让 Agent 自行判断用户当前意图，并把 read/propose/mutate/generate 权限变成不可绕过的运行时策略。

要改的文件：

- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/intent.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/routing.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/planner.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/tool-loop.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/models/actor.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/models/summarizer.ts`
- 对应 tests：`routing.test.ts`、`planner.test.ts`、`tool-loop.test.ts`、`runtime.test.ts`、`models/*.test.ts`

具体实现思路：

- 将 `classifyLocalCanvasUserIntent()` 输出从单一 reason 扩展为：`userIntent`、`mutationPolicy`、`canvasReadPolicy`、`confidence`、`evidence[]`、`requiresUserConfirmation`。
- 增加任务态输入：读取 memory 中 `taskState.openQuestions`、`lastObservation` 和 pending plan 状态，用于判断 follow-up 是继续讨论还是执行。
- 将 consult/propose/mutate 判断分为三层：
  - 明确非画布：天气、新闻、考试、通用编程问题等，除非同时出现“创建节点/当前画布/工作流”。
  - 明确执行：创建、新增、修改、写回、生成并写回、连接、布局等强 mutation 动词。
  - 讨论/提案：先讨论、怎么设计、先规划、给方案、等我确认、不要改画布等，只允许 read 或 propose。
- 允许模型参与模糊判断，但模型输出必须被 policy guard 截断：只要 policy 是 read_only/propose_only，tool-loop 不执行 `canvas.apply_patch` / `canvas.generate_node_output`。
- final answer 中显式说明当前模式：例如“我先不改画布，先给你一个设计方案”。不要读当前画布，除非用户说“基于当前画布/选中节点”。

数据流/调用链变化：

```text
context + memory + message
  -> intent decision with confidence
  -> planner receives immutable policy
  -> planner may propose patch, but cannot escalate policy
  -> tool-loop filters mutation tools by policy
  -> actor answers in current mode
  -> summarizer stores openQuestions and task goal
```

新增/修改测试：

- `routing.test.ts` / 新增 `intent.test.ts`：
  - “先告诉我工作流如何设计，和我讨论一下” => `consult_design/read_only/canvasReadPolicy none|optional`。
  - “根据当前画布创建一条内容链” => `mutate_canvas/allow_mutation/required`。
  - “先给我 patch，等我确认再执行” => `propose_plan/propose_only`。
  - “高考可能会考什么” => `non_canvas/read_only/none`。
  - “以高考为主题创建短视频内容链” => `mutate_canvas/allow_mutation/required`，避免 A-03 过度拦截。
- `planner.test.ts`：consult intent 不产生 patch/generateNodeIds；propose only 只调用 `canvas.propose_patch`。
- `tool-loop.test.ts`：policy 为 read_only/propose_only 时，即使 plan 中有 mutation hints 也不执行 mutation。
- `runtime.test.ts`：non_canvas 不读画布；consult 不改画布；manual confirm 正常执行 pending plan。

手工验证：

- 输入“小红书小猫 AI 视频生成工作流，先告诉我如何设计，和我讨论一下”。
- Network/SSE 预期：无 `canvas.apply_patch`、无 `canvas.generate_node_output`；可无 canvas tool，或仅在用户明确“基于当前画布”时读 summary。
- 后端 state hash 不变，ReactFlow DOM 不变。
- 回答应包含：脚本/分镜/主视觉/视频/配乐节点建议、需要确认的问题、下一步可以让我创建节点的提示。

风险和回滚点：

- 风险：启发式过严，导致本该创建的请求变成讨论。
- 回滚点：单独回滚 intent/policy commit，不影响 patch/generation/UI。

验收标准：

- “先讨论”类请求不改画布。
- “创建/修改/生成并写回”类请求仍能正常改画布。
- A-03 不回归，主题型画布任务不被误判为 non_canvas。

### 阶段 2.2：Planner v2，提升内容链质量并禁止原始用户请求直写节点

目标：让生成节点从“粗糙模板 + 用户原话”升级为“结构化内容生产计划 + 可编辑字段”，解决用户感受到的“工作流粗糙、把我提供的文案塞进节点”的问题。

要改的文件：

- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/planner.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/{text,image,video,audio}.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/canvas-patch.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/canvas-verify.ts`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-block.tsx`（仅当字段展示/默认参数需要配合）

具体实现思路：

- 拆出 `buildContentChainPlan()`：输入用户主题、平台、受众、风格、已有画布摘要，输出节点清单、字段、连接、布局。
- 对每个节点区分三类字段：
  - `title`：短、人可读。
  - prompt field：给生成器的清晰 prompt，例如 `aiPrompt/videoPrompt/audioPrompt`。
  - content field：真实内容，例如 text 的 `contentHtml`，不能直接写“创建一条用于...”这种命令句。
- 对 text 节点增加“脚本草稿模式”：如果用户要求创建工作流但没要求生成最终正文，`contentHtml` 写一个轻量占位脚本结构，而不是原始命令；`aiPrompt` 保存生成意图。
- 对 image/video/audio 节点只写生成 prompt 和参数，不在 `file` 里伪造结果。
- 增加 prompt hygiene：移除“创建/新建/排好/连接”等操作词，只保留创作主题、主体、风格、平台、约束。
- Planner 输出 patch 前做一次 `sanitizeContentChainFields()`，防止 raw user instruction 泄漏到最终 `contentHtml`。

数据流/调用链变化：

```text
message + optional canvas summary
  -> extractCreativeBrief(theme/platform/audience/style/constraints)
  -> buildContentChainPlan
  -> sanitize node fields
  -> patch validate
  -> apply + verify
```

新增/修改测试：

- `planner.test.ts`：
  - “创建一条用于小红书短视频的内容链...”创建 4 个节点和 3 条边。
  - text 节点 `contentHtml` 不等于用户原始命令，不包含“创建一条/包含四个节点/从左到右排好”。
  - image `aiPrompt` 聚焦主视觉；video `videoPrompt` 聚焦动态画面；audio `audioPrompt` 聚焦配乐。
  - 小猫 AI 视频主题能抽出“小猫/小红书/短视频/治愈或种草”而不是只复制命令。
- `canvas-verify.test.ts`：verify create/update/connect/layout 仍通过。
- `content-block` 相关测试：字段默认展示不因新增参数断裂。

手工验证：

- 空白画布输入：“创建一条用于小红书短视频的小猫 AI 视频内容链，包含脚本、主视觉、视频、配乐，并按生产顺序连接。”
- 预期：节点内容具体，脚本节点不是原始命令；image/video/audio prompt 是可直接生成的创作 prompt；画布从左到右展示并连接。
- 再输入“先给我方案，不要创建节点”：只回答方案，不改画布。

风险和回滚点：

- 风险：过度清洗导致用户精确文案被丢失。解决：当用户明确“把这段文案写入文本节点”时，允许原文作为 content；当用户是命令句时不直写。
- 回滚点：回滚 Planner v2，不影响 intent policy。

验收标准：

- D-01 内容链通过，且内容质量达到“可编辑可生成”。
- 用户原始命令不再直接成为文本节点正文。
- E-01 文本重写不回归，不出现 markdown/json/system/user-request 残片。

### 阶段 2.3：Memory / Context v2 提前落地，但绑定 verify 语义

目标：提前强化长上下文能力，支持长会话和长任务，同时避免 memory 记录失败、取消或未确认的画布修改。

要改的文件：

- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/memory.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/models/summarizer.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/context-manager.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/types.ts`
- 可能新增 `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/context-budget.ts`
- 后续如需要 DB schema 扩展，再单独设计 migration；本阶段优先复用现有 `memory` 表。

具体实现思路：

- 将 memory 更新拆成三类：
  - `conversationSummary`：用户目标、偏好、最近决定。
  - `canvasSummary`：只在成功读取画布或 verify 成功后更新，记录 workflow state 版本/节点数/边数摘要。
  - `taskState`：只把 verify 成功的 apply/generate/materialize/submit 标为 completedSteps；失败、取消、pending plan 只进入 `lastObservation` 或 `openQuestions`。
- 引入 `memoryUpdatePolicy`：
  - aborted turn：不写 completedSteps，只写 lastObservation 或不写。
  - failed verification：不写 completedSteps。
  - consult/propose：更新 openQuestions，不写 completedSteps。
  - confirm 执行成功：写 completedSteps。
- `context-manager.ts` 将长期 memory 与 recent messages 区分预算，长历史只保留近 N 条 + summary。
- 增加 token/字符预算可观测输出：在 debug/log 或 tests 中能看到每层截断情况。
- 为未来 team/task scope 预留 `scope` 字段，但本阶段仍只启用 personal，避免权限扩大。

数据流/调用链变化：

```text
runLocalCanvasAgent
  -> load memory
  -> context layers: profile/permissions/skills/canvas/selected/attached/recent/memory/user
  -> planner/tool-loop
  -> observations with verified/failure/aborted semantics
  -> summarizer merge by memoryUpdatePolicy
  -> save memory
```

新增/修改测试：

- `models/summarizer.test.ts`：
  - consult turn 产生 openQuestions，不产生 completedSteps。
  - `canvas.apply_patch` success + `canvas.verify_patch` success 才记 completedSteps。
  - generation verify success 记 completedSteps。
  - abort/failure 不记 completedSteps。
  - private key/url/path/id 被 redacted。
- `context-manager.test.ts`：
  - 长历史压缩后保留 summary + recent messages。
  - 大 selected node detail 不挤掉 User Request。
  - memory/context budget 随 `localCanvasContextWindowTokens` 或 model 增大而扩展。
- `memory.test.ts`（如新增）：key 仍 personal/user/workspace/workflow/agent/chat 隔离。

手工验证：

- 连续对话：先讨论小猫工作流 -> 用户补充“偏治愈风” -> 用户说“现在创建节点”。
- 预期：第三轮能记住“偏治愈风”，但前两轮不改画布；创建后 completedSteps 才记录。
- 取消生成后继续问“刚才完成了吗？”预期回答不能声称已完成。

风险和回滚点：

- 风险：memory 过强导致旧任务影响新任务。解决：summary 中记录 task goal，并在 intent 中识别新主题时降低旧 memory 权重。
- 风险：DB memory 脏数据已存在。解决：版本字段仍为 `version: 1`，必要时用 `memorySchemaVersion` 局部迁移。
- 回滚点：单独回滚 memory/context v2，不影响前两阶段。

验收标准：

- 长对话不靠全部历史也能跟进。
- 失败、取消、未确认操作不会进入 completedSteps。
- 不暴露 secret/path/url/id。

### 阶段 2.4：Patch / Verify / Adapter v2，降低“说改了但没改”的概率

目标：把 patch 和 verify 从“能用”做成“问题可定位”，所有写操作都能映射到目标 nodeId、字段和 UI 展示。

要改的文件：

- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/canvas-patch.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/canvas-verify.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/canvas-tools.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/*`
- `apps/sim/lib/copilot/tools/server/workflow/edit-workflow/**`（只在必要时）
- `apps/sim/stores/workflows/workflow/validation.ts`（如涉及 edge normalization）

具体实现思路：

- 为每个 patch operation 生成 `operationId` 或 stable reference，verify 输出逐项结果：`operationId/nodeId/field/expected/actual/success`。
- `create_node` verify：确认 clientNodeId -> real nodeId 映射，确认 kind/title/fields。
- `update_node` verify：字段级 exact/deep compare，对 `contentHtml` 增加 normalized text compare。
- `connect` verify：source/target/handle 兼容旧 content-reference edge，但 output 标注实际 edge id。
- `layout_nodes` verify：检查目标节点 position 顺序和方向，而不是只看存在。
- `generate` verify：继续强制 `nodeId + field`，并确认 file 的 safe metadata，不在 observation 中暴露 key/url/path。
- 把 `normalizeLegacyCanvasPatch()` 保留为工具边界兼容层；底层 `validateLocalCanvasPatch()` 仍严格。

数据流/调用链变化：

```text
planner patch
  -> normalize only at tool boundary
  -> validate strict patch
  -> editWorkflowServerTool
  -> load fresh snapshot
  -> per-operation verify result
  -> observation summary + detailed output
  -> actor final answer may only say completed if verify success
```

新增/修改测试：

- `canvas-patch.test.ts`：legacy `nodes/edges/addNodes/addEdges/instructions` 输入归一化；非法输入明确错误。
- `canvas-verify.test.ts`：create/update/connect/layout/generation 全字段断言；layout 位置断言；失败输出可定位字段。
- `canvas-tools.test.ts`：apply_patch verify failure 时 `success=false`；output 中不泄露 file key/url/path。
- `models/verifier.test.ts`：最终回答不能在 verify false 时说完成。

手工验证：

- D/E/F/G 类用例每次检查 SSE 中 `canvas.verify_patch` 是否包含目标字段。
- 浏览器确认字段 UI 和后端 state 一致，例如 text node 正文、image prompt、video duration、audio prompt。

风险和回滚点：

- 风险：verify 过严导致合法但格式略有差异的 HTML/JSON 被判失败。解决：每个字段定义 compare mode。
- 回滚点：可单独回滚 verify v2，保留 planner/intent。

验收标准：

- 任一写入失败能指出 nodeId 和字段。
- final answer 与 verify 一致。
- D/E/F/G/H 回归失败时可按 verify result 定位。

### 阶段 2.5：UI 生命周期 v2，稳定 Stop、Confirm/Revise、live refresh 和状态可见性

目标：让用户在右侧 Copilot 中明确看到 Agent 当前是在读、计划、写、验证、停止还是等待确认；画布 state 和 ReactFlow DOM 始终同步。

要改的文件：

- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/copilot-tab.tsx`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/workflow.tsx`
- `apps/sim/app/workspace/[workspaceId]/home/hooks/use-chat.ts`
- `apps/sim/app/workspace/[workspaceId]/home/components/mothership-chat/mothership-chat.tsx`
- `apps/sim/app/workspace/[workspaceId]/home/components/message-content/components/options/options.tsx`
- `apps/sim/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags.tsx`
- `apps/sim/app/api/copilot/chat/abort/route.ts`
- `apps/sim/lib/copilot/request/session/{abort,buffer}.ts`

具体实现思路：

- 将 tool status 映射成 UI：reading/planning/applying/verifying/generating/cancelled/failed/completed。
- `copilot-tab.tsx` 当前 reload 兜底保留，但增加 debounce 和 source reason，避免每个 tool result 触发过多 reload。
- `workflow.tsx` 继续维护 committed state -> display nodes reconcile；增加测试或调试事件证明 position 和 edge path 更新。
- Confirm/Revise pending plan：第一阶段仍不持久化，但 UI 应展示过期风险；TTL 到期后 option 点击返回明确过期提示。
- Stop：前端同时 abort fetch + 调 abort route；按钮状态要尽快结束 loading；server log 使用 `createLogger` 输出 chatId/streamId/requestId。
- 长任务 Stop 后，tool-loop/provider 写回前必须再次检查 abort；UI 如果收到 late tool result，应标记 ignored 或不触发 reload。

数据流/调用链变化：

```text
SSE tool_call/tool_result/complete/cancelled
  -> useChat message state
  -> MothershipChat status display
  -> CopilotTab mutation reload policy
  -> workflow registry load state
  -> workflow.tsx displayNodes/reconcile
  -> ReactFlow DOM
```

新增/修改测试：

- `use-chat.test.ts`：stop 调 abort/stop，fetch abort 后状态结束。
- `send-button.test.tsx`：loading 时显示 stop，点击触发 stop。
- `options.test.tsx` / `special-tags.test.tsx`：Confirm/Revise option 渲染、点击 payload 正确。
- `copilot-tab.test.tsx`：local canvas mutation tool success/stream end/send settled 触发 reload；失败 tool 不 reload；legacy `edit_workflow` 仍走 diff store。
- `workflow` 或 helper tests：position-only committed state update 能 reconcile display node position；旧 content-reference edge normalization 不回归。

手工验证：

- F-01：布局后不刷新页面，ReactFlow DOM transform 和 edge path 同步。
- F-02/F-03/F-04：manual mode 下 plan 展示、Confirm 执行、Revise 不执行、过期提示。
- H-04：生成进行中点击 Stop，Network 有 abort/stop，30 秒后 workflow hash 不变。

风险和回滚点：

- 风险：reload 过多造成闪烁或覆盖拖拽中的本地 position。解决：拖拽中不 reconcile；mutation reload debounce。
- 回滚点：UI lifecycle commit 可独立回滚，后端 runtime 不受影响。

验收标准：

- 用户能明确知道 Agent 当前状态。
- successful mutation 后 state 和 DOM 同步。
- cancel 后不迟到写回。

### 阶段 2.6：Generation Adapter v2，拆清“设置 prompt”和“真实生成”

目标：让 text/image/video/audio 生成写回更稳定，并为后续 document/table/image_editor 扩展准备统一 adapter。

要改的文件：

- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/canvas-tools.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/*`
- `apps/sim/lib/content-canvas/text-executor.ts`
- `apps/sim/lib/generated-media/{image,video,audio}/**`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/**`

具体实现思路：

- 为 adapter 增加 `generation` contract：input fields、output field、preconditions、writeback normalizer、redaction policy。
- `canvas.generate_node_output` 只接受 adapter 支持的节点；unsupported kind 返回安全错误。
- Text generation：区分 `aiPrompt` 和 `contentHtml`，生成失败不清空旧正文。
- Image/video/audio：生成服务返回 file 后统一 `normalizeGeneratedFileForWriteback()`，写回后 verify file exists/safe fields。
- Video first frame：明确从上游 image file 或 referencedMedia 读取，缺失时不使用伪引用。
- 真实 provider smoke tests 继续 opt-in；默认单元测试使用 fake provider。

数据流/调用链变化：

```text
canvas.generate_node_output(nodeId)
  -> adapter.generation.preconditions
  -> service/provider with abortSignal
  -> normalize output
  -> updateNodeAfterGeneration
  -> assertGeneratedFieldWritten
  -> verify_patch generation nodeId+field
```

新增/修改测试：

- `canvas-tools.test.ts`：四类生成成功、失败不清空、abort before/after provider、unsupported node kind。
- provider tests：abortSignal 传递；fake provider latency cancel；file metadata normalization。
- UI tests：生成后 content-block 预览刷新。

手工验证：

- G-01 到 G-04：真实生成写回，字段级 verify，UI 预览刷新。
- G-05：故意无效 model/provider error，旧字段不变，最终回答不报完成。

风险和回滚点：

- 风险：真实 provider 慢、额度不足、远端任务不可取消。验收边界定义为“本地停止后不写回”。
- 回滚点：generation adapter commit 可回滚，不影响 patch-only D/E/F。

验收标准：

- 生成成功时写到目标字段，失败时不污染旧值。
- abort 后本地不写回。
- 不泄露 key/url/path。

### 阶段 2.7：Tool Loop v2，观察-重规划-恢复

目标：把当前固定 `MAX_STEPS` 的 inspect/act/verify 循环升级为更像 Agent 的多步 loop：失败能恢复，工具结果能摘要，下一步由状态驱动。

要改的文件：

- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/tool-loop.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/tool-executor-bridge.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/observation.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/models/actor.ts`
- 可能新增 `tool-state.ts` / `tool-summary.ts`

具体实现思路：

- 将 loop state 明确化：`phase`、`stepIndex`、`toolQueue`、`completedTools`、`failedTools`、`pendingVerify`、`aborted`。
- 工具调用统一包装：before/after abort check、permission check、progress event、error classification、redacted output summary。
- 失败恢复策略：
  - read/search 找不到节点：不要 mutate，提问或说明。
  - patch validation failed：不给 apply，返回可修复错误。
  - verify failed：不说完成，允许一次 inspect/replan。
  - generation failed：停止后续 generation，不清空旧字段。
- 工具结果进入 context 时摘要化，避免大 JSON 挤爆后续 planner。
- 暂不引入并发 tool execution；借鉴 Claude Code 的 read-only 并发思想，但本项目当前坚持单线，先保证可定位。

数据流/调用链变化：

```text
plan.steps
  -> toolQueue
  -> execute tool with lifecycle event
  -> observation summary + detail pointer
  -> verify/recover decision
  -> actor final answer
```

新增/修改测试：

- `tool-loop.test.ts`：max steps、abort、policy filtering、verify failure、read failure、generation verify。
- `tool-executor-bridge.test.ts`（如新增）：tool title、redaction、progress event。
- `models/actor.test.ts`：不同失败类型的用户可读回答。

手工验证：

- H-01/H-02/H-03：错误安全停住。
- 一个故意错误 patch 或不存在节点请求，确认回答能指出原因而非泛泛失败。

风险和回滚点：

- 风险：loop 状态复杂化引入重复工具调用。解决：保留 seen key 和 max step，并添加 detailed tests。
- 回滚点：单独回滚 tool-loop v2，保留 planner/verify。

验收标准：

- 失败路径不损坏画布。
- 每个 tool call 的生命周期可追踪。
- final answer 与 observations 一致。

### 阶段 2.8：Team / Task Scope 设计先行，再实现最小闭环

目标：把 runtime design 中 team/task scope、多工种、任务流从“类型占位”变成有权限边界的最小实现。但本阶段先写设计和 API contract，不直接大改。

要改的文件：

- `docs/local-canvas-agent-runtime-design-zh.md` 或新增 team/task scope design doc。
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/types.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/context-manager.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/memory.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/permissions.ts`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/context-tools.ts`
- `apps/sim/lib/production-tasks/**`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/production-tasks/**`

具体实现思路：

- 明确 scope：
  - personal：当前用户 + 当前 workflow/chat。
  - team：workgroup 成员可读，team skills/profile 生效。
  - task：绑定 production task，source/assignee workgroup 和 task participants 可读写。
- 设计 `LocalAgentSessionScopeResolver`，所有 memory/history/tool 权限从 resolver 输出。
- task tools 当前已有 `read_tasks/update_task_result/submit_task_result` 雏形，后续要补 contract、权限和 UI 状态。
- team/task memory 与 personal memory 不共享 key；summary 中标注 scope 和 visibility。
- 所有 team/task 写操作必须过权限校验，不能因为是本地 agent 绕过。

数据流/调用链变化：

```text
workspace/workflow/chat/task/workgroup
  -> scope resolver
  -> permissions + agent profile + skills + memory key
  -> context tools available set
  -> task/team writes audited
```

新增/修改测试：

- scope resolver tests：personal/team/task 权限矩阵。
- memory key tests：不同用户/team/task 不串。
- production task tool tests：无权限不能 read/update/submit。
- UI tests：skill action create_task/submit_task 与 selected node 绑定。

手工验证：

- 个人画布不会读团队会话。
- 团队画布加载正确工种 skills。
- task scope 只能提交当前任务允许的节点。

风险和回滚点：

- 风险：权限扩大和数据串租户。这是后续最高风险阶段，必须先 design review。
- 回滚点：先提交 design，再逐步提交 resolver、memory、tools、UI。

验收标准：

- 没有绕过 workspace/workgroup/task 权限。
- scope 可测试、可审计、可解释。

### 阶段 2.9：多工种/多 Agent 协作，放到单用户和 task scope 稳定之后

目标：支持导演/灯光/舞美/剪辑等多工种 Agent 协作，但不在当前阶段抢跑。

范围：

- 多 Agent profile 和 skill registry。
- 任务分派、结果提交、审核和返工。
- 多用户可见性、通知、冲突处理。
- Agent 间消息、handoff、review。

不提前实现的原因：

- 当前用户痛点是“右侧 Copilot 能否正确理解和操作当前画布”，不是多人协作。
- 多 Agent 会放大 intent、memory、permission、UI 状态问题。
- 必须等 task scope、memory scope 和 tool lifecycle 可审计后再做。

## 5. 测试方案：尽量全覆盖并能定位问题

测试原则：每个关键手工用例都要有“状态、工具、回答、UI”四断言。

```text
用户输入
  -> Network payload 是否正确
  -> SSE tool call/result 是否符合 intent/policy
  -> workflow state 是否按预期变化或不变
  -> ReactFlow DOM 是否同步
  -> final answer 是否与 verify/observations 一致
```

### 4.1 最小单元测试集合

在 `apps/sim` 下优先运行：

```powershell
cd apps/sim
bunx vitest run "lib/copilot/request/lifecycle/local-canvas-agent"
```

重点覆盖：

- `routing.test.ts`：canvas/non_canvas/ambiguous。
- `planner.test.ts`：consult/propose/mutate/generate、D/E/F/H 用例、内容链字段质量。
- `tool-loop.test.ts`：policy filtering、abort、verify after generate、max steps。
- `canvas-patch.test.ts`：patch normalization、operation building。
- `canvas-verify.test.ts`：字段级 verify、layout verify、generation verify。
- `canvas-tools.test.ts`：apply/generate/read/schema/redaction/abort。
- `context-manager.test.ts`：selected nodes、attachments、context budget、memory layer。
- `context-tools.test.ts`：read_file/search_workspace/query_knowledge/task tools redaction。
- `models/{actor,verifier,summarizer,config}.test.ts`：final answer、failure wording、memory summary、model request。

失败定位：

- routing/intent fail：看 `routing.ts` / `intent.ts`。
- plan 不对：看 `planner.ts` 和 `buildTokenAwareLocalAgentContext()`。
- tool 没执行或执行错：看 `tool-loop.ts`。
- patch 参数错误：看 `canvas-tools.ts` normalize 层和 `canvas-patch.ts`。
- state 变了但 verify fail：看 `canvas-verify.ts` 或 adapter field mapping。
- 答案说完成但没完成：看 `models/verifier.ts` / `models/actor.ts`。

### 4.2 入口 / 生命周期 / API 测试

```powershell
cd apps/sim
bunx vitest run "lib/copilot/request/lifecycle/run.test.ts" "lib/copilot/request/lifecycle/start.test.ts"
bunx vitest run "app/api/copilot/chat/abort/route.test.ts" "app/api/copilot/chat/stop/route.test.ts" "lib/copilot/request/session/abort.test.ts"
```

覆盖：

- `content_canvas_v1` 入口进入 `runLocalCanvasAgent()`，旧 `content-canvas-agent.ts` 不回到生产路径。
- abort route 能按 chatId/streamId 停止 active request。
- buffer/session 在 abort 后不继续输出完成态。

失败定位：

- 入口没进 agent：`run.ts`。
- Stop 无效：`use-chat.ts`、abort/stop route、`session/abort.ts`、`session/buffer.ts`。
- late writeback：`tool-loop.ts`、`canvas-tools.ts`、provider abortSignal。

### 4.3 UI / Hook 测试

```powershell
cd apps/sim
bunx vitest run "app/workspace/[workspaceId]/home/hooks/use-chat.test.ts"
bunx vitest run "app/workspace/[workspaceId]/home/components/user-input/user-input.integration.test.tsx"
bunx vitest run "app/workspace/[workspaceId]/home/components/user-input/components/send-button.test.tsx"
bunx vitest run "app/workspace/[workspaceId]/home/components/message-content/components/options/options.test.tsx" "app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags.test.tsx"
bunx vitest run "app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/copilot-tab.test.tsx"
```

覆盖：

- payload 中带 `workflowCopilotMode: content_canvas_v1`、`confirmationMode`、`thinkingLevel`、`autoSelectionContexts`。
- 选中 text/image/video/audio 形成正确 `blockIds`。
- Stop button 显示和点击行为正确。
- Confirm/Revise option 渲染和回传 token 正确。
- local canvas mutation success 触发 workflow reload。

失败定位：

- agent 不知道选中节点：`workflow.tsx` selection store、`copilot-tab.tsx` `autoSelectionCards`、`user-input.tsx` payload。
- Confirm/Revise 不工作：`special-tags.tsx` / `options.tsx` / `runtime.ts` pending plan。
- 后端 state 已变 UI 未变：`copilot-tab.tsx` reload、`useWorkflowRegistry`、`workflow.tsx` reconcile、socket workflow-updated。

### 4.4 API validation / type / biome

PR 前必须保持：

```powershell
bun run check:api-validation
cd apps/sim
bun run type-check
```

针对改动文件的格式/静态检查优先用：

```powershell
bunx biome check --no-errors-on-unmatched <changed-files>
```

何时跑：

- 只改 docs：跑 `git diff --check -- docs/<file>.md` 即可。
- 改 runtime/planner/tool：跑 local-canvas-agent 单元 + targeted biome。
- 改 API route/contract：必须跑 `bun run check:api-validation`。
- 改 UI：跑对应 `.test.tsx` + targeted biome。
- 阶段 PR 前：跑 `apps/sim type-check`；如果 repo root type-check 有既有债务，要记录非本阶段失败。

### 4.5 SSE / 浏览器手工复测顺序

优先复测高风险失败点：

1. A-03：明显非画布请求。
   - 输入：“高考可能会考什么内容？”
   - 通过：无 canvas tool，state hash 不变，回答不读/不改画布。
2. Consult：先讨论小猫 AI 视频工作流。
   - 输入：“我想做一个小红书的小猫 AI 视频生成工作流，先告诉我工作流如何设计，和我讨论一下。”
   - 通过：无 mutation tool，state 不变，回答给方案和问题。
3. D-01：创建内容链。
   - 输入：“创建一条用于小红书短视频的小猫 AI 视频内容链，包含脚本、主视觉、视频、配乐，并按生产顺序连接。”
   - 通过：4 类节点 + 3 条边，text 正文不是原始命令，DOM 同步。
4. E-01/E-02/E-03/E-04：字段更新。
   - 通过：目标 nodeId 正确，目标字段变化，verify 指出字段。
5. F-01/F-02/F-03/F-04：live refresh 和 manual。
   - 通过：不刷新页面 DOM 同步；Confirm 执行；Revise 不执行；TTL 过期明确。
6. G-01 到 G-05：生成写回与失败。
   - 通过：成功写目标字段；失败不清空；final answer 与 verify 一致。
7. H-01 到 H-04：安全边界和取消。
   - 通过：不存在/只读/破坏性请求不损坏画布；Stop 后无迟到写回。
8. 长上下文回归。
   - 输入多轮讨论/补充/执行，观察 memory 是否保留关键偏好且不记错误完成。

浏览器观察点：

- Network：`/api/mothership/chat` request payload、SSE chunks、`/api/mothership/chat/abort`、`/api/mothership/chat/stop`、`/api/workflows/[id]/state`。
- SSE：`tool-call` / `tool-result` 的 toolName、success、output summary。
- Server log：chatId、streamId、workflowId、abort reason、verify result。
- DOM：`.react-flow__node` 数量、edge path 数量、node transform、节点字段展示。
- DB/API：workflow state hash、blocks/edges、目标字段。

### 4.6 失败定位矩阵

| 现象 | 优先检查 | 相关文件 |
|---|---|---|
| 非画布问题被拉回画布 | routing / intent | `routing.ts`、`intent.ts`、`runtime.ts` |
| “先讨论”仍改画布 | intent policy / planner fallback / tool-loop filtering | `intent.ts`、`planner.ts`、`tool-loop.ts` |
| 创建节点粗糙或复制用户命令 | content chain field builder | `planner.ts`、node adapters |
| 选中节点错 | UI selection payload / context selected ids | `workflow.tsx`、`copilot-tab.tsx`、`user-input.tsx`、`context-manager.ts` |
| `patch.operations` error | tool boundary normalizer | `canvas-tools.ts`、`canvas-patch.ts` |
| final answer 说完成但 state 没变 | verify / actor verifier | `canvas-verify.ts`、`models/verifier.ts`、`models/actor.ts` |
| 后端 state 变了但 DOM 没变 | Copilot reload / store hydration / ReactFlow reconcile | `copilot-tab.tsx`、`useWorkflowRegistry`、`workflow.tsx` |
| 生成失败清空旧值 | generation adapter writeback | `canvas-tools.ts`、generated-media services |
| Stop 后迟到写回 | abort signal propagation | `use-chat.ts`、abort route、`tool-loop.ts`、`canvas-tools.ts`、providers |
| file key/url/path 泄露 | redaction | `redaction.ts`、`context-manager.ts`、`context-tools.ts`、`canvas-tools.ts` |
| memory 记错完成状态 | summarizer policy | `models/summarizer.ts`、`memory.ts` |

## 6. 测试集泄露复查方案

整改标准：生产 prompt/guard 不复制测试编号、完整测试输入或测试预期中文禁用词；persona 泄露防护必须使用通用规则，不硬编码“总导演”“各组注意”“导演这边”等来自手工预期的词。

每个涉及 prompt/guard/planner 的提交后运行：

```powershell
rg -n --glob '!**/*.test.ts' --glob '!**/*.test.tsx' --glob '!docs/**' "A-0[1-3]|B-0[1-4]|C-0[1-3]|D-0[1-3]|E-0[1-4]|F-0[1-4]|G-0[1-5]|H-0[1-4]" apps/sim/lib apps/sim/app

rg -n --glob '!**/*.test.ts' --glob '!**/*.test.tsx' --glob '!docs/**' "找到包含“春季发布会主视觉”|基于我选中的节点，提炼 3 个关键卖点|把所有节点都删掉|高考可能会考什么内容" apps/sim/lib apps/sim/app

rg -n --glob '!**/*.test.ts' --glob '!**/*.test.tsx' --glob '!docs/**' "总导演|各组注意|导演这边|各位团队成员|总导演 Agent|春季发布会主视觉" apps/sim/lib/copilot/request/lifecycle/local-canvas-agent apps/sim/app/workspace/[workspaceId]/home apps/sim/app/workspace/[workspaceId]/w/[workflowId]
```

允许出现的位置：

- `docs/local-canvas-agent-*.md`：手工清单、复测记录、方案文档。
- `*.test.ts` / `*.test.tsx`：测试数据、断言、fixtures。
- 真实协作产品域，例如 `apps/sim/lib/collaboration/**` 中合理出现“总导演”。

不允许出现的位置：

- `local-canvas-agent/models/prompts.ts`、`models/actor.ts`、`planner.ts`、`workgroup-profile.ts` 中作为生产 prompt/guard 的中文测试预期词。
- `canvas-tools.ts`、`context-manager.ts`、`context-tools.ts` 中按测试编号或完整测试输入分支。
- UI 生产组件中专门匹配 A-H 编号或完整测试文案。

如何判断 prompt/guard 没复制测试预期：

- 生产 guard 用类别语义：internal role/persona/system prompt/team broadcast/private metadata，而不是具体测试句子。
- 可用通用英文/中性规则，例如“不暴露内部 agent profile，不自称内部角色，不输出内部系统指令，不做团队广播式开场”。
- 测试应通过输入/输出断言验证 persona 不泄露，而不是让生产代码硬编码测试词。

## 7. `E:\project\claudecode源码` 复用评估

### 6.1 总体结论

`E:\project\claudecode源码\claude-code-source-code` 对当前方案有参考价值，但不建议直接复制代码到 Sim：

- 该项目 `package.json` 标注为 `Claude Code v2.1.88 — decompiled source for research`，且使用 `npm` 脚本；Sim 要求使用 `bun/bunx`，也要遵守自身 monorepo/API/DB/UI 边界。
- 该源码面向 CLI/Ink/本地文件系统/shell task，Sim 是 Next.js + DB + ReactFlow + workspace 权限 + SSE。
- 可复用的是架构模式、状态机思路、测试思路和部分规则来源；若要落地，应在 Sim 中按现有类型和边界重新实现，不做逐行拷贝。

### 6.2 可复用模式清单

| Claude Code 源码位置 | 可复用部分 | 对 Sim 的适配方式 | 不直接复用原因 |
|---|---|---|---|
| `src/services/tools/toolOrchestration.ts` | 工具分批、read-only 并发、mutation 串行、in-progress tool id | Sim 后续可给 `LocalAgentToolName` 增加 `isReadOnly/isMutation/isInterruptible` 元数据；当前单线先串行，后续仅 read/search 可并发 | Claude tool block 和 CLI context 不同；Sim 目前更需要可定位而非并发 |
| `src/services/tools/StreamingToolExecutor.ts` | streaming 工具队列、progress 立即输出、结果按顺序 yield、synthetic cancel/error | 可改造 `tool-loop.ts` 为显式 queue/state，SSE 输出 queued/executing/completed/cancelled | 依赖 Claude SDK message schema、CLI AppState 和 permission flow |
| `src/services/tools/toolExecution.ts` | 输入 schema 校验、permission/hook 前后置、progress、tool_result error 分类 | Sim 可在 `tool-executor-bridge.ts` 包装统一 lifecycle 和 error classification | Sim API contract、权限、logger、tool schema 都不同 |
| `src/utils/abortController.ts`、`src/utils/combinedAbortSignal.ts` | parent/child abort、timeout cleanup、listener cleanup、sibling cancellation | Sim 可实现 `createLocalAgentChildAbortController()` 和 `combineAbortSignals()`，用于 provider/tool/stream | 现有实现依赖 Node/Bun 运行细节；需要按 Next route runtime 验证 |
| `src/tasks/stopTask.ts`、`src/tasks/LocalAgentTask/*` | task status、kill、notified、防重复通知、progress tracker | 后续 task scope / background generation 可借鉴状态字段和 kill 语义 | Sim 当前 chat request 不是 CLI background task；需要 DB/route/session 设计 |
| `src/services/tokenEstimation.ts`、`src/utils/analyzeContext.ts` | token counting fallback、按类别显示 context 占用、工具/schema/token 分解 | Sim 可把 `context-manager.ts` 的字符预算升级为 category budget + optional token estimator | Claude 计数依赖 Anthropic/Bedrock/Vertex；Sim 多 provider，应抽象接口 |
| `src/utils/collapseReadSearch.ts`、`collapseHookSummaries.ts`、`toolUseSummaryGenerator.ts` | 大量 read/search/tool output 摘要化，保留短进度标签 | Sim 可用于 observation compaction 和 UI progress summary | CLI renderer 和 message schema 不同，只复用策略 |
| `src/memdir/memoryTypes.ts`、`memdir.ts`、`memoryScan.ts`、`findRelevantMemories.ts` | memory 类型 taxonomy、index + detail、frontmatter manifest、相关 memory 选择、stale caveat | Sim DB memory 可增加 type/scope/description/updatedAt；context 可先注入 manifest，再按 query 取 detail | Sim 记忆存在 DB，不是文件目录；团队可见性要走权限 |
| `src/services/teamMemorySync/secretScanner.ts`、`teamMemSecretGuard.ts` | 高置信 secret scanning、只返回 label 不返回 secret、写入共享 memory 前阻断 | Sim 可把 secret scanner 思路放到 `redaction.ts` 和 team/task memory write guard | 规则来源应独立采用公开 gitleaks/MIT 或自写，避免复制 decompiled 代码 |
| `src/skills/loadSkillsDir.ts`、`src/skills/bundled/*` | skill frontmatter、when_to_use、allowed-tools、路径约束、只加载 frontmatter 进上下文 | Sim skills 可从 DB skill 扩展类似 metadata：whenToUse、allowedTools、scope、tokenCost | Sim skills 当前来自 agent template/team override，不是文件系统 markdown |
| `src/tasks/InProcessTeammateTask/*` | teammate identity、pending messages、idle/shutdown、message cap | 后续多工种协作可借鉴 task state，不必现在实现 | 多 Agent 属后续大阶段；当前先稳单 Agent |

### 6.3 对当前方案最有价值的三类复用

第一类：工具生命周期状态机。

- 当前 Sim `tool-loop.ts` 已能跑 inspect/act/verify，但状态还偏隐式。
- 可借鉴 Claude Code 的 queue/status/progress/synthetic error，把每个 tool 的状态变成可测试对象。
- 落地后能直接改善 F/H 类问题定位：用户能看到是 planning、applying、verifying、cancelled 还是 failed。

第二类：长期记忆和上下文压缩。

- Claude Code 的 memdir 设计强调“索引短、详情按需读、记忆可能过期、代码现状以当前 checkout 为准”。
- Sim 当前 memory 已有 summary/taskState，但缺少 typed memory、relevance selection、staleness/freshness。
- 可在 DB memory 上复刻这些原则：`type`、`scope`、`description`、`updatedAt`、`sourceWorkflowId/taskId`、`visibility`。

第三类：secret guard。

- Claude Code 的 team memory 写入前 secret scan 思路适合 Sim 的 team/task memory 和附件上下文。
- Sim 需要在 redaction 层和 memory write 层双保险：进入 agent context 前脱敏，写入共享 memory 前扫描阻断。
- 不要只靠 final answer guard，因为 secret 一旦进 model context 就已经暴露。

### 6.4 不建议复用或暂缓的部分

- CLI/Ink UI、terminal/task panels：Sim 是 Web UI + ReactFlow，不能直接复用。
- Bash/PowerShell/FileEdit/Repo 操作权限：Sim Local Canvas Agent 不应获得本地 shell/file edit 权限。
- Claude SDK 特定 message/tool schema：Sim 有自己的 provider abstraction 和 SSE contract。
- read-only 工具并发：单线阶段先不做。等 tool state 和 verify 稳定后，仅对 `canvas.read_*`、`search_*`、`query_knowledge` 这类无副作用工具考虑并发。
- 多 teammate/swarm：放到 team/task scope 之后。

## 8. 建议提交/PR 顺序

按单线拆分，推荐 commit/PR：

1. `document local canvas post phase roadmap`
   - 只包含本文档。
   - 验证：`git diff --check -- docs/local-canvas-agent-post-phase-1-roadmap-and-test-plan-zh.md`。
   - 可独立回滚。
2. `fix local canvas intent task policy`
   - 覆盖阶段 2.1。
   - 测试：intent/routing/planner/tool-loop/runtime targeted tests。
   - 可独立回滚。
3. `improve local canvas content chain planning`
   - 覆盖阶段 2.2。
   - 测试：planner/canvas-patch/canvas-verify/content-block targeted tests。
   - 可独立回滚。
4. `harden local canvas memory compression`
   - 覆盖阶段 2.3。
   - 测试：summarizer/context-manager/memory targeted tests。
   - 可独立回滚，但需要注意 DB memory version 兼容。
5. `verify local canvas patch operations`
   - 覆盖阶段 2.4。
   - 测试：canvas-patch/canvas-verify/canvas-tools/models/verifier。
   - 可独立回滚。
6. `harden local canvas copilot lifecycle`
   - 覆盖阶段 2.5。
   - 测试：use-chat/send-button/options/special-tags/copilot-tab/workflow helper。
   - 可独立回滚。
7. `adapterize local canvas generation`
   - 覆盖阶段 2.6。
   - 测试：canvas-tools + generated-media fake provider + opt-in real smoke。
   - 可独立回滚。
8. `rework local canvas tool loop state`
   - 覆盖阶段 2.7。
   - 测试：tool-loop/tool-executor/actor/verifier。
   - 可独立回滚。
9. `design local canvas team task scope`
   - 先只提交设计文档和接口草案。
   - 后续再拆 resolver、memory scope、task tools、UI。
   - 这是大阶段，必须单独 review。

每个 commit 前继续遵守：

```powershell
git status --short
git diff
# 只 stage 本阶段文件，不用 git add .
git diff --cached --stat
git diff --cached --name-only
# 运行对应最小验证
```

不要 push，除非用户明确要求。
