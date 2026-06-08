# Local Canvas Agent 阶段二代码验证与手工 Smoke 记录

日期：2026-06-08

工作区：`E:\project\sim`

本文记录阶段二当前代码侧验证证据，并把需要浏览器或真实 provider 才能证明的 smoke 项单独列出。自动化、API/SSE、浏览器和真实 provider 证据需要一起看，不能只用单元测试替代完整验收。

## 1. 当前代码侧覆盖

### 1.1 Intent / Task Policy v2

- `intent.ts` 输出 `userIntent`、`mutationPolicy`、`canvasReadPolicy`、`confidence`、`evidence` 和 `requiresUserConfirmation`。
- “先讨论/先规划/等确认”保持 `read_only` 或 `propose_only`，不会升级到 `allow_mutation`。
- 明确创建、更新、连接、生成写回才允许 mutation。
- 明确非画布问题保持 `non_canvas/read_only/none`；即使当前有选中节点，纯非画布问题也不会因为选中态强行读画布。
- 通用编程类“更新 TypeScript 代码”等请求保持非画布，不被通用“更新”动词误判成画布修改。
- 考试类主题可作为画布内容主题：纯“高考可能会考什么”是非画布；“以高考为主题创建短视频内容链”是画布 mutation。

### 1.2 Planner v2

- Planner 接收 immutable intent policy；模型计划不能把 `read_only/propose_only` 升级为 mutation。
- `read_only/propose_only` 下会过滤 `canvas.apply_patch`、`canvas.generate_node_output` 和 stale verify hints。
- 内容链创建使用 `buildContentChainPlan()` / content-chain field 构造，生成 text/image/video/audio 四类节点和连接。
- 文本节点正文不直接复制用户原始命令；image/video/audio 只写 prompt 和参数，不伪造 `file`。
- 主题抽取不依赖固定样例词表；任意主题如“火星露营”能进入节点字段，同时不会保留“以 X 为主题创建内容链”这类操作命令句。
- 选中节点后补充 text 节点时，也会基于选中节点摘要生成可编辑草稿，不把“在选中的图片后面加一个口播文案”这类操作命令直接写进 `contentHtml`。

### 1.3 Memory / Context v2

- `LocalContextBudget` 使用 `Record<keyof typeof CONTEXT_BUDGET, number>`，避免预算键和类型漂移。
- summarizer 只把 verify 成功的操作写入 `completedSteps`。
- consult/propose、verify failed、tool failed、abort/unverified write 不会被记录成已完成画布工作。
- Actor final answer 不再在缺少成功 `canvas.verify_patch` 时声称“已验证完成”。

### 1.4 Patch / Verify / Adapter v2

- patch operation 支持 `operationId`。
- verify 输出逐项 `operationResults`，包含 `operationId`、operation type、node/field/source/target、expected、actual、success、error。
- create verify 检查 created node 的 kind/title/fields。
- update verify 做字段级定位；`contentHtml` 支持文本归一化比较，避免仅因 markup 差异造成误判。
- connect verify 映射 client node id 到真实 node id。
- layout verify 检查目标位置顺序和方向。
- generation verify 只暴露 safe file metadata，不暴露 key/url/path。

### 1.5 UI Lifecycle / Generation / Tool Loop v2

- tool-loop 对 `read_only/propose_only` 执行硬过滤。
- `canvas.verify_patch` 在非 `allow_mutation` policy 下被阻止，避免旧 verify hint 在只读模式里制造误导。
- generation 成功后写回目标字段，失败或 abort 不清空旧值；单元测试覆盖 text/image/video/audio 和 late abort。
- UI hook/component tests 覆盖 Stop、Confirm/Revise options、local mutation reload、stream state 基本行为。

### 1.6 Claude Code 源码复用评估落实

- 已复查 `E:\project\claudecode源码\claude-code-source-code`，`package.json` 标注为 decompiled research source，且依赖 CLI/Ink、本地 shell/file edit、Anthropic/Bedrock/Vertex token counting 和 `bun:bundle` feature gate，不适合逐行移植到 Sim。
- 本阶段复用的是架构模式而不是代码拷贝：category context budget、tool lifecycle/progress/status、abort guard、secret/redaction guard、tool result summary。
- Sim 落地位置分别是 `context-manager.ts`、`tool-loop.ts` / `tool-executor-bridge.ts` / `stream.ts`、`redaction.ts`、`models/summarizer.ts`，保持 Next.js + DB + ReactFlow + workspace 权限边界。

### 1.7 模型驱动 Tool Loop / Media Tool 追加

- 新增 `decision.ts`：模型每轮返回 `AgentDecision` JSON，支持 `tool_call`、`ask_confirmation`、`ask_clarification`、`final_answer`。
- `tool-loop.ts` 支持 `LOCAL_CANVAS_AGENT_MODE=legacy|hybrid|model_tool_loop`；默认 hybrid，初始 decision 不可用时回退旧 plan-driven loop，显式 `model_tool_loop` 不静默降级。
- 模型调用工具前由 runtime 再次校验 descriptor availability、input schema、mutation policy 和 destructive guard。
- `canvas.apply_patch` / `canvas.generate_node_output` 成功后如果模型直接 final answer，runtime 会自动补 `canvas.verify_patch`，避免未验证写入被汇报为完成。
- 新增 `tool-result-budget.ts`，decision prompt 只放带 `outputRef` 的预算化 observation preview，不把大 tool output 全量塞回上下文。
- 新增 `media.analyze_node_media` 只读工具：可读取 image/video/audio 节点的 prompt、safe file metadata、已存媒体 context；无 file 时明确降级为 prompt-only，不假装看过真实媒体。
- `final_answer.memoryUpdate` 收窄为结构化 thread memory update；model loop 会把该更新记录成 `memory` observation，再由 summarizer 合并进当前 chat 的 deterministic memory。
- decision prompt 明确 patch 示例只是 recipe，不是固定模板；选中节点修改必须先读选中节点，再只更新对应 `nodeId` 的可编辑字段；媒体描述必须区分 prompt/metadata 与真实 file。
- tool observation prompt 现在限制最近 observation 数量、单个 output preview 和整体 prompt 长度；较早结果只保留 omitted 说明，较大输出通过稳定 `outputRef` + preview 暴露。
- `media.analyze_node_media` 支持 `analysisGoal=describe|quality_check|extract_prompt|compare_with_prompt`，model loop 覆盖“读取选中视频 -> 媒体分析 -> 最终回答”且不触发画布写入。
- `AgentDecision` 支持 `tool_calls` 批量只读调用；runtime 只允许 read-only 且 concurrency-safe 的工具并行执行，写入/生成/验证工具仍被阻止并保持串行。

## 2. 当前已跑验证命令

以下命令均在当前工作树上通过：

- `cd apps/sim; bun run test lib/copilot/request/lifecycle/local-canvas-agent`：18 files / 174 tests passed
- `cd apps/sim; bunx vitest run "lib/copilot/request/lifecycle/run.test.ts" "lib/copilot/request/lifecycle/start.test.ts" "app/api/copilot/chat/abort/route.test.ts" "app/api/copilot/chat/stop/route.test.ts" "lib/copilot/request/session/abort.test.ts"`：5 files / 19 tests passed
- `cd apps/sim; bunx vitest run "app/workspace/[workspaceId]/home/hooks/use-chat.test.ts" "app/workspace/[workspaceId]/home/components/user-input/user-input.integration.test.tsx" "app/workspace/[workspaceId]/home/components/user-input/components/send-button.test.tsx" "app/workspace/[workspaceId]/home/components/message-content/components/options/options.test.tsx" "app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags.test.tsx" "app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/copilot-tab.test.tsx"`：6 files / 25 tests passed
- `bunx biome check --no-errors-on-unmatched <changed TS files>`：passed
- `bunx tsc --noEmit --pretty false --project apps/sim/tsconfig.json --ignoreDeprecations 6.0`：passed
- `cd apps/sim; bun run type-check`：passed（阶段二历史验证）
- `cd apps/sim; bunx next typegen`：passed；用于修复前一次 Next dev 中断留下的 `.next-build/dev/types/routes.d.ts` 重复尾部，之后 `type-check` 重新通过
- `bun run check:api-validation`：passed，`440/415/25`
- `git diff --check`：passed
- 生产代码泄漏 grep：manual IDs、完整手工样例短语、persona/broadcast 短语均无命中

## 3. API/SSE smoke 记录

以下 smoke 使用本地 Next dev + PostgreSQL，`DISABLE_AUTH=true`，通过 `curl.exe` 以 UTF-8 字节写入/读取 SSE，避免 PowerShell `Invoke-WebRequest` 的中文响应误解码。`3017` 端口曾返回 403，日志确认原因是空 `User-Agent` 被代理层按 suspicious request 拦截；后续请求统一带 `User-Agent: CodexPhase2Smoke/1.0`。

### 3.1 non-canvas 与 consult

- 端口：`3018`
- 复用 workflow：`71eab20d-b39d-475e-971f-7465abe12d2d`
- workspace：`6008600b-37eb-4598-9ef7-02098086468b`
- 证据文件：
  - `tmp-local-canvas-agent-phase2-smoke-3018-responses/non_canvas_gaokao.sse`
  - `tmp-local-canvas-agent-phase2-smoke-3018-responses/consult_xiaohongshu_cat.sse`
  - `tmp-local-canvas-agent-phase2-smoke-3018.results.json`

| 输入 | SSE 结果 | 画布状态 | 结论 |
|---|---|---|---|
| `高考可能会考什么内容？` | HTTP 200；3 个 SSE events；无 tool events；无 `canvas.apply_patch` / `canvas.generate_node_output` / `canvas.verify_patch`；assistant 明确“不是当前画布相关任务，我不会读取或修改画布” | hash 前后均为 `nwxbwyYskMhFwDVzgApBvxlvBLt8oLOsGNSn8kL5SH0=` | 通过：非画布请求不读、不写画布 |
| `你好，我想做一个小红书的小猫ai视频生成工作流，先告诉我工作流如何设计，和我讨论一下` | HTTP 200；4 个 SSE events；无 tool events；无 `canvas.apply_patch` / `canvas.generate_node_output` / `canvas.verify_patch`；assistant 明确“先不改画布”并给出设计问题 | hash 前后均为 `nwxbwyYskMhFwDVzgApBvxlvBLt8oLOsGNSn8kL5SH0=` | 通过：consult 只讨论，不修改画布 |

### 3.2 内容链创建 API smoke

- 端口：`3018`
- 新建 disposable workflow：`c0cdbda4-b652-4e83-a000-697e58cee16a`
- 证据文件：
  - `tmp-local-canvas-agent-phase2-smoke-3018-responses/mutation_mars_content_chain.sse`
  - `tmp-local-canvas-agent-phase2-state-3019.summary-utf8.json`
  - `tmp-local-canvas-agent-phase2-state-3019.state.json`

输入：

```text
以火星露营为主题创建一个短视频内容链，包含脚本、主视觉、视频、配乐，并按生产顺序连接。
```

结果：

- SSE HTTP 200；12 个 SSE events。
- tool events 包含 `canvas.read_summary`、`canvas.search_nodes`、`canvas.apply_patch`、`canvas.verify_patch`。
- `canvas.apply_patch` 和 `canvas.verify_patch` 均成功；assistant 返回已创建并按生产顺序连接。
- 后端 state：`blockCount=5`（含默认 start block）、`contentCount=4`、`edgeCount=3`。
- 四个 content variants 为 `text`、`image`、`video`、`audio`。
- state 字段包含主题 `火星露营`，不包含完整原始命令句 `以火星露营为主题创建一个短视频内容链`。

结论：API/state 层通过内容链创建、连接、verify 和字段落库检查；ReactFlow DOM 同步见 3.4 的浏览器证据。

### 3.3 manual Confirm / Revise API smoke

- 端口：`3020`
- Revise workflow：`e53d2026-d8cc-4f59-adcb-c965612091d9`
- Confirm workflow：`b7b75f00-e3b2-4d26-ad2e-42df5d0c1154`
- 证据文件：
  - `tmp-local-canvas-agent-phase2-manual-3020.results.json`
  - `tmp-local-canvas-agent-phase2-manual-3020-responses/manual_plan_revise.sse`
  - `tmp-local-canvas-agent-phase2-manual-3020-responses/manual_revise.sse`
  - `tmp-local-canvas-agent-phase2-manual-3020-responses/manual_plan_confirm.sse`
  - `tmp-local-canvas-agent-phase2-manual-3020-responses/manual_confirm.sse`

结果：

- manual plan：HTTP 200；返回 `<options>`，包含 Confirm / Revise；无 tool events；state hash 不变。
- Revise：发送 `__local_canvas_revise__:<id>`；HTTP 200；回复“请告诉我你想如何调整这次画布修改计划。”；无 `canvas.apply_patch`；state hash 不变。
- Confirm：发送 `__local_canvas_confirm__:<id>`；HTTP 200；tool events 包含 `canvas.apply_patch` 和 `canvas.verify_patch`；state hash 改变。
- Confirm 后 state：`blockCount=5`、`contentCount=4`、`edgeCount=3`；variants 为 `text`、`image`、`video`、`audio`；字段包含主题 `深海图书馆`，不包含完整原始命令句。

结论：API/SSE 层通过 active Confirm / Revise 行为；过期 Confirm 提示由 `runtime.test.ts` 覆盖。

### 3.4 ReactFlow DOM 同步 browser smoke

- 端口：`3024`
- workflow：`c0cdbda4-b652-4e83-a000-697e58cee16a`
- 浏览器：Playwright Test + system Chrome（Playwright 自带 chromium 未安装，改用 `C:\Program Files\Google\Chrome\Application\chrome.exe`）
- 证据文件：
  - `tmp-local-canvas-agent-phase2-playwright-3024.results.json`
  - `tmp-local-canvas-agent-phase2-playwright-3024.png`

结果：

- Playwright：`1 passed (1.8m)`。
- ReactFlow DOM：`.react-flow` 1 个、`.react-flow__node` 5 个、`.react-flow__edge` 3 个。
- DOM 文本包含主题 `火星露营`、脚本文案、image/video/audio 三类 media placeholder。
- 截图可见 text -> image -> video -> audio 的横向内容链和默认 Start 节点。
- 控制台有 `GET /api/workspaces/.../permissions 403`，这是 personal canvas shared-permissions 的既有受控路径，不影响 ReactFlow DOM 同步。

结论：S-02 的 ReactFlow DOM 同步通过。

### 3.5 选中节点字段更新 + browser smoke

- 端口：`3025`（API/SSE）与 `3026`（browser）
- workflow：`c0cdbda4-b652-4e83-a000-697e58cee16a`
- 选中 text node：`38926e22-8e2d-4830-a80e-e60cbb1b08b6`
- 证据文件：
  - `tmp-local-canvas-agent-phase2-field-3025.results.json`
  - `tmp-local-canvas-agent-phase2-field-3025-responses/selected_text_update.sse`
  - `tmp-local-canvas-agent-phase2-field-browser-3026.results.json`
  - `tmp-local-canvas-agent-phase2-field-browser-3026.png`

输入：

```text
把选中的文本节点改成更年轻、更轻快一点的语气。
```

结果：

- SSE HTTP 200；tool events 包含 `canvas.read_selected_nodes`、`canvas.apply_patch`、`canvas.verify_patch`。
- SSE 中包含目标 `nodeId` 和字段 `contentHtml`。
- 后端 state hash 从 `rinergQCCggTpQLPXvztqgbYgfItAv7on/tpICFXU88=` 变为 `Qx3fKcqKFugWwCbuNSs1d+BIrfvFTvleDGxz0hu8EmA=`。
- `contentHtml` 从原脚本改为更年轻、更轻快的表达，例如“抛个超有画面的脑洞问题”“句子要短平快，节奏丝滑又上头”。
- Browser Playwright：`1 passed (1.7m)`；ReactFlow DOM 仍为 5 nodes / 3 edges，body 文本包含更新后的脚本文案和媒体 placeholder。

结论：S-03 的选中 text 节点字段更新、字段级 verify、后端 state 与浏览器 DOM 同步通过。image/video/audio 字段更新仍主要由单元测试覆盖，真实 file 写回见 S-05。

### 3.6 image / video / audio 选中节点字段更新 smoke

- 端口：`3032`
- workflow：`c0cdbda4-b652-4e83-a000-697e58cee16a`
- 证据文件：
  - `tmp-local-canvas-agent-phase2-media-fields-3032.results.json`
  - `tmp-local-canvas-agent-phase2-media-fields-3032-responses/update_image.sse`
  - `tmp-local-canvas-agent-phase2-media-fields-3032-responses/update_video.sse`
  - `tmp-local-canvas-agent-phase2-media-fields-3032-responses/update_audio.sse`

结果：

| 节点类型 | 选中节点 | 输入 | 写回字段 | 结果 |
|---|---|---|---|---|
| image | `d550b218-fab9-4966-b69d-3721ca8a6065` | `把选中的图片节点提示词改成赛博朋克霓虹风格。` | `aiPrompt` | HTTP 200；`canvas.apply_patch` + `canvas.verify_patch`；无 `canvas.generate_node_output`；字段追加 `赛博朋克霓虹风格` |
| video | `3b77bb8e-8ca1-4e20-9b77-c61ad4352f1a` | `把选中的视频节点提示词改成慢镜头推进，时长改成 8 秒。` | `videoPrompt` | HTTP 200；`canvas.apply_patch` + `canvas.verify_patch`；无 `canvas.generate_node_output`；字段追加 `慢镜头推进，8 秒` |
| audio | `30a5be21-4fa9-4f20-ad23-d9e34fb405ee` | `把选中的音频节点音乐方向改成轻快电子乐。` | `audioPrompt` | HTTP 200；`canvas.apply_patch` + `canvas.verify_patch`；无 `canvas.generate_node_output`；字段追加 `轻快电子乐` |

结论：S-03 的 text/image/video/audio 选中节点字段更新、字段级 writeback、verify 和“更新不误触发生成”均已通过 API/SSE；text 更新后的 DOM 同步已由 3.5 的 browser smoke 覆盖。

### 3.7 真实 provider 生成写回 smoke

- 端口：`3027`
- workflow：`c0cdbda4-b652-4e83-a000-697e58cee16a`
- 证据文件：
  - `tmp-local-canvas-agent-phase2-provider-3027.results.json`
  - `tmp-local-canvas-agent-phase2-provider-3027-responses/generate_text.sse`
  - `tmp-local-canvas-agent-phase2-provider-3027-responses/generate_image.sse`
  - `tmp-local-canvas-agent-phase2-provider-3027-responses/generate_audio.sse`
  - `tmp-local-canvas-agent-phase2-provider-3027-responses/generate_video.sse`

结果：

| 节点类型 | tool events | 写回字段 | 结果 |
|---|---|---|---|
| text | `canvas.generate_node_output` + `canvas.verify_patch` | `contentHtml` | 成功，字段内容变化并 verify |
| image | `canvas.generate_node_output` + `canvas.verify_patch` | `file` | 成功，生成文件写回并 verify |
| audio | `canvas.generate_node_output` + `canvas.verify_patch` | `file` | 成功，生成文件写回并 verify |
| video | `canvas.generate_node_output` + `canvas.verify_patch` | `file` | 成功，生成文件写回并 verify |

附加检查：

- 四次 SSE 均 HTTP 200。
- 四次 `canvas.generate_node_output` tool result 均 `success=true`。
- 四次 `canvas.verify_patch` tool result 均 `success=true`。
- 四次 SSE 均未出现 file `key` / `url` / `path` 泄漏；真实 file metadata 只在后端 state 中落库，不进入 SSE tool output。

结论：S-05 的 text/image/audio/video 真实 provider 写回、verify 和 SSE redaction 通过。

### 3.8 Stop / Abort provider smoke

- 端口：`3030`
- workflow：`c2a9cd88-dfc5-43d7-a5c0-ddc0d236d0e6`
- video node：`12fb2341-6020-407b-83ce-33197ce7c8e0`
- 证据文件：
  - `tmp-local-canvas-agent-phase2-abort-3030.results.json`
  - `tmp-local-canvas-agent-phase2-abort-3030.normalized.json`
  - `tmp-local-canvas-agent-phase2-abort-3030.results.json.node.json`

流程：

1. 新建 disposable workflow，并用 API/SSE 创建 text/image/video/audio 内容链。
2. 对选中 video node 发起真实 `canvas.generate_node_output`。
3. 读到 `canvas.generate_node_output` call event 后立即 POST `/api/mothership/chat/abort`，随后 POST `/api/mothership/chat/stop`，并中断客户端读取。
4. 等待 35 秒后重新读取 workflow state。

结果：

- 已看到 `canvas.generate_node_output` call event。
- `/api/mothership/chat/abort` 返回 HTTP 200，payload 为 `{ aborted: true, settled: true }`。
- `/api/mothership/chat/stop` 返回 HTTP 200，payload 为 `{ success: true }`。
- 35 秒后 workflow state hash 前后相同：`l5WWksmCJ2C+5CAPfsZCdBgu8mEpGOYvM7zwjR/XkVg=`。
- video file 仍是空 file-upload 占位（`value:null`），没有迟到写回。

结论：S-06 的 abort/stop API 触发和 provider 长请求无迟到写回通过。浏览器 Stop 按钮本身已有 UI 单元测试覆盖，本 smoke 验证了真实 provider 链路的服务端行为。

## 4. 浏览器/真实 provider smoke 覆盖矩阵

以下项目不能只由单元测试证明；当前已补齐 API/SSE、Playwright browser、真实 provider 或 abort smoke evidence。

| 编号 | Smoke 项 | 通过标准 | 当前状态 |
|---|---|---|---|
| S-01 | consult 不改画布 | 输入“小红书小猫 AI 视频工作流，先告诉我如何设计，和我讨论一下”；SSE 无 `canvas.apply_patch` / `canvas.generate_node_output`；workflow state hash 不变；回答明确“先不改画布” | 通过：API/SSE 已验证；消息渲染由现有 UI tests 覆盖 |
| S-02 | 内容链创建 | 空白画布创建 text/image/video/audio 四节点三边；节点字段具体且不复制原始命令；ReactFlow DOM 同步 | 通过：API/state + Playwright ReactFlow DOM 已验证 |
| S-03 | 字段更新 | 选中 text/image/video/audio 后更新字段；verify 指出 nodeId/field；UI 字段与后端 state 一致 | 通过：text API/state/DOM 已验证；image/video/audio API/SSE 字段更新已验证 |
| S-04 | manual Confirm/Revise | manual mode 先展示 plan；Confirm 执行；Revise 不执行；过期 Confirm 返回过期提示 | 通过：active Confirm/Revise API/SSE 已验证；过期 Confirm 由 `runtime.test.ts` 覆盖 |
| S-05 | 真实生成写回 | text/image/video/audio 真实 provider 成功写回；失败不污染旧字段；输出不泄露 key/url/path | 通过：text/image/audio/video provider smoke 全部成功 |
| S-06 | Stop/Abort | 生成或长请求中点击 Stop；abort/stop route 触发；30 秒后无迟到写回 | 通过：真实 video provider 生成中 abort/stop，35 秒后 state 未变化 |

## 5. 阶段二验收矩阵

| 阶段 | 要求 | 当前证据 |
|---|---|---|
| 2.0 | 有可复测 checklist，失败能定位到 routing/intent/planner/tool/verify/UI/provider/security 至少一层 | 本文按命令、API/SSE、browser、provider、abort 分层记录；泄漏 grep 与 API/type/biome/diff gate 单独列出 |
| 2.1 | “先讨论”不改画布；创建/修改/生成仍能改；考试主题画布任务不被误拦 | `intent.test.ts`、`routing.test.ts`、`planner.test.ts`、`tool-loop.test.ts`、`runtime.test.ts`；3.1 与 3.2 smoke |
| 2.2 | 内容链质量可编辑可生成；原始命令不直写文本正文；文本重写不回归 | `planner.test.ts` 内容链、任意主题、选中节点补 text 草稿；3.2 state 字段检查；3.5 text 更新 smoke |
| 2.3 | 长对话可跟进；失败、取消、未确认不进 completedSteps；不暴露 secret/path/url/id | `models/summarizer.test.ts`、`context-manager.test.ts`；3.8 abort；生产泄漏 grep |
| 2.4 | 写入失败能指出 nodeId/field；final answer 与 verify 一致；回归失败可按 verify result 定位 | `canvas-verify.test.ts` create/update/connect/layout/generation operationResults 与 `models/actor.test.ts` |
| 2.5 | 用户能看到状态；successful mutation 后 state 与 DOM 同步；cancel 后无迟到写回 | UI hook/component tests；3.4/3.5 Playwright DOM；3.8 abort |
| 2.6 | text/image/video/audio 成功写目标字段；失败不污染旧值；不泄露 key/url/path | `canvas-tools.test.ts` fake provider/abort；3.7 真实 provider；3.8 abort |
| 2.7 | 失败路径不损坏画布；tool call lifecycle 可追踪；final answer 与 observations 一致 | `tool-loop.test.ts` policy/verify/abort/max steps；`models/actor.test.ts`；SSE tool events 见 3.x |

## 6. 本轮结论

阶段二的代码侧实现和自动化验证已经覆盖 Intent / Task Policy v2、Planner v2、Memory/Context v2、Patch/Verify v2、Generation Adapter v2、Tool Loop v2 的主要风险点。本轮新增 API/SSE、Playwright browser、真实 provider 和 abort smoke evidence 后，S-01 到 S-06 均已有当前运行证据。

其中 S-03 的 text 字段更新已经额外通过 browser DOM 同步；image/video/audio prompt 字段更新通过 API/SSE 与后端 state 验证，媒体真实 file 写回与 redaction 由 S-05 provider smoke 覆盖。
