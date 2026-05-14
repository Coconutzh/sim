# TapNow 双轨协作画布方案设计

本文档用于定义 `sim` 在 TapNow 化二次开发中的下一阶段核心协作模型：同一团队在私有草稿画布内协作开发，验证通过后发布到团队主线画布，供其他工作组查看。

## 一、目标与结论

### 1.1 目标

本阶段要解决的不是单纯的节点交互优化，而是更上层的协作模型问题：

- 同一个团队成员要能共用一套私有协作画布
- 不同团队之间不能看到彼此的草稿画布
- 每个团队要有一套可以对外展示的已发布主线画布
- 其他工作组的人可以查看主线，但不能进入草稿协作面
- 尽量复用现有 `workflow`、`realtime`、`executor`、`workspace` 能力，不重写底层系统

### 1.2 结论

结合当前仓库的实现，第一版推荐采用下面这套模型：

- `workspace` 继续作为现有隔离容器使用，但产品语义改成“团队工作空间”
- 在 `workspace` 上增加 `workgroup` 分组层
- 在 `workflow` 上增加“轨道”概念，区分 `draft` 和 `published`
- 发布先做“整张工作流发布”，不先做节点簇 merge

也就是：

- `organization`
- `workgroup`
- `workspace (= team workspace)`
- `workflow (track = draft | published)`

这套方案的核心优点是：

- 最大化复用现有 `workspaceId` 权限桶
- 最大化复用现有 `workflowId` realtime 房间隔离
- 不需要第一版就把文件、知识库、凭证、文件夹树全部改成 team 级别
- 能最快落出“团队私有草稿 + 团队公开主线”的最小可用版本

## 二、当前仓库现状判断

下面这些现状决定了第一版不能粗暴上“一个 workspace 放多个 team”。

### 2.1 工作流天然是 `workspace` 级资源

当前 `workflow` 主表定义在：

- `packages/db/schema.ts`

关键字段包括：

- `workflow.workspaceId`
- `workflow.userId`
- `workflow.isDeployed`
- `workflow.deployedAt`
- `workflow.locked`
- `workflow.archivedAt`

说明现有工作流本质上是挂在 `workspace` 下，而不是挂在 `organization` 或更细粒度 team 下。

### 2.2 工作流权限今天是 `workspace` 级权限

当前工作流授权入口在：

- `packages/workflow-authz/src/index.ts`

关键函数：

- `getActiveWorkflowContext(workflowId)`
- `authorizeWorkflowByWorkspacePermission({ workflowId, userId, action })`

当前逻辑是：

- 先根据 `workflowId` 找到 `workflow.workspaceId`
- 再检查用户是否拥有这个 `workspace` 的 `read / write / admin` 权限

也就是说，今天系统并没有 team 级工作流授权模型。

### 2.3 Realtime 协作天然按 `workflowId` 隔离

当前协作入口主要在：

- `apps/sim/hooks/use-collaborative-workflow.ts`
- `apps/realtime/src/handlers/workflow.ts`
- `apps/realtime/src/middleware/permissions.ts`

实际协作链路是：

- 前端进入某个 `workflowId`
- Realtime 服务执行 `join-workflow`
- 服务端校验 `verifyWorkflowAccess(userId, workflowId)`
- 通过后把这个用户加入 `workflowId` 对应的房间

这说明：

- 当前协作隔离单位其实已经足够清晰，就是 `workflowId`
- 只要把“谁能访问这个 workflow”定义清楚，realtime 主体不需要重写

### 2.4 已经存在版本化与发布相关能力

当前数据库里已经有：

- `workflow_deployment_version`

对应代码链路在：

- `packages/db/schema.ts`
- `apps/sim/app/api/workflows/[id]/deploy/route.ts`
- `apps/sim/app/api/workflows/[id]/deployments/**`

这说明仓库本身已经有“工作流版本快照”和“部署版本”的基础概念，后续做“发布主线”时可以复用思路，而不必从零发明一套版本系统。

### 2.5 为什么不推荐第一版做“一个 workspace 多个 team”

如果在第一版直接让一个 `workspace` 容纳多个 team，则至少会牵动下面这些面：

- `workflow` 需要增加 `teamId`
- `workflowFolder` 需要增加 `teamId`
- 工作流列表接口需要按 `teamId` 过滤
- 文件夹树需要按 `teamId` 过滤
- `authorizeWorkflowByWorkspacePermission` 要升级成 `workspace + team` 双层授权
- `verifyWorkflowAccess` 要同步升级
- 文件、知识库、凭证是否也 team 隔离，必须同时做明确规则

这不是一个局部改动，而是把整个工作空间模型重切一遍，风险过高，不适合作为第一阶段方案。

## 三、术语定义

为了后续产品、设计、前端、后端对齐，建议固定下面几个术语。

### 3.1 工作组

`workgroup`

含义：

- 更高层的协作分组
- 一个工作组下面可以有多个团队
- 跨工作组之间默认隔离

### 3.2 团队工作空间

`workspace`

含义：

- 继续沿用现有技术模型
- 产品语义上代表一个团队的工作空间
- 团队成员共享其中的草稿与主线工作流

### 3.3 草稿轨

`draft track`

含义：

- 团队内部私有协作画布
- 可以实时协作、Copilot 改图、运行、调试
- 仅本团队成员可访问

### 3.4 主线轨

`published track`

含义：

- 团队对外展示的已发布画布
- 由草稿轨发布而来
- 对被授权的其他工作组只读可见

### 3.5 发布

`publish`

第一版定义：

- 将整张草稿工作流复制或覆盖到主线工作流
- 不做节点簇局部合并

## 四、推荐数据模型

### 4.1 新增 `workgroup` 表

建议新增：

- `id`
- `organizationId`
- `name`
- `slug`
- `description`
- `createdAt`
- `updatedAt`

用途：

- 给多个团队工作空间提供更高层归类
- 为“哪些工作组可以查看已发布主线”提供目标实体

### 4.2 在 `workspace` 上增加 `workgroupId`

在现有 `workspace` 表上增加：

- `workgroupId`

含义：

- 一个团队工作空间属于某个工作组

这样可以保持：

- 工作空间依旧是当前权限、文件、知识库、凭证的主隔离单元
- 但产品侧已经具备“团队属于哪个工作组”的表达能力

### 4.3 在 `workflow` 上增加轨道字段

建议在 `workflow` 表新增：

- `track`: `draft | published`
- `sourceWorkflowId`: 可为空，主线工作流指向源草稿工作流
- `publishedAt`: 可为空
- `publishedBy`: 可为空

建议约束：

- 同一个团队工作空间内，一套逻辑画布只允许一对 `draft/published`
- `published` workflow 必须有 `sourceWorkflowId`

第一版可以不引入“逻辑画布”总表，直接用 `sourceWorkflowId` 建立关联，先求简单。

### 4.4 可选新增 `workflow_publication_scope` 表

如果要支持“仅部分工作组可查看主线”，建议新增：

- `id`
- `workflowId`
- `viewerWorkgroupId`
- `createdAt`
- `createdBy`

含义：

- 某个 `published workflow` 允许哪些 `workgroup` 查看

如果第一版希望更简单，也可以先只支持：

- 同组织内所有工作组都可查看主线

那就可以先把可见性挂成 `workflow.visibility = team_only | org_workgroups`，后面再升级成明细表。

### 4.5 为什么不建议第一版单独建 `team` 表

从纯业务建模角度看，最完整的结构应该是：

- `organization`
- `workgroup`
- `team`
- `workspace`
- `workflow`

但当前仓库里 `workspace` 本身已经承担了团队级容器职责：

- 持有工作流
- 持有文件
- 持有知识库
- 持有凭证
- 持有权限

所以第一版再单独补一个 `team` 表，只会增加一层抽象映射，而不直接解决工程问题。第一版更稳的做法是：

- 先把 `workspace` 解释为团队工作空间
- 后续如果要把“团队”和“资源容器”真正拆开，再演进

## 五、权限设计

### 5.1 草稿轨权限

草稿轨沿用现有工作空间权限即可：

- `workspace admin` 可管理草稿与发布
- `workspace write` 可编辑草稿
- `workspace read` 可查看草稿，是否允许进入协作只读模式可单独定

默认规则：

- 草稿轨只对当前团队工作空间成员可见
- 其他团队、其他工作组都不可见

### 5.2 主线轨权限

主线轨分两类用户：

- 本团队成员
- 被授权查看的其他工作组成员

建议规则：

- 本团队成员：`admin/write/read` 按现有工作空间权限工作
- 外部工作组成员：统一只读，不允许编辑，不允许发布，不允许进入可写协作

### 5.3 服务端授权入口改造建议

当前入口：

- `authorizeWorkflowByWorkspacePermission`
- `verifyWorkflowAccess`

建议演进成两层：

1. 先保留现有 `workspace` 鉴权作为主判断
2. 再对 `workflow.track` 和 `publication scope` 做附加判断

也就是说：

- 对 `draft` workflow：必须是本 workspace 成员
- 对 `published` workflow：
  - 本 workspace 成员正常通过
  - 非本 workspace 成员，如果所属 `workgroup` 在可见范围内，则给只读权限

### 5.4 Realtime 权限建议

Realtime 不建议大改房间模型，只改权限判定结果：

- 草稿轨：允许进入实时协作房间
- 主线轨：
  - 本团队内部如果要协作查看，可进房间但根据 role 决定是否只读
  - 外部工作组默认只读查看，不进入可写协作房间更稳

更稳的第一版建议是：

- 外部工作组查看主线时，直接走 HTTP 只读载入
- 不接入 realtime 编辑链路

这样可以避免“被授权查看者进入 Socket 房间”的额外复杂度。

## 六、工作流模型设计

### 6.1 一套团队画布对应两张工作流

第一版推荐一套业务画布用两张 `workflow` 表示：

- 一张 `draft`
- 一张 `published`

好处：

- 每张画布都是一个完整独立 `workflowId`
- 现有编辑、执行、协作、状态存储全部可复用
- `draft` 和 `published` 的切换逻辑简单

### 6.2 发布动作的本质

第一版 `publish` 不是 merge，而是：

- 读取草稿 workflow 当前完整状态
- 将状态快照写入主线 workflow
- 更新主线 workflow 的 `publishedAt`、`publishedBy`

必要时可以保留发布历史：

- 每次发布都写入一条发布版本记录

### 6.3 与现有 `deploy` 的关系

现有 `deploy` 语义是“执行部署 / 对外 API 部署”。

新的 `publish` 语义是“团队主线内容发布”。

这两者不能混用，必须分开：

- `publish` 解决协作流转问题
- `deploy` 解决执行发布问题

建议：

- 保留现有 `/deploy` 语义不变
- 新增独立 `/publish` 语义

### 6.4 第一版不做的事情

为了控制范围，第一版明确不做：

- 节点簇提交到主线
- 局部 merge
- 多人同时编辑同一张主线并做冲突合并
- 发布态与草稿态的自动双向同步
- 跨工作组的实时共同编辑

## 七、API 改造方案

### 7.1 现有相关接口

当前主要工作流接口位于：

- `apps/sim/app/api/workflows/route.ts`
- `apps/sim/app/api/workflows/[id]/route.ts`
- `apps/sim/app/api/workflows/[id]/state/route.ts`
- `apps/sim/app/api/workflows/[id]/execute/route.ts`
- `apps/sim/app/api/workflows/[id]/deploy/route.ts`

这些接口今天默认都把工作流理解为“普通 workspace 工作流”，没有轨道概念。

### 7.2 建议新增的接口能力

#### A. 查询团队双轨工作流

建议新增：

- `GET /api/workspaces/:workspaceId/workflow-tracks`

返回：

- 草稿工作流列表
- 主线工作流列表
- 每条主线对应的源草稿信息
- 发布状态摘要

#### B. 创建草稿画布

建议新增或扩展现有创建接口：

- `POST /api/workflows`

新增字段：

- `track`
- `sourceWorkflowId`

默认：

- 普通新建走 `track = draft`

#### C. 发布草稿到主线

建议新增：

- `POST /api/workflows/:id/publish`

行为：

- `:id` 必须是 `draft workflow`
- 如果没有主线 workflow，则创建
- 如果已有主线 workflow，则整体覆盖
- 记录发布时间、发布人、发布版本

#### D. 查看发布信息

建议新增：

- `GET /api/workflows/:id/publication`

返回：

- 当前 track
- 对应源 workflow 或主线 workflow
- 最近发布时间
- 最近发布人
- 可见范围

#### E. 配置主线可见范围

建议新增：

- `PATCH /api/workflows/:id/publication-scope`

行为：

- 配置哪些 `workgroup` 可查看

#### F. 跨工作组查看主线

建议新增：

- `GET /api/workgroups/:workgroupId/published-workflows`

返回：

- 当前工作组有权查看的外部团队主线工作流列表

### 7.3 合同层建议

当前仓库的 HTTP 边界是合同先行模式，合同放在：

- `apps/sim/lib/api/contracts/**`

因此这批新接口也应先补合同：

- `workflow-tracks`
- `publish`
- `publication`
- `publication-scope`
- `published-workflows`

路线应保持为：

- contract
- route
- query hook
- component

## 八、前端与画布交互方案

### 8.1 页面结构建议

当前核心画布页入口仍然是：

- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/workflow.tsx`

第一版不建议新建完全不同的编辑器，而是在现有工作流页面外层增加轨道切换壳层。

建议交互：

- 左侧或顶部增加轨道切换
  - `团队草稿`
  - `团队主线`
- 进入草稿轨时：
  - 允许编辑
  - 允许 Copilot 改图
  - 允许实时协作
  - 允许运行调试
- 进入主线轨时：
  - 默认只读查看
  - 团队成员可执行“从草稿发布覆盖”

### 8.2 草稿轨体验

草稿轨是团队真正工作的主界面，应保留：

- 当前画布编辑
- 当前 inline 节点输入
- 当前右侧高级设置
- 当前 Copilot 改图
- 当前 execute / debug / log / pause / resume
- 当前多人协作

也就是说，草稿轨本质上就是现有编辑器，只是语义上变成“团队私有开发面”。

### 8.3 主线轨体验

主线轨是结果展示面，不是主要编辑面。

建议第一版主线轨能力：

- 只读查看工作流结构
- 查看节点内容与配置摘要
- 查看最近发布时间和发布来源
- 本团队管理员可点击“用当前草稿覆盖主线”

不建议第一版在主线轨上继续开放正常编辑，否则双轨边界会重新混乱。

### 8.4 工作流列表页建议

工作流列表页要能明确区分：

- 草稿
- 主线

建议字段展示：

- 名称
- 轨道类型
- 来源关系
- 最近更新时间
- 最近发布时间
- 发布状态

### 8.5 跨工作组查看入口建议

建议单独提供“主线浏览”视图，不要让外部用户直接进入对方团队的 workspace 主导航。

更合理的产品入口是：

- `工作组视角 -> 可查看的团队主线列表`

而不是：

- 进入别人的团队工作空间再找某张 workflow

## 九、实施顺序建议

### 9.1 第一阶段：数据与权限打底

目标：

- 加 `workgroup`
- 给 `workspace` 补 `workgroupId`
- 给 `workflow` 补 `track` 与发布元数据
- 打通服务端工作流可见性判断

完成标准：

- 后端能区分 `draft` 和 `published`
- 草稿只能团队内部访问
- 主线可按规则被外部工作组读取

### 9.2 第二阶段：发布链路

目标：

- 实现 `publish` API
- 实现草稿到主线的整图复制
- 记录发布元数据与发布历史

完成标准：

- 团队管理员能把一张草稿发布为主线
- 重复发布时能覆盖主线

### 9.3 第三阶段：前端双轨界面

目标：

- 增加轨道切换
- 列表页区分草稿和主线
- 主线页只读化
- 补上发布按钮和状态展示

完成标准：

- 用户能明显感知“团队草稿”和“团队主线”是两条不同轨道

### 9.4 第四阶段：跨工作组浏览

目标：

- 增加主线浏览页
- 仅展示被授权可见的主线

完成标准：

- 其他工作组能查看主线，但不能进入对方草稿面

### 9.5 第五阶段：后续高级能力

这一阶段再考虑：

- 节点簇提交
- 局部 merge
- 发布差异对比
- 审批流
- 主线历史回滚

## 十、风险与注意事项

### 10.1 不要混淆 `publish` 和 `deploy`

这两个概念必须明确隔离：

- `publish` 是团队协作语义
- `deploy` 是执行与对外接口语义

如果混在一起，后面权限和 UI 都会变乱。

### 10.2 不要第一版就碰所有资源的 team 化

第一版最容易失控的地方，是顺手把下面这些一起改成 team 级：

- files
- knowledge
- credentials
- folders
- notifications

建议先保持这些资源继续挂在团队工作空间下，不要提前做第二次模型切换。

### 10.3 主线建议第一版只读

如果第一版允许多人直接改主线，就会立刻引入：

- 主线与草稿的关系不清
- 谁是唯一真理源不清
- 发布动作失去意义

所以第一版必须坚持：

- 草稿可编辑
- 主线只读
- 主线由草稿覆盖生成

### 10.4 外部工作组查看建议先走 HTTP 只读

如果外部查看者也接入 realtime 房间，会带来额外复杂度：

- Socket 权限模型要细分
- 只读 presence 语义要补
- 房间人数和协作状态可能产生歧义

所以第一版建议：

- 外部查看者不进可写协作链路
- 直接载入只读主线状态即可

## 十一、验收口径

这一方案完成后的第一版验收，不是看“有没有建完全部组织结构”，而是看下面这条链路是否真的跑通：

1. 创建一个团队工作空间
2. 给它关联到某个工作组
3. 在该团队工作空间里创建草稿 workflow
4. 团队成员共同编辑草稿画布
5. 团队成员运行和调试草稿工作流
6. 管理员把草稿发布为主线
7. 其他工作组成员能查看主线
8. 其他工作组成员看不到草稿
9. 其他工作组成员不能编辑主线

只要这条链路成立，这个阶段就算成功。

## 十二、建议的后续实施方式

如果按工程推进顺序，推荐拆成下面几批提交：

1. 数据库迁移与 schema 扩展
2. 工作流权限服务改造
3. 发布 API 与发布服务
4. 工作流列表与轨道切换 UI
5. 主线浏览页与跨工作组查看入口

这也是后续最适合按 commit 逐步推进的顺序。

## 十三、最终建议

对于当前仓库，最稳且性价比最高的方案不是“一步到位做完整 team 平台”，而是：

- 把 `workspace` 直接产品化为团队工作空间
- 增加 `workgroup` 作为更高层分组
- 把一套团队画布拆成 `draft / published` 双轨
- 用“整图发布”先跑通草稿到主线的协作流转

这条路径改动面可控、和现有代码最贴合，也最适合作为 TapNow 化改造的下一阶段主线。
