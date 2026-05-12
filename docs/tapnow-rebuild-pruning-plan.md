# TapNow 风格二开功能对照与精简清单

## 1. 目标

本项目当前是一个能力很全的大型工作流编排平台，覆盖了画布编辑、实时协作、执行引擎、Copilot、A2A、MCP、数百个第三方工具和大量组织/部署治理能力。

二次开发目标不是继续扩充长尾能力，而是基于现有基础能力做一次产品聚焦：

- 保留画布式工作流编辑的核心体验
- 保留 AI 帮用户搭图、改图、调试图的关键能力
- 保留多人实时协作和执行调试
- 砍掉大量不直接服务于 TapNow 风格体验的外围复杂功能
- 最终实现“简单快速上手，但功能仍然足够强”的画布操作体验

从代码结构上看，最接近 TapNow 的核心不在海量 `tools/*` 和长尾集成，而在以下四层：

1. `workflow 画布编辑`
2. `realtime 实时协作`
3. `copilot / AI 改图`
4. `agent block / workflow 执行`

## 2. 核心能力对照

### 2.1 画布编辑器

画布主入口：

- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/workflow.tsx`

这里直接承载了：

- ReactFlow 画布
- block/edge 渲染
- 拖拽、连线、选择
- 复制、粘贴、删除、重复
- 右键菜单
- Panel、Terminal、DiffControls、Cursors
- Chat 懒加载入口

本地状态与工作流切换：

- `apps/sim/stores/workflows/workflow/store.ts`
- `apps/sim/stores/workflows/registry/store.ts`

服务端状态读写：

- `apps/sim/app/api/workflows/[id]/route.ts`
- `apps/sim/app/api/workflows/[id]/state/route.ts`

### 2.2 画布操作协议层

画布上的编辑操作并不是直接到数据库，而是先进入协作协议层：

- `apps/sim/hooks/use-collaborative-workflow.ts`

这一层封装了：

- block 批量新增/删除
- edge 批量新增/删除
- block 改名
- block 移动
- 父子容器关系更新
- block 锁定/解锁
- block enabled 开关
- subblock 值更新
- variable 增删改
- loop / parallel 配置更新

这是 TapNow 风格“顺手编辑体验”的核心边界层。

### 2.3 实时协作

前端 socket 客户端：

- `apps/sim/app/workspace/providers/socket-provider.tsx`

负责：

- socket 建连
- join/leave workflow room
- workflow operation 发射
- subblock / variable / cursor / selection 同步
- 失败重试

实时服务端：

- `apps/realtime/src/index.ts`
- `apps/realtime/src/middleware/auth.ts`
- `apps/realtime/src/handlers/workflow.ts`
- `apps/realtime/src/handlers/operations.ts`
- `apps/realtime/src/handlers/presence.ts`
- `apps/realtime/src/handlers/subblocks.ts`
- `apps/realtime/src/handlers/variables.ts`
- `apps/realtime/src/routes/http.ts`

职责分工：

- `workflow.ts`：进房、权限校验、presence 初始化、下发 workflow state
- `operations.ts`：编辑操作校验、权限判断、广播、持久化
- `presence.ts`：光标与选区同步
- `subblocks.ts`：子配置实时同步
- `variables.ts`：变量实时同步
- `routes/http.ts`：主应用通知 realtime 工作流更新/删除/部署/回滚

如果要保留多人共编，这一层必须整体保留。

### 2.4 Agent 节点

Agent 节点定义：

- `apps/sim/blocks/blocks/agent.ts`

它定义了 Agent block 的产品形态：

- messages
- model
- reasoning effort
- verbosity
- thinking
- response format
- memory
- tools
- provider credential

Agent 执行器：

- `apps/sim/executor/handlers/agent/agent-handler.ts`
- `apps/sim/executor/handlers/registry.ts`

这部分是“画布上放一个智能节点，它自己调模型、可带工具、可结构化输出”的真正执行层。

### 2.5 工作流执行与调试

前端执行/终端：

- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution.ts`

后端执行入口：

- `apps/sim/app/api/workflows/[id]/execute/route.ts`

执行核心：

- `apps/sim/lib/workflows/executor/execute-workflow.ts`
- `apps/sim/background/workflow-execution.ts`

这部分决定了：

- 手动运行
- SSE 流式执行
- 异步后台执行
- 取消执行
- 终端日志
- block 级执行状态

TapNow 风格产品不能只有“搭图”，必须有“边搭边跑边看结果”，所以这层也属于核心保留层。

### 2.6 AI 改图 / Copilot

工作流页面右侧 AI 面板入口：

- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/panel/panel.tsx`

这个面板里包含：

- Copilot chat 会话管理
- 新建/切换/删除会话
- 发送自然语言需求
- AI 工具执行结果回流
- `edit_workflow` 结果触发 diff 预览

统一聊天入口：

- `apps/sim/app/api/mothership/chat/route.ts`

对外无 UI 的 headless 入口：

- `apps/sim/app/api/v1/copilot/chat/route.ts`

Copilot 真正修改工作流的实现：

- `apps/sim/lib/copilot/tools/handlers/workflow/mutations.ts`

这一层最接近 TapNow 的“用户说一句话，AI 帮你搭图/改图，然后给你一个可接受的差异结果”。

### 2.7 自动布局

自动布局接口：

- `apps/sim/app/api/workflows/[id]/autolayout/route.ts`

这是非常适合保留的体验增强能力，可以直接支撑：

- 一键整理图
- AI 改图后自动重新排版
- 简化用户对复杂布局的手动维护成本

### 2.8 A2A Agent 暴露能力

A2A 管理接口：

- `apps/sim/app/api/a2a/agents/route.ts`
- `apps/sim/app/api/a2a/agents/[agentId]/route.ts`

A2A 对外服务入口：

- `apps/sim/app/api/a2a/serve/[agentId]/route.ts`

这个能力更偏“把 workflow 发布成外部可调用 agent 服务”，不是 TapNow MVP 的第一优先级，但在后续平台化时很有价值。

## 3. 保留 / 后置 / 裁剪清单

### 3.1 MVP 必保留

| 能力 | 主要代码/接口 | 原因 |
| --- | --- | --- |
| 画布编辑器本体 | `workflow.tsx`、`workflow/store.ts`、`registry/store.ts` | TapNow 核心交互入口 |
| 工作流状态读写 | `api/workflows/[id]/route.ts`、`api/workflows/[id]/state/route.ts` | 加载、保存、AI 改图回写都依赖 |
| 实时协作 | `socket-provider.tsx`、`apps/realtime/src/handlers/*` | 多人共编是核心竞争力 |
| 画布操作协议层 | `use-collaborative-workflow.ts`、`packages/realtime-protocol/*` | 保证交互一致性和可扩展性 |
| 执行与终端 | `use-workflow-execution.ts`、`api/workflows/[id]/execute/route.ts`、`execute-workflow.ts` | 用户必须能运行和调试 |
| Agent 节点 | `blocks/blocks/agent.ts`、`executor/handlers/agent/agent-handler.ts` | 画布中的 AI 核心能力 |
| Copilot / AI 改图 | `panel.tsx`、`api/mothership/chat/route.ts`、`lib/copilot/tools/handlers/workflow/mutations.ts` | 最像 TapNow 的核心体验 |
| 自动布局 | `api/workflows/[id]/autolayout/route.ts` | 能显著提升易用性 |

### 3.2 二阶段保留

| 能力 | 主要代码/接口 | 建议 |
| --- | --- | --- |
| Chat/表单/嵌入式部署 | `workflows/[id]/chat/status`、`/chat/[identifier]`、Deploy UI | 二阶段再恢复 |
| MCP 生态 | `blocks/blocks/mcp.ts`、`app/api/mcp/**` | 很强但先不做全量 |
| A2A Agent 发布 | `api/a2a/**`、`hooks/queries/a2a/agents.ts` | 偏平台能力，可后置 |
| Webhook / Schedule / Trigger 生态 | `app/api/webhooks/**`、`app/api/schedules/**`、`triggers/**` | 先保留最小触发方式 |
| 知识库 / 文件上下文 | `knowledge/**`、`files/**` | 取决于是否强调知识增强型 AI |

### 3.3 优先裁剪

| 能力 | 主要代码/接口 | 裁剪原因 |
| --- | --- | --- |
| 海量第三方 tools 路由 | `app/api/tools/**`、`tools/registry.ts` | 数量极大，不是首版核心体验 |
| 海量 blocks 注册 | `blocks/registry.ts` | 需要缩成一个小而强的核心组件集 |
| 垂类 Agent 能力 | `agentmail`、`agentphone`、`stagehand` 等 | 会显著分散产品焦点 |
| 复杂组织治理 / billing / admin | `organizations/**`、`billing/**`、`superuser/**`、`v1/admin/**` | 对 TapNow MVP 无直接价值 |
| 训练/反馈等实验性 Copilot 能力 | feedback / training / 非核心 checkpoint 周边 | 可留到后期 |
| 大量开放平台能力 | 部分 `v1/*`、公开发现、复杂 OAuth 管理 | 内部产品形态先跑通再开放 |

## 4. 推荐的核心 Block / Tool 白名单

如果要先裁成 TapNow 风格 MVP，建议先把画布层收敛到少量高频块。

### 4.1 建议保留的 Block

- `start_trigger`
- `agent`
- `api`
- `function`
- `condition`
- `router`
- `response`
- `loop`
- `parallel`
- `variables`
- `webhook_request`
- `generic_webhook`
- `chat_trigger`
- `mcp`
- `note`

### 4.2 建议保留的 Tool 类别

- LLM provider
- HTTP/API 调用
- 文件输入输出
- 知识库检索
- 搜索类工具
- MCP 工具桥接
- 少量高频 SaaS 集成

### 4.3 建议首批去掉的 Tool/Block 类别

- 长尾 CRM / HR / Ads / Analytics 集成
- `agentmail`
- `agentphone`
- 复杂浏览器自动化垂类
- 非核心媒体处理长尾能力
- 平台治理类非终端用户能力

## 5. 建议实施顺序

### 阶段一：抽出 TapNow 内核

目标：

- 在不大动执行引擎和实时协议的前提下，先得到一个能正常编辑、运行、协作、AI 改图的最小产品

建议动作：

1. 保留 `workflow.tsx + use-collaborative-workflow + realtime handlers + execute route + agent block + panel copilot`
2. 收缩 `blocks/registry.ts`，只保留核心块
3. 收缩 `tools/registry.ts`，只保留最小可用工具集
4. 隐藏而不是立刻物理删除长尾页面和入口
5. 先保证 MVP 可以完整完成“建图 -> 改图 -> 运行 -> 调试 -> 协作”

### 阶段二：重做产品交互层

目标：

- 把当前偏“全功能平台”的 UI 交互，收敛成更像 TapNow 的轻量工作台

建议动作：

1. 简化右侧 Panel 信息密度
2. 简化 block 菜单与工具分类
3. 强化 AI 输入入口与自动建议
4. 强化自动布局和模板起手体验
5. 弱化配置复杂度高但低频的高级选项

### 阶段三：按需要逐步恢复平台能力

目标：

- 在 MVP 跑顺以后，再逐步加回真正需要的扩展能力

建议动作：

1. 先恢复 MCP
2. 再恢复知识库和文件上下文
3. 再恢复 webhook / schedule / trigger
4. 最后视商业化需要恢复 A2A、开放 API、组织治理

## 6. 结论

这个仓库并不需要“推倒重来”，因为 TapNow 风格产品所需的关键骨架已经存在：

- 画布编辑器已经有
- 协作协议已经有
- 实时服务已经有
- Agent 节点已经有
- 执行器已经有
- AI 改图已经有

真正需要做的是一次产品聚焦和架构裁剪：

- 核心层保留
- 外围层后置
- 长尾层裁剪

用一句话概括这次二开的方向：

> 不是继续维护一个“什么都有”的自动化平台，而是把现有平台裁成一个更聚焦、更顺手、更像 TapNow 的 AI 工作流画布产品。

## 7. 后续文档建议

基于这份文档，建议继续补三份配套文档：

1. `TapNow MVP 模块白名单`
2. `TapNow MVP 下线目录清单`
3. `TapNow 二开实施排期与里程碑`

## 8. 海量第三方 Tools 路由如何裁剪

这一层不要从 `apps/sim/app/api/tools/**` 的 300 多个路由文件开始删。

在这个仓库里，第三方工具的真实接线顺序是：

1. `apps/sim/tools/registry.ts`
2. `apps/sim/tools/utils.ts` 的 `getTool()`
3. `apps/sim/tools/utils.server.ts` 的 `getToolAsync()`
4. `apps/sim/blocks/registry.ts`
5. `apps/sim/blocks/blocks/{service}.ts`
6. `apps/sim/app/api/tools/{service}/**`

也就是说，最安全的第一裁剪点不是 route 文件，而是 `tools/registry.ts`。

### 8.1 为什么先裁 registry，不先删 route

因为当前工具执行链是集中式的：

- `getTool()` 会从 `apps/sim/tools/registry.ts` 读取内置工具
- `getToolAsync()` 也先读同一个 registry，再处理 custom tool
- 很多 block 通过 `tools.access` 和 `tools.config.tool()` 绑定具体 tool id

只要 registry 不再暴露某个 tool：

- 画布侧就可以不再展示它
- 执行侧就可以拿不到它
- Copilot / Agent 侧也更难再误调用它

而 route 文件即使暂时留在磁盘上，也不会继续构成主产品能力面。

### 8.2 这个仓库最适合按 service 裁，不适合按单个 action 裁

这个项目的工具天然就是按 service 分组的：

- tool id 命名大多是 `service_action`，例如 `slack_message`、`gmail_send_v2`、`notion_search_v2`
- route 目录也是 `app/api/tools/{service}/...`
- block 也是 `blocks/blocks/{service}.ts`

所以第一轮应该做的是：

- 保留少量核心 service
- 整组下线长尾 service

而不是先在一个 service 里面挑十几个 action 慢慢删。

### 8.3 建议的四层裁剪顺序

#### 第一层：产品白名单

先定义一份 TapNow MVP 的工具白名单，建议单独放一个中心文件，例如：

- `apps/sim/lib/product/tool-policy.ts`

这份文件建议至少提供三类能力：

- `ENABLED_TOOL_SERVICES`
- `isToolEnabled(toolId)`
- `isToolServiceEnabled(service)`

第一版建议只保留少量高价值类别：

- `agent` 相关能力
- `api` / `http_request`
- `file`
- `search`
- `mcp`
- 如业务确实需要，再少量保留 `slack` / `gmail` / `notion`

首批可优先下线的，通常包括：

- `agentmail`
- `agentphone`
- `stagehand`
- 大量 CRM / HR / Ads / Analytics / 数据库长尾集成
- 各种并非 TapNow 核心体验的垂类外部 SaaS

#### 第二层：裁 `apps/sim/tools/registry.ts`

这是第一关键闸口。

做法不是立刻删掉 import，而是先把最终导出的 `tools` 改成“白名单过滤后的 registry”：

- 先保留 `ALL_TOOLS`
- 再导出过滤后的 `tools`

这样做的好处是：

- 风险最低
- 最容易回滚
- 最容易做 A/B 或阶段性收缩
- 不会一上来就制造大规模 merge conflict

#### 第三层：同步裁 `apps/sim/blocks/registry.ts`

如果只裁 tool，不裁 block，会出现一个典型坏状态：

- 画布上还能拖出 `slack` block
- 但运行时找不到对应 tool
- 最终变成“可见但不可执行”的坏体验

所以 block registry 也必须同步做白名单过滤，至少做到：

- 被下线 service 的 block 不再出现在画布菜单
- 已下线 block 不再作为模板默认块暴露

必要时再进一步处理：

- `blocks/blocks/{service}.ts`
- 内部的 `tools.access`
- `tools.config.tool()`

如果一个 block 本身只服务于被裁掉的工具组，第二阶段就可以整文件删除。

#### 第四层：执行时硬拦截

只改 UI 不够，运行时还要再挡一次。

建议在下面两个函数里统一做 disabled tool 判定：

- `apps/sim/tools/utils.ts` 的 `getTool()`
- `apps/sim/tools/utils.server.ts` 的 `getToolAsync()`

目标是：

- 被裁掉的 tool id 一律返回 `undefined`
- 或直接抛出明确错误，例如 “Tool disabled in this product edition”

这样即使：

- 旧 workflow 里残留了历史 block
- Agent / Copilot 还生成了旧 tool id
- 某些内部执行链绕过了前端菜单

也不会真的执行到下线工具。

### 8.4 `app/api/tools/**` 路由什么时候再删

等上面三层稳定之后，再做物理删除。

推荐顺序：

1. 先 registry 下线
2. 再 block 下线
3. 再运行时硬拦截
4. 最后批量删除 `apps/sim/tools/{service}` 和 `apps/sim/app/api/tools/{service}`

原因很现实：

- 先删 route，改动面太大
- 很容易漏掉 block、template、copilot、executor 里的隐式依赖
- 对正在做并行开发的人也最不友好

而且这个仓库的第三方工具非常多，直接物理删除往往会把“功能裁剪”做成“仓库重构”。

### 8.5 推荐的阶段化策略

#### 阶段 A：软下线

目标：

- 用户看不到
- 新流程用不到
- 旧流程运行会明确报错

落点：

- `apps/sim/lib/product/tool-policy.ts`
- `apps/sim/tools/registry.ts`
- `apps/sim/tools/utils.ts`
- `apps/sim/tools/utils.server.ts`
- `apps/sim/blocks/registry.ts`

#### 阶段 B：清模板与入口

目标：

- 模板、推荐块、Copilot 默认建议里不再出现已下线 service

需要顺手排查：

- workflow 模板
- starter flow
- block 搜索菜单
- Copilot 可用工具列表

#### 阶段 C：物理删除

目标：

- 真正减少代码量、依赖面、构建时间和维护成本

删除对象：

- `apps/sim/tools/{service}/**`
- `apps/sim/app/api/tools/{service}/**`
- `apps/sim/blocks/blocks/{service}.ts`
- 对应 icon、测试、文档、合同和引用

### 8.6 对 TapNow 风格 MVP 的具体建议

如果目标是“先做一个简单、顺手、AI 驱动的画布产品”，那么第三方 tools 这一层建议收得非常狠：

- 第一版只保留通用能力，不保留平台大全
- 优先保留“任何用户都能理解”的工具，而不是“某个行业才需要”的工具
- 优先保留“能帮助 AI 搭图和执行”的工具，而不是“为了展示集成数量”的工具

更直接一点说：

- `http/api` 应该留
- `agent` 应该留
- `search` 应该留
- `file` 应该留
- `mcp` 可以小规模保留
- `slack/gmail/notion` 只在明确有业务场景时再留
- 大量长尾 SaaS 集成第一版都应该先砍掉

### 8.7 一句话原则

这部分的正确裁剪方式不是：

> 先删 300 个 route 文件

而是：

> 先做一层中心白名单，用 registry 和 block registry 把产品能力面收窄，再在运行时硬拦截，最后再物理删目录。
