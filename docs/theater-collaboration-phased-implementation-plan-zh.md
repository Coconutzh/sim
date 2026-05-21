# 剧场项目多团队画布协作系统分阶段实施方案

> 本文档用于把前期讨论沉淀成可直接交给工程师执行的规格。它同时覆盖产品目标、当前代码基线、后端隔离方案、前端交互细节、管理员差分、10 个 Agent 接入、每阶段要做什么、每阶段验收标准与建议提交粒度。

## 0. 一句话目标

把当前 Sim 的 `workspace/workflow` 协作能力，改造成面向大型演艺/剧场项目的多工种、多团队、多画布协作系统：

- 用户登录后属于某个组织/项目下的某个工种团队。
- 普通用户不再直接创建 `workspace`，`workspace` 退为内部画布容器。
- 每个用户有只能自己看到和编辑的个人草稿画布。
- 每个团队有团队成员共同可见、共同编辑的团队画布。
- 团队可以把成熟方案发布成展示画布，进入全局状态树，广播给其他团队只读查看。
- Copilot 根据当前用户所处工种团队接入对应 Agent/Skill，形成工种专属协作助手。
- 管理员和普通员工界面明显差分：管理员负责团队、成员、发布、Agent Skill、全局项目配置；普通员工只聚焦个人草稿、团队协作、展示查看。

## 1. 当前讨论已经确定的核心决策

### 1.1 领域模型命名

| 概念 | 最终语义 | 对当前 Sim 的关系 |
| --- | --- | --- |
| `organization` | 项目/组织容器 | 沿用现有组织体系 |
| `discipline` | 工种，例如舞美、视觉、灯光音响 | 新增一级业务分类 |
| `workgroup` | 某个工种下面的具体团队 | 承载成员、管理员、团队画布 |
| `workspace` | 内部画布容器 | 不再作为普通用户主入口概念 |
| `workflow` | 画布内容/节点图 | 沿用现有 workflow 作为画布数据 |
| `personal canvas` | 个人草稿画布 | owner-only 私有画布 |
| `team canvas` | 团队共同工作画布 | 团队成员可见可编辑 |
| `showcase canvas` | 展示画布/发布方案 | 已发布快照，只读、跨团队可见 |
| `global state tree` | 全局状态树 | 展示画布发布后的项目级方案树 |
| `agent profile` | 工种 Agent 配置 | Copilot 根据当前工种选择 |

### 1.2 工种与 Agent 数量

讨论中列出的工种是 11 个展示工种，但最终 Agent 是 10 个。原因是“项目总控/PMO”不单独做第 11 个 Agent，而是复用/映射到“总导演”类全局统筹 Agent。

#### 11 个工种

| 工种 | 职责摘要 | 默认 Agent 映射 |
| --- | --- | --- |
| 总导演 | 整体创意方向、审核各岗位方案、全局进度和效果预演 | `chief_director` |
| 秀演/编导 | 演员动线、节目编排、舞台走位、装置移动节点 | `show_director` |
| 舞美师 | 舞台概念、舞台模型、空间布局、舞美资产提交 | `stage_designer` |
| 视觉团队 | 分镜、海报、AIGC 视频素材、异形屏适配、视觉预览 | `visual_team` |
| 导播/摄影团队 | 摄像机机位、拍摄盲区、导播脚本 | `broadcast_camera` |
| 灯光/音响团队 | 灯具 Cue 点、声场布局、演艺技术参数 | `lighting_audio` |
| 特效师 | 激光、机械装置、特效触发时序、装置运动对齐 | `special_effects` |
| 音乐团队 | 音乐风格、曲风匹配、制作进度、版权合规 | `music_team` |
| 道具/服装团队 | 道具、服装、置景与创意风格匹配 | `props_costume` |
| 制片团队 | 人员档期、通告单、节目排期表、流程文件 | `production_team` |
| 项目总控/PMO | 任务调度、依赖管理、风险预警、项目健康度 | `chief_director` |

#### 10 个 Agent

1. `chief_director`
2. `show_director`
3. `stage_designer`
4. `visual_team`
5. `broadcast_camera`
6. `lighting_audio`
7. `special_effects`
8. `music_team`
9. `props_costume`
10. `production_team`

### 1.3 主界面形态

最终决策不是只选“卡片入口”或只选“左侧三段导航”，而是组合：

- 首页主区域使用大卡片入口，让用户一眼看到“个人草稿画布 / 团队画布 / 展示画布”三类核心任务。
- 页面左侧保留持久三段导航，便于用户在深层页面里快速切换。
- 用户登录后，如果已经属于某个工种团队，主操作界面必须展示：
  - 当前组织/项目；
  - 当前工种；
  - 当前团队；
  - 当前角色：普通成员、团队管理员、项目管理员；
  - 当前 Agent；
  - 是否有活跃团队；
  - 快捷切换团队入口。
- 普通用户不应该再看到“新增 workspace”作为主操作路径。

### 1.4 三类画布展示方式

推荐设计为“可单独进入 + 可分屏组合”：

- 个人草稿画布：单独进入，适合个人构思、试验节点、未成熟方案。
- 团队画布：单独进入，适合团队内共同编辑，右上角显示正在团队画布中的成员头像。
- 展示画布：单独进入，适合按工种/团队筛选并查看已发布方案，只读。
- 分屏工作台：支持同时打开两个画布，例如左边个人草稿，右边团队画布，允许把个人草稿中的成熟节点复制到团队画布。

### 1.5 管理员界面差分

管理员必须和普通员工做明显区分，但不要让管理员默认突破个人隐私。

#### 普通成员

- 查看自己的个人草稿画布。
- 编辑自己的个人草稿画布。
- 查看并编辑自己所在团队的团队画布。
- 查看有权限的展示画布。
- 切换自己的活跃团队。
- 使用与当前工种匹配的 Copilot Agent。
- 不能新增 workspace。
- 不能管理团队成员。
- 不能查看其他人的个人草稿。

#### 团队管理员

在普通成员能力基础上增加：

- 查看团队成员列表。
- 邀请/移除团队成员。
- 设置成员角色，例如 member/admin。
- 查看团队画布健康状态。
- 发起团队画布发布。
- 管理本团队展示画布版本。
- 配置本团队 Agent Skill 绑定。
- 查看团队相关协作日志。
- 不应默认查看成员个人草稿画布。

#### 项目/组织管理员

在更高层增加：

- 管理工种列表。
- 管理工种下多个团队。
- 将用户拉入团队。
- 分配用户工种和团队。
- 维护项目级全局状态树。
- 管理 Agent 模板和全局 Skill 策略。
- 设置跨团队展示画布可见范围。
- 查看审计日志、权限矩阵、项目健康度。
- 不应默认读取个人草稿；如未来需要“接管模式”，必须单独设计审批和审计，v1 不做。

## 2. 当前代码基线

当前仓库已经有一批协作基础能力提交。后续工程师应以当前仓库代码为准，不要从空白系统重新做。

### 2.1 已提交的相关 commit

| Commit | 说明 |
| --- | --- |
| `d54d11236` | Add team canvas collaboration foundation |
| `96781c0e5` | Test collaboration discipline definitions |
| `2f95e1818` | Add team management workbench page |

### 2.2 已实现的后端基础

| 文件 | 已实现内容 |
| --- | --- |
| `packages/db/schema.ts` | 新增或扩展协作相关表结构 |
| `packages/db/migrations/0206_cheerful_lilandra.sql` | 新增迁移，包含工种、Agent、团队画布、个人画布、发布版本等结构 |
| `apps/sim/lib/collaboration/definitions.ts` | 工种、Agent、映射关系常量 |
| `apps/sim/lib/collaboration/service.ts` | 团队成员、个人/团队画布、发布版本、展示树、Copilot Agent 解析等核心服务 |
| `apps/sim/lib/api/contracts/collaboration.ts` | 协作相关 API 合约 |
| `apps/sim/lib/api/contracts/index.ts` | 导出协作合约 |
| `apps/realtime/src/middleware/permissions.ts` | Realtime 权限收紧，read 角色不再允许位置更新 |
| `apps/sim/lib/copilot/chat/workspace-context.ts` | Copilot 注入当前 Agent 上下文 |

### 2.3 已实现的数据库概念

当前已具备以下核心表/字段基础：

- `discipline`
- `agent_profile`
- `workgroup_member`
- `personal_canvas_workspace`
- `workflow_publication_version`
- `agent_skill_binding`
- `settings.activeWorkgroupId`
- `workgroup.disciplineId`
- `workgroup.teamWorkspaceId`

### 2.4 已实现的 API 路由基础

当前已有或扩展了以下路线：

- `GET /api/disciplines`
- `GET /api/agents/profiles`
- `GET /api/copilot/agent-profile`
- `GET /api/me/workgroups`
- `PUT /api/me/active-workgroup`
- `GET /api/organizations/[organizationId]/workgroups`
- `POST /api/organizations/[organizationId]/workgroups`
- `GET /api/workgroups/[workgroupId]/members`
- `POST /api/workgroups/[workgroupId]/members`
- `DELETE /api/workgroups/[workgroupId]/members/[userId]`
- `POST /api/workgroups/[workgroupId]/personal-workspace`
- `POST /api/workgroups/[workgroupId]/team-workspace`
- `GET /api/publications/[publicationVersionId]`
- `GET /api/publications/[publicationVersionId]/tree`
- `POST /api/workflows/[id]/copy-selection`
- 已扩展 workflow 发布路线。
- 已扩展 published workflows 查询路线。

### 2.5 已实现的前端基础

| 文件/路径 | 已实现内容 |
| --- | --- |
| `apps/sim/hooks/queries/collaboration.ts` | 协作 API React Query hooks |
| `apps/sim/app/workbench/page.tsx` | 新工作台首页 |
| `apps/sim/app/workbench/personal/page.tsx` | 个人草稿入口 |
| `apps/sim/app/workbench/team/page.tsx` | 团队画布入口 |
| `apps/sim/app/workbench/showcase/page.tsx` | 展示画布列表入口 |
| `apps/sim/app/workbench/showcase/[publicationVersionId]/page.tsx` | 展示画布详情入口 |
| `apps/sim/app/workbench/team-management/page.tsx` | 团队管理工作台基础页 |
| `apps/sim/app/workspace/page.tsx` | 已重定向到 `/workbench` |

### 2.6 已运行过的验证

已验证：

```powershell
bun run check:api-validation
bun test apps/sim/lib/collaboration/definitions.test.ts
```

已知情况：

- `bun run check:api-validation` 已通过。
- 工种/Agent 定义测试已通过。
- `bun run type-check` 存在历史遗留错误；之前过滤检查未看到明显新增协作/工作台相关错误。后续阶段应逐步补足局部验证和回归验证。

## 3. 最终权限隔离规格

### 3.1 个人草稿画布

| 动作 | 权限 |
| --- | --- |
| 创建 | 当前用户本人，在当前活跃团队上下文中创建 |
| 查看 | 仅 owner 本人 |
| 修改 | 仅 owner 本人 |
| 删除/归档 | 仅 owner 本人；是否允许管理员代归档留到后续 |
| 复制节点到团队画布 | owner 本人可主动复制 |
| 发布到展示画布 | 不能直接发布；必须先进入团队画布或团队发布流程 |
| 管理员查看 | v1 不允许 |
| 其他团队查看 | 不允许 |
| 搜索索引 | 不应进入跨用户可见索引 |

### 3.2 团队画布

| 动作 | 权限 |
| --- | --- |
| 创建 | 系统为 workgroup 创建，或团队管理员触发创建 |
| 查看 | workgroup 成员 |
| 修改 | workgroup 成员 |
| 发布 | 团队管理员，或团队内有发布权限的成员 |
| Presence 头像 | 仅显示当前团队画布房间内成员 |
| 其他团队查看 | 不允许 |
| 其他团队修改 | 不允许 |
| 项目管理员查看 | 可配置；v1 推荐允许项目管理员查看团队画布，但不能查看个人草稿 |

### 3.3 展示画布

| 动作 | 权限 |
| --- | --- |
| 创建 | 团队画布发布生成 |
| 查看 | 发布可见范围内的团队成员、项目管理员 |
| 修改 | 不允许直接修改 |
| 再编辑 | 必须复制/回流到个人或团队画布后编辑 |
| 评论/标注 | 可作为后续功能；默认不改变画布内容 |
| 全局状态树 | 展示已发布版本、依赖、状态、所属团队 |
| 跨团队筛选 | 支持按工种、团队、状态、版本筛选 |

### 3.4 Realtime 权限原则

- 个人草稿房间只能 owner 加入。
- 团队画布房间只能 workgroup 成员加入。
- 展示画布房间默认只读，不能发送位置、节点、边、块配置等修改类 operation。
- `read` 权限不能执行任何 position update 或 mutation。
- 服务端必须以数据库权限为准，不能信任客户端传入的 canvas mode。
- Presence 也要按房间隔离，不能泄露其他团队正在编辑的信息。

## 4. 最终前端信息架构

### 4.1 登录后的主路径

用户登录后进入：

```text
/workbench
```

页面需要包含：

- 顶部当前身份条：
  - 项目/组织；
  - 工种；
  - 团队；
  - 角色；
  - 当前 Agent；
  - 团队切换；
  - 若没有团队，显示引导和联系管理员。
- 左侧三段导航：
  - 个人草稿；
  - 团队画布；
  - 展示画布；
  - 管理入口根据角色显示。
- 主区域卡片入口：
  - 个人草稿画布卡片；
  - 团队画布卡片；
  - 展示画布卡片；
  - 最近打开；
  - 待处理发布/审核；
  - 当前 Agent 建议。

### 4.2 为什么采用“卡片入口 + 左侧三段导航”

只用卡片入口的问题：

- 深层页面中切换成本高。
- 对频繁协作用户不够高效。
- 管理员入口会变得分散。

只用左侧导航的问题：

- 首页不够直观。
- 新用户不知道三类画布差异。
- 不利于展示当前团队状态和下一步行动。

组合方案的优势：

- 首页卡片负责解释任务和引导。
- 左侧导航负责高频切换。
- 既适合新用户，也适合熟练用户。

### 4.3 画布内统一上下文头

所有画布页面应在右上或顶部显式显示 `CanvasModeHeader`：

| 模式 | 显示内容 | 可操作 |
| --- | --- | --- |
| 个人草稿 | “个人草稿：仅你可见” | 复制到团队画布、重命名、归档 |
| 团队画布 | “团队画布：团队成员共同编辑” | 发布、成员头像、打开分屏 |
| 展示画布 | “展示画布：只读发布版本” | 查看版本树、复制为草稿、筛选团队 |

团队画布右上角还要显示 presence：

- 当前正在团队画布界面的成员头像；
- 鼠标悬停显示姓名、角色、工种；
- 只显示同团队同画布房间成员；
- 不显示其他团队成员；
- 如果用户只打开展示画布，不应出现在团队画布编辑 presence 中。

### 4.4 分屏设计

推荐支持以下组合：

| 左侧 | 右侧 | 场景 |
| --- | --- | --- |
| 个人草稿 | 团队画布 | 把个人成熟节点复制到团队 |
| 团队画布 | 展示画布 | 对照已发布方案修改团队方案 |
| 展示画布 | 个人草稿 | 从其他团队发布方案学习并复制为个人草稿 |
| 团队画布 | 团队画布 | 项目管理员/总导演对比两个团队方案，v1 可后置 |

分屏第一阶段不建议做复杂拖拽跨画布直接移动，先做更稳妥的“选择节点 -> 复制到目标画布”：

1. 用户在源画布选中节点和边。
2. 点击“复制到团队画布”或“复制到右侧画布”。
3. 前端调用 `POST /api/workflows/[id]/copy-selection`。
4. 后端验证源画布读权限和目标画布写权限。
5. 后端复制节点、边、块数据并生成新的 ID。
6. 目标画布刷新并在可视区域放置复制内容。

## 5. 后端总体实现方案

### 5.1 鉴权入口

所有协作权限判断必须收敛到服务层或共享授权包，而不是散落在页面或 route 中。

推荐分层：

```text
API route
  -> auth session
  -> parseRequest(contract)
  -> collaboration service / workflow authz
  -> db transaction
  -> response contract

Realtime server
  -> socket auth
  -> room join permission
  -> operation permission
  -> persist/broadcast
```

### 5.2 API 合约要求

遵守当前仓库规范：

- 边界 HTTP request/response schema 放在 `apps/sim/lib/api/contracts/**`。
- Route 不直接 `import { z } from 'zod'`。
- Route 使用 `parseRequest(contract, request, context)`。
- React Query hook 使用 `requestJson(contract, input)`。
- 客户端不写临时 wire type。
- 日志使用 `createLogger`。
- ID 使用 `generateId()` 或 `generateShortId()`。

### 5.3 服务层建议拆分

当前已有 `apps/sim/lib/collaboration/service.ts`，后续随着复杂度增加，可拆成以下文件：

| 文件 | 职责 |
| --- | --- |
| `apps/sim/lib/collaboration/service.ts` | 对外聚合入口 |
| `apps/sim/lib/collaboration/authz.ts` | 个人/团队/展示画布权限判断 |
| `apps/sim/lib/collaboration/publications.ts` | 发布、版本、全局状态树 |
| `apps/sim/lib/collaboration/canvas-copy.ts` | 跨画布复制 |
| `apps/sim/lib/collaboration/agents.ts` | Agent profile 与 skill 绑定 |
| `apps/sim/lib/collaboration/admin.ts` | 团队管理、项目管理 |

是否拆分取决于文件长度和职责边界；如果当前 service 还可读，可以先不强拆，但后续 phase 不应继续无限堆大。

### 5.4 数据库约束建议

需要检查并逐步补齐：

- `discipline.code` 唯一。
- `agent_profile.code` 唯一。
- `workgroup.organizationId + workgroup.name` 唯一或软唯一。
- `workgroup_member.workgroupId + workgroup_member.userId` 唯一。
- `personal_canvas_workspace.userId + personal_canvas_workspace.workgroupId` 唯一。
- `workflow_publication_version.workflowId + version` 唯一。
- `workgroup.teamWorkspaceId` 指向团队画布 workspace。
- 删除团队成员时不要删除用户个人草稿，只解除团队关系。
- 删除/归档团队时要明确团队画布、发布版本、成员关系如何处理。

### 5.5 发布快照原则

展示画布不应直接引用可继续变动的团队画布 live 数据，而应发布为 snapshot/version：

- 发布时读取团队画布当前状态。
- 清洗掉不应公开的字段，例如临时 UI 状态、个人凭证、敏感环境变量、未授权文件引用。
- 写入 `workflow_publication_version`。
- 更新全局状态树。
- 触发通知/广播。
- 展示页读取发布版本，不读取 live 团队画布。

## 6. 分阶段实施计划总览

| 阶段 | 名称 | 目标 | 建议 commit |
| --- | --- | --- | --- |
| Phase 0 | 当前基线确认 | 确认已实现基础和风险 | 已完成多个 commit |
| Phase 1 | 基础稳定化 | 补测试、补约束、确认权限服务边界 | `Stabilize collaboration foundation` |
| Phase 2 | 画布上下文头 | 明确三类画布 UI 状态和只读提示 | `Add canvas mode context header` |
| Phase 3 | 展示画布只读渲染 | 真正禁止展示画布编辑 | `Add read-only showcase canvas renderer` |
| Phase 4 | 权限隔离加固 | 后端、Realtime、查询全面按模式隔离 | `Harden canvas authorization boundaries` |
| Phase 5 | 发布与全局状态树 | 团队方案发布、版本、广播、状态树 | `Implement publication state tree workflow` |
| Phase 6 | 跨画布复制 | 支持个人节点复制到团队画布 | `Implement cross-canvas selection copy` |
| Phase 7 | 分屏工作台 | 同时查看/操作两个画布 | `Add split view canvas workbench` |
| Phase 8 | 10 个 Agent 深度接入 | Copilot 按工种 Skill 化 | `Wire discipline agents into Copilot` |
| Phase 9 | 团队管理员闭环 | 成员、角色、团队发布管理 | `Complete team admin workbench` |
| Phase 10 | 项目管理员中心 | 工种、团队、全局树、模板管理 | `Add project collaboration admin center` |
| Phase 11 | Legacy workspace 迁移 | 隐藏/迁移旧 workspace 入口 | `Migrate legacy workspace entrypoints` |
| Phase 12 | 测试、审计、发布 | 完整回归和上线方案 | `Add collaboration release hardening` |

## 7. Phase 0：当前基线确认

### 7.1 目标

把当前已完成的代码基线记录清楚，避免后续工程师重复实现已存在的基础能力。

### 7.2 已完成事项

- DB schema 已有工种、Agent、成员、个人画布、发布版本、Skill 绑定等基础结构。
- 协作 definitions 已有 11 工种和 10 Agent 映射。
- 协作 service 已有创建/查询/发布/Agent 解析基础逻辑。
- 协作 API 合约和路线已初步建立。
- 工作台页面、个人/团队/展示入口、团队管理页已有初版。
- Realtime 的 read 权限已经开始收紧。
- Copilot workspace context 已经开始注入 Agent 上下文。

### 7.3 需要复核

- 当前迁移是否已在本地和目标环境执行。
- 当前 seed 数据是否幂等。
- 已有 route 是否全部满足 API contract 规范。
- 已有 service 是否存在权限漏判。
- 旧 workspace UI 是否仍有普通用户可见的新增入口。

### 7.4 验收标准

- `git log --oneline` 能看到协作基础 commit。
- `bun run check:api-validation` 通过。
- `bun test apps/sim/lib/collaboration/definitions.test.ts` 通过。
- 工程师能根据本文档定位当前基础文件。

## 8. Phase 1：基础稳定化

### 8.1 目标

把已有协作基础从“可运行初版”稳定成“后续功能可信赖的基础设施”。

### 8.2 为什么先做

如果先做复杂 UI 或分屏，但后端权限、测试、约束不稳，后面会出现：

- 个人草稿泄露；
- 团队画布被非成员修改；
- 展示画布被编辑；
- 发布版本污染敏感字段；
- Copilot Agent 选错上下文。

### 8.3 后端任务

1. 审查 `apps/sim/lib/collaboration/service.ts`：
   - 每个 public function 明确输入、输出、权限假设；
   - 对外 route 调用前必须已经有 session；
   - 服务内部不要信任客户端传入的 role；
   - 所有工作组成员判断从 DB 查询。
2. 补齐基础权限 helper：
   - `canReadPersonalCanvas(userId, workspaceId)`；
   - `canWritePersonalCanvas(userId, workspaceId)`；
   - `canReadTeamCanvas(userId, workgroupId)`；
   - `canWriteTeamCanvas(userId, workgroupId)`；
   - `canReadPublication(userId, publicationVersionId)`；
   - `canPublishTeamCanvas(userId, workgroupId)`。
3. 检查 DB 唯一约束：
   - 对 workgroup member 去重；
   - 对个人画布一人一团队一草稿容器去重；
   - 对 discipline/agent code 去重。
4. 检查 publication sanitizer：
   - 敏感字段不能进入展示快照；
   - credentials、tokens、personal-only metadata 必须剔除；
   - 对未知字段采取白名单或明确黑名单策略。
5. 梳理 route 返回错误：
   - 401：未登录；
   - 403：已登录但无权限；
   - 404：资源不存在或不应泄露存在性；
   - 409：重复成员、重复团队等冲突。

### 8.4 前端任务

1. 对已有 `useCollaboration...` hooks 做一次 key factory 审核：
   - 有 `all`；
   - 有 `lists()`；
   - 有 `list(workgroupId)`；
   - 有 `details()`；
   - 有 `detail(id)`。
2. 所有 queryFn forward `signal`。
3. 所有 query 有明确 `staleTime`。
4. mutation 做目标化 invalidate，而不是粗暴全量 invalidate。
5. 工作台首页没有活跃团队时显示空状态：
   - “你还没有加入团队”；
   - “请联系项目管理员”；
   - 如果是项目管理员，显示“创建团队/邀请成员”入口。

### 8.5 测试任务

新增/补强：

```powershell
bun test apps/sim/lib/collaboration/definitions.test.ts
bun test apps/sim/lib/collaboration/service.test.ts
bun test apps/sim/lib/collaboration/snapshot-sanitizer.test.ts
```

建议覆盖：

- 11 工种存在。
- 10 Agent 存在。
- PMO 映射到 `chief_director`。
- 非 owner 不能读取个人草稿。
- 非团队成员不能读取团队画布。
- 团队成员可以读取/写团队画布。
- 展示画布可见范围正确。
- 发布快照不包含敏感字段。

### 8.6 验收标准

- 所有新增 collaboration 单元测试通过。
- API validation 通过。
- 权限 helper 有明确测试覆盖。
- 个人草稿/团队/展示三种模式在服务层有统一判断入口。

### 8.7 建议提交

```text
Stabilize collaboration foundation
```

## 9. Phase 2：画布上下文头与三类入口体验

### 9.1 目标

让用户进入任何画布后，都能马上知道自己在哪里、能做什么、不能做什么。

### 9.2 用户体验要求

#### 工作台首页

首页展示：

- 当前身份：
  - 项目；
  - 工种；
  - 团队；
  - 当前 Agent；
  - 角色；
  - 活跃团队切换器。
- 三张核心卡片：
  - 个人草稿画布；
  - 团队画布；
  - 展示画布。
- 角色相关卡片：
  - 团队管理员看到“团队管理”；
  - 项目管理员看到“项目管理”；
  - 普通成员看不到管理员入口。

#### 画布页头

新增或抽象组件：

```text
apps/sim/components/workbench/canvas-mode-header.tsx
```

显示字段：

- `canvasMode`: `personal | team | showcase`
- `organizationName`
- `disciplineName`
- `workgroupName`
- `userRole`
- `agentName`
- `visibilityText`
- `permissionText`
- `versionText`
- `presenceAvatars`

### 9.3 页面行为

#### 个人草稿页

- 标题：“个人草稿画布”
- 副标题：“仅你可见，其他团队成员和管理员默认不可见”
- 主 CTA：“打开个人草稿”
- 次 CTA：“复制到团队画布”
- 不显示团队 presence。

#### 团队画布页

- 标题：“团队画布”
- 副标题：“团队成员共同编辑”
- 显示成员 presence。
- 显示发布按钮，权限不够则 disabled 并说明。
- 显示分屏按钮。

#### 展示画布页

- 标题：“展示画布”
- 副标题：“已发布方案，只读查看”
- 支持筛选：
  - 工种；
  - 团队；
  - 版本；
  - 状态；
  - 更新时间。
- 详情页不能出现编辑按钮。

### 9.4 后端任务

如果当前 API 缺少 workbench summary，新增：

```http
GET /api/me/collaboration-context
```

返回：

- 当前用户；
- 当前组织；
- 当前 active workgroup；
- 用户所有 workgroups；
- 当前 Agent；
- 是否 team admin；
- 是否 project admin；
- 三类画布入口状态。

如果已有接口能组合出来，也可以先在前端组合，不强制新增 route；但如果页面发太多请求，应新增聚合接口。

### 9.5 前端任务

- 新增 `WorkbenchShell`：
  - 左侧导航；
  - 顶部身份条；
  - 管理入口按角色显示。
- 新增 `CanvasModeHeader`。
- 把现有 `/workbench/personal`、`/workbench/team`、`/workbench/showcase` 接入统一 header。
- 隐藏普通用户旧的 `workspace create` 入口。

### 9.6 测试任务

- 组件测试或页面级 smoke：
  - 普通成员不显示团队管理。
  - 团队管理员显示团队管理。
  - 无团队用户显示空状态。
  - 展示画布显示只读提示。

### 9.7 验收标准

- 用户进入 `/workbench` 能看到当前工种和团队。
- 普通用户不能从主操作界面新增 workspace。
- 三类画布入口清晰。
- 每个画布页都有明确模式提示。

### 9.8 建议提交

```text
Add canvas mode context header
```

## 10. Phase 3：展示画布只读渲染

### 10.1 目标

让展示画布真正成为只读发布版本，而不只是 UI 上写“只读”。

### 10.2 需要解决的问题

当前 workflow editor 天然偏编辑态。如果展示画布直接复用编辑器但只隐藏按钮，仍可能出现：

- 快捷键修改节点；
- 拖拽修改位置；
- Realtime operation 仍被发送；
- 节点配置弹窗仍可保存；
- 自动保存误写回 live workflow。

### 10.3 前端任务

1. 梳理现有 workflow editor 支持的只读能力：
   - 是否有 `readOnly` prop；
   - 是否能禁用拖拽；
   - 是否能禁用节点新增；
   - 是否能禁用边连接；
   - 是否能禁用 block config save；
   - 是否能禁用 keyboard shortcuts。
2. 如果没有统一只读入口，新增：

```typescript
interface WorkflowCanvasMode {
  mode: 'edit' | 'read-only'
  reason?: string
}
```

3. 展示画布详情页使用 read-only renderer：
   - 可以缩放、平移、查看详情；
   - 不可以增删改节点；
   - 不可以保存；
   - 不加入编辑房间；
   - 不显示编辑 presence；
   - 可以显示“复制为个人草稿”或“请求引用”。

### 10.4 后端任务

- 展示画布 API 只返回 publication snapshot。
- 不返回原团队画布的可写 workspace id。
- 如果需要引用源团队画布，只返回脱敏的 source metadata。
- Realtime 加入展示画布 room 时只给 read role。

### 10.5 测试任务

- 展示详情页不触发 save mutation。
- 展示详情页不发送 mutation socket operation。
- 展示详情页快捷键无编辑效果。
- 非发布可见范围用户访问返回 403/404。

### 10.6 验收标准

- 展示画布无法通过 UI、快捷键、API、Realtime 修改。
- 展示页展示的是发布版本，不随团队画布后续修改自动变化。
- 展示页仍可流畅查看方案。

### 10.7 建议提交

```text
Add read-only showcase canvas renderer
```

## 11. Phase 4：权限隔离加固

### 11.1 目标

把“隔离要求”从产品描述落实到所有后端读写路径和 Realtime 路径。

### 11.2 需要排查的路径

按资源扫描：

- workflow load；
- workflow save；
- workflow duplicate；
- workflow publish；
- workspace list；
- workspace detail；
- folder/list/sidebar；
- recent workflows；
- search；
- files/assets；
- credentials；
- Copilot context；
- Realtime room join；
- Realtime operation；
- webhooks/internal tasks。

### 11.3 后端任务

1. 定义统一 canvas visibility：

```typescript
type CanvasScope = 'personal' | 'team' | 'showcase'
type CanvasPermission = 'read' | 'write' | 'publish' | 'admin'
```

2. 给 workflow/workspace 查询补权限过滤：
   - 个人：`ownerUserId = session.user.id`；
   - 团队：`exists workgroup_member`；
   - 展示：`exists publication visibility`。
3. 所有写操作先判断 write permission。
4. 所有发布操作先判断 publish permission。
5. 旧 workspace list 不再返回其他人的个人草稿。
6. team admin 只能管理自己团队，不是所有团队。
7. project admin 可以管理组织下团队，但默认不能读个人草稿。

### 11.4 Realtime 任务

1. room join 时解析 room 对应 canvas scope。
2. 加入个人草稿 room：
   - 仅 owner。
3. 加入团队画布 room：
   - workgroup member。
4. 加入展示画布 room：
   - 可见范围内用户；
   - role=read。
5. operation permission：
   - `read` 不能发 mutation；
   - `write` 才能发 node/edge/position/config 更新；
   - `publish` 不一定等于 `write`，发布走 HTTP API。
6. presence 广播：
   - 只在同 room；
   - 不跨团队；
   - 离开 room 后及时清理。

### 11.5 前端任务

- 如果后端返回 403，显示权限说明，而不是空白。
- 如果 active workgroup 失效，提示用户切换团队。
- 切换团队后 invalidation 当前 collaboration queries。
- 不在客户端拼接越权入口。

### 11.6 测试任务

新增：

```powershell
bun test apps/realtime/src/middleware/permissions.test.ts
bun test apps/sim/lib/collaboration/authz.test.ts
```

覆盖：

- 非 owner 不能进个人草稿 room。
- 非成员不能进团队画布 room。
- read role position update 被拒绝。
- 展示画布 mutation 被拒绝。
- team admin 不能管理其他团队。
- project admin 不能默认读取个人草稿。

### 11.7 验收标准

- 隔离需求在 HTTP 和 Realtime 都成立。
- 没有任何普通用户能通过旧 workspace API 看到别人的个人草稿。
- 展示画布只读在服务端强制。

### 11.8 建议提交

```text
Harden canvas authorization boundaries
```

## 12. Phase 5：发布流程与全局状态树

### 12.1 目标

允许团队将团队画布成熟方案提交到全局状态树，并广播给其他团队，形成跨工种协作的“展示画布”。

### 12.2 发布流程

```text
团队画布
  -> 团队成员完成方案
  -> 团队管理员点击发布
  -> 填写版本说明、状态、可见范围
  -> 后端校验权限
  -> 生成脱敏 snapshot
  -> 写入 publication version
  -> 更新 global state tree
  -> 广播给可见团队
  -> 展示画布列表出现新版本
```

### 12.3 发布状态建议

| 状态 | 含义 |
| --- | --- |
| `draft` | 发布草稿，未广播 |
| `published` | 已发布，可见团队可查看 |
| `superseded` | 已被新版本替代 |
| `archived` | 归档，不在默认列表显示 |
| `retracted` | 撤回，需保留审计 |

### 12.4 全局状态树字段

每个节点建议包含：

- `publicationVersionId`
- `sourceWorkflowId`
- `sourceWorkgroupId`
- `sourceDisciplineId`
- `title`
- `version`
- `status`
- `summary`
- `createdBy`
- `createdAt`
- `visibleTo`
- `dependsOnPublicationIds`
- `relatedDisciplineIds`
- `riskLevel`
- `reviewState`
- `agentNotes`

### 12.5 后端任务

1. 完善 publish route：
   - 请求体包含 version note、visibility、status、dependencies。
   - 返回 publication version。
2. 完善 publication tree route：
   - 支持按 organization；
   - 支持按 discipline；
   - 支持按 workgroup；
   - 支持只返回当前用户可见节点。
3. 增加发布广播：
   - 可以先用已有 realtime/internal event；
   - 后续再接通知中心。
4. 增加撤回/归档能力：
   - 团队管理员可撤回本团队发布；
   - 项目管理员可归档不合规发布；
   - 所有操作写审计。

### 12.6 前端任务

- 团队画布页新增“发布方案”对话框。
- 展示画布列表新增筛选和状态标签。
- 展示画布详情显示：
  - 发布团队；
  - 工种；
  - 版本；
  - 发布时间；
  - 发布说明；
  - 依赖关系；
  - 可见范围；
  - 只读标识。
- 全局状态树页面初版：
  - 树形/图形视图；
  - 按工种分组；
  - 点击节点进入展示画布。

### 12.7 测试任务

- 团队管理员可以发布。
- 普通成员无发布权限时被拒绝。
- 发布快照不随团队画布变更。
- 其他团队只能看到可见范围内发布。
- 发布树只返回可见节点。

### 12.8 验收标准

- 团队成熟方案能从团队画布发布成展示画布。
- 展示画布出现在其他团队的可见列表中。
- 全局状态树能表达发布版本和依赖。
- 发布和撤回都有审计记录。

### 12.9 建议提交

```text
Implement publication state tree workflow
```

## 13. Phase 6：跨画布节点复制

### 13.1 目标

支持用户把个人草稿中做好的节点复制到团队画布，降低协作摩擦。

### 13.2 第一阶段范围

先做“复制”，不做“移动”：

- 源画布保留原节点。
- 目标画布生成新节点 ID。
- 复制选中的节点、边、必要 block data。
- 不复制个人敏感配置。
- 不复制不可公开文件凭证。

### 13.3 源和目标权限矩阵

| 源 | 目标 | 是否允许 | 条件 |
| --- | --- | --- | --- |
| 个人草稿 | 团队画布 | 允许 | 源 owner 且目标团队成员 |
| 团队画布 | 个人草稿 | 允许 | 源团队成员且目标 owner |
| 展示画布 | 个人草稿 | 允许 | 展示可读且目标 owner |
| 展示画布 | 团队画布 | 建议允许 | 展示可读且目标团队成员 |
| 个人草稿 | 展示画布 | 不允许 | 必须通过团队发布 |
| 团队画布 | 展示画布 | 不直接复制 | 通过发布流程 |

### 13.4 后端任务

完善：

```http
POST /api/workflows/[id]/copy-selection
```

请求体建议：

```json
{
  "sourceWorkflowId": "workflow-source",
  "targetWorkflowId": "workflow-target",
  "selectedNodeIds": ["node-1", "node-2"],
  "selectedEdgeIds": ["edge-1"],
  "placement": {
    "strategy": "viewport-center",
    "offsetX": 80,
    "offsetY": 80
  }
}
```

处理步骤：

1. 验证 source read permission。
2. 验证 target write permission。
3. 读取源 workflow state。
4. 提取选中节点和边。
5. 过滤未选中边。
6. 生成新 ID。
7. 清洗敏感 block params。
8. 写入目标 workflow。
9. 返回新节点 ID 映射。

### 13.5 前端任务

- 画布选中节点后显示“复制到...”。
- 如果当前在个人草稿页，默认目标是当前团队画布。
- 如果打开分屏，默认目标是另一侧画布。
- 复制成功后：
  - 目标画布刷新；
  - 高亮新节点；
  - toast 显示复制数量。

### 13.6 测试任务

- 非 owner 不能从个人草稿复制。
- 非团队成员不能复制到团队画布。
- 复制后 source 不变。
- target 新节点 ID 不冲突。
- 敏感字段被清洗。

### 13.7 验收标准

- 用户可以把个人草稿成熟节点复制到团队画布。
- 不会泄露 credentials。
- 不会破坏源画布。
- 目标画布协作者能实时看到复制结果。

### 13.8 建议提交

```text
Implement cross-canvas selection copy
```

## 14. Phase 7：分屏工作台

### 14.1 目标

支持用户同时打开两个画布进行对照和复制，尤其是“个人草稿 -> 团队画布”的高频场景。

### 14.2 推荐入口

- `/workbench/split`
- 或者在画布页点击“打开分屏”后进入：

```text
/workbench/split?left=personal&right=team
```

### 14.3 分屏布局

桌面端：

- 左右双栏。
- 中间可拖拽调整宽度。
- 每侧顶部显示 `CanvasModeHeader` 的压缩版。
- 每侧有独立 zoom/pan。
- 右上有“退出分屏”。

移动端：

- 不强制左右分屏。
- 使用顶部 tab：“左画布 / 右画布”。
- 保留“复制到另一侧”动作。

### 14.4 状态管理

建议新增轻量 store：

```text
apps/sim/stores/workbench/split-view-store.ts
```

保存：

- left canvas descriptor；
- right canvas descriptor；
- active side；
- selected node ids；
- panel ratio；
- copy target side。

不保存：

- workflow server data；
- publication snapshot；
- 权限数据。

这些仍由 React Query 或现有 workflow store 管。

### 14.5 后端任务

分屏本身不需要新后端，但需要已有能力稳定：

- 能同时读取两个画布。
- 能独立判断左右两侧权限。
- 能从左复制到右。
- 能只读展示画布。

### 14.6 前端任务

- 新增 SplitWorkbench 页面。
- 抽象 `CanvasPane`。
- 每个 pane 支持：
  - personal；
  - team；
  - showcase。
- 避免两个 editor 实例共享错误状态。
- 分屏复制使用 Phase 6 API。

### 14.7 测试任务

- 打开 personal + team。
- personal 选节点复制到 team。
- showcase pane 无法编辑。
- 切换团队后分屏失效画布提示。

### 14.8 验收标准

- 用户能同时查看个人草稿和团队画布。
- 用户能从个人草稿复制节点到团队画布。
- 分屏不会导致权限串线。
- 移动端可用，不必强制同屏左右。

### 14.9 建议提交

```text
Add split view canvas workbench
```

## 15. Phase 8：Copilot 10 个 Agent 深度接入

### 15.1 目标

让 Copilot 聊天框根据当前登录用户的 active workgroup/discipline 自动接入对应 Agent 和 Skill，形成工种专属助手。

### 15.2 当前基础

当前已经有：

- `agent_profile`
- `agent_skill_binding`
- `apps/sim/lib/collaboration/definitions.ts`
- `apps/sim/lib/copilot/chat/workspace-context.ts`
- `GET /api/copilot/agent-profile`

后续要把“识别 Agent”推进到“Agent 影响工具、提示词、上下文、能力边界”。

### 15.3 Agent 配置字段建议

每个 Agent Profile 包含：

- `code`
- `displayName`
- `disciplineCodes`
- `systemPrompt`
- `allowedSkillIds`
- `defaultTools`
- `blockedTools`
- `contextTemplate`
- `handoffRules`
- `reviewChecklist`
- `outputFormatHints`

### 15.4 10 个 Agent 的能力方向

| Agent | 重点 Skill |
| --- | --- |
| 总导演 Agent | 全局创意、方案审核、跨工种冲突、项目预演 |
| 秀演/编导 Agent | 演员动线、节目结构、舞台走位、时间轴 |
| 舞美师 Agent | 舞台空间、模型、布局、舞美资产 |
| 视觉 Agent | 分镜、海报、视频素材、异形屏、视觉预览 |
| 导播/摄影 Agent | 机位、盲区、导播脚本、镜头调度 |
| 灯光/音响 Agent | 灯光 Cue、声场、技术参数、时序 |
| 特效 Agent | 激光、机械装置、触发时序、安全对齐 |
| 音乐 Agent | 曲风、音乐制作进度、版权、情绪匹配 |
| 道具/服装 Agent | 道具服装风格、置景、角色匹配 |
| 制片 Agent | 档期、通告单、排期、流程文档 |

PMO 用户默认使用总导演 Agent，但 prompt 中增加 PMO 视角：

- 任务调度；
- 依赖管理；
- 风险预警；
- 项目健康度。

### 15.5 后端任务

1. 完善 Agent resolver：
   - 根据 `settings.activeWorkgroupId` 找 workgroup；
   - 根据 workgroup.disciplineId 找 discipline；
   - 根据 discipline.agentProfileId 或 mapping 找 agent；
   - 如果无 active workgroup，返回默认 onboarding agent；
   - PMO discipline 返回 `chief_director` 并附加 PMO context。
2. Copilot chat route 调用 resolver：
   - system prompt 注入 Agent；
   - tool/skill registry 按 Agent 过滤；
   - context 中包含当前 canvas mode；
   - 不把无权限画布内容注入上下文。
3. 团队管理员可配置本团队 skill binding：
   - 只能增删允许范围内 skill；
   - 项目管理员可维护全局模板。

### 15.6 前端任务

- Copilot 聊天框顶部显示当前 Agent。
- 用户切换团队后刷新 Agent。
- 如果用户没有团队，显示通用助手或引导。
- 团队管理员页面显示 Agent Skill 配置。
- 展示画布只读时，Copilot 只能基于展示内容分析，不能调用修改类工具。

### 15.7 测试任务

- 不同工种返回不同 Agent。
- PMO 返回 `chief_director`。
- 切换 active workgroup 后 Agent 变化。
- 无权限画布不进入 Copilot context。
- 展示画布模式下修改类 tool 被禁用。

### 15.8 验收标准

- Copilot 明确显示当前工种 Agent。
- Agent 的 prompt/skill/tool 与工种匹配。
- 权限边界不会被 Copilot 绕过。

### 15.9 建议提交

```text
Wire discipline agents into Copilot
```

## 16. Phase 9：团队管理员闭环

### 16.1 目标

让团队管理员能完成日常团队管理，不需要项目管理员代办所有事情。

### 16.2 团队管理员页面

路径：

```text
/workbench/team-management
```

页面模块：

- 团队概览；
- 成员管理；
- 角色管理；
- 团队画布状态；
- 发布版本管理；
- Agent Skill 管理；
- 审计日志。

### 16.3 成员管理

功能：

- 搜索用户；
- 邀请加入团队；
- 移除成员；
- 设置成员角色；
- 查看成员最近活跃时间；
- 查看成员是否在线团队画布。

限制：

- 团队管理员只能管理自己团队。
- 不能把自己移出最后一个管理员角色，除非有其他管理员。
- 移除成员不删除其个人草稿。
- 移除成员后不再能访问团队画布。

### 16.4 发布管理

功能：

- 查看本团队发布版本列表。
- 查看每个版本状态。
- 设置版本为 archived。
- 撤回错误发布。
- 查看可见范围。
- 查看其他团队引用情况。

### 16.5 Agent Skill 管理

功能：

- 查看当前团队 Agent。
- 查看已绑定 Skill。
- 在允许范围内启用/禁用 Skill。
- 查看 Skill 说明和风险级别。
- 保存后影响团队内 Copilot。

### 16.6 后端任务

- 完善 workgroup member routes。
- 增加成员角色更新 route。
- 增加团队发布版本管理 routes。
- 增加 team agent skill binding routes。
- 所有 route 使用 contract + parseRequest。
- 所有管理操作写 audit。

### 16.7 前端任务

- 完善现有 `team-management` 页面。
- 使用表格/列表展示成员。
- 成员操作有确认框。
- 权限不足显示 403 状态。
- 操作成功后目标化 invalidate。

### 16.8 测试任务

- team admin 可以添加成员。
- 普通成员不能添加成员。
- team admin 不能管理其他团队。
- 移除成员后权限立即失效。
- 最后一个 admin 保护。

### 16.9 验收标准

- 团队管理员可独立完成团队成员和发布管理。
- 普通成员看不到或打不开管理功能。
- 操作都有审计。

### 16.10 建议提交

```text
Complete team admin workbench
```

## 17. Phase 10：项目管理员中心

### 17.1 目标

让项目/组织管理员能管理整个项目的工种、团队、用户分配、全局状态树和 Agent 模板。

### 17.2 推荐路径

```text
/workbench/project-admin
```

### 17.3 页面模块

- 项目概览；
- 工种管理；
- 团队管理；
- 用户分配；
- 全局状态树；
- 展示画布治理；
- Agent 模板；
- 权限与审计；
- 项目设置。

### 17.4 工种管理

v1 不建议让用户自由删除内置 11 工种，但可以：

- 启用/停用某工种；
- 修改显示名称；
- 查看该工种下团队；
- 查看对应 Agent；
- 配置是否允许创建多个团队。

### 17.5 团队管理

功能：

- 在某工种下创建团队；
- 设置团队名称；
- 设置团队管理员；
- 归档团队；
- 查看团队画布；
- 查看团队发布；
- 查看团队成员数量。

### 17.6 用户分配

功能：

- 搜索用户；
- 分配到工种团队；
- 一个用户可属于多个团队；
- 设置 active team 由用户自己选择，但管理员可查看默认建议；
- 批量导入成员可后置。

### 17.7 全局状态树

项目管理员视图比普通展示画布更强：

- 看所有团队发布；
- 看依赖关系；
- 看冲突；
- 看风险；
- 看哪些工种未提交；
- 看哪些发布已过期；
- 可归档/撤回违规发布。

### 17.8 Agent 模板

功能：

- 查看 10 个 Agent 模板；
- 编辑项目级 system prompt 附加说明；
- 配置每类 Agent 默认 Skill；
- 配置 PMO 对 `chief_director` 的附加上下文；
- 禁用高风险 Skill。

### 17.9 后端任务

- 组织管理员权限判断。
- project admin routes。
- discipline/team CRUD 或受控更新。
- user assignment route。
- global state tree admin route。
- agent template route。
- audit logs route。

### 17.10 前端任务

- 新增 project admin shell。
- 工种/团队二维管理界面。
- 用户分配 drawer。
- 全局状态树图/表切换。
- Agent 模板配置页。

### 17.11 测试任务

- project admin 可以创建团队。
- team admin 不能创建其他工种团队。
- 普通成员不能访问 project admin。
- 用户加入团队后能看到对应团队画布。
- 用户移出团队后不能再访问团队画布。

### 17.12 验收标准

- 项目管理员可以完整维护工种、团队、成员、状态树。
- 权限不扩大到个人草稿。
- 10 个 Agent 模板可被项目级配置。

### 17.13 建议提交

```text
Add project collaboration admin center
```

## 18. Phase 11：Legacy workspace 入口迁移

### 18.1 目标

把旧的 workspace 用户心智迁移到新的协作工作台，避免普通用户继续创建和管理 workspace。

### 18.2 原则

- workspace 不删除，仍作为内部容器。
- 普通用户主界面不出现“新建 workspace”。
- 老链接仍可兼容跳转或显示说明。
- 管理员和系统内部仍可使用 workspace 作为底层资源。

### 18.3 需要排查

- sidebar 中 workspace list；
- create workspace button；
- workspace settings；
- workspace switcher；
- onboarding；
- empty state；
- templates；
- recent workflows；
- command palette；
- mobile nav。

### 18.4 迁移策略

| 旧行为 | 新行为 |
| --- | --- |
| 用户新建 workspace | 引导到创建个人草稿或联系管理员建团队 |
| 用户切换 workspace | 切换 active workgroup |
| workspace list | 改为我的团队/画布入口 |
| workspace settings | 普通用户隐藏，管理员进入团队/项目管理 |
| workflow list | 按个人、团队、展示分组 |

### 18.5 后端任务

- workspace list API 默认只返回当前用户可见画布容器。
- 旧 API 如果仍返回 workspace，要带 scope。
- 新增兼容字段：
  - `canvasScope`
  - `workgroupId`
  - `disciplineId`
  - `isInternalWorkspace`

### 18.6 前端任务

- 所有普通入口跳 `/workbench`。
- 老 `/workspace` 已有重定向，继续完善深层路径。
- 创建按钮按角色显示：
  - 普通成员：创建个人草稿；
  - 团队管理员：创建/修复团队画布；
  - 项目管理员：创建团队。

### 18.7 测试任务

- 普通用户看不到 create workspace。
- 老链接不报错。
- 个人草稿仍可打开。
- 团队画布仍可打开。
- 管理员入口正常。

### 18.8 验收标准

- 普通用户不再感知 workspace。
- 旧数据和旧链接有兼容策略。
- 底层 workspace 仍服务 workflow/editor。

### 18.9 建议提交

```text
Migrate legacy workspace entrypoints
```

## 19. Phase 12：测试、审计、发布与监控

### 19.1 目标

在上线前证明隔离、发布、分屏、Agent、管理闭环都可靠。

### 19.2 必跑命令

```powershell
bun run check:api-validation
bun test apps/sim/lib/collaboration/definitions.test.ts
bun test apps/sim/lib/collaboration/authz.test.ts
bun test apps/sim/lib/collaboration/snapshot-sanitizer.test.ts
bun test apps/realtime/src/middleware/permissions.test.ts
```

如果仓库全量 type-check 仍有历史错误，至少要：

- 记录当前错误是否为历史遗留；
- 对新增文件做局部类型验证；
- 不引入新的协作相关类型错误。

### 19.3 手工验收脚本

准备用户：

- `user_a`: 舞美师团队 A 普通成员；
- `user_b`: 舞美师团队 A 团队管理员；
- `user_c`: 视觉团队 B 普通成员；
- `user_d`: 项目管理员；
- `user_e`: 无团队用户。

验证流程：

1. `user_a` 登录，进入 `/workbench`。
2. 确认显示舞美师、团队 A、舞美 Agent。
3. `user_a` 创建/打开个人草稿。
4. `user_b` 不能看到 `user_a` 的个人草稿。
5. `user_a` 打开团队画布。
6. `user_b` 同时打开团队画布，右上角互相看到头像。
7. `user_c` 不能打开团队 A 的团队画布。
8. `user_a` 在个人草稿选节点复制到团队画布。
9. `user_b` 在团队画布看到复制结果。
10. `user_b` 发布团队画布。
11. `user_c` 在展示画布列表看到可见发布，但不能编辑。
12. `user_d` 在全局状态树看到该发布。
13. `user_e` 进入工作台看到“尚未加入团队”空状态。

### 19.4 审计要求

必须记录：

- 成员加入团队；
- 成员移出团队；
- 成员角色变更；
- 团队画布发布；
- 展示画布撤回；
- 展示画布归档；
- Agent Skill 绑定变化；
- 项目管理员创建/归档团队；
- 权限拒绝可选择记录 warn，不要记录敏感内容。

### 19.5 监控指标

建议埋点/日志：

- workbench load time；
- active workgroup missing rate；
- personal canvas create success/failure；
- team canvas join success/failure；
- realtime permission denied count；
- publication create success/failure；
- copy-selection success/failure；
- Copilot agent resolve fallback count；
- showcase read-only mutation blocked count。

### 19.6 发布策略

建议灰度：

1. 内部开发环境；
2. 单组织测试；
3. 单项目多团队测试；
4. 打开普通用户 workspace 隐藏；
5. 打开展示画布发布；
6. 打开分屏复制；
7. 打开 Agent Skill 管理。

### 19.7 回滚策略

必须保留：

- 旧 workflow/editor 数据不变；
- workspace 仍作为内部容器；
- 如果 workbench 出问题，可临时恢复旧入口给管理员；
- 发布版本是 append-only，撤回用状态，不物理删除。

### 19.8 验收标准

- 自动化测试和手工脚本通过。
- 没有已知个人草稿泄露路径。
- 展示画布服务端强只读。
- Copilot Agent 能正确随团队切换。
- 管理员和普通成员界面差分明确。

### 19.9 建议提交

```text
Add collaboration release hardening
```

## 20. 端到端用户故事

### 20.1 普通员工：个人到团队

1. 用户登录。
2. 工作台显示“舞美师 / 舞美一组 / 舞美 Agent”。
3. 用户进入个人草稿画布。
4. 用户搭建舞台空间方案节点。
5. 用户打开分屏：左个人草稿，右团队画布。
6. 用户选中成熟节点，复制到团队画布。
7. 团队成员在团队画布看到新节点。
8. Copilot 使用舞美 Agent 给出舞台布局建议。

### 20.2 团队管理员：发布方案

1. 团队管理员进入团队画布。
2. 查看团队成员 presence。
3. 确认方案成熟。
4. 点击“发布到展示画布”。
5. 填写版本说明和可见范围。
6. 系统生成展示快照。
7. 其他团队在展示画布看到该方案。
8. 全局状态树出现新节点。

### 20.3 其他团队：只读查看

1. 视觉团队成员进入展示画布。
2. 筛选“舞美师 / 舞美一组”。
3. 打开舞美发布方案。
4. 只能查看，不能修改。
5. 可复制相关节点为自己的个人草稿参考。
6. Copilot 使用视觉 Agent 分析异形屏适配影响。

### 20.4 项目管理员：组建团队

1. 项目管理员进入项目管理中心。
2. 查看 11 个工种。
3. 在视觉团队下创建“视觉二组”。
4. 将用户加入视觉二组。
5. 设置团队管理员。
6. 用户登录后自动看到视觉二组和视觉 Agent。

## 21. API 与数据补充规格

### 21.1 推荐新增/完善的 contract 文件

如果 `collaboration.ts` 继续膨胀，可拆分：

```text
apps/sim/lib/api/contracts/collaboration/context.ts
apps/sim/lib/api/contracts/collaboration/workgroups.ts
apps/sim/lib/api/contracts/collaboration/publications.ts
apps/sim/lib/api/contracts/collaboration/agents.ts
apps/sim/lib/api/contracts/collaboration/canvas-copy.ts
```

拆分时仍从 `apps/sim/lib/api/contracts/index.ts` 或领域 barrel 导出。

### 21.2 推荐 API 清单

| API | 用途 | 权限 |
| --- | --- | --- |
| `GET /api/me/collaboration-context` | 工作台聚合上下文 | 登录用户 |
| `GET /api/disciplines` | 工种列表 | 登录用户 |
| `GET /api/agents/profiles` | Agent 模板列表 | 登录用户或管理员 |
| `GET /api/copilot/agent-profile` | 当前 Agent | 登录用户 |
| `GET /api/me/workgroups` | 我的团队 | 登录用户 |
| `PUT /api/me/active-workgroup` | 切换当前团队 | 用户必须属于该团队 |
| `GET /api/organizations/[organizationId]/workgroups` | 组织团队 | project admin 或受限可见 |
| `POST /api/organizations/[organizationId]/workgroups` | 创建团队 | project admin |
| `GET /api/workgroups/[workgroupId]/members` | 团队成员 | team member |
| `POST /api/workgroups/[workgroupId]/members` | 添加成员 | team admin/project admin |
| `PATCH /api/workgroups/[workgroupId]/members/[userId]` | 修改角色 | team admin/project admin |
| `DELETE /api/workgroups/[workgroupId]/members/[userId]` | 移除成员 | team admin/project admin |
| `POST /api/workgroups/[workgroupId]/personal-workspace` | 获取/创建个人草稿容器 | 当前用户本人 |
| `POST /api/workgroups/[workgroupId]/team-workspace` | 获取/创建团队画布容器 | team member/team admin |
| `POST /api/workgroups/[workgroupId]/publications` | 发布团队画布 | publish permission |
| `GET /api/publications` | 展示列表 | 按可见范围 |
| `GET /api/publications/[publicationVersionId]` | 展示详情 | 按可见范围 |
| `GET /api/publications/[publicationVersionId]/tree` | 发布树 | 按可见范围 |
| `POST /api/workflows/[id]/copy-selection` | 跨画布复制 | 源 read + 目标 write |

### 21.3 错误响应规范

建议所有协作 API 保持一致：

```json
{
  "error": "Forbidden",
  "message": "You do not have access to this team canvas."
}
```

前端中文显示可以映射为：

- 未登录：请先登录。
- 无团队：你还没有加入团队，请联系项目管理员。
- 无权限：你没有访问该画布的权限。
- 只读：展示画布为只读发布版本，不能修改。
- 团队失效：你已不在该团队中，请切换团队。

## 22. UI 细节清单

### 22.1 工作台首页卡片

个人草稿卡片：

- 标题：个人草稿画布
- 标签：仅自己可见
- 描述：用于个人构思、试验节点、准备提交给团队的方案。
- CTA：打开个人草稿

团队画布卡片：

- 标题：团队画布
- 标签：团队共同编辑
- 描述：团队成员实时协作，成熟方案可发布到展示画布。
- CTA：进入团队画布
- 附加：在线成员头像。

展示画布卡片：

- 标题：展示画布
- 标签：跨团队只读查看
- 描述：查看各团队已发布方案和全局状态树。
- CTA：查看展示方案

### 22.2 左侧导航

普通成员：

- 工作台
- 个人草稿
- 团队画布
- 展示画布
- Copilot

团队管理员增加：

- 团队管理
- 发布管理
- Agent Skill

项目管理员增加：

- 项目管理
- 工种与团队
- 全局状态树
- Agent 模板
- 审计日志

### 22.3 空状态

无团队用户：

```text
你还没有加入任何团队
请联系项目管理员将你加入对应工种团队。
```

无个人草稿：

```text
还没有个人草稿画布
创建一个只对你可见的草稿空间，用于整理想法。
```

无团队画布：

```text
团队画布尚未初始化
团队管理员可以初始化团队画布。
```

无展示方案：

```text
还没有可见的展示方案
当团队发布成熟方案后，会在这里显示。
```

### 22.4 按钮权限文案

- 发布按钮 disabled：只有团队管理员或有发布权限的成员可以发布。
- 复制按钮 disabled：你没有目标画布的写入权限。
- 编辑按钮 hidden：展示画布是只读发布版本。
- 管理入口 hidden：你的角色不是管理员。

## 23. 工程执行规范

### 23.1 每阶段 commit 策略

用户要求做 git 版本管理并及时 commit。建议：

- 每个 phase 至少一个 commit。
- 一个 phase 很大时拆成 backend/frontend/test 三个 commit。
- 不把无关格式化混入协作 commit。
- 提交前看 `git status --short`。
- 不回滚用户已有改动。

### 23.2 推荐提交顺序

```text
Stabilize collaboration foundation
Add canvas mode context header
Add read-only showcase canvas renderer
Harden canvas authorization boundaries
Implement publication state tree workflow
Implement cross-canvas selection copy
Add split view canvas workbench
Wire discipline agents into Copilot
Complete team admin workbench
Add project collaboration admin center
Migrate legacy workspace entrypoints
Add collaboration release hardening
```

### 23.3 每阶段完成前检查

每个阶段结束前至少执行：

```powershell
git status --short
bun run check:api-validation
```

如果阶段涉及 definitions：

```powershell
bun test apps/sim/lib/collaboration/definitions.test.ts
```

如果阶段涉及权限：

```powershell
bun test apps/sim/lib/collaboration/authz.test.ts
bun test apps/realtime/src/middleware/permissions.test.ts
```

如果阶段涉及发布：

```powershell
bun test apps/sim/lib/collaboration/snapshot-sanitizer.test.ts
```

## 24. 风险与规避

### 24.1 个人草稿泄露

风险：

- 旧 workspace list 返回所有 workspace。
- search/recent/sidebar 没有 scope filter。
- Copilot context 把无权限内容注入。

规避：

- 所有 workflow 查询都走统一 authz。
- 个人草稿只按 owner 返回。
- Copilot context 复用同一权限判断。
- 增加专门测试。

### 24.2 展示画布被编辑

风险：

- UI 隐藏按钮但快捷键仍可编辑。
- Realtime read role 仍允许 position update。
- 后端 save route 未判断 publication。

规避：

- 前端 read-only renderer。
- Realtime read role 禁止 mutation。
- 后端 save route 按 canvas scope 拦截。

### 24.3 管理员权限过大

风险：

- 项目管理员默认看到个人草稿。
- 团队管理员能管理其他团队。

规避：

- v1 明确不做个人草稿接管。
- team admin scope 限定 workgroupId。
- project admin 操作写审计。

### 24.4 Agent 绕过权限

风险：

- Copilot 读取用户无权访问的画布。
- Agent 调用修改工具改展示画布。

规避：

- Agent context 只用当前用户可见数据。
- tool 调用前再次做服务端权限判断。
- 展示模式禁用修改类 tools。

### 24.5 分屏状态串线

风险：

- 左右两个画布共享 selection/store。
- 操作发到错误 workflow。

规避：

- CanvasPane 明确 pane id。
- 复制 API 显式传 source/target。
- 每侧独立权限和 query key。

## 25. 最终验收总表

| 验收项 | 标准 |
| --- | --- |
| 登录身份 | 工作台显示项目、工种、团队、角色、Agent |
| 普通用户入口 | 普通用户不能新增 workspace |
| 个人草稿 | 只有本人可见可编辑 |
| 团队画布 | 团队成员可见可编辑，非成员不可见不可改 |
| Presence | 团队画布右上角只显示同团队同画布在线成员 |
| 展示画布 | 发布版本只读，可按工种团队筛选 |
| 发布 | 团队管理员可把团队画布发布到全局状态树 |
| 跨团队查看 | 其他团队可查看被授权展示方案，不能修改 |
| 分屏 | 支持个人草稿和团队画布同时打开并复制节点 |
| Copilot | 根据当前 active workgroup 接入 10 个 Agent 之一 |
| PMO | PMO 工种映射到总导演 Agent，并带 PMO 语境 |
| 团队管理员 | 可管理成员、发布、团队 Agent Skill |
| 项目管理员 | 可管理工种、团队、成员分配、全局状态树、Agent 模板 |
| 权限服务端强制 | HTTP 和 Realtime 均不能绕过 |
| 审计 | 管理、发布、权限关键行为有审计 |
| 测试 | API validation、权限、发布清洗、Realtime 权限测试通过 |

## 26. 建议下一步

如果继续编码，建议按以下顺序推进：

1. 先做 Phase 1，补权限 helper 和测试，把基础打稳。
2. 再做 Phase 2 和 Phase 3，让用户界面清晰，并确保展示画布只读。
3. 然后做 Phase 4，彻底扫旧入口和 Realtime 权限。
4. 接着做 Phase 5 和 Phase 6，让发布和复制形成闭环。
5. 最后做 Phase 7 到 Phase 10，把分屏、Agent、管理员中心补完整。

这个顺序的理由是：先保隔离，再做体验；先保证展示只读，再开放跨团队查看；先做复制 API，再做分屏 UI；先有团队管理，再做项目级复杂管理。
