# SIM 接入 Hermes Agent 架构方案

## 0. 文档目的

本文用于约束 SIM 后续接入 Hermes Agent 的架构、边界、数据所有权、安全策略和分阶段落地路径。

本方案基于当前 SIM 源码中的 Local Canvas Agent Runtime 和本地 Hermes Agent fork 讨论结论制定。后续实现、评审和排期应优先遵守本文；如需偏离，必须在方案评审中明确说明原因、影响范围、回滚方案和安全边界。

部署、运维、健康检查、环境变量和发布前检查清单见 `docs/hermes-agent-deployment-runbook-zh.md`。

## 1. 最终决策

采用方案二：Hermes 作为全局主控 Agent，SIM Local Canvas Agent Runtime 作为 Hermes 可调用的专属画布子能力。

用户体验上可以包装为“一个 SIM Agent”，但工程架构上必须保持分层：

```text
用户 / SIM UI / 消息平台
        |
        v
Hermes Agent Service
  - 用户对话
  - 用户画像 / memory
  - 用户级 skill 自动迭代
  - 网页搜索与网页解析
  - 通用工具调用
  - 全局任务规划和调度
        |
        | 只通过受控 SIM 工具/API 调用
        v
SIM Local Canvas Agent Runtime
  - 画布读取
  - 选中节点 / 相关节点理解
  - 节点 adapter
  - 画布 patch 生成、校验、执行、验证
  - 内容生成写回
  - SIM 权限、DB、workflow、SSE、审计
```

强制约束：

- Hermes 不直接读写 SIM workflow DB。
- Hermes 不直接构造或执行底层 `EditWorkflowOperation`。
- Hermes 不绕过 SIM 的 `authorizeWorkflowByWorkspacePermission`。
- Hermes 不直接发布团队级 / 组织级 SIM DB Skill。
- SIM 画布写入必须继续走 SIM Runtime 的权限校验、patch 校验、执行和 verify。
- GitHub 上游 Hermes 只作为源码来源，不作为生产运行时。

## 2. 源码现状依据

### 2.1 SIM 当前 Agent/画布链路

当前 `content_canvas_v1` 请求已经在 SIM 生命周期入口直接路由到本地画布 Agent：

- `apps/sim/lib/copilot/request/lifecycle/run.ts` 中 `workflowCopilotMode === 'content_canvas_v1'` 时调用 `runLocalCanvasAgent`。
- 非画布路径仍走原有远端 / fallback checkpoint loop。

当前 Local Canvas Agent Runtime 入口：

- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/runtime.ts`

Runtime 会执行：

```text
resolveLocalAgentContext
  -> routing
  -> load memory
  -> runLocalAgentToolLoop
  -> execute local tools
  -> verify final answer
  -> persist local memory
  -> emit SSE result
```

上下文由 `context-manager.ts` 组装，包含：

- userId
- workspaceId
- workflowId
- chatId
- workgroup agent profile
- permissions
- selectedNodeIds
- attachments
- attached contexts
- conversation history
- enabled skills
- model config

画布读取由 `canvas-context.ts` 从 normalized workflow tables 加载真实 workflow state，并通过 node adapter 生成摘要和详情。

画布工具由 `canvas-tools.ts` 执行。关键写入链路是：

```text
canvas.apply_patch
  -> check context.permissions.canWrite
  -> validateLocalCanvasPatch
  -> buildEditWorkflowOperationsFromPatch
  -> editWorkflowServerTool.execute
  -> verifyLocalCanvasPatch
```

这说明 SIM 的画布 Agent 不是简单 prompt，而是深度绑定 SIM 数据模型、权限模型、workflow 编辑工具、生成服务和 UI 事件的领域运行时。

### 2.2 Hermes 当前可复用能力

Hermes 的成熟能力适合做全局控制面：

- API Server / Gateway：可作为长期运行的 Agent 服务。
- Toolset/Registry：支持 web、browser、file、terminal、vision、skills、memory、delegation 等工具。
- Plugin 系统：插件可注册工具、hooks、slash command。
- Memory Provider：支持每轮 prefetch、完成后 sync_turn、会话结束处理。
- Background Review：主任务结束后 fork review agent，使用 memory/skill 工具进行自动改进。
- Skill Manager：创建、patch、edit、delete 本地 skill 文件。

Hermes 的这些能力应通过自托管服务接入 SIM，而不是把 SIM 画布能力迁移进 Hermes core。

## 3. Hermes 接入方式

### 3.1 采用本地/自托管 Hermes，不采用运行时远端 GitHub Hermes

结论：

- 开发和生产都使用自托管 Hermes。
- GitHub upstream 只作为源码来源。
- 生产从公司 fork 构建固定版本镜像或内部包。

当前公司 fork：

```text
git@github.com:Coconutzh/hermes-agent.git
```

本地开发目录建议：

```text
E:\project\hermes-agent-sim
```

已有上游原版目录：

```text
E:\project\hermes-agent
```

两者不要混用：

- `E:\project\hermes-agent`：上游原版对照仓库。
- `E:\project\hermes-agent-sim`：SIM 集成 fork。

### 3.2 为什么必须自托管

Hermes 是会执行工具、维护 memory/skill、连接消息平台、发起 browser/terminal/web 操作的运行时，不是一个纯 SDK。生产环境必须控制：

- 版本。
- 权限。
- 工具列表。
- API key。
- 用户数据存储位置。
- 审计日志。
- SIM 内部 API 调用边界。
- 上游安全更新合并节奏。

禁止：

- 生产运行时直接依赖 GitHub upstream main。
- 请求时动态拉取或执行上游代码。
- 让生产 SIM 直接调用不可控的外部 Hermes 服务。
- 将用户画布数据、网页阅读行为、消息内容发送到不可控第三方 Agent 服务。

### 3.3 Fork 使用原则

Hermes fork 的定位：

```text
可控发行版 + SIM 插件承载点 + 少量通用 runtime patch
```

不是：

```text
把 SIM 业务逻辑和 Hermes core 融合成一个大仓库
```

允许放入 Hermes fork 的内容：

- SIM Hermes plugin。
- Hermes API Server 入参透传的小型 patch。
- 多用户 namespace / profile / memory adapter 的通用补丁。
- 审计、trace、header 透传。
- 为 SIM plugin 提供的配置项和启动脚本。

不允许放入 Hermes core 的内容：

- SIM node adapter。
- SIM workflow DB 直接读写。
- SIM `editWorkflowServerTool` 逻辑。
- SIM canvas patch 主校验逻辑。
- SIM 生成服务业务实现。
- SIM 前端 SSE/画布 UI 细节。

## 4. 推荐部署形态

### 4.1 本地开发

```text
E:\project\sim
E:\project\hermes-agent
E:\project\hermes-agent-sim
```

本地服务：

```text
SIM dev server
Hermes API Server
SIM internal canvas endpoint
```

本地配置示例：

```env
HERMES_HOME=E:\project\.hermes-sim-dev
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
API_SERVER_KEY=<local-dev-secret>
SIM_INTERNAL_API_URL=http://127.0.0.1:3000
SIM_SERVICE_TOKEN=<local-service-token>
```

注意：

- 不要在代码中写死 `E:\project\hermes-agent-sim`。
- 不要把源码路径当作运行状态路径。
- `HERMES_HOME` 必须显式配置。

### 4.2 测试/预发

```text
sim-backend
hermes-agent-sim
postgres/redis/object-storage
```

要求：

- Hermes 从固定 commit 构建。
- Hermes 和 SIM 在同一内网或同一 VPC。
- Hermes API Server 只对 SIM 后端开放。
- 使用强 `API_SERVER_KEY`。
- 使用 service token 调用 SIM internal API。
- 开启结构化日志和 traceId。

### 4.3 生产

推荐容器形态：

```text
sim-backend container
hermes-agent container
shared private network
persistent volume: /var/lib/hermes/sim
```

生产配置示例：

```env
HERMES_HOME=/var/lib/hermes/sim
API_SERVER_ENABLED=true
API_SERVER_HOST=0.0.0.0
API_SERVER_PORT=8642
API_SERVER_KEY=<strong-secret>
SIM_INTERNAL_API_URL=http://sim-backend.internal
SIM_SERVICE_TOKEN=<service-token>
```

如不需要 Hermes 直接执行 terminal/file 工具，应禁用相关 toolset；如保留，必须限制 `terminal.cwd`、工作目录、容器权限和网络权限。

## 5. 服务间调用边界

### 5.1 SIM 调 Hermes

SIM 后端通过 Hermes API Server 调用 Hermes，不直接 import Hermes Python 代码，不通过 CLI 子进程执行每次请求。

推荐：

- 短期使用 `/v1/chat/completions` 或 `/v1/responses`。
- 需要长期任务、SSE 事件、审批流时使用 `/v1/runs` 和 `/v1/runs/{run_id}/events`。
- 传入稳定 session key，用于用户级 memory/skill 隔离。

SIM 调 Hermes 时必须传递：

- SIM user id。
- organization id。
- workspace id。
- workflow id。
- chat id。
- selected node ids。
- 当前用户权限摘要。
- 当前请求 trace id。

这些信息不应全部裸写入 prompt；应优先作为 Hermes plugin tool 的默认上下文或 API metadata。

### 5.2 Hermes 调 SIM

Hermes 通过 SIM plugin 注册受控工具，由工具调用 SIM internal API。

第一阶段只注册一个粗粒度工具：

```text
sim_canvas_agent_run
```

输入：

```ts
interface SimCanvasAgentRunInput {
  userId: string
  organizationId?: string
  workspaceId: string
  workflowId: string
  chatId?: string
  message: string
  selectedNodeIds?: string[]
  mode: 'read_only' | 'propose' | 'apply_after_confirm'
  confirmationMode?: 'auto' | 'manual'
  traceId?: string
}
```

输出：

```ts
interface SimCanvasAgentRunOutput {
  success: boolean
  answer: string
  intent?: string
  risk?: 'low' | 'medium' | 'high'
  requiresConfirmation?: boolean
  proposedPatchSummary?: string
  changedNodeIds?: string[]
  generatedNodeIds?: string[]
  verificationSummary?: string
  auditId: string
  error?: string
}
```

后续稳定后可拆分为：

```text
sim.canvas.read_summary
sim.canvas.read_selected_nodes
sim.canvas.search_nodes
sim.canvas.inspect_schema
sim.canvas.propose_patch
sim.canvas.apply_patch_after_confirm
sim.canvas.generate_node_output
sim.canvas.verify_patch
```

但即使拆分，也必须满足：

- `apply_patch_after_confirm` 内部仍由 SIM 做权限校验。
- patch 必须使用 SIM high-level patch schema。
- 底层 `EditWorkflowOperation` 只能由 SIM 生成。
- verify 必须由 SIM 重新读取 workflow 完成。
- 生成结果 file/content 只能由 SIM generation service 写回。

## 6. Memory 分工

### 6.1 总原则

```text
Hermes 学“这个人怎么工作”
SIM 学“这个画布/项目当前发生了什么”
SIM Published Skill 存“团队正式规范”
```

### 6.2 Hermes Memory

Hermes memory 存用户长期偏好和跨项目稳定信息：

- 沟通风格。
- 输出格式偏好。
- 内容偏好。
- 常用工作流。
- 常用网页/资料类型偏好。
- 常用工具习惯。
- 跨项目重复出现的方法论。

示例：

```text
用户做短视频内容时偏好先要 3 个 hook 方向，再要分镜脚本，最后才生成画布节点。
用户不喜欢长篇背景解释，偏好先结论、后风险、最后执行步骤。
用户经常引用视频生成、镜头调度、AI 图像提示词相关网页。
```

禁止写入 Hermes 长期 memory：

- 大段画布原文。
- 大段网页全文。
- 临时任务进度。
- 未经用户授权的浏览记录。
- 团队尚未批准的生产规范。
- 密钥、token、隐私信息。

### 6.3 SIM Local Memory

SIM local memory 存当前画布任务状态：

- conversationSummary。
- taskState。
- canvasSummary。
- recentObservations。
- toolResultRefs。

scope 应继续按：

```text
userId + workspaceId + workflowId + agentCode + chatId
```

这类 memory 服务于当前画布持续任务，不应上升为用户长期偏好，除非 Hermes review 明确识别出稳定偏好，并经过过滤后写入用户级 memory。

### 6.4 多用户隔离

Hermes 原生 memory/skill 更偏单用户 CLI profile。SIM 生产是多用户系统，必须做隔离。

可选方案：

1. MVP：
   - 每个用户或租户一个 `HERMES_HOME`。
   - 简单但资源占用高，管理复杂。

2. 正式方案：
   - 实现 SIM-backed Hermes Memory Provider。
   - memory 按 SIM user/org/workspace namespace 存储。
   - Hermes 不再依赖单一共享 `~/.hermes/memories` 服务所有 SIM 用户。

正式方案优先级更高。

## 7. Skill 分工与权限治理

### 7.1 总原则

Hermes 可以成为 SIM Skill 的自动教研员，但不应默认成为无需审批的生产规则发布者。

也就是说：

```text
Hermes 负责：发现、生成、维护建议、提出 patch
SIM 负责：权限、审核、发布、生效、回滚
```

### 7.2 Hermes Personal Skill

Hermes personal skill 存用户级 procedural knowledge：

- 这个用户做某类任务的偏好步骤。
- 用户反复纠正过的工作方法。
- 某用户在某类内容生成中的固定格式。
- 用户级工具使用套路。

这类 skill 可以自动迭代，但默认只影响该用户。

### 7.3 SIM Published Skill

SIM DB skill 当前由 `skill` 表和 `agent_skill_binding` 绑定控制。

它的影响范围可能是：

- organization。
- agentCode。
- workgroup。
- team override。
- agent template。

这类 skill 一旦 enabled，就可能进入本地画布 Agent prompt，影响团队或组织的生产行为。因此必须治理。

禁止：

- Hermes background review 自动直接写入并启用团队/组织级 skill。
- Hermes 自动修改 `agent_skill_binding.enabled`。
- Hermes 自动删除已发布 SIM skill。
- Hermes 自动将个人偏好升级为团队规范。

允许：

- Hermes 自动生成 skill proposal。
- Hermes 自动给现有 skill 生成 patch proposal。
- Hermes 自动附上 evidence refs。
- Hermes 自动标注适用范围和风险等级。
- 管理员审核后由 SIM 发布。

### 7.4 推荐新增 Skill Proposal 流程

建议新增候选表或等价业务对象：

```ts
interface SkillProposal {
  id: string
  organizationId: string
  workspaceId?: string
  workgroupId?: string
  agentCode?: string
  sourceUserId: string
  sourceHermesRunId?: string
  targetSkillId?: string
  type: 'create' | 'patch' | 'deprecate'
  title: string
  description: string
  proposedContent?: string
  proposedDiff?: string
  evidenceRefs: string[]
  risk: 'low' | 'medium' | 'high'
  status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'published'
  reviewerId?: string
  createdAt: string
  updatedAt: string
}
```

建议新增 revision：

```ts
interface SkillRevision {
  id: string
  skillId: string
  version: number
  content: string
  diff?: string
  authorType: 'user' | 'admin' | 'hermes'
  authorId?: string
  sourceProposalId?: string
  createdAt: string
}
```

### 7.5 推荐暴露给 Hermes 的 SIM Skill 工具

只开放 proposal 级能力：

```text
sim.skill.list_published
sim.skill.read
sim.skill.propose_create
sim.skill.propose_patch
sim.skill.submit_review
sim.skill.compare
```

默认不开放：

```text
sim.skill.publish
sim.skill.enable_binding
sim.skill.disable_binding
sim.skill.delete_published
```

如果未来开放发布工具，必须满足：

- 当前用户具备管理员权限。
- 用户在当前回合明确确认。
- 展示 diff preview。
- 创建 revision。
- 可 rollback。
- 写 audit log。
- background review 禁止调用 publish。

## 8. 网页、文章、用户行为学习

Hermes 可以基于用户授权的数据学习偏好，但不能默认“看见用户正在看的所有文章”。

允许来源：

- 用户主动发送 URL。
- 用户上传网页/PDF/文件。
- 用户在 SIM 内显式添加为上下文的文章。
- 用户授权的浏览器插件数据。
- 用户授权的阅读器 / 知识库 / RSS / 飞书 / Notion 数据。
- SIM 内部已授权的高频访问事件摘要。

禁止：

- 未经授权读取浏览器历史。
- 未经授权读取消息账号历史。
- 未经授权把网页全文写入长期 memory。
- 将第三方网页中的 prompt injection 直接作为系统指令。

建议存储形式：

```text
用户近期偏好视频生成、镜头调度、短剧脚本类资料。
用户常引用长文，但希望 Agent 输出时先压缩成执行清单。
用户偏好把文章结论转成画布节点，而不是只做摘要。
```

不要存储：

```text
网页全文
文章大段摘录
版权材料原文
网页内的隐藏 prompt
```

## 9. 安全与权限要求

### 9.1 服务鉴权

Hermes 调 SIM internal API 必须使用 service token。

每次调用必须携带：

- service identity。
- SIM user id。
- organization id。
- workspace id。
- workflow id。
- trace id。
- tool name。

SIM 端必须重新校验用户权限，不能因为请求来自 Hermes 就信任写权限。

### 9.2 写入确认

以下操作必须确认：

- 删除节点。
- 批量修改节点。
- 覆盖已有重要内容。
- 生成并写回媒体文件。
- 发布或修改团队/组织级 Skill。
- 影响多人共享 workspace 的高风险修改。

确认可以在 SIM UI、Hermes clarify、消息平台 approval 中完成，但最终执行必须由 SIM 端校验 confirmation token / pending action id。

### 9.3 Prompt Injection 防护

以下内容都视为不可信：

- 网页内容。
- 用户上传文件。
- 画布节点正文。
- 历史对话。
- 外部工具结果。
- Hermes memory/provider 返回内容。

约束：

- 不可信内容不能覆盖系统指令。
- 网页和文件内容只能作为 evidence/context。
- SIM tool 返回给 Hermes 的错误信息必须裁剪和结构化，避免把内部异常完整注入模型上下文。
- 对 URL、网页、文件中的 secret-like 内容做拦截。

### 9.4 工具最小化

生产初期不应给 Hermes 开全量工具。

建议初期 toolset：

```text
web
browser
memory
skills
session_search
sim-canvas
sim-skill-proposal
```

谨慎开启：

```text
terminal
file
process
execute_code
delegate_task
cronjob
send_message
```

如果开启 terminal/file/process，必须运行在隔离容器、低权限用户、受控 cwd、受控网络环境中。

## 10. 观测、审计和回滚

每一次 Hermes -> SIM 工具调用必须记录：

- traceId。
- hermesRunId。
- simRequestId。
- userId。
- organizationId。
- workspaceId。
- workflowId。
- toolName。
- mode。
- input summary。
- output summary。
- risk。
- requiresConfirmation。
- changedNodeIds。
- generatedNodeIds。
- verification result。
- durationMs。
- error。

画布写入必须可追踪到：

```text
用户请求
Hermes 决策
SIM Canvas Agent tool observations
patch proposal
确认记录
editWorkflowServerTool 操作
verify 结果
最终回答
```

Skill 发布必须可追踪到：

```text
proposal
diff
evidence
reviewer
published revision
rollback target
```

## 11. 分阶段实施计划

### Phase 0：冻结架构边界

目标：

- 明确 Hermes/SIM 职责边界。
- 确定 Hermes fork 和部署路径。
- 确定 API Server 接入方式。
- 确定 SIM internal canvas endpoint。
- 确定多用户 memory/skill 隔离方案。

交付物：

- 本文档评审通过。
- Hermes fork 初始化。
- SIM/Hermes 环境变量清单。
- 安全边界清单。

### Phase 1：Hermes API Server 接入 SIM

目标：

- SIM 后端能调用 Hermes API Server。
- Hermes 能返回普通对话结果。
- session id / session key / user metadata 可透传。

验收：

- 本地 SIM 能调用 `E:\project\hermes-agent-sim` 启动的 Hermes。
- 不依赖硬编码本地路径。
- 生产配置可替换为容器地址。

### Phase 2：只读 Canvas Tool

目标：

- Hermes 注册 `sim_canvas_agent_run(mode=read_only)`。
- Hermes 能让 SIM Runtime 读取画布摘要、选中节点、权限状态。
- 无任何写入能力。

验收：

- Hermes 能回答“当前画布有什么节点”。
- Hermes 不能修改画布。
- SIM 端权限校验生效。

### Phase 3：Proposal 模式

目标：

- Hermes 可以请求 SIM 生成画布修改方案。
- SIM 返回 proposed patch summary 和 risk。
- 不实际写入 workflow。

验收：

- 用户能看到待确认方案。
- destructive action 必须要求确认。
- patch 不合法时不会进入执行阶段。

### Phase 4：受控写入和 Verify

目标：

- 用户确认后执行写入。
- SIM 内部调用 `editWorkflowServerTool`。
- 写后强制 verify。

验收：

- 创建、更新、连接、布局等基本 patch 成功。
- verify 失败时 Hermes 不得宣称成功。
- 审计日志完整。

### Phase 5：生成节点输出

目标：

- 支持 text/image/video/audio 生成写回。
- Hermes 不伪造 file output。
- SIM generation services 执行真实生成。

验收：

- 生成结果写回对应节点字段。
- 失败时有明确错误。
- verify 能确认写回结果。

### Phase 6：Memory/Skill Adapter

目标：

- Hermes 用户偏好进入隔离 memory。
- SIM canvas memory 仍留在 SIM。
- Hermes skill 自动迭代只影响个人级 skill。

验收：

- 用户 A/B memory 不串。
- 用户偏好可在后续会话召回。
- 当前画布 task state 不污染全局用户画像。

### Phase 7：Skill Proposal 审核流

目标：

- Hermes 生成团队/组织 skill proposal。
- 管理员审核后发布到 SIM DB skill。
- 支持 revision 和 rollback。

验收：

- Hermes background review 不能直接 publish。
- proposal 有 evidence 和 diff。
- 发布后进入 `agentSkillBinding` 生效链路。
- 可回滚。

## 12. 后续开发硬性约束

### 12.1 MUST

- MUST 使用自托管 Hermes 服务。
- MUST pin Hermes fork commit/release。
- MUST 通过配置传递路径和 URL。
- MUST 显式设置 `HERMES_HOME`。
- MUST 对多用户 memory/skill 做隔离。
- MUST 让 SIM 端重新校验画布权限。
- MUST 让 SIM 执行画布 patch 和 verify。
- MUST 对团队/组织级 skill 发布加审核。
- MUST 为每次写入记录 audit/trace。
- MUST 为高风险操作提供确认。

### 12.2 SHOULD

- SHOULD 把 SIM 集成做成 Hermes plugin。
- SHOULD 初期只暴露粗粒度 `sim_canvas_agent_run`。
- SHOULD 将 Hermes 作为控制面，SIM 作为画布数据面。
- SHOULD 将网页/文章学习结果压缩为偏好摘要。
- SHOULD 把 skill proposal 和 published skill 分表或分状态管理。
- SHOULD 定期从 upstream Hermes 合并安全更新。

### 12.3 MUST NOT

- MUST NOT 把 SIM canvas runtime 移植进 Hermes core。
- MUST NOT 让 Hermes 直接写 SIM workflow DB。
- MUST NOT 让 Hermes 直接生成底层 `EditWorkflowOperation`。
- MUST NOT 让 Hermes background review 自动发布团队/组织级 skill。
- MUST NOT 用单一共享 `~/.hermes` 服务所有 SIM 用户。
- MUST NOT 在代码里写死本地开发目录。
- MUST NOT 未经授权读取用户浏览器历史或消息历史。
- MUST NOT 将网页全文默认写入长期 memory。
- MUST NOT 在生产默认开启所有 Hermes 工具。

## 13. 关键反模式

以下实现方式应在 code review 中直接阻止：

1. 在 SIM 中通过 `child_process` 每次请求启动 Hermes CLI。
2. 在 Hermes 中直接 import SIM TS 文件或访问 SIM DB。
3. 在 Hermes plugin 中拼底层 workflow operations。
4. 使用一个共享 Hermes profile 存所有用户 memory。
5. Hermes 自动把个人偏好写入 SIM published skill。
6. 网页内容未经清洗直接进入系统 prompt。
7. 画布写入无 verify 就回复“已完成”。
8. 生产环境开启 terminal/file/process 但无容器隔离。
9. 将本地路径 `E:\project\hermes-agent-sim` 写进业务逻辑。
10. 从 GitHub upstream main 动态部署生产 Hermes。

## 14. 当前建议的近期任务清单

1. 在 `E:\project\hermes-agent-sim` 中创建 SIM plugin 雏形。
2. 在 SIM 中新增 internal canvas agent endpoint，仅供 Hermes service token 调用。
3. 在 SIM 中新增 Hermes client module，负责调用 Hermes API Server。
4. 定义 `sim_canvas_agent_run` request/response contract。
5. 完成本地 read-only demo。
6. 补充 trace/audit 字段。
7. 再进入 proposal 和 apply 阶段。

## 15. SIM Internal API 落地要求

### 15.1 推荐 endpoint

建议第一阶段只新增一个 Hermes 专用 internal route：

```text
POST /api/internal/hermes/canvas-agent/run
```

职责：

- 只接收 Hermes service 调用。
- 只作为 SIM Local Canvas Agent Runtime 的后端入口。
- 不向前端直接暴露。
- 不承载 Hermes memory/skill 逻辑。
- 不绕过现有 workflow、workspace、workgroup 权限模型。

### 15.2 Contract 位置

该 route 仍属于 HTTP boundary，必须遵守 SIM API contract 规范。

推荐新增：

```text
apps/sim/lib/api/contracts/internal/hermes-canvas-agent.ts
```

或如后续 internal Hermes 接口增多，可新增：

```text
apps/sim/lib/api/contracts/internal/hermes.ts
```

约束：

- Route 不得 `import { z } from 'zod'`。
- Route 不得定义 route-local boundary schema。
- Route 使用 `parseRequest(contract, request, context)`。
- Request/response type 只能从 contract 文件导出并复用。
- Auth/service-token 校验必须先于 body 解析和业务执行。
- 同源客户端 hook 不直接调用该 endpoint；仅 SIM backend/Hermes integration 层使用。

### 15.3 Route 实现边界

Route 只能做四件事：

1. 校验 Hermes service token。
2. 建立 SIM user/workspace/workflow 的授权上下文。
3. 调用 Local Canvas Agent Runtime 的受控 headless 入口。
4. 返回结构化工具结果和 audit/trace id。

Route 不应做：

- 自己解析 workflow DB 并拼 prompt。
- 自己生成 patch。
- 自己调用 `editWorkflowServerTool` 绕开 runtime。
- 在 route 内直接写 memory/skill。
- 把 Hermes 原始 prompt 注入 SIM system prompt。

如果现有 `runLocalCanvasAgent` 强绑定 SSE/前端 lifecycle，应新增薄封装的 headless adapter，而不是复制 runtime 逻辑。推荐命名：

```text
runLocalCanvasAgentHeadless
```

该 adapter 应复用已有：

- context manager。
- canvas context loader。
- routing/planner/tool-loop。
- permissions。
- canvas tools。
- patch validator。
- verify。
- memory persist。
- observability。

### 15.4 错误语义

Hermes plugin 需要稳定识别 SIM 错误类型，因此 SIM 返回错误时应结构化。

建议错误 code：

```text
UNAUTHENTICATED_SERVICE
USER_PERMISSION_DENIED
WORKSPACE_NOT_FOUND
WORKFLOW_NOT_FOUND
CANVAS_CONTEXT_UNAVAILABLE
PATCH_VALIDATION_FAILED
CONFIRMATION_REQUIRED
CONFIRMATION_EXPIRED
TOOL_EXECUTION_FAILED
VERIFY_FAILED
GENERATION_FAILED
RATE_LIMITED
INTERNAL_ERROR
```

约束：

- `VERIFY_FAILED` 不能被 Hermes 当作成功。
- `CONFIRMATION_REQUIRED` 必须带 pending action id 或 proposal summary。
- `USER_PERMISSION_DENIED` 不应泄漏具体权限表内部结构。
- `INTERNAL_ERROR` 不应返回完整 stack trace。

## 16. Hermes Fork 开发与升级策略

### 16.1 分支建议

Hermes fork 建议长期保留以下分支：

```text
main                 跟随 fork 的稳定主线
sim/integration      SIM 集成开发主分支
sim/release/*        生产候选版本
upstream-sync/*      合并上游变更的临时分支
```

原则：

- SIM 业务集成只进入 `sim/integration` 或 release 分支。
- 不直接在生产分支试验 upstream main。
- 每次上线记录 Hermes commit、SIM commit、配置版本和迁移版本。
- 上游合并使用独立 PR，先跑 Hermes 自测，再跑 SIM 集成冒烟。

### 16.2 Fork 改造边界

允许改 Hermes fork：

- API Server metadata/header/session-key 支持。
- plugin 注册和配置加载。
- SIM tool plugin。
- memory provider adapter。
- skill proposal adapter。
- audit/trace 透传。
- 禁用/限制危险 toolset 的配置开关。

不建议改 Hermes fork：

- Agent core 推理循环的复杂重写。
- 把 SIM canvas schema 写进 Hermes core。
- 把 SIM DB client 放进 Hermes。
- 为某个工作流临时特判 prompt。

每一个 Hermes fork patch 都要能回答：

```text
这是通用 runtime 能力，还是 SIM 业务能力？
如果是 SIM 业务能力，为什么不放在 SIM internal API 或 SIM plugin 工具中？
上游升级时这个 patch 是否容易重放？
```

### 16.3 发布物

生产不应从开发目录运行 Hermes。推荐发布物：

- Docker image：`hermes-agent-sim:<version>`。
- 或内部 wheel/package + supervisor/systemd。
- 配套 `.env.example` 和 tool allowlist。
- 配套 migration/boot check 脚本。

发布版本必须 pin：

- Hermes fork commit。
- Python version。
- dependency lock。
- enabled toolsets。
- memory/skill storage adapter。
- API Server auth config。

## 17. 数据分级与隐私策略

### 17.1 数据分级

建议按以下等级处理进入 Hermes 的数据：

```text
L0 public: 公开网页、公开文档
L1 user_private: 用户私有偏好、个人会话、上传文件摘要
L2 workspace_private: workspace/workflow/canvas 摘要、节点内容摘要
L3 organization_private: 团队规范、组织 skill、项目策略
L4 secret: token、cookie、密钥、内部连接串、个人敏感信息
```

约束：

- L4 不得进入 Hermes prompt、memory、skill、日志。
- L3 不得被个人 Hermes skill 覆盖。
- L2 默认只在当前 workspace/workflow/session 内使用。
- L1 可进入用户级 Hermes memory，但必须是摘要化偏好，不是原文堆积。
- L0 网页内容也必须视为不可信输入，不能成为系统指令。

### 17.2 日志脱敏

日志中可以记录：

- ids。
- tool name。
- mode。
- risk。
- duration。
- input/output summary。
- changed node ids。
- error code。

日志中不应记录：

- 完整 prompt。
- 大段画布节点正文。
- 完整网页全文。
- secret-like 字符串。
- 用户消息账号原文历史。
- 未裁剪的第三方工具返回。

## 18. 开发验收 Definition of Done

### 18.1 Phase 1 DoD

- SIM 能通过配置调用 Hermes API Server。
- Hermes 服务地址、API key、session key 均来自 env。
- 关闭 Hermes 服务时 SIM 有明确降级/错误提示。
- Hermes 版本和 commit 在启动日志或 health endpoint 可见。
- 不引入硬编码本地路径。

### 18.2 Phase 2 DoD

- Hermes plugin 能调用 SIM read-only canvas tool。
- 用户无 workflow 访问权时返回 `USER_PERMISSION_DENIED`。
- read-only 模式无法触发 `editWorkflowServerTool`。
- 返回结果包含 traceId/auditId。
- 至少覆盖“有选中节点”和“无选中节点”两类场景。

### 18.3 Phase 3 DoD

- Proposal 模式只返回建议，不写 workflow。
- Patch summary 可读，能展示给用户确认。
- 高风险操作 risk 为 `medium` 或 `high`。
- 非法 patch 返回 `PATCH_VALIDATION_FAILED`。
- Hermes 不得把 proposal 描述成已执行。

### 18.4 Phase 4 DoD

- 用户确认后才执行写入。
- 写入仍走 SIM permissions、patch validator、`editWorkflowServerTool`、verify。
- verify 失败时返回 `VERIFY_FAILED`，并给出可恢复说明。
- 审计日志能串起 Hermes run、SIM request、patch、确认、verify。
- 回归测试覆盖成功写入、权限拒绝、verify 失败。

### 18.5 Phase 6/7 DoD

- Hermes memory 按用户/租户隔离。
- 用户 A 的偏好不会被用户 B 召回。
- Hermes personal skill 只影响个人。
- SIM published skill 只能通过 proposal + review + publish 生效。
- proposal 有 evidence、diff、risk、reviewer、revision。
- 支持回滚到上一个 published revision。

## 19. Code Review 阻断项

以下任一情况出现时，PR 应直接打回：

- Hermes plugin 直接访问 SIM 数据库。
- Hermes plugin 直接生成底层 workflow operation。
- SIM internal route 绕过 `parseRequest` 和 contract。
- SIM internal route 先解析未鉴权 body，再做 service auth。
- 画布写入没有 verify。
- skill proposal 未经审核直接写入 enabled published skill。
- 使用共享 `~/.hermes` 存储多用户长期 memory。
- 把本地绝对路径写入业务代码。
- 把网页或文件内容作为系统指令拼接。
- production tool allowlist 默认开启 terminal/file/process。
- 日志记录完整 prompt、网页全文、token 或敏感正文。

## 20. 风险矩阵

| 风险 | 影响 | 触发场景 | 缓解措施 |
| --- | --- | --- | --- |
| Hermes/SIM 职责混乱 | 后续维护成本急剧上升 | 在 Hermes core 中加入 SIM canvas 业务逻辑 | SIM 业务只放 plugin/internal API，core patch 必须可解释为通用能力 |
| 多用户 memory 串号 | 严重隐私事故 | 共享 `HERMES_HOME` 或 session key 不稳定 | namespace/profile 隔离，正式阶段实现 SIM-backed provider |
| 自动发布团队 skill | 团队生产规范被污染 | background review 直接写 DB skill | proposal + admin review + revision + rollback |
| 画布误写 | 破坏用户 workflow | Hermes 绕过 SIM patch/verify | 写入只能由 SIM runtime 完成，危险操作二次确认 |
| Prompt injection | Agent 执行恶意指令 | 网页/文件/节点内容包含指令 | 不可信内容只作 evidence，工具 allowlist，输出过滤 |
| 上游升级冲突 | fork 难维护 | 大量修改 Hermes core | 小 patch、plugin 化、upstream-sync 分支、集成测试 |
| 工具权限过大 | 数据泄漏或服务器风险 | 生产默认开启 terminal/file/process | 容器隔离、最小 toolset、allowlist、审计 |

## 21. 最终定位

Hermes 是 SIM Agent 体系的通用智能体控制面。

SIM Local Canvas Agent Runtime 是 SIM 业务最核心的画布数据面。

两者的关系不是替代，而是协作：

```text
Hermes 负责更聪明、更通用、更会学习。
SIM Runtime 负责更准确、更安全、更懂画布。
```

这条路线能最大化复用 Hermes 的成熟能力，同时避免重写 SIM 画布核心能力，降低长期 fork 成本，并为后续多 Agent、用户画像、网页理解、Skill 治理和团队协作留下清晰扩展空间。
