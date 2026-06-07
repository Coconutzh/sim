# Local Canvas Agent 第一阶段下一步完整开发方案

日期：2026-06-07

工作区：`E:\project\sim`

分支：`fix/low-memory-canvas-interactions`

## 只读状态检查

本方案基于当前 checkout 的文档和代码复核写成。本次只编辑本文档，不改业务代码，不提交，不跑大范围耗时测试。

已执行：

```powershell
git status --short
git branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name '@{u}'
```

当前分支为 `fix/low-memory-canvas-interactions`，上游分支为 `origin/fix/low-memory-canvas-interactions`。工作区存在大量未提交/未跟踪改动，主要集中在：

- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/**`
- `apps/sim/lib/copilot/request/lifecycle/run.ts`
- `apps/sim/lib/copilot/request/lifecycle/content-canvas-agent.ts`
- `apps/sim/app/workspace/[workspaceId]/home/**`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/**`
- `apps/sim/lib/content-canvas/text-executor.ts`
- `apps/sim/lib/generated-media/{image,video,audio}/**`
- `docs/local-canvas-agent-phase-1-*.md`

未还原任何用户或前序工作改动。

本轮复核补充（2026-06-07）：已重新执行 `git status --short`、`git branch --show-current`、`git rev-parse --abbrev-ref --symbolic-full-name '@{u}'`，确认仍在 `fix/low-memory-canvas-interactions`，上游仍是 `origin/fix/low-memory-canvas-interactions`。本轮未运行测试、未启动服务、未提交代码，只做文档和代码只读核对，并只更新本文档。

本轮关键代码证据：

- `apps/sim/lib/copilot/request/lifecycle/run.ts:143-144`：`workflowCopilotMode === 'content_canvas_v1'` 时调用 `runLocalCanvasAgent()`。
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/routing.ts:82-109`、`runtime.ts:298-306`：当前 routing 已有 `canvas/non_canvas/ambiguous` 分类，`non_canvas` 会直接返回非画布回答。
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/canvas-verify.ts:130-160`、`tool-loop.ts:263-266`、`tool-loop.ts:406-411`：生成写回后的 `nodeId + field` 字段级 verify 已存在。
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/canvas-tools.ts:572-578`、`596-605`、`642-651`、`664-673`：text/image/video/audio 生成分别返回 `verifiedField`，并在写回前后检查目标字段。
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/context-manager.ts:340-352`、`context-tools.ts:65-74`、`context-tools.ts:121-140`、`canvas-tools.ts:321-334`：agent-visible 附件和节点 file detail 当前只输出 name/type/size 或文件名；内部 key/url/path 仍只用于匹配、读取和写回。
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/runtime.ts:39-77`、`193-238`、`319-346`：manual Confirm/Revise pending plan 当前有 30 分钟 TTL、过期清理、一次性消费和 Revise 删除逻辑。
- `apps/sim/lib/copilot/request/lifecycle/content-canvas-agent.ts:4236-4240`：旧 `runContentCanvasAgent()` 已标注 deprecated，作为迁移参考和 legacy 测试保留。
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/copilot-tab.tsx`：右侧 Copilot 当前已把 `canvas.apply_patch` / `canvas.generate_node_output` 成功结果、local canvas stream end、send settled 都分流到 `useWorkflowRegistry.getState().loadWorkflowState(workflowId)`；legacy `edit_workflow` 仍走 `workflowDiffStore.setProposedChanges()`。2026-06-08 current-source 浏览器样本已证明 F-01 节点 position 无刷新同步：后端 state 横向后，ReactFlow DOM transform 同步为 `-220/140/500/860/1220/1580/1940`。
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/workflow.tsx:3083-3310`、`stores/workflows/workflow/validation.ts`、`components/content-block/content-block.tsx`：F-01 前端根因已拆成三段。`workflow.tsx` 通过 `reconcileDisplayNodePositions()` 处理 position-only committed reload；`validation.ts` 本轮新增旧 content-reference edge normalization，兼容只有 `content-reference-*` handles 但缺少 `data.kind=content_reference` 的旧边，避免刷新后节点位置对齐但连接不显示；`content-block.tsx` 本轮补回 `coerceNumber()` 和缺失的 audio/video default imports，修复 current-source 页面挂载与 preview build 阻断。2026-06-08 3007 current-source preview 已补到修复后的同端口 ReactFlow DOM 证据：API 仍为 7 blocks / 5 legacy edges，DOM 显示 7 nodes / 5 `workflowEdge` / 5 edge paths。

本轮测试污染只读 grep 结果：在 `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent`、`apps/sim/app/workspace/[workspaceId]/home`、`apps/sim/app/workspace/[workspaceId]/w/[workflowId]` 的非测试生产文件范围内，未命中 `A-01` 到 `H-04` 测试编号，也未命中“总导演”“各组注意”“导演这边”“各位团队成员”“总导演 Agent”“高考”“春季发布会主视觉”等 local-canvas-agent 泄露复查关键词。后续改 prompt/guard 后仍必须按第五节重新 grep。

已按 UTF-8 阅读：

- `docs/local-canvas-agent-phase-1-audit-zh.md`
- `docs/local-canvas-agent-phase-1-manual-test-checklist-zh.md`
- `docs/local-canvas-agent-phase-1-retest-notes-zh.md`
- `docs/local-canvas-agent-runtime-design-zh.md`

已重点核对：

- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/**`
- `apps/sim/lib/copilot/request/lifecycle/run.ts`
- `apps/sim/lib/copilot/request/lifecycle/content-canvas-agent.ts`
- `apps/sim/app/workspace/[workspaceId]/home/**` 中发送、停止、Confirm/Revise、选中上下文相关代码
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/**` 中右侧 Copilot、画布节点、预览相关代码
- local-canvas-agent 相关测试

重要校正：`local-canvas-agent-phase-1-audit-zh.md` 中若干结论在当时成立，但当前 checkout 已经被后续改动覆盖。本文按当前代码和最新复测记录重新归类：

- `routing.ts` 已不再永远 true。当前有 `canvas | non_canvas | ambiguous` 分类，A-03 已有 preview 浏览器级通过证据。
- 生成写回后已有字段级 verify 链路：`generate_node_output -> verifiedField -> verify_patch({ generation })`。
- manual Confirm/Revise pending plan 已有 30 分钟 TTL 和一次性消费逻辑。第一阶段仍不做 DB 持久化。
- 生成服务、tool loop、前端 stop 已有取消信号链路。H-04 有 preview 浏览器核心通过证据；server log 可观测性已有 abort handler 代码级和 route test 证据；chatId 已解析后停止已有 current-source API/SSE 样本；2026-06-08 已补 preview 浏览器 UI 二次样本，点击 Stop 后出现 `/api/mothership/chat/abort` 和 `/api/mothership/chat/stop` 请求，30 秒后 workflow state hash 不变。
- 附件和节点 file detail 已有脱敏实现。2026-06-08 已补 fake `fileAttachments` 真实 SSE 请求：payload 中包含 storage key、serve URL、Windows path、external URL、fake private-key marker，SSE/tool/final answer 均未命中 forbidden 值；同时已修复 `read_file` 整句 query 包含文件名时匹配失败的问题，并用 focused test 覆盖成功路径脱敏。
- `content-canvas-agent.ts` 已标注 deprecated；生产 `content_canvas_v1` 入口在 `run.ts` 中走 `runLocalCanvasAgent()`。

第一阶段当前主要剩余工作不是从零实现 runtime，而是：在 B-01/B-03 已补 current-source preview 选中节点 detail 和文件脱敏 API/SSE 证据，F-01 已有节点 position live refresh、旧 content-reference edge hydration 兼容和 3007 current-source preview DOM 连接复验证据，D-01/D-02/D-03 已有 current-source preview 证据，E-03/E-04 已有 current-source preview API/state、浏览器节点展示和 JSON string 参数解析测试证据，G-01/G-02/G-03/G-04/G-05 已有 current-source 或 focused unit 证据，H-01/H-02/H-03 已有 current-source API/SSE 安全边界和浏览器 DOM 未损坏证据，H-04 已有 server log 代码级补强、chatId API/SSE 停止样本和 preview 浏览器 UI 二次样本、附件脱敏已有 fake attachment metadata 真实 SSE 无泄露证据的基础上，继续做剩余读画布/搜索类浏览器补强和验收文档收尾。

## 一、当前问题归并

### 1. routing / 非画布请求处理

| 项目 | 内容 |
|---|---|
| 对应测试编号 | A-03 |
| 当前失败表现 | 首轮手工记录中，“高考可能会考什么内容？”被拉回画布语境。 |
| 相关代码位置 | `local-canvas-agent/routing.ts`：`classifyLocalCanvasAgentRouting()`、`shouldRunLocalCanvasAgent()`；`runtime.ts`：`runLocalCanvasAgent()`、`buildNonCanvasResponse()`；`run.ts`：`workflowCopilotMode === 'content_canvas_v1'` 路由。 |
| 当前代码状态 | `routing.ts` 已定义 `LocalCanvasAgentRoutingKind = 'canvas' | 'non_canvas' | 'ambiguous'`。`NON_CANVAS_TERMS`/`NON_CANVAS_PATTERNS` 覆盖考试、天气、新闻、编程等明显非画布请求；`CANVAS_TERMS` 覆盖画布、节点、内容链、文案、脚本、图片、视频、音频等画布意图。`runtime.ts` 在 `routingDecision.kind === 'non_canvas'` 时直接输出不读不改画布的回答。 |
| 根因假设 | 原失败来自旧实现 `shouldRunLocalCanvasAgent()` 永远 true。当前剩余风险是启发式误判：例如“高考会考什么”应 non_canvas，但“以高考为主题创建短视频内容链”应 canvas。 |
| 是否需要进一步验证 | A-03 已有当前源码 API/SSE 和 preview 浏览器证据；后续 routing 变更后必须回归 A-03，并增加“非画布 vs 主题型画布任务”的对照样本。 |

当前不是继续实现“routing 不永远 true”，而是把它做稳：保留 non-canvas gate，同时避免把带主题的画布创作请求误拒绝。

### 2. 选中节点理解和目标节点选择

| 项目 | 内容 |
|---|---|
| 对应测试编号 | B-01、B-02、B-03、B-04、D-02、D-03、E-01、E-02、E-03、E-04 |
| 当前失败表现 | B-02 曾把只读说明误判为创建 `new_text_after_selection`；B-04 曾选中 audio 却答成 video；D-02/D-03/E-03/E-04 依赖正确目标节点选择。 |
| 相关代码位置 | `context-manager.ts`：`extractSelectedNodeIds()`；`planner.ts`：`resolveTargetSelectedNode()`、`isSelectionScopedCreateTextRequest()`、`buildSelectedUpdatePatch()`；`models/actor.ts`：只读回答；`user-input.tsx`：`buildAutoSelectionContexts()`、`confirmationMode`、`thinkingLevel`；`copilot-tab.tsx`：右侧 Copilot 固定 `workflowCopilotMode: 'content_canvas_v1'`。 |
| 当前代码状态 | `context-manager.ts` 从 `autoSelectionContexts`、`contexts`、`selectedContexts`、`selectedNodeIds` 汇总 selected node ids。`planner.ts` 会按用户话语中的 kind 偏好选择 text/image/video/audio，并把只读意图与“补节点”意图分开。B-02/B-04 已有 preview 浏览器证据：真实 ReactFlow 选中 image/audio 后，Network payload 的 `autoSelectionContexts.blockIds` 正确，回答目标正确，workflow state 不变。2026-06-08 3007 current-source preview API/SSE 又补 B-01/B-03：选中文本可提炼真实长文本关键词，选中视频可读取 videoPrompt、模型族、参数和安全文件名，均不修改 state。 |
| 根因假设 | 原失败来自 intent 分类和目标节点选择过粗；当前剩余风险转到 D/E 类写入任务：同一选中上下文下，planner 是否持续把更新写到正确 nodeId 和字段。 |
| 是否需要进一步验证 | B-01/B-02/B-03/B-04 均已有 current-source 或 preview 证据；后续只在 selection、Copilot tab、`UserInput` payload、node adapter、file redaction 或 planner target 变动后回归。D-02/D-03 已同步 current-source preview 证据；E-03/E-04 已有 current-source preview API/state 字段写入证据，仍可补强右侧属性面板浏览器展示。 |

### 3. 创建 / 更新 / 连接 / 布局 patch 可靠性

| 项目 | 内容 |
|---|---|
| 对应测试编号 | D-01、D-02、D-03、E-01、E-02、E-03、E-04、F-01 |
| 当前失败表现 | D-01 曾失败为 `patch.operations is required`；D-02 曾只复述输入；D-03 曾第一次找不到图片；E-03 曾声称修改视频但 state 不变；F-01 曾失败为后端 state 已按生产顺序横向布局并完成 verify，但 ReactFlow DOM 未实时更新，仍显示旧 position。 |
| 相关代码位置 | `canvas-tools.ts`：`requirePatch()`、`normalizeLegacyCanvasPatch()`、`normalizeInstructionCanvasPatch()`、`executeCanvasTool()`；`canvas-patch.ts`：patch 校验与 `editWorkflowServerTool` operation 构造；`canvas-verify.ts`：create/update/connect/layout 验证；`planner.ts`：内容链、补前后节点、更新字段、布局计划；`copilot-tab.tsx`：`handleCopilotToolResult()` 的 mutation 后 UI refresh。 |
| 当前代码状态 | 工具边界已兼容标准 `patch.operations`、旧形态 `addNodes/addEdges`、direct operation、instruction-only chain。`canvas-verify.ts` 已验证 create/update/connect/layout。D-01 已有 current-source preview 浏览器级通过证据：空白 workflow 从 1 节点/0 边变为 5 节点/3 边，ReactFlow live refresh 显示 5 nodes / 3 edges，无 `patch.operations is required` 或 cancelled。D-02/D-03 已同步 current-source preview 证据：选中 video/image 后新增 text 并形成 `video -> text`、`text -> image` 连线，当前 preview state 复核仍可见目标节点和边。F-01 的 position/edge 同步链路已实现：`copilot-tab.tsx` 把 local canvas mutation tool success、stream end、send settled 接到 committed workflow reload；`workflow.tsx` 通过 `reconcileDisplayNodePositions()` 覆盖 position-only committed reload；`normalizeWorkflowState()` 兼容旧 content-reference edge。2026-06-08 3007 current-source preview 复验显示 7 nodes / 5 edges / 5 edge paths。 |
| 根因假设 | D-01 原因是模型真实输出旧参数形态与工具 schema 不兼容。D-02/D-03 是 selected target 和 connect reference 问题。E-03/E-04 是字段提取和 verify 不足导致“说改了但没改”。F-01 根因已收敛为前端同步链路：local canvas mutation 不能走 legacy proposed diff 路径，position-only committed reload 需要显式 reconcile 到 ReactFlow display nodes；旧 malformed content-reference edge 还需要在 workflow state normalization 阶段补语义，以免刷新后连接不显示。 |
| 是否需要进一步验证 | F-01 当前已补稳定 current-source preview DOM 证据；后续只在 stream/store/hydration/normalization/ReactFlow rendering 或 content block 默认参数逻辑改动后回归。D-01/D-02/D-03 和 E-03/E-04 后续作为回归保护；E 类若改 UI 字段展示，还需补属性面板浏览器回归。 |

### 4. 生成写回和字段级 verify

| 项目 | 内容 |
|---|---|
| 对应测试编号 | G-01、G-02、G-03、G-04、G-05 |
| 当前失败表现 | 审计指出生成后曾只做空 verify，不能证明目标 `nodeId + field` 写回。 |
| 相关代码位置 | `canvas-tools.ts`：`generateNodeOutput()`、`assertGeneratedFieldWritten()`；`tool-loop.ts`：`pendingVerifyAfterGenerate`；`runtime.ts`：`buildGenerationVerifyInput()`；`canvas-verify.ts`：`verifyLocalCanvasPatch({ generation })`；`text-executor.ts`；`generated-media/{image,video,audio}/**`。 |
| 当前代码状态 | text 生成写回 `contentHtml`，image/video/audio 生成写回 `file`。`generateNodeOutput()` 返回 `verifiedField`；`tool-loop.ts` 将其转成 `canvas.verify_patch({ generation: { nodeId, field } })`；`canvas-verify.ts` 校验目标节点存在且目标字段非空。更新类字段如 `aiPrompt`、`videoParameters`、`audioPrompt` 通过 patch update verify 覆盖。 |
| 根因假设 | 代码层字段级 verify 已补上，但真实 provider、生成失败、UI 文件预览刷新、上游参考图传递仍可能有缺口。 |
| 是否需要进一步验证 | G-01 已有 current-source preview API/state 证据，G-02/G-03/G-04 已有真实 provider 生成写回、字段级 verify 和浏览器预览证据。G-05 已有 dedicated unit 证据和 2026-06-08 一次性 workflow API/SSE 失败样本：无效 text model 触发 `canvas.generate_node_output` error，旧 `contentHtml` 与 state hash 不变，最终回答不含完成态。后续仅在 generation、provider、file writeback、preview 或脱敏逻辑改动后回归。 |

### 5. Manual Confirm / Revise

| 项目 | 内容 |
|---|---|
| 对应测试编号 | F-02、F-03、F-04 |
| 当前失败表现 | 审计指出 pending plan 只在进程内 Map，生命周期不明确。 |
| 相关代码位置 | `runtime.ts`：`PENDING_PLAN_TTL_MS`、`pendingPlans`、`maybeHandlePendingPlan()`；`stream.ts`；`special-tags.tsx`；`options.tsx`；`mothership-chat.tsx`；`use-chat.ts`。 |
| 当前代码状态 | 当前 pending plan 有 30 分钟 TTL。Confirm/Revise token mismatch 或过期会拒绝；Confirm 执行前删除 pending，避免重复执行；Revise 删除 pending 并提示用户说明调整方向。F-02/F-03/F-04 已有 preview 浏览器证据。 |
| 根因假设 | 第一阶段边界可以是不持久化；刷新、重启、多实例后 pending plan 失效并要求重新发起。持久化属于后续 team/task scope 和多实例能力，不纳入第一阶段。 |
| 是否需要进一步验证 | 已有浏览器级证据。后续 UI/runtime 改动后回归同一 `chatId`、一次性消费、TTL 过期和 Revise 不执行。 |

### 6. 取消长任务

| 项目 | 内容 |
|---|---|
| 对应测试编号 | H-04 |
| 当前失败表现 | 审计指出停止后可能继续生成并偷偷写回。 |
| 相关代码位置 | `use-chat.ts`：stop/abort；`runtime.ts`：`throwIfAborted()`；`tool-loop.ts`：工具调用前后 abort 检查；`canvas-tools.ts`：生成前、生成后、写回前 `throwIfAborted()`；`text-executor.ts`；`generated-media/{image,video,audio}/providers.ts`。 |
| 当前代码状态 | 前端 stop 会 abort 当前 fetch，并向 `/api/mothership/chat/abort` 发请求。tool loop 在工具调用前后检查 abort。生成服务调用传入 `abortSignal`，写回前再检查。H-04 preview 浏览器核心路径已通过：stop button 被点击、abort 200、UI loading 结束、等待后 state hash 不变。 |
| 根因假设 | 本地写回可阻断，但远端 provider 任务可能已经提交且不可完全撤销。第一阶段验收应定义为：停止后本地 runtime 不继续写回画布，UI 状态明确。 |
| 是否需要进一步验证 | server log 可观测性已有 abort handler 结构化日志和 route test 证据；chatId 已解析后停止已有 current-source API/SSE 样本，返回 `aborted=true/settled=true`、SSE `cancelled`、state hash 不变。2026-06-08 preview 浏览器 UI 二次样本已补：Stop button 立即出现并点击，Network 有 abort/stop 请求，30 秒后 state hash 不变。后续只在 stop UI、abort route、stream buffer、tool loop 或 provider cancel 改动后回归。 |

### 7. 附件 / 文件脱敏

| 项目 | 内容 |
|---|---|
| 对应测试编号 | B-03、B-02、B-04、G-02、G-03、G-04、附件专项 |
| 当前失败表现 | 审计指出附件/file context 曾可能暴露 private key、storage path、URL。 |
| 相关代码位置 | `canvas-tools.ts`：`sanitizeCanvasNodeDetailForAgent()`；`context-manager.ts`：`extractAttachments()`、`buildAttachmentContext()`；`context-tools.ts`：`sanitizeAttachmentForAgent()`、`readFileContext()`；`node-adapters/{image,video,audio,document,image-editor}.ts`。 |
| 当前代码状态 | 节点 detail 对 agent 只保留 file name；prompt attachment context 只输出 name/type/size；`read_file` 输出 attachments 时使用 `sanitizeAttachmentForAgent()`。`attachedContexts.type === 'file'` 的 prompt context 和 `read_file` context content 已接入 `redactAgentVisibleFileContext()`，覆盖 storage key/path、`/api/files/serve`、HTTP URL、Windows/Unix path 和 PEM private key block。内部 attachment 仍保留 key/url 供匹配、读取和写回。 |
| 根因假设 | 风险在“内部字段误流到 agent-visible 输出”，不是内部存储本身。尤其要检查 attachedContexts.content、workspace context、SSE observation、最终回答。 |
| 是否需要进一步验证 | focused tests 已覆盖 prompt context 与 `read_file` output 脱敏。2026-06-08 fake attachment metadata 真实 SSE 请求已证明 final/tool stream 不输出 storage key、path、URL 或 private-key marker；`read_file` 成功路径由 focused test 覆盖，因为当前 3000/3005 运行进程未加载新匹配补丁，真实请求仍命中旧的 query matching error。后续如重启 current-source dev/preview，可补一次成功 `read_file` 的端到端样本。 |

### 8. 中危测试污染清理

| 项目 | 内容 |
|---|---|
| 对应测试编号 | A-01、A-02、B-01、B-03、E-01 persona 泄露回归；全量测试泄露复查 |
| 当前失败表现 | 审计发现生产 prompt/guard 曾硬编码“总导演”“各组注意”“导演这边”等测试预期中文禁用词。 |
| 相关代码位置 | `models/actor.ts`、`planner.ts`、`models/prompts.ts`、`workgroup-profile.ts`、相关 tests 和 docs。 |
| 当前代码状态 | 当前 Local Canvas Agent/UI 生产范围 grep 未发现测试编号、完整手工输入、或“总导演/各组注意/导演这边/各位团队成员/总导演 Agent”。这些词仍允许在 docs、tests、真实协作工种业务定义中出现。 |
| 根因假设 | 当前已从具体中文禁用词转向通用 persona/internal-field/team-broadcast guard。风险是后续修 persona 泄露时再次把测试预期复制进生产 prompt。 |
| 是否需要进一步验证 | 每个相关提交后都必须跑泄露 grep。 |

### 9. 旧 `content-canvas-agent.ts` 维护风险

| 项目 | 内容 |
|---|---|
| 对应测试编号 | 入口 routing 测试、legacy tests |
| 当前失败表现 | 生产入口已走 Local Canvas Agent，但旧文件仍很大，容易误导维护者。 |
| 相关代码位置 | `run.ts`、`content-canvas-agent.ts`、`run.test.ts`。 |
| 当前代码状态 | `run.ts` 在 `workflowCopilotMode === 'content_canvas_v1'` 时调用 `runLocalCanvasAgent()`。`content-canvas-agent.ts` 中 `runContentCanvasAgent()` 已有 deprecated TSDoc：生产请求由 `local-canvas-agent` 处理，旧 runtime 仅保留作 migration reference 和 legacy tests。 |
| 根因假设 | 旧实现不是当前生产路径风险，但仍是维护风险。第一阶段不建议删除，以免扩大 diff；应保留 deprecated 标注和入口测试。 |
| 是否需要进一步验证 | `run.test.ts` 要持续证明 `content_canvas_v1` 入口只走 local runtime。 |

### D/E/F/G/H 失败用例逐项映射

| 编号 | 当前状态 | 主要归因层 | 下一步位置 | 验收重点 |
|---|---|---|---|---|
| D-01 | current-source preview 浏览器级通过；历史失败为 `patch.operations is required` | tool boundary / patch / UI refresh | `canvas-tools.ts`、`canvas-patch.ts`、`canvas-verify.ts`、`content-block.tsx` | 后续作为回归保护：空白 workflow 出现 text/image/video/audio 四节点和三条顺序连接，UI 同步显示 |
| D-02 | current-source preview 证据通过；选中 video 后新增 text 并连接 `video -> text` | planner + selection payload + connect | `planner.ts`、`user-input.tsx`、`canvas-verify.ts` | 后续作为回归保护：选中 video 后新增 text，连接 `video -> text`，不破坏已有边 |
| D-03 | current-source preview 证据通过；选中 image 后新增 text 并连接 `text -> image` | target selection + connect | `planner.ts`、`canvas-patch.ts` | 后续作为回归保护：选中 image 后新增 text，连接 `text -> image` |
| E-01 | 服务级通过；首轮 UI 显示不全待界定 | adapter / UI display | `node-adapters/text.ts`、`content-block.tsx` | state 中 `contentHtml` 完整；若 UI 截断，记录为独立 UI 问题 |
| E-02 | 服务级通过；需浏览器字段展示回归 | planner field extraction | `planner.ts` | `aiPrompt` 不包含“把提示词改成”这类操作话术 |
| E-03 | current-source preview API/state 证据通过；仍可补强右侧属性面板展示 | planner + verify | `planner.ts`、`canvas-verify.ts` | 后续作为回归保护：`videoParameters.duration = 5`，`videoPrompt` 含推进感，verify 成功 |
| E-04 | current-source preview API/state 证据通过；仍可补强右侧属性面板展示 | planner + actor | `planner.ts`、`models/actor.ts` | 后续作为回归保护：更新 `audioPrompt`，不误读 video，不误走 generation |
| F-01 | current-source preview 通过；已有 position 同步、旧 content-reference edge normalization 和 3007 DOM edge 复验证据 | UI refresh + workflow store hydration + ReactFlow position/edge reconcile | `copilot-tab.tsx`、`workflow.tsx`、`stores/workflows/registry/store.ts`、`stores/workflows/workflow/validation.ts`、`content-block.tsx` | 后端 state position/edges 变化，ReactFlow DOM transform 和 edge path 同步变化，无需刷新页面；节点和边不丢，回答与 verify 一致 |
| F-02 | preview 浏览器级通过 | runtime + UI | `runtime.ts`、`special-tags.tsx`、`options.tsx` | Confirm/Revise 展示，未确认前 state 不变 |
| F-03 | preview 浏览器级通过 | runtime + tool loop | `runtime.ts`、`tool-loop.ts` | 同一 chatId 执行 pending plan，一次性消费，随后 verify |
| F-04 | preview 浏览器级通过 | runtime + UI | `runtime.ts`、`special-tags.tsx` | Revise 不执行 patch，pending 清理，state 不变 |
| G-01 | current-source preview API/state 和浏览器文本节点展示均通过 | generation + verify + UI | `canvas-tools.ts`、`tool-loop.ts`、`text-executor.ts`、`content-block.tsx` | 后续作为回归保护：写回 `contentHtml`，verify 指向该字段，文本节点刷新 |
| G-02 | current-source 真实 provider 生成写回和浏览器预览通过 | generation + file preview + redaction | `canvas-tools.ts`、image service/provider、`content-block.tsx` | 已写回 `file`、字段级 verify、图片预览刷新、不泄露 key/url/path；后续作为回归保护 |
| G-03 | current-source 真实 provider 生成写回、上游 image first_frame 代码/测试证据和浏览器视频预览通过 | generation + upstream reference + file preview | `canvas-tools.ts`、video service/provider | 已写回 `file`、字段级 verify、视频预览刷新、不泄露 key/url/path；后续作为回归保护 |
| G-04 | current-source 真实 provider 生成写回和浏览器播放器通过 | generation + file preview | `canvas-tools.ts`、audio service/provider | 已写回 `file`、字段级 verify、播放器刷新、不泄露 key/url/path；后续作为回归保护 |
| G-05 | dedicated unit 证据通过；一次性 workflow API/SSE 失败样本通过 | provider error + verifier | `canvas-tools.ts`、`models/verifier.ts` | 后续作为回归保护：失败不清空旧值，不假报完成 |
| H-01 | current-source preview API/SSE 通过；复测后浏览器 DOM 未损坏 | planner + canvas tool | `canvas-tools.ts`、`models/actor.ts` | 找不到节点，不修改画布，不调用 mutation；ReactFlow 仍为 7 nodes / 5 edges |
| H-02 | current-source preview API/SSE 通过；复测后浏览器 DOM 未损坏 | adapter + planner | `node-adapters/{document,table,image-editor}.ts`、selected start node guard | 只读/未支持类型拒绝写入，不调用 mutation；ReactFlow 仍为 7 nodes / 5 edges |
| H-03 | current-source preview API/SSE 通过；复测后浏览器 DOM 未损坏 | planner safety guard | `planner.ts` | 破坏性全画布请求不直接执行，要求明确范围或手动确认；ReactFlow 仍为 7 nodes / 5 edges |
| H-04 | preview 浏览器核心通过，日志可观测性已有代码级补强，chatId 已解析后 API/SSE 样本通过，preview 浏览器 UI 二次样本已补 | UI abort + runtime + provider | `use-chat.ts`、`app/api/copilot/chat/abort/route.ts`、`session/abort.ts`、`session/buffer.ts`、`tool-loop.ts`、`canvas-tools.ts`、providers | stop 后 UI 结束 loading，abort 到服务端，本地不迟到写回；server log 可按 streamId/chatId 追踪 |

## 二、目标状态

### 第一阶段完成标准

第一阶段完成标准是：手工清单 A-01 到 H-04 全部通过，或每一项都有等价的当前源码真实 UI/API 运行证据。单元测试和 harness 只能作为辅助证据，不能替代需要观察浏览器 UI、Network、SSE、画布 live refresh 的用例。

必须通过：

- A-01/A-02：读懂画布节点、内容摘要和连接关系，不修改画布。
- A-03：明显非画布请求不读画布、不调用 canvas tools、不修改 workflow state。
- B-01 到 B-04：选中 text/image/video/audio 时目标节点正确，能读取完整 detail，file 信息脱敏。
- C-01 到 C-03：搜索、上下游、孤立节点理解正确，只建议时不自动修改。
- D-01 到 D-03：创建内容链、补后续、补前置节点稳定写入并连接，画布刷新可见。
- E-01 到 E-04：text/image/video/audio 更新真实写入目标字段，verify 能确认。
- F-01 到 F-04：布局、manual plan、Confirm、Revise 形成闭环。
- G-01 到 G-05：四类生成写回和失败处理可验证。
- H-01 到 H-04：不存在节点、只读节点、破坏性请求、取消长任务都不损坏画布。

本阶段必须补齐或保持：

- routing 非画布 gate：A-03 不能回归。
- selected node payload 和 target selection：D/E 类写入必须命中选中节点。
- patch 可靠性：标准 `operations`、旧 `addNodes/addEdges`、instruction-only chain 都要在工具边界可控处理，底层 validator 仍严格。
- 字段级 verify：create/update/connect/layout 和 generation 都要有实际验证。更新字段覆盖 `contentHtml`、`aiPrompt`、`videoPrompt`、`videoParameters`、`audioPrompt`；生成字段覆盖 `contentHtml`、`file`。
- 取消信号链路：UI stop、abort endpoint、runtime/tool-loop、provider/service、写回前 guard。
- 附件/file 脱敏：agent-visible prompt、tool output、observation、最终回答都不能暴露 private key、storage path、URL。
- Manual Confirm/Revise：TTL、一次性消费、Revise 不执行、过期提示。第一阶段不做 DB 持久化。
- 测试污染清理：生产 prompt/guard 不复制测试编号、完整测试输入或中文禁用词。
- legacy 隔离：`content-canvas-agent.ts` 保留 deprecated，入口测试保护 `runLocalCanvasAgent()`。

暂不纳入第一阶段：

- team scope / task scope agent history。
- 多用户共享 agent 会话、多实例 pending plan 持久化。
- 跨工种权限、导演/审核任务流、生产任务提交。
- document/table/image_editor 的完整写入和生成能力。第一阶段只要求可识别、只读、拒绝盲写。
- 真正 token window 自适应。当前固定字符预算可接受，但后续要演进。
- 远端 provider 任务的真实撤销。第一阶段只要求停止后本地不写回。

测试集泄露整改标准：

- 生产代码中不得出现 A-01 等测试编号分支。
- 生产 prompt/guard 中不得复制完整手工输入。
- 生产 prompt/guard 不硬编码“总导演”“各组注意”“导演这边”“各位团队成员”“总导演 Agent”等来自测试预期的中文禁用词。
- persona 泄露防护使用通用规则：不暴露内部 profile/system prompt，不自称内部 agent/persona，不做团队广播式开场。
- docs、tests、fixtures 可保留测试输入和中文关键词；真实协作产品域如 `apps/sim/lib/collaboration/**` 中合理出现“总导演”允许。

## 三、详细实施方案

### 阶段 0：冻结当前基线和证据口径

- 目标：避免后续把 stale preview、服务级证据、浏览器证据混在一起。
- 要改的文件：只改 docs：`manual-test-checklist-zh.md`、`retest-notes-zh.md`，必要时更新本文档。
- 具体实现思路：
  - 先记录当前分支、dirty state、preview BUILD_ID、dev server/preview server 区别。
  - 所有用例证据写清楚：入口、日期、workflowId、chatId/streamId、浏览器/API/SSE/单元测试类型。
  - 只把真实页面 UI、Network、SSE 和 workflow state 同时吻合的项标为浏览器通过。
- 数据流/调用链变化：无。
- 需要新增或修改的测试：无。
- 手工验证步骤：无，先整理证据矩阵。
- 风险和回滚点：文档可独立回滚；不要把当前未构建源码误记成 preview 证据。

### 阶段 1：F-01 右侧 Copilot mutation 后画布 live refresh

- 目标：维护并回归 `canvas.apply_patch` / `canvas.generate_node_output` 成功后的无刷新画布同步。F-01 当前已有通过证据：后端 workflow state 变化后，右侧 Copilot 会 reload committed workflow state，ReactFlow display nodes 会同步 position-only 变化；旧 content-reference edge hydration 兼容后，3007 current-source preview DOM 显示 `nodeCount=7`、`edgeCount=5`、`edgePathCount=5`。
- 要改的文件：
  - `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/copilot-tab.tsx`
  - `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/workflow.tsx`
  - `apps/sim/stores/workflows/registry/store.ts`
  - `apps/sim/stores/workflows/workflow/store.ts`
  - 已补测试：右侧 Copilot tool-result / stream-end handler 的邻近测试文件，以及 `reconcileDisplayNodePositions()` focused helper test。
  - 不优先改 `canvas-tools.ts`、`canvas-patch.ts`、`canvas-verify.ts`，除非复测发现 state 本身未写入。
- 具体实现思路：
  - 已有实现：保留 legacy `edit_workflow` 的现有 diff/proposed changes 行为，避免影响旧 Copilot 工作流。
  - 已有实现：对 `LOCAL_CANVAS_MUTATION_TOOLS` 即 `canvas.apply_patch` 和 `canvas.generate_node_output`，成功后调用 `useWorkflowRegistry.getState().loadWorkflowState(workflowId)`，让 committed workflow state reload 到 `useWorkflowStore.replaceWorkflowState()` 和 subblock store 初始化链路。
  - 已有实现：`onStreamEnd` 和 send settled 兜底 reload 当前 workflow，用来覆盖真实页面未稳定暴露 local canvas tool result callback 的情况。
  - 已有实现：workflow store 收到新 blocks 后，`workflow.tsx` 用只处理外部 committed position 变化的 reconcile：
    - 比较 `blocks[id].position` 与当前 `displayNodes[id].position`。
    - 只在节点 id 集合相同、非拖拽中的情况下更新 `displayNodes` 的 `position`、`parentId`、`extent` 等 ReactFlow 位置相关字段。
    - 保留当前 selection、zIndex 和交互状态，避免影响拖拽体验。
    - 不把 `position` 加回 `blocksStructureHash`，否则会让拖拽过程频繁重建节点。
  - 如果后续发现 normalized state 相关 UI 仍需刷新，可在 reload 后定向 invalidate `getWorkflowNormalizedStateContract` 对应 query，但不要只写入 `useWorkflowDiffStore.setProposedChanges()`。
- 数据流/调用链变化：
  - 旧失败链路：`SSE tool result -> handleCopilotToolResult -> fetch normalized state -> workflowDiffStore.setProposedChanges(skipPersist) -> ReactFlow 未必更新 committed store`
  - 当前目标链路：`SSE canvas.apply_patch/generate_node_output success 或 stream end -> workflowRegistry.loadWorkflowState(workflowId) -> workflowStore.replaceWorkflowState + subblock hydration -> ReactFlow live refresh`
  - Position reconcile 链路：`replaceWorkflowState -> blocks reference/position 变化 -> workflow.tsx reconcile effect -> setDisplayNodes(position-only merge) -> ReactFlow DOM transform 更新`
  - `edit_workflow` 仍走原 diff proposal 链路。
- 需要新增或修改的测试：
  - 已覆盖 `canvas.apply_patch` 成功时调用 `loadWorkflowState(workflowId)`，不走 legacy `edit_workflow` diff/proposal 分支。
  - 已覆盖 `canvas.generate_node_output` 成功时同样 reload committed state。
  - 已覆盖 right-side `onStreamEnd` 触发 reload。
  - 已覆盖 `reconcileDisplayNodePositions(displayNodes, blocks)`：position-only committed update 能改变节点位置、selection 保留、缺失或新增节点交给 `derivedNodes` 结构重建。
  - 后续如改 `edit_workflow` 分支，应补充确认 legacy 成功时仍调用 `setProposedChanges()`，防止旧 Copilot diff/proposal 行为回归。
- 手工验证步骤：
  - 使用 F-01 目标 workflow 或等价 workflow，先记录 state API positions 和 ReactFlow DOM transform。
  - 在右侧 Copilot 发送 UTF-8 正确的“把当前画布按内容生产顺序从左到右整理一下。”。
  - 观察 Network payload：`workflowCopilotMode: content_canvas_v1`、`confirmationMode`、`thinkingLevel`、`chatId` 正确。
  - 观察 tool blocks：`Canvas.read Summary`、`Canvas.apply Patch`、`Canvas.verify Patch`。
  - 取 workflow state：positions 已按横向顺序变化，blocks/edges 数量不丢。
  - 不刷新页面，直接检查 ReactFlow DOM transform 必须同步变为新 positions。
- 风险和回滚点：
  - 风险是误把 legacy `edit_workflow` 的 proposal/diff 体验改成直接提交展示。因此实现必须只分流 local canvas mutation tools。
  - 如果 `loadWorkflowState()` 后续引发额外网络或 subblock 初始化副作用，可回滚到“fetch normalized state 后直接 `useWorkflowStore.replaceWorkflowState()` + `useSubBlockStore` 初始化”的更窄实现，但应优先复用 registry 的既有入口。

### 阶段 2：D-01/D-02/D-03 回归保护

- 目标：D-01/D-02/D-03 已有 current-source preview 证据，后续只作为回归保护，不再作为当前首要缺口。
- 要改的文件：
  - 若回归通过，只更新 docs。
  - 若验证失败，重点改 `planner.ts`、`canvas-tools.ts`、`canvas-patch.ts`、`canvas-verify.ts`、`content-block.tsx` 或画布刷新/invalidation 相关代码。
- 具体实现思路：
  - D-01：在一次性空白 workflow 中发送内容链请求，观察 `canvas.apply_patch`、`canvas.verify_patch`，确认 state 从 start-only 变为 start + text/image/video/audio，边为 text -> image -> video -> audio。
  - D-02：选中 D-01 生成的 video 节点，点击 Copilot tab 后发送“补一个结尾口播文案节点，接到当前视频节点后面。”，确认 payload `autoSelectionContexts.blockIds` 只含 video id，新增 text，边为 video -> text。
  - D-03：选中 image 节点，发送“给当前图片节点前面补一个创意说明文本节点。”，确认新增 text，边为 text -> image。
  - 如果服务 state 已变而 UI 不刷新，定位为画布 store/socket/invalidation，不把 agent runtime 判失败。
- 数据流/调用链变化：
  - `ReactFlow selection -> UserInput autoSelectionContexts -> context-manager selectedNodeIds -> planner patch -> canvas.apply_patch -> editWorkflowServerTool -> canvas.verify_patch -> UI refresh`
- 需要新增或修改的测试：
  - `planner.test.ts`：D-02/D-03 选中节点前后补文本。
  - `canvas-tools.test.ts`：instruction-only patch 和 legacy patch 归一化。
  - `canvas-verify.test.ts`：clientNodeId connect 后 verify。
- 手工验证步骤：
  - 使用一次性 workflow，记录 before/after hash、blocks/edges、edge source/target。
  - 浏览器 Network 记录 request payload、SSE tool blocks。
  - 截取 UI 节点和连线刷新状态。
- 风险和回滚点：
  - instruction-only patch 归一化是启发式，必须约束在“明确 create/add + connect/sequential + quoted titles”语义内；底层 `validateLocalCanvasPatch()` 不放宽。

### 阶段 3：E-03/E-04 和 E 类字段更新闭环

- 目标：确保“声称更新”一定对应 state 字段变化和 verify 成功。
- 要改的文件：
  - `planner.ts`
  - `canvas-verify.ts`
  - `models/actor.ts`
  - `node-adapters/{text,image,video,audio}.ts`
  - 若 UI 显示不刷新，`content-block.tsx` 或面板字段组件
- 具体实现思路：
  - E-03：选中 video，更新 `videoPrompt` 和 `videoParameters.duration = 5`。verify 读取 update operation 中的实际字段，不只检查节点存在。
  - E-04：选中 audio，更新 `audioPrompt`。如果用户要求不明确，actor 要澄清是改 prompt、parameters 还是直接生成，不应假装修改。
  - E-01：继续区分 state 写入完整 vs 文本节点 UI 显示截断。若 state 完整，单独记录 UI 展示问题。
  - E-02：保持 `extractFieldInstruction()` 和 `mergePromptInstruction()` 不把“把提示词改成”写进 `aiPrompt`。
- 数据流/调用链变化：
  - `selectedNodeIds -> readCanvasNodeDetail -> buildSelectedUpdatePatch -> canvas.apply_patch -> verify update fields -> final answer`
- 需要新增或修改的测试：
  - `planner.test.ts`：video duration 5 秒、推进感；audio prompt 电子风格；image prompt 不复读操作话术。
  - `canvas-verify.test.ts`：`videoParameters`、`audioPrompt`、`aiPrompt` 字段级 update verify。
  - `models/actor.test.ts`：verify 失败时不说已完成。
- 手工验证步骤：
  - 选中真实 video/audio 节点，发送 E-03/E-04 输入。
  - 观察 Network selected blockIds、SSE patch operations、verify summary。
  - 拉取 workflow state，确认字段值；打开右侧属性面板确认展示。
- 风险和回滚点：
  - prompt 合并过强会污染用户原 prompt；必要时回滚到“追加一句简短描述，不重写整个 prompt”的保守策略。

### 阶段 4：G-01/G-02/G-03/G-04/G-05 生成验收回归保护

- 目标：生成写回必须有目标字段 verify，失败不清空旧值、不假报成功。
- 要改的文件：
  - `canvas-tools.ts`
  - `tool-loop.ts`
  - `runtime.ts`
  - `canvas-verify.ts`
  - `models/verifier.ts`
  - `text-executor.ts`
  - `generated-media/{image,video,audio}/**`
  - 需要时 `content-block.tsx` 或媒体预览组件
- 具体实现思路：
  - 保持 `generateNodeOutput()` 返回 `{ nodeId, verifiedField }`。
  - `tool-loop.ts` 对 `canvas.generate_node_output` 成功结果设置 `pendingVerifyAfterGenerate`，下一步执行 `canvas.verify_patch({ generation: { nodeId, field } })`。
  - G-01 已有 current-source preview API/state 证据，后续作为回归保护。
  - G-05 已有 dedicated unit 证据，后续可补真实服务失败最终回答样本。
  - G-02/G-03/G-04 已补真实 provider 写回、字段级 verify 和浏览器预览证据；下一步只作为回归保护。
- 数据流/调用链变化：
  - `planner generateNodeIds -> canvas.generate_node_output -> provider/service -> updateNodeAfterGeneration -> assertGeneratedFieldWritten -> verifiedField -> canvas.verify_patch({ generation }) -> final answer`
- 需要新增或修改的测试：
  - `canvas-tools.test.ts`：text/image/video/audio 写回字段和失败保留旧值。
  - `tool-loop.test.ts`：生成后不退回空 verify。
  - `models/verifier.test.ts`：生成失败不 report completion。
  - provider/service tests：abort/error 不写回。
- 手工验证步骤：
  - G-01：回归保护。text 节点有 `aiPrompt`，生成后检查 `contentHtml`、UI 文本展示、verify generation field。
  - G-02/G-03/G-04：回归保护。检查 file 写回、图片/视频/音频预览刷新、SSE/final answer 不泄露 key/url/path；G-03 同时检查上游 image 参考/首帧代码路径。
  - G-05：回归保护。制造失败，确认 state hash 或旧字段不被清空，最终回答不说已完成。
- 风险和回滚点：
  - 真实 provider 依赖 env、额度、网络和耗时。开发期优先服务级/可控 mock，最终用最小真实样本补浏览器证据。

### 阶段 5：H-04 可观测性补强

- 目标：在已有 H-04 核心通过基础上，保持 server log 可观测性、chatId 已解析后的 API/SSE 停止样本和 preview 浏览器 UI 二次样本。
- 要改的文件：
  - `use-chat.ts`
  - `start.ts` 或 abort endpoint 相关代码
  - `runtime.ts`
  - `tool-loop.ts`
  - `canvas-tools.ts`
  - provider/service tests
- 具体实现思路：
  - 前端 stop 请求尽量携带 `streamId` 和已解析 `chatId`；如果 chatId 尚未解析，允许只带 streamId，但日志要能按 streamId 追踪。
  - 服务端 abort 处理已补结构化日志：streamId、chatId、settled、localAborted、goAbortOk、reason。
  - 无 Redis 的本地环境下，`activeStreams`、`pendingChatStreams`、`pollingStreams` 和 in-memory stream buffer 使用 `globalThis` 单例，避免 Next dev route chunk 分开加载导致 abort route 看不到 active stream。
  - tool loop 遇到 abort 时设置 `streamContext.wasAborted`，不继续 tool call。
  - 写回前 `throwIfAborted()` 保持硬边界。
- 数据流/调用链变化：
  - `Stop button -> local AbortController.abort -> /api/mothership/chat/abort -> stream abort controller -> tool-loop abort check -> provider abort -> writeback guard`
- 需要新增或修改的测试：
  - `use-chat.test.ts`：abort payload 和重试路径。
  - `app/api/copilot/chat/abort/route.test.ts`：abort handler 的 chatId 已知路径、streamId-only 后解析 chatId 路径和结构化日志。
  - `session/abort.test.ts`：active stream registry 能触发同一个 AbortController。
  - `tool-loop.test.ts`：abort 后不继续执行。
  - `canvas-tools.test.ts`：生成完成但写回前 abort 不调用 edit。
  - provider tests：fetch/poll sleep 可 abort。
- 手工验证步骤：
  - 先跑“发送后立即 stop”样本，确认与当前 H-04 一致。
  - 已补 API/SSE 版“chatId 已解析后 stop”样本：`streamId=h04-node-stream-1780831081015`、`chatId=388771b6-d911-4839-9d3e-560f6d605a0c`、abort 返回 `aborted=true/settled=true`、SSE finalStatus 为 `cancelled`、15 秒后 state hash 不变。
  - 已补 preview 浏览器 UI 二次样本：`localhost:3000` workflow `e9f8bb55-52e6-4c2b-b8f8-35f60e9c0c6a`，Stop button 立即出现并点击，Network 有 `/api/mothership/chat/abort` 和 `/api/mothership/chat/stop` 请求，30 秒后 state hash 仍为 `14680279081603930949`，blocks/edges/files 不变。该样本证明 UI stop 与无迟到写回；chatId 已解析 body 仍由 API/SSE 样本覆盖。
  - 等待 15 到 60 秒后取 workflow hash，确认不变。
- 风险和回滚点：
  - 不要求撤销已经提交到第三方的远端生成任务；只要求本地不继续写回。

### 阶段 6：附件 / 文件脱敏专项

- 目标：证明所有 agent-visible 文件上下文与节点 file detail 同等脱敏。
- 要改的文件：
  - `context-manager.ts`
  - `context-tools.ts`
  - `canvas-tools.ts`
  - `node-adapters/{document,image,image-editor,video,audio}.ts`
  - 相关 tests
- 具体实现思路：
  - 内部 `LocalAgentAttachment` 可保留 key/url/path 供匹配和读取，但 agent-visible 输出只允许 name/type/size。
  - `buildAttachmentContext()`、`readFileContext()`、`sanitizeCanvasNodeDetailForAgent()` 的输出要作为统一红线。
  - 检查 attachedContexts.content 是否来自文件处理服务，若内容中包含 storage URL/path，进入 agent 前要裁剪或脱敏。
- 数据流/调用链变化：
  - `request fileAttachments/attachedContexts -> internal context -> redacted prompt/tool output -> observations/final answer`
- 需要新增或修改的测试：
  - `context-manager.test.ts`：prompt 附件不含 key/url/path。
  - `context-tools.test.ts`：`read_file` 输出不含 key/url/path。
  - `canvas-tools.test.ts`：selected node file detail 只含 name。
  - `models/actor.test.ts`：最终回答不复述敏感路径。
- 手工验证步骤：
  - 准备带 key、previewUrl、storage path 的附件。
  - 询问 agent “这个文件是什么/读取附件信息”。
  - 检查 Network/SSE/final answer/server log，不出现 private key、`/api/files/serve` URL、workspace storage path、signed URL。
- 风险和回滚点：
  - 不要删除内部读取所需字段；只改输出边界。

### 阶段 7：F-02/F-03/F-04 回归和第一阶段边界文档化

- 目标：保持 manual Confirm/Revise 已通过状态，明确非持久化边界。
- 要改的文件：
  - `runtime.ts`
  - `stream.ts`
  - `special-tags.tsx`
  - `options.tsx`
  - `mothership-chat.tsx`
  - `use-chat.ts`
  - docs
- 具体实现思路：
  - 保持 30 分钟 TTL。
  - Confirm/Revise token 和 pending key 必须匹配同一 user/workspace/workflow/chat。
  - Confirm 执行前删除 pending，第二次点击不能重复执行。
  - Revise 删除 pending，不执行 patch。
  - 文档明确：第一阶段不做 DB 持久化；刷新、服务重启、多实例后 pending 失效，需要重新发起。
- 数据流/调用链变化：
  - `manual request -> pendingPlans Map -> option special tag -> inline option click -> command message -> maybeHandlePendingPlan -> execute or revise`
- 需要新增或修改的测试：
  - `runtime.test.ts`：TTL 过期、token mismatch、Confirm 一次性、Revise 不执行。
  - `options.test.tsx`、`mothership-chat.test.tsx`：Confirm/Revise raw key 传给 submit。
- 手工验证步骤：
  - 重跑 F-02/F-03/F-04 preview 浏览器路径。
  - 观察同一 chatId、state hash、tool blocks。
- 风险和回滚点：
  - 持久化 pending plan 会引入 DB/schema/多实例复杂度，不纳入第一阶段。

### 阶段 8：测试污染清理和 legacy 隔离

- 目标：防止中危测试污染回归，降低旧 runtime 误用风险。
- 要改的文件：
  - `models/actor.ts`
  - `planner.ts`
  - `models/prompts.ts`
  - `workgroup-profile.ts`
  - `content-canvas-agent.ts`
  - `run.test.ts`
  - persona tests
- 具体实现思路：
  - 生产 prompt/guard 只写通用规则，不列测试预期中文词。
  - 测试文件可保留“总导演/各组注意”等 fixture，验证通用 guard 能拦截。
  - `content-canvas-agent.ts` 第一阶段保留 deprecated，不删除；入口测试断言 `content_canvas_v1` 只调用 local runtime。
  - 如果旧文件仍被误读，可在文件顶部增加更醒目的 TSDoc，不改生产路由。
- 数据流/调用链变化：无生产目标变化。
- 需要新增或修改的测试：
  - persona 泄露回归。
  - `run.test.ts` routing 断言。
  - 泄露 grep 作为 PR checklist。
- 手工验证步骤：
  - 回归 A-01/A-02/B-01/B-03/E-01，确认不出现 internal persona、系统 prompt 或 team-broadcast 口吻。
- 风险和回滚点：
  - 删除 legacy runtime 风险大，容易牵连旧测试和迁移参考；第一阶段只隔离和标注。

### 阶段 9：验收文档收尾

- 目标：把 A-01 到 H-04 全部转成通过或明确等价证据。
- 要改的文件：
  - `docs/local-canvas-agent-phase-1-manual-test-checklist-zh.md`
  - `docs/local-canvas-agent-phase-1-retest-notes-zh.md`
  - 本文档若计划发生变化
- 具体实现思路：
  - 每项写明日期、入口、workflowId、chatId/streamId、证据类型、最终结论。
  - 对 API/SSE 等价证据写清楚为什么可以替代浏览器。
  - 对 UI live refresh、文件预览、loading、Confirm/Revise 点击，不用 API 证据冒充浏览器通过。
- 数据流/调用链变化：无。
- 需要新增或修改的测试：无。
- 手工验证步骤：按第四节复测顺序。
- 风险和回滚点：文档提交应与功能修复提交分开，便于回滚功能时保留客观证据。

## 四、测试计划

所有命令优先使用 `bun` / `bunx`，不要使用 `npm` / `npx`。Vitest 建议在 `apps/sim` 下执行。

### 最小单元测试集合

```powershell
Push-Location apps/sim
bun run test -- `
  lib/copilot/request/lifecycle/local-canvas-agent/routing.test.ts `
  lib/copilot/request/lifecycle/local-canvas-agent/planner.test.ts `
  lib/copilot/request/lifecycle/local-canvas-agent/canvas-patch.test.ts `
  lib/copilot/request/lifecycle/local-canvas-agent/canvas-tools.test.ts `
  lib/copilot/request/lifecycle/local-canvas-agent/canvas-verify.test.ts `
  lib/copilot/request/lifecycle/local-canvas-agent/context-manager.test.ts `
  lib/copilot/request/lifecycle/local-canvas-agent/context-tools.test.ts `
  lib/copilot/request/lifecycle/local-canvas-agent/tool-loop.test.ts `
  lib/copilot/request/lifecycle/local-canvas-agent/models/actor.test.ts `
  lib/copilot/request/lifecycle/local-canvas-agent/models/verifier.test.ts
Pop-Location
```

### 入口 / 生命周期测试

```powershell
Push-Location apps/sim
bun run test -- `
  lib/copilot/request/lifecycle/local-canvas-agent/runtime.test.ts `
  lib/copilot/request/lifecycle/local-canvas-agent/runtime-foundation.test.ts `
  lib/copilot/request/lifecycle/run.test.ts
Pop-Location
```

### UI 或 hook 测试

```powershell
Push-Location apps/sim
bun run test -- `
  "app/workspace/[workspaceId]/home/hooks/use-chat.test.ts" `
  "app/workspace/[workspaceId]/home/components/mothership-chat/mothership-chat.test.tsx" `
  "app/workspace/[workspaceId]/home/components/message-content/components/options/options.test.tsx" `
  "app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags.test.tsx" `
  "app/workspace/[workspaceId]/home/components/user-input/user-input.integration.test.tsx" `
  "app/workspace/[workspaceId]/home/components/user-input/components/send-button.test.tsx"
Pop-Location
```

### 生成服务 / 取消测试

```powershell
Push-Location apps/sim
bun run test -- `
  lib/content-canvas/text-executor.test.ts `
  lib/generated-media/image/image-generation-service.test.ts `
  lib/generated-media/image/providers.test.ts `
  lib/generated-media/video/video-generation-service.test.ts `
  lib/generated-media/video/providers.test.ts `
  lib/generated-media/audio/audio-generation-service.test.ts `
  lib/generated-media/audio/providers.test.ts
Pop-Location
```

### API validation

从 repo root 执行：

```powershell
bun run check:api-validation
```

### type-check / biome

开发过程中优先跑定向测试和定向 Biome，不在每个小改后跑全仓耗时检查。

局部 Biome：

```powershell
bunx biome check `
  apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/routing.ts `
  apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/planner.ts `
  apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/canvas-tools.ts `
  apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/canvas-verify.ts `
  apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/tool-loop.ts `
  apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/runtime.ts
```

PR 前建议：

```powershell
bun run check:api-validation
bun run lint:check
bun run type-check
```

如果只改 docs，不需要跑 type-check。若改生成服务签名、API route/hook contract、abortSignal 类型或 API 边界，必须跑 type-check 和 API validation。

### 手工复测顺序

第一优先级：仍缺浏览器证据或 UI 刷新证据的失败/高风险点。

1. G-02/G-03/G-04：作为媒体生成回归保护。判断通过：`file` 写回，预览刷新，不泄露 key/url/path。
2. F-02/F-03/F-04：manual Confirm/Revise 真实页面回归；F-01 已补 current-source preview DOM 连接复验，后续仅作为 stream/store/rendering 回归点。
3. G-01/G-05：已有 API/SSE、浏览器或 dedicated unit 证据；后续只在 text generation/provider/verifier 或 text UI 改动后回归。
4. 附件/文件脱敏专项：已有 fake attachment metadata 真实 SSE 无泄露证据和 focused `read_file` 成功路径测试；后续重启 current-source server 后可补成功 `read_file` 端到端样本。
5. H-04：已具备浏览器核心样本、chatId API/SSE 样本和 preview 浏览器 UI 二次样本；后续只在 stop/abort/cancel 链路改动后回归。

第二优先级：已通过但高风险的回归点。

1. A-03：明显非画布请求不读不改；对照“以该主题创建内容链”仍走 canvas。
2. F-02/F-03/F-04：manual plan、Confirm、Revise 真实页面点击，同一 chatId，一次性消费。
3. H-04：长任务中 stop；当前已有浏览器核心样本、server log 可观测性、chatId API/SSE 样本和 preview 浏览器 UI 二次样本，后续作为回归保护。
4. B-02/B-04：仅在 selection 或 UserInput payload 改动后回归；当前已有 preview 浏览器级通过证据。

第三优先级：全量回归。

1. A-01、A-02。
2. B-01、B-03。
3. C-01、C-02、C-03。
4. E-01、E-02。
5. H-01、H-02、H-03。

每个手工用例必须观察：

- Network request：`workflowCopilotMode`、`confirmationMode`、`thinkingLevel`、`autoSelectionContexts`、`chatId`。
- SSE/tool blocks：tool name、target `nodeId`、patch operations、verify target field。
- Server log：routing decision、tool-loop step、abort/cancel、verify result。
- Workflow state：节点字段、连接、position、file 是否真实变化。
- UI：loading 是否结束、Confirm/Revise 是否可点击、文件预览是否刷新、错误是否可见。

中文 API/SSE 复测注意：

```powershell
$json = $body | ConvertTo-Json -Depth 50 -Compress
$bytes = [Text.Encoding]::UTF8.GetBytes($json)
Invoke-WebRequest `
  -Method Post `
  -Uri "http://localhost:3001/api/mothership/chat" `
  -Headers @{ "User-Agent" = "CodexLocalCanvasRetest/1.0" } `
  -ContentType "application/json; charset=utf-8" `
  -Body $bytes
```

不要用 PowerShell 普通字符串 `-Body` 发送中文 JSON，否则可能出现 mojibake 并造成假失败。

## 五、测试集泄露复查方案

### 必查 grep

从 repo root 执行，排除测试文件：

```powershell
rg -n -e "A-0[1-3]|B-0[1-4]|C-0[1-3]|D-0[1-3]|E-0[1-4]|F-0[1-4]|G-0[1-5]|H-0[1-4]" `
  apps/sim/lib apps/sim/app `
  --glob "!**/*.test.ts" --glob "!**/*.test.tsx" --glob "!**/*.spec.ts" --glob "!**/*.spec.tsx"

rg -n -F "春季发布会主视觉" `
  apps/sim/lib apps/sim/app `
  --glob "!**/*.test.ts" --glob "!**/*.test.tsx" --glob "!**/*.spec.ts" --glob "!**/*.spec.tsx"

rg -n -F "把所有节点都删掉" `
  apps/sim/lib apps/sim/app `
  --glob "!**/*.test.ts" --glob "!**/*.test.tsx" --glob "!**/*.spec.ts" --glob "!**/*.spec.tsx"

rg -n -F "基于我选中的节点，提炼 3 个关键卖点" `
  apps/sim/lib apps/sim/app `
  --glob "!**/*.test.ts" --glob "!**/*.test.tsx" --glob "!**/*.spec.ts" --glob "!**/*.spec.tsx"

rg -n -F "根据这个节点的 aiPrompt 生成正文并写回。" `
  apps/sim/lib apps/sim/app `
  --glob "!**/*.test.ts" --glob "!**/*.test.tsx" --glob "!**/*.spec.ts" --glob "!**/*.spec.tsx"

rg -n -e "总导演" -e "各组注意" -e "导演这边" -e "各位团队成员" -e "总导演 Agent" `
  apps/sim/lib/copilot/request/lifecycle/local-canvas-agent `
  "apps/sim/app/workspace/[workspaceId]/home" `
  "apps/sim/app/workspace/[workspaceId]/w/[workflowId]" `
  --glob "!**/*.test.ts" --glob "!**/*.test.tsx" --glob "!**/*.spec.ts" --glob "!**/*.spec.tsx"
```

### 允许出现的位置

- `docs/local-canvas-agent-phase-1-*.md`
- `*.test.ts`
- `*.test.tsx`
- fixtures / mocks
- `apps/sim/lib/collaboration/**` 等真实协作工种业务定义中的产品域词

### 不允许出现的位置

- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/**/*.ts` 的非测试生产代码。
- `models/prompts.ts`、`models/actor.ts`、`planner.ts` 中复制测试预期文案。
- runtime guard 中按完整测试输入、测试编号或具体中文禁用词造通过结果。
- UI 文案中硬编码手工用例输入或预期回答。

### 无泄露判定标准

- 生产 prompt/guard 只表达通用规则：不暴露内部字段、不自称内部 agent/persona、不做团队广播式开场。
- 不列举复测文档里的中文禁用词。
- 不按 `A-03`、`G-01` 等编号或完整测试输入做分支。
- persona 泄露测试仍通过，但依赖通用规则或 fixture mock，不依赖生产硬编码测试词。
- grep 命中如果来自 docs/tests/fixtures/协作产品定义，要在复查记录中标为允许；如果来自 production local-canvas-agent prompt/guard，则必须整改。

## 六、交付顺序建议

### Commit 1：证据矩阵和复测文档同步

- 解决内容：同步当前 A/B/F/H 已有证据，明确 D/E/G 剩余缺口和 browser/API 证据口径。
- 对应测试：无代码测试；只需 markdown review。
- 可独立回滚。

### Commit 2：F-01 右侧 Copilot 画布 live refresh 验证与收敛

- 解决内容：验证当前右侧 Copilot local canvas mutation 成功后的 committed workflow state reload 和 stream-end 兜底是否足以让 F-01 布局修改无刷新反映到 ReactFlow；若仍失败，再收敛 `workflow.tsx` 的 position-only reconcile 或 workflow store hydration，避免继续改已通过的 agent patch/verify。
- 对应测试：优先新增/调整 focused UI handler test；若抽出 position reconcile helper，补 helper 单元测试；至少跑 `bunx biome check apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/copilot-tab.tsx apps/sim/app/workspace/[workspaceId]/w/[workflowId]/workflow.tsx`，并补 F-01 浏览器 DOM live refresh 证据。
- 可独立回滚；只影响 `canvas.apply_patch` / `canvas.generate_node_output` 后的 local canvas mutation refresh 或外部 committed position 同步，legacy `edit_workflow` diff 行为和拖拽体验必须保持。

### Commit 3：D-01/D-02/D-03 证据同步与回归保护

- 解决内容：同步创建内容链、补后续、补前置的 current-source preview 证据；后续作为已通过用例保留回归保护。
- 对应测试：`planner.test.ts`、`canvas-tools.test.ts`、`canvas-patch.test.ts`、`canvas-verify.test.ts`。
- 可独立回滚。若只是文档补证，与功能修复分开提交。

### Commit 4：E-03/E-04 字段更新闭环

- 解决内容：video/audio 更新真实写入字段，verify 和最终回答一致。
- 对应测试：`planner.test.ts`、`canvas-verify.test.ts`、`models/actor.test.ts`。
- 可独立回滚。

### Commit 5：G-01/G-05 生成字段级验收和失败处理

- 解决内容：text 生成写回 `contentHtml`，生成失败不清空旧值、不假报成功。
- 对应测试：`canvas-tools.test.ts`、`tool-loop.test.ts`、`models/verifier.test.ts`、`text-executor.test.ts`。
- 建议独立提交，便于回滚 provider 相关改动。

### Commit 6：G-02/G-03/G-04 媒体生成和预览刷新

- 解决内容：image/video/audio 写回 `file`，预览/播放器刷新，上游参考图和脱敏验证。
- 对应测试：generation service/provider tests、`canvas-tools.test.ts`、必要时 content block UI tests。
- 可独立回滚；真实 provider 风险较高，建议单独 PR。

### Commit 7：H-04 可观测性补强

- 解决内容：stop 后 server log 可按 streamId/chatId 追踪，chatId 已解析后的停止样本通过。
- 对应测试：`use-chat.test.ts`、`app/api/copilot/chat/abort/route.test.ts`、`lib/copilot/request/session/abort.test.ts`、`tool-loop.test.ts`、`canvas-tools.test.ts`、provider abort tests。
- 可独立回滚。

### Commit 8：附件 / 文件脱敏专项

- 解决内容：附件、file detail、tool output、observation、最终回答不泄露 key/url/path。
- 对应测试：`context-manager.test.ts`、`context-tools.test.ts`、`canvas-tools.test.ts`、`models/actor.test.ts`。
- 可独立回滚。

### Commit 9：Manual Confirm / Revise 回归和边界文档

- 解决内容：F-02/F-03/F-04 防回归，明确第一阶段不做 pending plan 持久化。
- 对应测试：`runtime.test.ts`、`options.test.tsx`、`mothership-chat.test.tsx`。
- 可独立回滚。

### Commit 10：测试污染清理和 legacy 隔离

- 解决内容：生产 prompt/guard 不复制测试预期词，旧 `content-canvas-agent.ts` deprecated 边界明确。
- 对应测试：persona guard tests、`run.test.ts`、泄露 grep。
- 可独立回滚。

### Commit 11：第一阶段验收收尾

- 解决内容：A-01 到 H-04 全部通过或有等价当前源码真实证据，更新 checklist 和 retest notes。
- 对应验证：
  - local-canvas-agent targeted suite
  - entry/UI/hook suite
  - generation service/provider suite
  - `bun run check:api-validation`
  - PR 前 `bun run lint:check` 和 `bun run type-check`
- 不建议和功能修复混在同一 commit，便于回滚功能改动时保留验收记录。
