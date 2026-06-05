# 本地画布 Agent Runtime 技术方案

## 背景与目标

当前项目已经具备画布、工种团队、展示画布、任务协作、Copilot 聊天和内容节点等基础能力，但现有本地 `content_canvas_v1` agent 更接近一个“内容画布小动作 planner”，可用范围偏窄。它适合处理“新增一个节点”“修改选中节点”“连线”“布局”等简单操作，但在复杂问题、多轮上下文、跨工种 skill、读取新增节点、执行多步工具链等场景下能力不足。

后续产品方向明确为只使用本地 agent，不再依赖远端 Mothership agent。因此本方案不要求兼容远端 agent API 或 checkpoint/resume 协议，但应复用项目已有的本地基础设施：

- 聊天记录持久化：`copilot_chats`
- 用户、团队、工种权限体系：`workspace`、`workgroup`、`workgroup_member`
- 工种 agent 和 skill 配置：`agent_profile`、`discipline`、`agent_skill_binding`、`skill`
- 画布读取与修改能力：`loadWorkflowFromNormalizedTables`、`editWorkflowServerTool`
- 本地工具执行链：`executeTool`、已有 server tools
- 前端 SSE/消息 UI 体验：现有 Mothership/Copilot chat 组件

核心目标是把当前玩具化的画布 planner 升级为一个正式的本地多步 agent runtime：

```text
用户请求
  -> 解析当前用户、画布、团队、工种、权限、skill
  -> 构造长上下文
  -> 多步规划
  -> 调用本地画布/文件/生成/任务工具
  -> 观察结果并继续推理
  -> 更新画布或返回答案
  -> 持久化用户隔离的 agent 历史
```

## 当前问题总结

### 1. 现有本地画布 Agent 过于轻量

当前 `apps/sim/lib/copilot/request/lifecycle/content-canvas-agent.ts` 的核心逻辑是：

- 只处理内容节点：`text`、`image`、`video`、`audio`
- 只给模型每个节点约 120 字 preview
- 只取最近 6 条对话历史
- 一次最多输出 3 个 actions
- 输出 token 较小
- 不完整吸收文件、资源、@上下文
- 工具范围窄，主要围绕 create/update/connect/layout/generate/writeback

这导致它更像“局部画布操作生成器”，不是能够理解项目、工种、任务、长上下文、复杂画布结构的 agent。

### 2. 历史记录隔离需要重新明确

`copilot_chats` 表本身有 `userId`、`workspaceId`、`workflowId`、`type`、`messages`，具备用户隔离基础。但当前不同入口的隔离规则不完全一致：

- workflow-scoped copilot 查询通常会按 `userId + workflowId` 过滤。
- workspace/mothership 类型聊天有部分逻辑更偏工作区共享，只校验 workspace access，而不一定按 `userId` 私有过滤。

本地 agent 后续必须明确区分：

- 个人 agent 历史
- 团队 agent 历史
- 任务 agent 历史

默认应使用个人隔离，避免同一团队画布里不同用户互相看到私人 agent 历史。

### 3. 不同工种的 Agent 和 Skill 必须区分

当前协作模型已经有工种和 agent 绑定基础：

```text
workgroup
  -> disciplineId
  -> discipline.agentCode
  -> agent_profile
  -> organization_agent_template
  -> agent_skill_binding
  -> skill
```

但现有 `content_canvas_v1` 并没有完整使用这套身份和 skill 体系。后续本地 agent 必须根据当前画布归属的 workgroup/discipline 动态加载对应 agent profile 和 skills。

### 4. 新增节点读取和工具调用未体系化

当前内容节点 preset 已经出现了预留类型：

- `document`
- `table`
- `image_editor`

但 `ContentNodeVariant` 目前主要是：

- `text`
- `image`
- `video`
- `audio`

现有 agent 读取节点和执行生成逻辑都硬编码在几个 variant 上。后续新增节点后，如果没有统一节点 adapter/registry，agent 会出现：

- 读不到新增节点内容
- 不知道新增节点有哪些字段
- 不知道如何生成 preview/detail
- 不知道如何创建、更新、生成、写回这些节点
- 工具调用无法覆盖新增节点能力

## 设计原则

### 1. 不兼容远端协议，但复用本地基础设施

后续只使用本地 agent，因此不需要继续兼容远端 Mothership 的 `/api/tools/resume`、checkpoint_pause 等协议。但应该保留这些思想：

- agent 可以多步执行
- 工具调用后继续观察和推理
- 工具结果要进入上下文
- 长任务要有 task state
- 工具过程要能在 UI 中展示

### 2. 默认用户隔离，团队共享显式化

agent 历史默认是个人私有。只有以下情况才共享：

- 用户显式创建团队 agent 会话
- 会话绑定到团队任务
- 导演/审核流程需要共享某个任务上下文

### 3. 工种身份决定 Agent 能力

本地 agent 不应该统一使用一个通用 prompt。每次运行都应解析：

```text
当前 workspace/workflow
  -> workgroup
  -> discipline
  -> agentCode
  -> agentProfile
  -> projectInstructions
  -> enabled skills
  -> 当前用户 role/permissions
```

### 4. 节点能力注册化

不要继续在 agent 主逻辑里写大量 `if variant === 'text'`。所有节点的读取、摘要、详情、创建、更新、生成、验证都应通过 adapter 注册。

### 5. 工具高层语义化

模型不应直接随意生成底层 `EditWorkflowOperation`。应优先使用高层画布工具：

- `canvas.read_summary`
- `canvas.read_node`
- `canvas.search_nodes`
- `canvas.apply_patch`
- `canvas.verify_patch`
- `canvas.generate_node_output`

底层再由工具和 adapter 转成安全的 `editWorkflowServerTool` 操作。

## 总体架构

建议把新系统命名为 `Local Canvas Agent Runtime`，它不是远端 Mothership 的兼容实现，而是本地复现远端 agent 的核心思想：上下文构建、多步规划、工具调用、观察结果、压缩记忆、继续执行、最终输出。

推荐结构：

```text
Local Canvas Agent Runtime
  ├── 通用 runtime：会话、上下文、计划、工具循环、SSE、memory、权限
  └── Canvas skill/tool layer：画布读取、节点 adapter、patch、生成、验证
```

建议新增本地 agent 模块：

```text
apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/
├── index.ts
├── runtime.ts
├── types.ts
├── routing.ts
├── context-manager.ts
├── planner.ts
├── tool-loop.ts
├── tool-registry.ts
├── tool-executor-bridge.ts
├── observation.ts
├── memory.ts
├── stream.ts
├── permissions.ts
├── skills.ts
├── workgroup-profile.ts
├── canvas-context.ts
├── canvas-tools.ts
├── canvas-patch.ts
├── canvas-verify.ts
├── node-adapters/
│   ├── index.ts
│   ├── text.ts
│   ├── image.ts
│   ├── video.ts
│   ├── audio.ts
│   ├── document.ts
│   ├── table.ts
│   └── image-editor.ts
└── models/
    ├── planner.ts
    ├── actor.ts
    ├── summarizer.ts
    └── verifier.ts
```

主流程：

```text
runLocalCanvasAgent
  -> resolveLocalAgentContext
  -> loadUserScopedHistory
  -> loadWorkgroupAgentProfile
  -> loadEnabledSkills
  -> buildTokenAwareContext
  -> selectAvailableTools
  -> runAgentToolLoop
  -> executeLocalTools
  -> summarizeObservation
  -> verifyToolResults
  -> updateConversationSummary / taskState / canvasSummary
  -> persistAssistantMessage
```

这个结构的关键是：本地 runtime 是正式的 orchestrator，画布只是它能操作的一类工具。不要继续在 `content-canvas-agent.ts` 里堆更多 prompt、节点类型特判和一次性 action schema。

## 远端 Agent 思想如何本地复现

本方案不要求兼容远端 Mothership agent API，也不要求实现真实的 `/api/tools/resume`、远端 checkpoint 存储或远端 subagent 协议。但当前本地调用远端 agent 的代码能反推出一个重要事实：远端 agent 大概率不是一次 LLM 调用，而是一个完整 orchestrator。

本地应吸收的是这些思想，而不是远端协议：

| 远端 agent 思想 | 本地复现方式 |
| --- | --- |
| 上下文组装 | 本地 `context-manager.ts` 统一组装 user、workspace、workflow、canvas、selected nodes、history、skills、attachments |
| 工具选择 | 本地 `tool-registry.ts` 动态筛选可用工具，不一次塞全部工具 |
| 工具调用后继续推理 | 本地 `tool-loop.ts` 把 tool result 转成 observation，再继续下一轮 actor 推理 |
| checkpoint/resume 思想 | 本地 in-process 实现 `tool_request -> execute -> observation -> continue`，不走远端 HTTP resume |
| 长上下文压缩 | 本地 `memory.ts` 做 conversation summary、task state、canvas summary |
| 子任务/子 agent 思想 | 本地先用 skill/tool group 表达，后续可扩展成 canvas/file/task 子 runtime |
| 流式过程展示 | 本地继续发已有 SSE 事件，让 UI 展示 thinking/tool/result/complete |
| 资源产物追踪 | 本地生成节点输出、文件或 artifact 时记录 resource/ref，避免把大结果全塞回上下文 |

因此本地 agent 的核心循环应该是：

```text
上下文构建
  -> 任务理解
  -> 计划拆解
  -> 选择工具
  -> 本地执行工具
  -> 观察工具结果
  -> 压缩/更新记忆
  -> 判断继续或完成
  -> 输出最终回答
```

这个循环要在本地完成，不依赖远端服务，也不为了兼容远端协议牺牲本地权限、工种 skill 和画布节点 adapter 的正确性。

## 本地 Agent 运行时详细设计

### `routing.ts`

负责判断哪些请求走新 runtime，哪些请求暂时保留旧逻辑。

初期建议：

| 场景 | 处理方式 |
| --- | --- |
| 单个简单 create/update/connect/layout | 可暂时保留 `content_canvas_v1` |
| 多节点、多轮、长上下文、需要先分析再修改 | 走 `runLocalCanvasAgent` |
| 涉及 selected nodes 完整内容 | 走 `runLocalCanvasAgent` |
| 涉及文件、知识库、历史对话、任务状态 | 走 `runLocalCanvasAgent` |
| 涉及工种 skill 或团队权限 | 走 `runLocalCanvasAgent` |
| 新增节点类型 document/table/image_editor | 走 `runLocalCanvasAgent`，并要求 adapter 支持 |

复杂请求可以先用启发式识别：

- 请求包含“根据当前画布”“完整方案”“分析”“整理所有”“生成一组”“检查并修改”等复杂意图。
- 当前有 selected nodes，且选中节点内容较长或数量大于 1。
- 请求需要读取文件、知识库、历史对话或任务状态。
- 请求需要连续创建、更新、连接多个节点。
- 请求需要先理解全局结构，再执行画布修改。

### `context-manager.ts`

负责解决“上下文过短”的核心问题。它不能只是把最近消息从 6 条扩大到 30 条，而应该做 token-aware 分层上下文。

输入来源：

- 当前用户消息
- `copilot_chats.messages`
- 当前 workspace / workflow / workgroup
- selected nodes
- 当前画布节点和边
- 工种 agent profile
- 启用 skills
- 文件、knowledge、@上下文
- 已保存的 conversation summary / task state / canvas summary

输出上下文分层：

```text
System Prompt
Agent Profile
Project / Workgroup Instructions
Permission Summary
Enabled Skills
Current Canvas Summary
Selected Node Full Details
Relevant Node Details
Attached Contexts
Recent Conversation
Long-term Conversation Summary
Current Task State
Recent Tool Observations
User Message
```

画布上下文规则：

- selected nodes 给完整 detail。
- 与 selected nodes 相连的节点优先给 detail。
- 用户文本命中的节点优先给 detail。
- 最近修改或高中心度节点可给 detail。
- 其余节点只给标题、类型、短摘要和连接关系。
- 超长节点内容保存为 artifact/ref，需要时通过 `canvas.read_node` 再读全文。

### `planner.ts`

负责把复杂请求拆成可执行计划。Planner 不直接修改画布，只输出计划和风险。

建议结构：

```ts
interface LocalAgentPlan {
  goal: string
  risk: 'low' | 'medium' | 'high'
  requiresClarification: boolean
  steps: Array<{
    id: string
    title: string
    intent: 'inspect' | 'create' | 'update' | 'connect' | 'generate' | 'verify' | 'answer'
    toolHints: string[]
    expectedObservation: string
  }>
  successCriteria: string[]
}
```

高风险计划必须先停在 clarify/propose 阶段，例如：

- 大范围删除节点。
- 覆盖团队画布关键内容。
- 更新 mainline/show canvas。
- 跨工种读取或修改。

### `tool-registry.ts`

负责注册和筛选本地工具。不要一次性把所有 Sim 工具都塞给模型。

工具分层：

```text
基础工具：ask_clarification, summarize_context
画布读取：canvas.read_summary, canvas.read_node, canvas.read_selected_nodes, canvas.search_nodes, canvas.inspect_schema
画布修改：canvas.propose_patch, canvas.apply_patch, canvas.verify_patch
生成工具：canvas.generate_node_output, generate_text, generate_image, generate_video, generate_audio
文件工具：read_file, search_workspace, materialize_file
工作流工具：inspect_workflow, edit_workflow, run_workflow
知识工具：query_knowledge, search_docs
任务工具：read_tasks, update_task_result, submit_task_result
```

筛选依据：

- 当前 mode：chat / canvas / workflow / task
- 当前用户权限：read / edit / publish / review
- 当前工种 agent profile
- enabled skills
- 用户意图
- 当前画布是否只读

### `tool-executor-bridge.ts`

负责把 agent 的工具调用转成项目已有工具执行。原则是复用，不绕路。

优先复用：

- `executeTool`
- `executeToolAndReport`
- `editWorkflowServerTool`
- `loadWorkflowFromNormalizedTables`
- `workspace-vfs`
- `processContextsServer`
- 现有文本/图片/视频/音频生成服务

本地 checkpoint/resume 思想可以这样实现：

```text
actor 选择工具
  -> runtime 记录 pending tool request
  -> 权限 guard 校验
  -> executor bridge 执行本地工具
  -> stream 发工具调用和结果
  -> observation summarizer 摘要工具结果
  -> tool-loop 把 observation 放回上下文
  -> actor 继续下一步
```

注意：这只是保留 checkpoint/resume 的思想，不实现远端 checkpoint API。

### `memory.ts`

负责让复杂任务能跨多轮继续，而不是每次都重新理解。

初期不需要向量库，先做三类结构化 memory：

```text
conversationSummary：每个 chat 的长期摘要
taskState：当前复杂任务的 plan、completedSteps、openQuestions、lastObservation
canvasSummary：每个 workflow/canvas 的结构摘要、关键节点摘要、最近修改摘要
```

写入时机：

- 每次 agent run 完成。
- 对话或工具结果超过上下文预算。
- 画布 patch 成功。
- 用户说“继续”“按刚才的方案做”。

隔离规则：

- personal scope：按 `userId + workspaceId + workflowId + agentCode` 隔离。
- team scope：必须显式选择，并校验团队访问权限。
- task scope：绑定任务 ID，并按任务参与权限读取。

### `stream.ts`

本地 agent 不需要复刻远端协议，但应该复用现有前端能识别的流式事件形态，避免新增聊天 UI。

建议至少输出：

- assistant text：最终回答和必要过程说明。
- thinking/status：正在读取画布、正在分析节点、正在修改画布。
- tool call/result：展示工具名、状态、摘要。
- complete/error/cancelled：结束状态。

如果现有 UI 已经支持 Mothership stream event，可以继续使用同一类事件对象；但文档和代码上要把它定义为“本地 UI stream 复用”，不是“远端协议兼容”。

### `canvas-context.ts` 和 `node-adapters`

负责把画布从原始 workflow JSON 转成 agent 可理解、可验证的语义结构。

每个 adapter 至少支持：

```ts
interface CanvasNodeAdapter {
  variant: string
  summarize(node): CanvasNodeSummary
  detail(node): CanvasNodeDetail
  getEditableFields(node): CanvasEditableField[]
  buildCreatePatch(input): LocalCanvasPatch
  buildUpdatePatch(nodeId, input): LocalCanvasPatch
  validatePatch(patch): CanvasPatchValidationResult
}
```

新增节点必须配 adapter。没有 adapter 的节点只能以 generic readonly summary 出现在上下文里，不能允许 agent 盲写。

### `canvas-tools.ts`

画布工具应该是高层语义工具，不让模型直接拼底层数据库操作。

第一批工具：

```text
canvas.read_summary：读取画布结构、节点列表、连接关系和短摘要
canvas.read_node：读取单个节点完整 detail
canvas.read_selected_nodes：读取当前选中节点完整 detail
canvas.search_nodes：按标题、内容、类型、连接关系搜索节点
canvas.inspect_schema：查询节点类型可编辑字段和约束
canvas.propose_patch：生成但不执行 patch，用于高风险变更或用户确认
canvas.apply_patch：执行安全 patch，底层调用 editWorkflowServerTool
canvas.verify_patch：读取修改后画布并校验是否符合计划
canvas.generate_node_output：调用生成服务并写回节点输出
```

复杂任务执行例子：

```text
用户：根据当前画布，帮我做一个完整短视频内容链
agent:
  1. canvas.read_summary
  2. canvas.read_selected_nodes
  3. canvas.search_nodes("脚本/视觉/视频")
  4. planner 生成内容链计划
  5. canvas.inspect_schema("text")
  6. canvas.apply_patch 创建脚本节点
  7. canvas.apply_patch 创建图像节点和视频节点
  8. canvas.apply_patch 连接节点
  9. canvas.verify_patch
  10. 输出完成说明和下一步建议
```
## Agent 会话与历史隔离

### 会话 scope

建议把本地 agent 会话分成三类：

```ts
type LocalAgentSessionScope = 'personal' | 'team' | 'task'
```

### 个人会话

默认会话类型。

查询条件必须包含：

```text
userId = currentUserId
workspaceId = currentWorkspaceId
workflowId = currentWorkflowId
agentCode = resolvedAgentCode
scope = personal
```

用途：

- 用户自己的草稿思路
- 私人问题
- 尚未共享给团队的修改建议

其他用户不能读取。

### 团队会话

只有显式创建团队会话时使用。

查询条件：

```text
workspaceId = teamWorkspaceId
workgroupId = activeWorkgroupId
agentCode = resolvedAgentCode
scope = team
```

访问条件：

- 当前用户必须是该 workgroup 成员
- 管理/删除团队会话需要 workgroup admin 或更高权限

用途：

- 团队共同讨论团队画布
- 团队 agent 产出的共享方案
- 团队内部任务推进

### 任务会话

绑定 production task。

查询条件：

```text
taskId = productionTaskId
scope = task
```

访问条件：

- 任务创建者
- 任务分配工种成员
- 导演/审核角色
- 被任务显式授权的相关工种

用途：

- 任务提交/审核讨论
- 任务节点消息
- 任务结果修改历史

### `copilot_chats` 使用建议

短期可以继续复用 `copilot_chats`，在 `config` 里存本地 agent 元数据：

```ts
{
  scope: 'personal' | 'team' | 'task',
  agentCode: string,
  organizationId: string,
  workgroupId?: string,
  disciplineId?: string,
  taskId?: string,
  localAgentVersion: string
}
```

如果后续本地 agent 复杂度提高，可以再迁移到独立表，例如 `local_agent_session`、`local_agent_message`、`local_agent_memory`。

## 工种 Agent 与 Skill 解析

### Agent 身份解析

本地 agent 每次运行前，需要解析当前上下文：

```text
workspace/workflow
  -> workspace.workgroupId 或 personal_canvas_workspace.workgroupId
  -> workgroup.disciplineId
  -> discipline.agentCode
  -> agent_profile.code
```

如果没有 discipline，默认 fallback：

```text
chief_director
```

但 fallback 必须可观测，日志要记录原因。

### Agent Profile

`agent_profile` 提供：

- `code`
- `name`
- `description`
- `defaultSystemPrompt`

本地 agent 的基础系统身份应来自这里，而不是写死。

### 组织级项目说明

`organization_agent_template` 提供：

- `organizationId`
- `agentCode`
- `projectInstructions`

这部分应作为当前项目/组织的补充 instruction。

### Skill 加载规则

Skill 来源：

- `skill` 表
- `agent_skill_binding`

加载条件：

```text
skill.workspaceId = 当前工种 teamWorkspaceId
agentSkillBinding.agentCode = 当前 agentCode
agentSkillBinding.organizationId = 当前 organizationId
enabled = true
```

合并规则：

1. 加载组织级默认策略：`scope = agent_template` 且 `workgroupId IS NULL`
2. 加载团队级覆盖：`scope = team_override` 且 `workgroupId = 当前 workgroupId`
3. 团队级覆盖优先于组织级策略
4. 禁用的 skill 不进入 agent prompt
5. 非当前 agentCode 的 skill 不进入 prompt
6. 当前用户无权访问的 workgroup skill 不进入 prompt

### Skill 与 Skill Card 的区别

`skill` / `agent_skill_binding` 是 agent 能力和指令，应该进入 agent 上下文。

`copilot_skill_card` 更像 UI 快捷入口，包含：

- prompt 快捷动作
- 创建任务模板
- 提交任务入口

它不应无脑作为 agent 能力进入系统 prompt，而应作为：

```text
suggestedActions / shortcuts / task templates
```

## 权限模型

### 个人画布

规则：

- 只允许 owner 编辑。
- agent 历史默认 personal。
- agent 可以读取该个人画布。
- 个人画布不能直接上传/发布到展示画布。
- 不能读取其他用户的个人 agent 历史。

### 团队画布

规则：

- workgroup member 可编辑团队画布。
- workgroup admin 可管理团队设置、成员、skill 开关。
- 团队 agent 可读取团队画布。
- 团队 agent 历史默认仍建议 personal，除非显式选择 team scope。

### 展示画布 / Mainline

规则：

- 普通工种 agent 默认只读展示画布。
- 导演 agent 可以读取展示画布和审核任务。
- 更新展示画布必须走团队画布 publish/update 权限。
- 个人画布 agent 不能直接写展示画布。

### 跨工种访问

规则：

- 灯光 agent 默认不能读取舞美团队画布。
- 舞美 agent 默认不能读取灯光团队画布。
- 导演 agent 可读取授权展示画布和任务相关团队结果。
- 跨工种任务访问应通过 production task 或 publication visibility 授权，而不是直接放开 workspace。

## 画布节点 Adapter/Registry

### 设计目标

新增节点后，agent 不应该改主循环。节点能力应由 adapter 描述：

```ts
interface CanvasNodeAdapter {
  kind: string
  blockType: string
  canRead: boolean
  canWrite: boolean
  canGenerate: boolean
  canReferenceFile: boolean
  summarize(node: CanvasNodeRecord): CanvasNodeSummary
  readDetail(node: CanvasNodeRecord): CanvasNodeDetail
  buildCreateOperation(input: CanvasNodeCreateInput): EditWorkflowOperation
  buildUpdateOperation(input: CanvasNodeUpdateInput): EditWorkflowOperation
  buildGenerateOperation?(input: CanvasNodeGenerateInput): LocalToolCall
  validatePatch?(patch: CanvasNodePatch): ValidationResult
}
```

### 第一批 Adapter

必须先支持：

- `text`
- `image`
- `video`
- `audio`

新增/预留：

- `document`
- `table`
- `image_editor`
- `generic_workflow_block`

### text 节点

读取字段：

- `contentHtml`
- `blockStyle`
- `backgroundColor`
- `fontSize`
- `width`
- `height`
- `aiPrompt`
- `aiModel`

能力：

- 创建文本节点
- 更新文本内容
- 生成文本
- 写回 `contentHtml`
- 摘要 HTML 文本

### image 节点

读取字段：

- `file`
- `aiPrompt`
- `aiModel`
- `aiAspectRatio`

能力：

- 创建图片节点
- 上传/关联图片文件
- 生成图片
- 写回 `file`
- 摘要 prompt、文件名、类型、尺寸等

### video 节点

读取字段：

- `file`
- `videoPrompt`
- `videoModelFamily`
- `videoResolution`
- `videoDuration`
- `referencedMedia`

能力：

- 创建视频节点
- 生成视频
- 上传/关联视频文件
- 写回 `file`
- 读取首帧/尾帧引用

### audio 节点

读取字段：

- `file`
- `audioPrompt`
- `audioModel`
- `audioParameters`

能力：

- 创建音频节点
- 生成音频
- 上传/关联音频文件
- 写回 `file`

### document 节点

短期可先占位，但 agent 要能识别：

- 这是文档卡片
- 支持文件读取
- 支持摘要
- 支持引用到其他节点

后续能力：

- 上传文档
- 解析文档
- 提取段落
- 根据文档生成文本/图片/视频节点

### table 节点

短期可先占位，但 agent 要能识别：

- 表格数据节点
- 支持结构化数据读取
- 支持 CSV/JSON 输入输出

后续能力：

- 创建表格
- 更新表格数据
- 从文件导入表格
- 将表格转成内容计划

### image_editor 节点

短期可先占位，但 agent 要能识别：

- 图片编辑节点
- 需要 source image
- 需要 edit prompt
- 产出新 image file

后续能力：

- 读取源图
- 生成编辑 prompt
- 调用图片编辑服务
- 写回输出图片

## 本地画布工具

本地 agent 应该通过高层工具操作画布。

### `canvas.read_summary`

返回画布结构摘要：

```ts
{
  workflowId,
  workspaceId,
  nodes: [
    {
      id,
      name,
      blockType,
      kind,
      position,
      selected,
      summary,
      capabilities
    }
  ],
  edges: [
    { source, target, sourceHandle, targetHandle }
  ]
}
```

用途：

- 复杂任务第一步读取画布
- 布局/连线/整体分析
- 判断相关节点

### `canvas.read_node`

读取单个节点完整详情。

规则：

- 用户选中节点：优先允许完整读取
- 用户明确提到节点名/id：允许完整读取
- 超长内容：返回摘要 + 可继续分页读取

### `canvas.read_selected_nodes`

读取当前选中的节点完整详情。

这是解决当前“选中节点只传 blockIds，不传完整内容”的关键工具。

### `canvas.search_nodes`

按名称、类型、内容、连接关系搜索节点。

用途：

- 用户说“刚才那个视频节点”
- 用户说“含有某段文案的节点”
- 用户说“连到图片后的音频”

### `canvas.inspect_schema`

告诉 agent 某类节点支持哪些字段和能力。

示例：

```ts
{
  kind: 'image',
  readableFields: ['file', 'aiPrompt', 'aiModel', 'aiAspectRatio'],
  writableFields: ['file', 'aiPrompt', 'aiModel', 'aiAspectRatio'],
  generation: {
    supported: true,
    inputFields: ['aiPrompt', 'aiAspectRatio'],
    outputField: 'file'
  }
}
```

### `canvas.apply_patch`

接受高层 patch，而不是原始底层 operations。

示例：

```ts
{
  operations: [
    {
      type: 'create_node',
      kind: 'text',
      title: '短视频脚本',
      contentHtml: '<p>...</p>',
      position: { x: 100, y: 200 }
    },
    {
      type: 'connect',
      sourceNodeId: 'text-1',
      targetNodeId: 'image-1'
    }
  ]
}
```

本地工具负责：

- 校验权限
- 校验节点 schema
- 转换为 `EditWorkflowOperation`
- 调用 `editWorkflowServerTool`
- 返回应用后的 workflow state

### `canvas.verify_patch`

应用 patch 后重新读取 normalized workflow，确认：

- 节点是否创建成功
- 字段是否写入成功
- 连线是否存在
- 生成结果是否写回
- 是否有 validation errors/skipped items

### `canvas.generate_node_output`

统一入口：

```ts
canvas.generate_node_output({ nodeId })
```

内部按 adapter 分派：

- text -> text generation -> `contentHtml`
- image -> image generation -> `file`
- video -> video generation -> `file`
- audio -> audio generation -> `file`
- document/table/image_editor -> 后续 adapter 接入

## Agent 上下文管理

### 不再固定最近 6 条

当前 `content_canvas_v1` 的 `slice(-6)` 必须被替换为 token-aware context builder。

建议上下文分层：

```text
System Prompt
Agent Profile
Project Instructions
Enabled Skills
Permission Summary
Canvas Summary
Selected Node Full Details
Relevant Node Details
Attached Contexts
Recent Conversation
Long-term Conversation Summary
Current Task State
User Message
```

### 上下文预算建议

初始可以采用比例预算：

```text
agent profile + permissions: 10%
project instructions: 10%
skills: 15%
canvas summary: 15%
selected node details: 20%
relevant node details: 10%
recent conversation: 10%
long-term summary/task state: 5%
current user request: 5%
```

后续可按模型 context window 动态调整。

### 长历史处理

超过预算时不能直接丢弃。建议：

- 保留最近 N 条完整消息
- 更早消息压缩为 conversation summary
- 对复杂任务保存 task state
- 对画布保存 canvas summary cache
- 工具结果太长时保存 artifact，只把摘要放回上下文

## 本地 Agent Loop

建议采用多步循环：

```text
1. Understand：理解请求
2. Inspect：按需读取画布/节点/上下文
3. Plan：生成可执行计划
4. Act：调用一个或多个本地工具
5. Observe：读取工具结果
6. Verify：验证画布或任务状态
7. Continue/Finish：继续下一步或输出最终回答
```

伪代码：

```ts
async function runLocalCanvasAgent(input) {
  const context = await buildLocalAgentContext(input)
  const state = await loadAgentState(context)

  for (let step = 0; step < maxSteps; step += 1) {
    const prompt = await buildStepPrompt(context, state)
    const decision = await callAgentModel(prompt)

    if (decision.type === 'final') {
      await persistFinalAnswer(decision.answer)
      return
    }

    if (decision.type === 'tool_call') {
      const result = await executeLocalAgentTool(decision.tool)
      state.observations.push(summarizeToolResult(result))
      await maybeUpdateMemory(state)
      continue
    }

    if (decision.type === 'ask_clarification') {
      await emitAssistantMessage(decision.question)
      return
    }
  }

  await emitAssistantMessage('任务步骤较多，我已完成当前可安全执行的部分，并保存了后续计划。')
}
```

## 模型调用策略

建议拆成几个模型角色，而不是一个巨大 prompt：

### Planner

结构化输出：

- 用户意图
- 是否需要读画布
- 是否需要调用工具
- 初步计划
- 风险等级

### Actor

多步工具调用：

- 选择工具
- 生成工具参数
- 根据观察继续执行

### Verifier

结构化校验：

- 修改是否符合用户要求
- 是否漏了节点
- 是否违反权限
- 是否需要继续

### Summarizer

压缩历史：

- conversation summary
- task state
- canvas summary
- tool result summary

## 本地工具链复用

优先复用现有能力：

- `loadWorkflowFromNormalizedTables`
- `editWorkflowServerTool`
- `executeTool`
- `processContextsServer`
- `generateWorkspaceContext`
- `workspace-vfs`
- 现有文本/图片/视频/音频生成服务
- production task API/service
- publication/mainline API/service

不要为 agent 单独写一套绕过权限和数据模型的画布修改逻辑。

## 与现有 `content_canvas_v1` 的关系

`content_canvas_v1` 不应该继续被小修小补成“万能 agent”。它当前更适合作为 simple canvas action fallback：处理低风险、单步或少量局部画布操作。

不建议继续做这些局部增强：

- 把 `slice(-6)` 简单改成 `slice(-30)`。
- 把每个节点 120 字 preview 简单改成 1000 字。
- 把 planner token 从 2000 简单改成 8000。
- 在 `content-canvas-agent.ts` 里继续堆 prompt、if/else 和节点类型特判。

这些做法只能短期改善，不能解决多步任务、长上下文、工具选择、权限隔离、工种 skill 和新增节点 adapter 的核心问题。

过渡策略：

1. 新增 `Local Canvas Agent Runtime`。
2. 保留 `content_canvas_v1` 处理简单 create/update/connect/layout 请求。
3. 复杂请求、多轮上下文、涉及 skill/任务/新增节点/文件/knowledge 的请求走 `runLocalCanvasAgent`。
4. 新 runtime 覆盖核心画布工具后，把 `content_canvas_v1` 改成调用新 runtime 的 simple mode。
5. 新 runtime 稳定后，删除或冻结旧 `content_canvas_v1` 主逻辑。

最终目标：

```text
content_canvas_v1
  -> Local Canvas Agent Runtime 的 simple canvas mode
  -> 或在新 runtime 覆盖后移除
```
## 实施阶段

### 阶段 1：本地 Agent 会话与上下文身份

目标：

- 定义 local agent session metadata
- 默认个人历史隔离
- 解析当前 workspace/workflow 对应 workgroup、discipline、agentCode
- 生成 `LocalAgentContext`

产出：

- `resolveLocalAgentContext`
- `loadUserScopedAgentHistory`
- `LocalAgentSessionScope`
- 基础权限校验

### 阶段 2：工种 Agent Profile 与 Skill 加载

目标：

- 加载 `agent_profile`
- 加载 `organization_agent_template`
- 加载启用的 `skill`
- 支持团队级 skill override

产出：

- `loadWorkgroupAgentProfile`
- `loadEnabledAgentSkills`
- `buildAgentSystemPrompt`

### 阶段 3：画布节点 Adapter Registry

目标：

- 把 text/image/video/audio 读取逻辑迁移到 adapter
- 新增 document/table/image_editor adapter 占位
- selected nodes 支持完整 detail
- 全画布 summary 统一格式

产出：

- `CanvasNodeAdapter`
- `canvasNodeAdapterRegistry`
- `readCanvasSummary`
- `readCanvasNodeDetail`

### 阶段 4：本地画布工具

目标：

- 实现第一批高层画布工具
- 底层复用 `editWorkflowServerTool`
- patch 后自动 verify

第一批工具：

- `canvas.read_summary`
- `canvas.read_node`
- `canvas.read_selected_nodes`
- `canvas.search_nodes`
- `canvas.inspect_schema`
- `canvas.apply_patch`
- `canvas.verify_patch`

### 阶段 5：多步 Agent Loop

目标：

- 实现 inspect-plan-act-observe-verify 循环
- 支持多次工具调用
- 工具结果进入上下文
- 支持 clarification

产出：

- `runLocalCanvasAgent`
- `tool-loop.ts`
- `stream.ts`

### 阶段 6：生成类工具和新增节点工具

目标：

- text/image/video/audio 生成工具 adapter 化
- 新增 document/table/image_editor 的读取和写入基础能力
- 生成结果写回节点并 verify

产出：

- `canvas.generate_node_output`
- `generateTextNodeOutput`
- `generateImageNodeOutput`
- `generateVideoNodeOutput`
- `generateAudioNodeOutput`

### 阶段 7：长期记忆和压缩

目标：

- 不再依赖固定最近 N 条
- 支持 conversation summary
- 支持 canvas summary cache
- 支持 task state memory
- 工具大结果摘要化

产出：

- `local-agent/memory.ts`
- `summarizer.ts`
- session summary 字段或独立 memory 表

## 验证用例

### 用户隔离

- 同一团队画布中，用户 A 的 personal agent 会话不出现在用户 B 的历史里。
- 用户 B 无法通过 chatId 读取用户 A 的 personal agent 会话。
- team scope 会话只有 workgroup 成员可读。
- task scope 会话只有任务相关用户可读。

### 工种隔离

- 灯光团队画布加载 lighting agent profile。
- 舞美团队画布加载 stage/design agent profile。
- 导演画布加载 chief/director agent profile。
- 灯光 agent 不加载舞美 team workspace 的 skills。
- team override 禁用的 skill 不进入 prompt。

### 节点读取

- 选中文本节点时，agent 能读取完整 `contentHtml`。
- 选中图片节点时，agent 能读取 `file` 和 `aiPrompt`。
- 视频/音频节点能读取对应 prompt 和 file metadata。
- document/table/image_editor 节点至少不会被忽略，应返回可识别摘要。

### 工具调用

- agent 能读取画布 summary。
- agent 能搜索相关节点。
- agent 能创建 text/image/video/audio 节点。
- agent 能更新节点字段。
- agent 能连接节点。
- agent 修改后能 verify。

### 复杂任务

- 用户要求“根据当前画布做完整短视频内容链”，agent 能多步创建文案、图片、视频、音频节点并连接。
- 用户要求“根据选中图片写一段文案并接到后面”，agent 能读取选中图片详情，创建文本节点并连线。
- 用户要求“按灯光组规范检查当前方案”，agent 能加载灯光 skill 并输出/执行对应检查。

## 风险与注意事项

### 1. 不要绕过权限

所有 agent 工具必须通过现有权限检查。不能因为是本地 agent 就直接读写任意 workspace/workflow。

### 2. 不要把所有上下文无脑塞进模型

需要 token-aware context builder。否则复杂画布会导致 prompt 过长、效果变差、成本变高。

### 3. 不要把所有工具一次性暴露

工具应按任务动态启用。默认只暴露基础画布工具和当前工种相关工具。

### 4. 新增节点必须配套 adapter

以后新增任何一类画布节点，都要同时补：

- adapter
- readable fields
- writable fields
- summary/detail
- create/update patch mapping
- generate/writeback 能力
- tests

### 5. Skill Card 不等于 Agent Skill

不要把 `copilot_skill_card` 全部塞进 agent system prompt。它更多是 UI 快捷动作/任务模板。

## 推荐下一步

建议下一步先做阶段 1-3，不直接写完整 agent loop：

1. 先定义 local agent session metadata 和用户隔离规则。
2. 实现 `resolveLocalAgentContext`，确保能正确识别用户、工种、agentCode、权限。
3. 实现 skill 加载，确保不同工种拿到不同 skill。
4. 实现 canvas adapter registry，先让 agent 能正确读取所有现有/新增节点。

做到这一步后，再开始多步 agent loop 和工具调用，风险会低很多。
