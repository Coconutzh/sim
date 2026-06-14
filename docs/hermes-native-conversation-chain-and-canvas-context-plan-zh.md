# Hermes 原生会话链与 SIM 画布上下文改造方案

## 0. 文档目的

本文用于约束 SIM 接入 Hermes 后的多轮对话上下文、画布操作历史、上下文压缩、双数据库边界和后续开发步骤。

本文结论基于当前方案二：Hermes 作为全局主 Agent，SIM Local Canvas Agent / Canvas Runtime 作为受控画布能力层。本文不推翻现有 `docs/hermes-agent-integration-architecture-plan-zh.md`，而是补充其中“直接启用 Hermes Native Conversation Chain”的详细落地方案。

核心目标：

- 让 Hermes 真正具备当前 SIM chat 内的多轮推理连续性。
- 避免 Hermes 和 SIM 各自维护一套互相冲突的业务事实。
- 保留 SIM DB 对聊天、画布、操作、审计、权限和回滚的唯一权威地位。
- 将 SIM Local Canvas Agent 逐步从“第二个完整主脑”收敛为“画布上下文读取、Patch 编译、安全执行和业务摘要层”。

## 1. 最终决策

直接启用 Hermes `/v1/responses` 的原生 conversation chain：

```text
SIM Copilot Chat
  -> Hermes /v1/responses
       conversation = sim:org:<orgId>:user:<userId>:workspace:<workspaceId>:workflow:<workflowId>:chat:<chatId>:gen:<generation>
       store = true
  -> Hermes response_store.db 保存 Hermes 推理上下文
  -> SIM DB 继续保存产品业务事实
```

强制边界：

```text
SIM DB = 业务事实来源
Hermes response_store.db = Hermes 推理上下文缓存
Hermes memory = 用户长期偏好和工作习惯
SIM local canvas memory = 当前 chat/workspace/workflow 的画布任务摘要
```

禁止把 Hermes `response_store.db` 当成 SIM 的业务数据库使用。它可以丢失、过期、重建；丢失后只影响 Hermes 原生续聊上下文，不影响 SIM 产品侧聊天历史、画布状态、操作审计和权限判断。

## 2. 当前存储现状

### 2.1 SIM 侧

当前 SIM 侧的关键数据已经在 SIM DB 中：

| 数据 | 表 / 字段 | 作用 |
| --- | --- | --- |
| 用户可见 Copilot 对话 | `copilot_chats.messages` JSONB | UI 展示、用户历史、聊天删除和恢复 |
| Copilot 运行记录 | `copilot_runs` | 每次 agent 请求、执行状态、模型和 provider |
| 异步/暂停恢复上下文 | `copilot_run_checkpoints.conversation_snapshot` JSONB | 异步工具、暂停、恢复 |
| workflow 画布状态快照 | `workflow_checkpoints.workflow_state` JSON | 画布状态恢复、回放、关联 message |
| Hermes 调 SIM 工具审计 | `hermes_tool_call_audit` | 工具名、mode、输入输出摘要、changedNodeIds、verify、错误 |
| 通用审计 | `audit_log` | SIM 通用 action/resource 审计 |
| Local Canvas Agent 线程记忆 | `memory.data` JSONB | `conversationSummary`、`taskState`、`canvasSummary`、`recentObservations`、`toolResultRefs` |
| 待确认画布方案 | 进程内 `Map`，30 分钟 TTL | `pendingActionId` 临时执行凭证，不是长期事实 |

这意味着 SIM 已经具备业务事实存储，不需要把这些迁移到 Hermes。

### 2.2 Hermes 侧

Hermes 侧主要有两类 SQLite：

| 文件 | 作用 |
| --- | --- |
| `state.db` | Hermes session/message 总库，CLI、gateway、API session 都可能使用 |
| `response_store.db` | `/v1/responses` 专用状态库，保存 response 对象、conversation 映射和完整 conversation history |

启用 `store=true` 后，Hermes 会把 Responses API 的完整内部上下文保存到 `response_store.db`，包括：

- response id
- response output
- usage
- instructions
- session id
- 历史 user / assistant 消息
- tool call
- tool result

这用于下一轮通过 `conversation` 或 `previous_response_id` 恢复 Hermes 推理上下文。

## 3. 为什么保留双 DB

保留双 DB 是合理的，但必须明确不是双权威。

### 3.1 SIM DB 的职责

SIM DB 保存用户和业务必须可靠的数据：

- 用户可见聊天记录。
- 当前画布状态。
- workflow 节点、边、布局、内容字段。
- patch 执行结果。
- verify 结果。
- 操作审计。
- 权限和组织范围。
- 删除、恢复、回滚、报表查询。

这些数据需要强一致、可授权、可审计、可迁移。

### 3.2 Hermes DB 的职责

Hermes `response_store.db` 保存 Hermes 的运行态上下文：

- 主 Agent 多轮推理连续性。
- 模型看到过的历史摘要。
- Hermes 工具调用轨迹。
- 用于 `conversation` / `previous_response_id` 的续链状态。

这些数据服务于推理，不是产品事实。它可以有保留期，也可以按容量淘汰。

### 3.3 不保留双 DB 的代价

如果只保留 SIM DB，SIM 需要自己重建 Hermes Responses 的所有续链能力，包括 tool call/result history、previous response 链路、conversation mapping 和压缩衔接。这会重复造轮子。

如果只保留 Hermes DB，SIM 会失去业务主权：聊天删除、权限隔离、审计、画布回滚、团队管理、数据导出都会被绑定到 Hermes 内部实现。

因此最终原则是：

```text
SIM DB 是 source of truth。
Hermes response_store.db 是 derived runtime cache。
```

## 4. 会话链路设计

### 4.1 使用 conversation 优先

第一版直接使用 `conversation`，不优先使用 `previous_response_id`。

请求体示例：

```json
{
  "model": "gemini-3.1-pro-preview",
  "instructions": "<SIM Hermes system prompt>",
  "input": "按刚才讨论的方向帮我改画布",
  "conversation": "sim:org:org-1:user:user-1:workspace:ws-1:workflow:wf-1:chat:chat-1:gen:0",
  "store": true,
  "truncation": "auto",
  "metadata": {
    "sim": {
      "userId": "user-1",
      "organizationId": "org-1",
      "workspaceId": "ws-1",
      "workflowId": "wf-1",
      "chatId": "chat-1"
    }
  }
}
```

选择 `conversation` 的原因：

- SIM 已经有稳定 `chatId`。
- Hermes 自动维护 `conversation -> latest response_id`。
- SIM 不需要每轮保存和传递 `previous_response_id`。
- 用户在同一个 chat 里继续对话时，Hermes 原生续链。

### 4.2 conversation key 规则

conversation key 必须包含足够作用域：

```text
sim:org:<organizationId|none>:user:<userId>:workspace:<workspaceId|none>:workflow:<workflowId|none>:chat:<chatId|no-chat>:gen:<generation>
```

约束：

- 必须包含 `organizationId` 和 `userId`，避免跨组织/跨用户污染。
- 画布场景必须包含 `workspaceId` 和 `workflowId`，避免不同画布互相继承上下文。
- 必须包含 `chatId`，避免同一 workflow 的不同聊天互相污染。
- 必须包含 `generation`，用于清空聊天或重置上下文时切断旧 Hermes conversation。
- 如果 `chatId` 缺失，只能退化为临时 key；画布模式应尽量保证存在 chatId。

### 4.3 previous_response_id 的后续用途

`previous_response_id` 不作为第一版主路径，但保留为后续增强：

- 精确分支。
- 回放某次 Hermes 推理链。
- 从 SIM DB 记录的 latest response id 恢复某条固定链。
- 处理高级“回到某一轮继续”的 UX。

第一版只需要 `conversation + store=true`。

## 5. SIM 客户端改造

### 5.1 修改 HermesResponseParams

文件：

```text
apps/sim/lib/hermes/client.ts
```

新增字段：

```ts
export interface HermesResponseParams {
  input: string
  instructions: string
  model?: string
  sessionId?: string
  sessionKey?: string
  metadata?: Record<string, unknown>
  signal?: AbortSignal
  store?: boolean
  conversation?: string
  previousResponseId?: string
  truncation?: 'auto'
}
```

请求体增加：

```ts
body: JSON.stringify({
  model: params.model,
  instructions: params.instructions,
  input: params.input,
  metadata: params.metadata,
  store: params.store ?? false,
  conversation: params.conversation,
  previous_response_id: params.previousResponseId,
  truncation: params.truncation,
})
```

注意：`store` 的默认值不要在通用 client 全局改为 true，避免影响其他潜在调用方；应在 `callHermesSimAgent()` 中对 SIM Hermes Agent 明确传 `store: true`。

### 5.2 conversation 与 previousResponseId 互斥

client 层应在发请求前校验：

```ts
if (params.conversation && params.previousResponseId) {
  throw new HermesClientError('conversation and previousResponseId cannot both be set')
}
```

原因：Hermes API Server 已经有互斥校验，但 SIM client 层提前失败更容易定位。

### 5.3 返回 Hermes 链路元信息

`callHermesResponse()` 当前已经返回 response id、session id、session key。需要确保调用方能拿到：

- `result.id`：Hermes response id。
- `result.sessionId`：Hermes session id。
- `result.sessionKey`：Hermes session key。
- `result.raw`：完整 response，用于解析 tool output。

不需要把 Hermes conversation history 回写到 SIM messages。

## 6. SIM Hermes Agent 调用改造

### 6.1 生成 conversation key

文件：

```text
apps/sim/lib/hermes/sim-agent.ts
```

新增函数：

```ts
function buildHermesConversationKey(params: {
  organizationId?: string
  userId: string
  workspaceId?: string
  workflowId?: string
  chatId?: string
  generation?: number
}): string {
  return [
    'sim',
    `org:${sanitizeHeaderPart(params.organizationId ?? 'none')}`,
    `user:${sanitizeHeaderPart(params.userId)}`,
    `workspace:${sanitizeHeaderPart(params.workspaceId ?? 'none')}`,
    `workflow:${sanitizeHeaderPart(params.workflowId ?? 'none')}`,
    `chat:${sanitizeHeaderPart(params.chatId ?? 'no-chat')}`,
    `gen:${params.generation ?? 0}`,
  ].join(':').slice(0, MAX_HERMES_HEADER_VALUE_LENGTH)
}
```

如果 key 可能超过 header/value 限制，应使用稳定 hash 后缀：

```text
sim:conv:<sha256(scopeParts).slice(0, 48)>
```

但日志和 `copilot_chats.config.hermes` 中仍应保存原始 scope 结构，便于排查。

### 6.2 callHermesSimAgent 传 store + conversation

`callHermesSimAgent()` 调用 `callHermesResponse()` 时传入：

```ts
return callHermesResponse({
  instructions: buildSimHermesSystemPrompt(),
  input: params.message,
  model: params.model,
  sessionId: buildHermesSessionId(scopedParams),
  sessionKey: buildHermesSessionKey(scopedParams),
  conversation: buildHermesConversationKey(scopedParams),
  store: true,
  truncation: 'auto',
  metadata: buildSimMetadata(scopedParams),
  signal: params.signal,
})
```

`sessionId` 和 `conversation` 可以同时存在：

- `conversation` 用于 Responses response chain。
- `sessionId` 用于 Hermes session grouping / logging / memory scope 辅助。
- `sessionKey` 用于用户长期 memory scope。

### 6.3 Feature Flag

新增开关：

```env
HERMES_NATIVE_CONVERSATION_CHAIN_ENABLED=true
```

建议默认：

- 本地和测试环境先开启。
- 生产灰度开启。
- 出现 response_store 体积、隐私或续链异常时可快速回退。

逻辑：

```ts
const nativeChainEnabled = env.HERMES_NATIVE_CONVERSATION_CHAIN_ENABLED === 'true'

return callHermesResponse({
  ...
  ...(nativeChainEnabled
    ? { conversation: buildHermesConversationKey(scopedParams), store: true, truncation: 'auto' }
    : { store: false }),
})
```

## 7. SIM DB 元信息记录

SIM DB 仍是权威历史，但建议记录 Hermes chain 的排查元信息。

位置：

```text
copilot_chats.config.hermes
```

建议结构：

```json
{
  "hermes": {
    "nativeConversationChain": true,
    "conversationKey": "sim:org:...:chat:...:gen:0",
    "latestResponseId": "resp_xxx",
    "latestSessionId": "session_xxx",
    "latestSessionKey": "sim:org:...:user:...",
    "generation": 0,
    "updatedAt": "2026-06-14T00:00:00.000Z"
  }
}
```

约束：

- 这不是业务历史。
- 不从这里恢复画布事实。
- 不把 Hermes raw conversation 存进 SIM DB。
- 只用于 debug、清理、删除、重置、关联日志。

推荐新增函数：

```text
apps/sim/lib/hermes/conversation-metadata.ts
```

职责：

- 读取 chat config 的 `hermes.generation`。
- 写入最新 response id 和 session id。
- 清空聊天时递增 generation。
- 删除 chat 时提供可选 cleanup 信息。

## 8. 删除、清空、切换和丢失策略

### 8.1 删除 chat

用户删除 SIM chat 时：

1. SIM 删除 `copilot_chats`。
2. 可选调用 Hermes `DELETE /v1/responses/{latestResponseId}`。
3. 不要求强依赖 Hermes 删除成功。
4. 新 chat 使用新 `chatId`，因此天然使用新 conversation key。

风险说明：

- Hermes `response_store.db` 可能仍保留旧 response，直到保留期清理。
- 由于新 chatId 不同，正常业务不会再续上旧 conversation。

### 8.2 清空 chat

用户清空同一个 chat 的消息时，不应复用旧 Hermes conversation。

处理方式：

1. `copilot_chats.messages = []`。
2. `copilot_chats.config.hermes.generation += 1`。
3. 新 conversation key 使用新的 `gen`。

不要依赖用户清空后 Hermes 自动忘记旧上下文。

### 8.3 切换 workflow

同一 chat 如果理论上可能切换 workflow，必须重新生成 conversation key。更推荐产品层不允许同一画布 Copilot chat 横跨 workflow。

如果确实允许：

- key 必须包含新 workflowId。
- SIM prompt 要提示 Hermes 当前 workflow 已变化。
- 当前画布状态必须重新调用 SIM 读取。

### 8.4 Hermes response_store.db 丢失

如果 Hermes `response_store.db` 被清理或损坏：

- SIM 聊天仍在 `copilot_chats.messages`。
- SIM 画布状态仍在 workflow DB。
- SIM 操作审计仍在 `hermes_tool_call_audit`。
- Hermes 原生续聊上下文丢失。

恢复策略：

第一版可以接受“新一轮从空 Hermes chain 开始”。如果要增强，可以在 Hermes API 返回 previous response not found 时：

1. 从 SIM `copilot_chats.messages` 构造最近 N 轮 `conversation_history`。
2. 用同一个 `conversation` 重新 seed Hermes chain。
3. 继续 `store=true`。

这个 fallback 可以后续实现，不阻塞第一版。

## 9. 系统提示约束

必须修改 `buildSimHermesSystemPrompt()`，加入以下语义：

```text
You may use Hermes conversation history only as prior discussion context.
Never answer current canvas, workflow, selected node, operation history, pending action, or verification status from Hermes conversation history alone.
For current canvas state, operation history, pending actions, or verification status, call SIM tools.
SIM DB and SIM tools are the source of truth for canvas state, permissions, audit, and workflow mutations.
Hermes memory stores durable user preferences only; it must not store current canvas task state, pendingActionId, raw canvas data, or team production rules.
```

目的：

- Hermes 可以记得“用户刚才讨论偏治愈风”。
- Hermes 不可以凭历史说“封面图节点已经写入成功”。
- 画布事实必须调用 SIM 工具。

## 10. 画布操作历史查询能力

启用 Hermes conversation chain 后，Hermes 可能在对话中记得工具返回过“proposal 已生成”。但回答事实问题时仍必须查 SIM。

新增工具建议：

```text
sim_canvas_history_query
```

或作为 `sim_canvas_agent_run` 的新增 mode：

```text
history_query
```

第一版建议独立工具，避免 `sim_canvas_agent_run` 继续膨胀。

### 10.1 支持操作

```ts
type SimCanvasHistoryOperation =
  | 'recent_operations'
  | 'pending_actions'
  | 'operation_detail'
  | 'verification_history'
```

输入：

```ts
interface SimCanvasHistoryQueryInput {
  operation: SimCanvasHistoryOperation
  userId: string
  organizationId?: string
  workspaceId?: string
  workflowId?: string
  chatId?: string
  auditId?: string
  pendingActionId?: string
  limit?: number
}
```

输出：

```ts
interface SimCanvasHistoryQueryResult {
  success: boolean
  operation: SimCanvasHistoryOperation
  summary: string
  items: Array<{
    auditId?: string
    hermesRunId?: string
    toolName?: string
    mode?: string
    status: string
    risk?: string
    requiresConfirmation?: boolean
    changedNodeIds?: string[]
    generatedNodeIds?: string[]
    verificationSummary?: string
    errorCode?: string
    error?: string
    createdAt: string
  }>
  evidenceRefs: string[]
}
```

### 10.2 数据来源

第一版必须读：

- `hermes_tool_call_audit`

后续可增强读：

- `workflow_checkpoints`
- `copilot_runs`
- SIM local canvas memory
- 当前 workflow 状态

### 10.3 触发规则

Hermes 遇到以下问题必须调用 history 工具：

- “刚才改了什么？”
- “上次执行成功了吗？”
- “那个封面图节点是不是已经加了？”
- “为什么失败？”
- “还有什么待确认？”
- “刚才 proposal 里准备改哪些节点？”

Hermes 不能只根据 conversation history 或 memory 回答这些事实问题。

## 11. 上下文压缩职责划分

### 11.1 Hermes 负责压缩对话推理上下文

Hermes 原生 context compression 负责：

- 多轮自然语言讨论。
- Hermes 自己的推理连续性。
- Hermes 调过哪些工具。
- 工具返回过哪些摘要。
- 当前未完成问题。

这些压缩结果只能作为“对话背景”。

### 11.2 SIM 负责压缩画布业务上下文

SIM local canvas memory 负责：

- `conversationSummary`
- `taskState.goal`
- `taskState.completedSteps`
- `taskState.openQuestions`
- `taskState.lastObservation`
- `canvasSummary`
- `recentObservations`
- `toolResultRefs`

这些来自 SIM runtime、工具 observation、verify 结果和 workflow 状态。它们是画布业务上下文摘要，不是 Hermes 用户长期 memory。

### 11.3 原始事实不靠摘要

无论 Hermes 压缩还是 SIM memory 总结，都不能替代原始事实：

| 问题 | 必须查询 |
| --- | --- |
| 当前画布有什么 | 当前 workflow / `read_context` |
| 某节点是否存在 | 当前 workflow / node adapter |
| 某次 patch 是否成功 | `hermes_tool_call_audit` + verify |
| 某 pendingActionId 是否可执行 | SIM pending plan store |
| 用户长期偏好 | Hermes memory |
| 用户可见聊天历史 | `copilot_chats.messages` |

## 12. SIM Local Canvas Agent 收敛方向

启用 Hermes native chain 后，应避免“双 Agent 重复思考”。

目标分层：

```text
Hermes 主 Agent
  - 多轮需求理解
  - 用户长期偏好召回
  - 判断是否需要画布工具
  - 生成结构化画布任务
  - 处理确认流程
  - 解释 SIM 返回结果

SIM Canvas Tool Layer
  - read_context
  - history_query
  - compile_patch
  - apply_after_confirm
  - verify
  - audit

SIM DB / Workflow Runtime
  - 权限
  - workflow 状态
  - patch 执行
  - checkpoints
  - 操作审计
```

当前 `propose` 可以先保留兼容，但长期应新增或迁移到：

```text
compile_patch
```

`compile_patch` 的输入应优先是 Hermes 整理后的结构化任务，而不是纯自然语言。

示例：

```json
{
  "mode": "compile_patch",
  "task": {
    "intent": "mutate_canvas",
    "goal": "优化小红书视频流程，补充封面图节点",
    "constraints": ["保持治愈风格", "不要直接执行", "生成可确认方案"],
    "expectedChanges": ["新增封面图节点", "调整与脚本/主视觉节点的连接"],
    "userPreferences": ["用户偏好先出三版 hook"],
    "clarificationState": {
      "alreadyDiscussed": "用户已确认风格偏治愈，不要营销化"
    }
  }
}
```

SIM 的职责是把这个任务编译成合法、安全、可验证的 patch proposal，而不是重新从头理解用户长期目标。

## 13. 代码修改清单

### 13.1 SIM 必改

| 文件 | 修改 |
| --- | --- |
| `apps/sim/lib/hermes/client.ts` | 支持 `conversation`、`previousResponseId`、`truncation`，保留 `store` 显式控制 |
| `apps/sim/lib/hermes/sim-agent.ts` | 生成 conversation key，启用 `store=true`，传 `conversation` |
| `apps/sim/lib/copilot/request/lifecycle/hermes-agent.ts` | 保存 Hermes response/session 元信息，确认消息继续走同一 conversation key |
| `apps/sim/lib/hermes/user-memory.ts` | 保持 current canvas / pendingActionId / taskState 禁止写入 Hermes user memory |
| `apps/sim/app/api/internal/hermes/canvas-agent/run/route.ts` | 保持 service token、contract、audit，不因 conversation chain 放宽权限 |
| `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/pending-plan.ts` | 保持 pending plan TTL 和 scope 校验 |

### 13.2 SIM 建议新增

| 文件 | 作用 |
| --- | --- |
| `apps/sim/lib/hermes/conversation-key.ts` | conversation key 生成和 hash fallback |
| `apps/sim/lib/hermes/conversation-metadata.ts` | 读写 `copilot_chats.config.hermes` |
| `apps/sim/lib/hermes/canvas-history-query.ts` | 查询 `hermes_tool_call_audit` 并生成受控历史摘要 |
| `apps/sim/app/api/internal/hermes/canvas-history/query/route.ts` | 给 Hermes plugin 调用的内部 history API |

### 13.3 Hermes fork 必改

| 文件 | 修改 |
| --- | --- |
| `plugins/sim/tools.py` | 新增 `sim_canvas_history_query` 工具或新增 mode 白名单 |
| `plugins/sim/tools.py` | 保持 `apply_after_confirm` 必须带真实 `pendingActionId` |
| `plugins/memory/sim/__init__.py` | 保持长期 memory 只存用户偏好，不存画布短期状态 |

### 13.4 不建议修改

第一版不修改：

- Hermes core SessionDB schema。
- Hermes response_store.db schema。
- SIM workflow schema。
- SIM `copilot_chats.messages` 数据结构。

除非后续出现性能或清理需求，再单独设计 migration。

## 14. 分阶段实施步骤

### 阶段 1：启用 native conversation chain

目标：Hermes 能跨多轮接住当前 SIM chat 的自然语言讨论。

步骤：

1. SIM client 支持 `conversation` / `truncation`。
2. SIM Hermes Agent 生成 scoped conversation key。
3. `hermes_agent_v1` 调用传 `store=true`。
4. 写入 `copilot_chats.config.hermes` 元信息。
5. smoke 测普通多轮对话。

验收：

- 同一 chat 第二轮“按刚才说的继续”能接住上下文。
- 不同 chat 不继承上下文。
- 不同 user/org/workflow 不串上下文。

### 阶段 2：保留并强化 SIM 权威历史

目标：双 DB 不打架。

步骤：

1. 明确 UI 聊天历史只读 `copilot_chats.messages`。
2. 画布操作历史只读 SIM DB。
3. 清空 chat 时递增 `hermes.generation`。
4. 删除 chat 时不复用旧 conversation key。
5. 文档和代码注释明确 `response_store.db` 只是 runtime cache。

验收：

- 删除旧 chat 后，新 chat 不继承 Hermes 上下文。
- 清空同一 chat 后，Hermes 不再记得清空前内容。
- Hermes response_store.db 丢失不影响 SIM 聊天和画布状态。

### 阶段 3：新增画布操作历史工具

目标：Hermes 能回答“刚才改了什么”，但事实来自 SIM。

步骤：

1. 新增 SIM internal history query API。
2. 新增 Hermes SIM plugin tool。
3. Hermes system prompt 要求操作历史问题必须调用该工具。
4. 返回结构化摘要和 evidence refs。

验收：

- 用户问“刚才改了什么”，Hermes 调 history tool。
- 回答包含 changedNodeIds / verify summary / audit id。
- 不凭 conversation history 编造执行结果。

### 阶段 4：收敛 SIM Local Canvas Agent 自由度

目标：减少双 Agent 重复思考。

步骤：

1. 新增结构化 task contract。
2. `propose` 兼容旧路径。
3. 新增 `compile_patch`，优先使用 Hermes 传入的 task。
4. SIM 只在复杂画布语义判断时调用模型。
5. 每次 SIM 模型调用写 telemetry，区分 compiler deterministic path 和 model reasoning path。

验收：

- 大多数明确画布修改由 Hermes 规划，SIM 编译 patch。
- SIM 不重新大范围判断用户长期意图。
- 复杂任务仍可用 `canvas_reasoning` 兜底。

## 15. 测试计划

### 15.1 自动 smoke

新增或扩展：

```text
bun run hermes:smoke -- --chat
bun run hermes:smoke -- --conversation-chain
bun run hermes:smoke -- --canvas-read
bun run hermes:smoke -- --canvas-propose
bun run hermes:smoke -- --canvas-history
```

`--conversation-chain` 应测试：

1. 第一轮：`请记住本轮测试短语：SIM_CHAIN_ALPHA，只在本 chat 内使用。`
2. 第二轮：`刚才的测试短语是什么？`
3. 预期：Hermes 回答包含 `SIM_CHAIN_ALPHA`。
4. 新 chat 再问：不应回答出旧短语，除非 SIM 显式传入旧历史。

### 15.2 手工测试

手工测试章节必须配套“自动化模拟手工测试”执行方式：先用脚本模拟人工点击和对话流程，验证链路、权限、状态、工具调用、DB 写入、画布 diff 与 audit；再由真人只抽查体验、语义和方案质量。

| 场景 | 预期 |
| --- | --- |
| 普通多轮聊天 | Hermes 能接住当前 chat 前文 |
| 多轮需求澄清后修改画布 | Hermes 把前文偏好带入 SIM proposal |
| 当前画布总结 | Hermes 必须调用 SIM read tool |
| 刚才改了什么 | Hermes 必须调用 SIM history tool |
| 用户确认 proposal | Hermes 调 `apply_after_confirm`，SIM verify 成功后才说完成 |
| 清空 chat | 新一轮不继承旧 Hermes 上下文 |
| 删除 chat 后新建 | 不继承旧 conversation |
| response_store.db 丢失 | SIM 业务历史仍完整，Hermes 可降级重新开始 |

### 15.3 自动化模拟手工测试

后续开发可以用自动化脚本模拟大部分手工测试，但必须区分“链路正确”和“最终用户体验满意”。

它的定位不是替代真人验收，而是把人工步骤中可机械验证的部分固化成回归用例，避免每次升级 Hermes、SIM API、Local Canvas Agent 或提示词后都靠人工重复点页面。

自动化模拟手工测试分两层：

| 层级 | 工具方式 | 可验证内容 |
| --- | --- | --- |
| API 级模拟 | 直接调用 SIM/Hermes API、smoke 脚本、DB 查询 | conversation chain、tool call、proposal、pendingActionId、apply、verify、audit、workflow state |
| 浏览器级模拟 | Playwright / CDP 打开真实 SIM 页面操作 | Copilot 输入、SSE 渲染、确认按钮、ReactFlow 节点/边变化、Network 请求、页面错误 |

建议新增或扩展以下测试入口：

```text
bun run hermes:simulate-manual -- --case chat-memory
bun run hermes:simulate-manual -- --case canvas-summary
bun run hermes:simulate-manual -- --case canvas-propose-confirm-apply
bun run hermes:simulate-manual -- --case canvas-history
bun run hermes:simulate-manual -- --case isolation
```

当前 API 级模拟入口落在 `scripts/hermes-sim-simulate-manual.ts`，并通过根目录脚本 `hermes:simulate-manual` 暴露。它复用 `scripts/hermes-sim-smoke.ts` 的真实 SIM/Hermes API 链路，不 mock Hermes 主链路；浏览器级模拟后续再用 Playwright / CDP 单独补齐。

当前落地口径：

- `hermes:simulate-manual` 是“自动化模拟手工测试”的第一阶段入口，覆盖 API 级人工流程模拟。
- 该脚本必须复用真实 SIM API、Hermes Gateway、Hermes 插件和 SIM internal tool route；只允许在测试自身做断言与结果汇总，不允许 mock 主调用链。
- 默认所有写画布用例都必须安全降级为 proposal 校验；只有显式设置写入确认开关时，才允许进入真实 apply/verify。
- 后续新增 Hermes / SIM Agent / Local Canvas Agent 能力时，必须同步补充对应 case，不能只补人工 checklist。
- 浏览器级模拟尚未完成前，文档中的浏览器级条目作为后续 Playwright / CDP 验收范围，不视为当前 API 级脚本已经覆盖。

脚本必须接收显式上下文，不能默认扫库随机取数据：

```text
HERMES_SMOKE_USER_ID=<userId>
HERMES_SMOKE_WORKSPACE_ID=<workspaceId>
HERMES_SMOKE_WORKFLOW_ID=<workflowId>
HERMES_SMOKE_CHAT_ID=<chatId>
HERMES_SMOKE_AGENT_ID=hermes_agent_v1
HERMES_SERVICE_TOKEN=<service token，用于只读 diff / apply / audit 校验>
```

每个模拟用例的输出必须包含：

| 字段 | 要求 |
| --- | --- |
| caseName | 当前模拟场景名称 |
| smokeFlags | 当前用例实际启用的 smoke 子能力开关 |
| requestIds | SIM requestId、Hermes responseId、toolCallId |
| conversationKey | 当前 Hermes conversation key，脱敏后输出 |
| toolCalls | 实际触发的 SIM tool 列表 |
| dbChecks | 查询到的 chat、audit、workflow 校验结果 |
| stateDiff | 画布节点/边变化摘要；只读场景必须为空 |
| pass | 布尔值，只有全部断言通过才为 true |
| failureReason | 失败时必须给出具体断言和证据引用 |

API 级模拟应覆盖：

1. 同一 chat 的 Hermes 多轮对话能续上。
2. 新 chat 不继承旧 chat 的 Hermes conversation。
3. 当前画布总结会触发 SIM read tool。
4. 画布修改请求返回 proposal 和 `pendingActionId`。
5. 确认后 Hermes 调 `apply_after_confirm`，SIM 执行 patch、verify、audit。
6. `hermes_tool_call_audit` 写入状态、mode、changedNodeIds、verificationSummary。
7. workflow state 在成功 apply 后发生预期变化。
8. response_store 丢失时，SIM DB 中的聊天和画布事实仍可查询。
9. 未授权或跨 workspace 请求被拒绝，且不会写入画布。
10. 同一个用户不同 workflow / chat 的 conversation 不串线。

浏览器级模拟应覆盖：

1. 打开指定 workspace / workflow。
2. 打开 Copilot 并切到 `hermes_agent_v1`。
3. 连续发送多轮需求澄清消息。
4. 发送画布总结请求，确认画布没有被修改。
5. 发送画布修改请求，确认出现用户确认选项。
6. 点击确认按钮，确认最终画布节点/边变化并通过 verify。
7. 发送“刚才改了什么”，确认 Hermes 调用 SIM history/audit 工具后回答。
8. 检查页面无明显错误、loading 不挂死、ReactFlow DOM 与后端 state 一致。

自动化模拟的推荐执行顺序：

1. 先跑 API 级模拟，确认后端链路、权限、DB 状态、tool call 和 audit 全部正确。
2. 再跑浏览器级模拟，确认真实页面的 Copilot、SSE、按钮、ReactFlow 渲染和 Network 行为正确。
3. 最后人工抽查 1 到 2 条关键场景，判断回答质量、业务语义和交互体验。

强约束：

- 不能为了让测试通过而 mock 掉 Hermes 主链路；API 级模拟必须真实调用 Hermes test server 或本地 Hermes 服务。
- 不能只断言“有回复”；必须断言是否调用了正确 SIM tool、是否写入 audit、是否符合只读/写入边界。
- 只读场景必须断言 workflow state 未变化。
- 写画布场景必须断言先 proposal、再确认、再 apply、再 verify，不能绕过用户确认。
- 测试数据必须隔离，不能复用生产用户或生产 workspace。
- 失败日志必须保留 responseId、toolCallId、pendingActionId、auditId，方便追查。
- 能用脚本稳定验证的手工步骤必须进入 `hermes:simulate-manual`；不能长期只停留在人工说明。

自动化模拟不能替代以下人工验收：

- 文案是否符合产品语气。
- 回答是否符合真实业务语义。
- 多轮沟通过程是否自然、少绕弯。
- 确认按钮、错误提示、长回复阅读体验是否清楚。
- 复杂创作任务的方案质量是否满足目标用户预期。

验收口径：

```text
自动化模拟用于守住链路、权限、状态和回归。
人工手工测试用于判断体验、语义和方案质量。
```

如果自动化模拟失败，不允许进入人工验收；如果自动化模拟通过，仍需要人工抽查关键 UX 和业务语义。

### 15.4 负向测试

| 场景 | 禁止结果 |
| --- | --- |
| Hermes conversation history 里有旧画布摘要，但当前画布已手动修改 | Hermes 不得凭旧摘要回答当前画布 |
| 用户跨 workflow 继续问“刚才那个节点” | 不得引用旧 workflow 节点作为当前事实 |
| 用户要求记住 pendingActionId | 不得写入 Hermes user memory |
| history tool 返回失败 | Hermes 不得声称执行成功 |
| response_store 缺失 previous response | 不得报业务数据丢失，只能说明 Hermes 上下文需重建 |

## 16. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Hermes 和 SIM 双份历史不一致 | 用户删除/清空后 Hermes 仍记得旧内容 | conversation key 加 generation；删除/清空不复用旧 key |
| response_store 过大 | 磁盘增长 | 配置 Hermes retention/max size；定期清理 |
| 跨用户上下文污染 | 严重安全问题 | key 必含 org/user/chat/workflow；service token 校验 |
| Hermes 凭历史回答当前画布 | 错误事实 | system prompt + 工具强制 + 测试覆盖 |
| SIM Local Canvas Agent 二次思考 | 成本和不一致 | 引入结构化 task / compile_patch，限制 SIM 模型调用 |
| pendingActionId 被长期化 | 过期凭证风险 | pending plan 继续内存 TTL + scope 校验，不写长期 memory |
| response_store 丢失 | Hermes 连续性下降 | SIM DB 保持权威；后续可用 SIM history fallback seed |

## 17. 开发约束

后续实现必须遵守：

1. 不允许把 SIM 画布原始状态写入 Hermes long-term memory。
2. 不允许把 `pendingActionId` 写入 Hermes long-term memory。
3. 不允许 Hermes 直接读写 SIM workflow DB。
4. 不允许 Hermes 直接生成或执行底层 `EditWorkflowOperation`。
5. 当前画布状态必须从 SIM 工具读取。
6. 画布操作历史必须从 SIM audit/history 工具读取。
7. Hermes response_store.db 只作为推理缓存，不作为 UI 历史来源。
8. SIM UI 展示聊天仍以 `copilot_chats.messages` 为准。
9. 清空/删除/切换 workflow 必须切断或更换 Hermes conversation key。
10. 所有写画布仍必须经过 propose -> confirmation -> apply_after_confirm -> verify -> audit。

## 18. 推荐实现顺序

最小可落地顺序：

1. `client.ts` 支持 `conversation`、`truncation`、互斥校验。
2. `sim-agent.ts` 生成 scoped conversation key，`hermes_agent_v1` 传 `store=true`。
3. `copilot_chats.config.hermes` 写入 latest response/session 元信息。
4. system prompt 加“conversation history 不能作为画布事实来源”的硬约束。
5. 加 conversation-chain smoke。
6. 加清空/删除 chat 的 generation 策略。
7. 新增 `sim_canvas_history_query`。
8. 再推进 `compile_patch` 和 SIM Local Canvas Agent 工具化。

不要先做：

- 大规模改 Hermes core。
- 迁移 SIM 聊天历史到 Hermes。
- 删除 SIM local canvas memory。
- 让 Hermes 直接写 workflow DB。
- 让 `response_store.db` 成为用户可见聊天的唯一来源。

## 19. 最终目标形态

```text
用户
  |
  v
SIM UI / Copilot Chat
  |
  | 用户可见聊天写入 SIM DB
  v
SIM Backend
  |
  | /v1/responses conversation + store=true
  v
Hermes 主 Agent
  - 多轮对话连续性
  - 用户长期偏好
  - 全局工具调度
  - 结果解释
  |
  | SIM plugin tools
  v
SIM Canvas Tool Layer
  - read_context
  - history_query
  - compile_patch / propose
  - apply_after_confirm
  - verify
  - audit
  |
  v
SIM DB / Workflow Runtime
  - 唯一业务事实来源
```

一句话总结：

```text
Hermes 负责“连续理解和调度”，SIM 负责“事实、权限、执行和审计”。
Hermes 可以保存推理上下文，但不能成为 SIM 画布事实和操作历史的权威数据库。
```
