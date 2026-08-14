# Agent 画布静默刷新任务

## 问题描述和用户可见表现

右侧 Agent 回答结束或画布工具执行成功后，前端会重新加载 workflow state。当前加载路径把已就绪的 workflow 重新置为加载中，导致 ReactFlow 被卸载和重新挂载。用户会看到画布闪烁或全屏 loading，缩放和平移复位，拖动、选择和缩放等进行中的操作也会被打断。

## 已确认的根因和调用链

- Copilot 在 `canvas.apply_patch`、`canvas.generate_node_output`、stream end 和 send-settled 等路径调用 `useWorkflowRegistry.getState().loadWorkflowState(workflowId)`。
- `loadWorkflowState()` 将 `hydration.phase` 改为 `state-loading`，使 `isWorkflowReady` 变为 `false`。
- `workflow.tsx` 因此卸载 ReactFlow 并显示 loading；加载完成后重新挂载。
- ReactFlow 的 `onInit` 再次执行初始 `fitView()`，覆盖用户 viewport。
- 同一轮 Agent 回答存在多个触发点，可能产生重复或并发加载。

## 目标与非目标

### 目标

- 增加运行时静默 workflow 刷新通道，刷新期间保持 ready、ReactFlow 挂载和 viewport 不变。
- 继续自动显示 Agent 写入的节点、边、位置、subblock、variables 和生成结果。
- 保留 stream end 兜底，覆盖浏览器未收到 Hermes 内部工具事件的情况。
- 复用现有协作 reconciliation 规则，保护 active diff 和未完成本地操作。
- 对同一 workflow 的刷新实施 single-flight、queued refresh 和时序保护。
- 保持首次加载、workflow 切换、协作同步和 undo/redo 行为。

### 非目标

- 不修改 Hermes 协议，除非后续证明确有协议缺口。
- 不通过重挂载后恢复 viewport、全局样式或定时器掩盖卸载根因。
- 不重构与该问题无关的 workflow、Copilot 或协作模块。

## 涉及文件

- `apps/sim/stores/workflows/registry/store.ts`
- `apps/sim/stores/workflows/registry/types.ts`
- `apps/sim/stores/workflows/registry/store.test.ts`
- `apps/sim/stores/workflows/workflow-state-sync.ts`
- `apps/sim/stores/workflow-diff/utils.ts`
- `apps/sim/stores/workflow-diff/utils.test.ts`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/copilot-tab.tsx`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/copilot-tab.test.tsx`
- `apps/sim/hooks/use-collaborative-workflow.ts`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/workflow.tsx`（仅复核 ready/onInit 链路，未修改）
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-canvas-helpers.test.ts`（复用既有位置 reconcile 覆盖，未修改）

## 分阶段任务清单

| 阶段 | 状态 | 做到什么程度 | 接下来还要做什么 |
| --- | --- | --- | --- |
| 0. 阅读约束与检查工作区 | completed | 已完整阅读两个仓库适用的 `AGENTS.md`；确认 `sim-canonical` 干净，`hermes-agent-sim` 有用户已有的 `uv.lock` 修改 | 保持 Hermes 修改不动 |
| 1. 复核调用链与测试基线 | completed | 已逐行确认 registry 初始加载、协作 reload、Copilot 工具/终止触发、ReactFlow ready 条件与 `onInit fitView`；确认 `notifyTurnEnded` 覆盖正常完成和用户停止 | 进入实现阶段 |
| 2. 实现静默刷新协调器 | completed | 已实现 `refreshWorkflowState`，保持 hydration/active workflow 不变；加入 active diff、operation queue、pending external update、stale hydration/workflow、undo/redo 剪枝、single-flight 和 queued refresh | 通过自动化测试继续验证边界 |
| 3. 调整 Copilot 触发策略 | completed | `canvas.apply_patch`、`canvas.generate_node_output` 和 stream end 已改用静默刷新；删除 send-settled workflow 刷新；协作 revert/external update/replay 复用同一通道 | 运行相关测试确认无回归 |
| 4. 自动化测试与静态检查 | completed | 24 个 focused 测试、102 个相关回归测试、typecheck、API 审计和改动文件 Biome 均通过；全应用 lint 被仓库已有的 94 个无关格式/排序错误阻塞 | 不修改无关 lint 文件 |
| 5. 浏览器验收 | in_progress | 初始沙箱端口限制已解除；已重新生产构建并通过 systemd 启动 SIM 3000、Realtime 3002，Hermes 8642 保持运行；health 和 service preflight 均通过 | 在当前已恢复环境补跑 10 项手工/Playwright 验收 |
| 6. 收尾与风险复核 | completed | 已确认运行时调用点不再使用 `loadWorkflowState()`，send-settled workflow 同步已删除；diff/status 检查完成，Hermes 仓库未修改 | 交付并明确浏览器阻塞 |

## 当前正在进行的工作

实现、自动化验证、静态检查和收尾复核已完成；完整服务已重新构建并启动，真实浏览器验收环境现已可用。

## 已完成的代码修改

- 新增 `useWorkflowRegistry.refreshWorkflowState(workflowId, options?)`，请求期间不修改 hydration、active workflow 或浏览器 active-workflow 事件。
- 抽出 `workflow-state-sync.ts`，复用原有 blocks/edges、subblocks 和 variables 原地应用逻辑。
- 静默刷新加入 workflow/hydration identity 判旧、workspace scope 校验和 undo/redo 无效条目剪枝。
- 同一 workflow 刷新采用 single-flight；飞行中触发合并为一次 queued follow-up。
- active diff 或 operation queue 存在时标记 `pendingExternalUpdate`；operation 排空后自动重试，diff settle 继续由现有协作事件重放。
- 协作 hook 的 revert、external update 和 pending replay 改为调用 registry 静默刷新。
- Copilot 画布工具成功与 stream end 改为静默刷新；send-settled 不再加载 workflow。

## 关键技术决策及原因

- 首次加载与运行时同步分离：首次进入和真正切换 workflow 继续使用 `loadWorkflowState()`，Agent 写入后的同步使用独立静默通道，避免改变初始 loading 和 `fitView()` 语义。
- 暂不修改 `hermes-agent-sim`：现有信息表明问题发生在 SIM 前端加载语义，且 stream end 已能提供兜底信号。
- `send-settled` 不再承担 workflow 同步：`useChat.notifyTurnEnded()` 在正常完成的 `finalize()` 和成功停止路径都会调用 `onStreamEnd`，该通知对单次终止转换是幂等的；send-settled 只需继续刷新聊天列表。
- 协作同步与 Agent 同步共用 registry 静默刷新：避免复制 active diff、operation queue、pendingExternalUpdates、stale result 和 undo/redo 剪枝规则。
- 同一 workflow 使用 single-flight；飞行中触发只记录一次 queued refresh，当前请求结束后补一次，以覆盖请求期间发生的最后写入。

## 已运行的测试和结果

- `bun run type-check --filter=sim`：通过。
- `cd apps/sim && bun run test --run stores/workflows/registry/store.test.ts stores/workflow-diff/utils.test.ts app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/copilot-tab.test.tsx app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-canvas-helpers.test.ts`：4 个文件、24 个测试全部通过。
- `cd apps/sim && bun run test --run stores/operation-queue/store.test.ts stores/workflows/workflow/store.test.ts app/workspace/[workspaceId]/home/hooks/use-chat.test.ts`：3 个文件、102 个测试全部通过。
- `bunx biome check <9 个改动源码/测试文件>`：通过，无修复项。
- `git diff --check`：通过。
- `bun run check:api-validation`：通过。
- `bun run lint:check --filter=sim`：未通过。首次运行扫描到 `.vitest-cache`；清理该 gitignored 可再生缓存后重跑，仍有 94 个错误和 40 个 warning，均位于未修改的 admin console、A2A/API 测试、media route 等既有文件。为遵守“不格式化无关文件”，未自动修复；本次改动文件的 targeted Biome 已通过。
- 首次合并 focused 测试时 registry 文件的 jsdom 注解被格式化移除，导致 `window/document` 不存在并引发未决 single-flight 级联超时；已改为 Vitest 支持的块注解并单独验证通过。该问题仅存在于测试配置，不是生产逻辑失败。

## 浏览器验证结果

- `bun run hermes:preflight`：静态配置通过，确认 SIM/Hermes env、service token、API key、LLM key、SIM plugin 和 toolset 配置完整。
- 尝试启动 Hermes gateway：API server 无法绑定 `127.0.0.1:8642`，返回 bind 失败；没有保留该重复进程。
- 尝试 `bun run dev:full`：Bun sandbox 默认临时目录只读；拆分直接启动 Next 后，`0.0.0.0:3000` 返回 `listen EPERM`。
- 尝试直接启动 Next 到 `127.0.0.1:3100`：仍返回 `listen EPERM`，确认不是固定端口冲突，而是当前执行环境禁止监听端口。
- `bun run hermes:preflight -- --require-services`：SIM 配置地址与 Hermes listener 均不可达。
- 因页面无法启动且外部 SIM 地址不可达，不能诚实完成真实浏览器中的 Agent 发问、画布工具写入、Network 请求计数和 ReactFlow `onInit` 观察。
- 可执行替代证据：jsdom canvas harness 在静默刷新请求前、请求中、应用后始终保持同一个 canvas DOM 实例，`onInit` 仅 1 次，模拟 viewport `{ x: -180, y: 96, zoom: 0.72 }` 不变；现有 `reconcileDisplayNodePositions` 测试确认服务端位置变化原地更新且保留 selection。
- 后续环境权限恢复后执行 `bun run preview:build`：Next 生产构建、TypeScript 和静态页面生成成功。
- `systemctl start sim.service` 后，SIM 3000、Realtime 3002 和 Hermes 8642 均正常监听；`GET /api/health` 返回 `status: ok`。
- 再次执行 `bun run hermes:preflight -- --require-services`：全部通过；`check:hermes-health` 返回 healthy。当前可继续真实浏览器验收。

## 尚未完成的事项

- 在允许绑定本地端口、可访问 SIM 数据库和 Hermes 的运行环境完成 10 项真实浏览器/Playwright 验收。

## 已知风险、阻塞和后续建议

- 风险：服务端刷新结果可能与 active diff 或本地 operation queue 竞争，必须沿用协作层保护语义。
- 风险：stream end 与前端可见工具事件可能紧邻触发，需要 queued refresh 保证最终写入不丢失，同时避免并发请求。
- 风险：静默刷新请求返回前若发生 workflow 切换或新的 hydration，请求结果必须按 active workflow、workspace、hydration request identity 一并判旧。
- 已通过自动化测试覆盖上述三项风险。
- 原环境端口阻塞已解除，服务已恢复；真实浏览器交互清单仍待执行。
- 剩余风险：真实 ReactFlow、Agent stream 和浏览器 Network 时序尚未在运行中的完整栈上观察；合入前应在可运行环境补验，但实现不依赖 viewport 保存/恢复，自动化已证明 hydration 不离开 ready 且 canvas 不重挂载。
