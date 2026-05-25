# 剧场协作系统当前完成总结与后续详细计划

> 更新时间：2026-05-25
> 适用仓库：`E:\project\sim`
> 关联基准文档：
> - `docs/theater-collaboration-phased-implementation-plan-zh.md`
> - `docs/theater-collaboration-progress-and-next-steps-zh.md`
>
> 本文档用于给后续开发者快速接续：哪些能力已经落地、哪些能力只是有基础但不能宣称完成、后续应按什么顺序继续推进。当前产品方向已经从独立 `/workbench` 外壳纠偏为：在原始 `/workspace/[workspaceId]` 主界面、Sidebar、Provider 和编辑器外壳内完成个人草稿画布、团队画布、展示画布的切换与管理。

## 1. 当前总体结论

当前仓库已经完成剧场多团队画布协作系统的核心骨架和多个关键闭环：

- `workspace` 已逐步退为内部画布容器，产品语义转向 `个人草稿画布 / 团队画布 / 展示画布`。
- 原主界面 `/workspace/[workspaceId]` 已成为主要承载外壳，不再维护新的独立 `/workbench` shell。
- 普通成员可以在当前团队上下文中创建多个个人草稿画布，并进入默认节点图。
- 团队管理员可以初始化团队画布、邀请/添加成员、调整成员角色、移除成员、发布团队画布到展示画布、管理发布生命周期、管理团队 Agent Skill、查看团队活动日志。
- 组织/项目管理员已有项目管理员中心入口，可在原 `/workspace/[workspaceId]` shell 内查看工种、团队、成员数量、Agent 映射、展示发布治理 watchlist 和按团队筛选的 activity drilldown，并可创建新的工种团队、从组织 roster 中把既有用户单个或批量分配到任意团队，还可维护项目级 Agent prompt 补充说明、项目级 Agent Skill 默认策略、Agent 策略影响预览、风险 Skill guardrails、项目级发布状态树治理、发布详情编辑、reviewer 指派、approval workflow、跨团队依赖冲突提示、依赖冲突处理动作、发布评审通知队列、通知投递草稿、服务端通知投递记录、持久通知 outbox、webhook provider delivery、email provider delivery、持久通知 inbox、通用项目通知中心顶部铃铛、项目中心筛选/详情/导出首版和独立全屏页（发布评审 + 项目失败审计 + 发布治理审计 + 成员/团队/Agent 策略审计 + retention/data drain/组织管理/组织设置/billing（seat/plan switch/org credits/invoice failure recovery/subscription cancellation）/cleanup 执行审计）、项目管理员失败操作审计，以及失败审计历史筛选、分页、导出、趋势/保留窗口概览、组织日志 retention policy 控制入口和详情 drawer。
- 展示画布已经有只读查看路径和发布版本生命周期基础，服务端权限已对展示/发布画布做强只读约束。
- Phase 4 权限隔离已完成一轮系统性加固；Phase 5 到 Phase 9 已完成多个可用切片；Phase 10 已启动项目管理员中心概览、创建团队、成员分配、批量成员分配、按团队 activity drilldown、团队归档、项目级 Agent 模板、项目级 Agent Skill 策略、Agent 策略影响预览、Agent Skill 跨团队策略复制、风险 Skill guardrails、项目级发布治理、发布详情 drawer、发布版本 diff preview、节点级 diff preview、发布冲突检测、首批冲突处理动作、发布批量治理、依赖影响预览、发布详情编辑、reviewer 指派、approval workflow、跨团队依赖冲突提示、依赖冲突处理动作、发布评审通知队列、通知投递草稿、服务端通知投递记录、持久通知 outbox、webhook provider delivery、email provider delivery、持久通知 inbox、项目管理员顶部通知铃铛与已读状态首版、通用项目通知中心筛选/分页/详情/导出/全屏页首版和发布治理/成员/团队/Agent 策略/retention/data drain/组织管理/组织设置/billing（seat/plan switch/org credits/invoice failure recovery/subscription cancellation）/cleanup 执行审计类型扩展、项目管理员失败操作审计、失败审计历史筛选/分页/导出/趋势概览/详情 drawer/组织日志 retention controls、冲突修复向导和过期/未提交团队发布 nudges；Phase 11 到 Phase 12 仍未完成。
- 最新补充的失败审计独立清理能力新增 `POST /api/organizations/[id]/project-admin/failures/cleanup`，可 dry-run 预览或按小时窗口删除旧的 `project_admin_failure.recorded` audit row，并把执行结果写回 `cleanup_execution` 项目通知类型。
- 最新 Phase 11 切片已让 `/api/workspaces` 返回服务端推导的 `canvasCreationCapabilities.canCreatePersonalCanvas` / `canCreateTeamCanvas`，Sidebar 个人草稿创建和 Home 团队画布初始化入口开始消费该能力，并把 Published/Showcase 旧 workspace 文案改为 canvas/team 语义。
- 最新 Phase 11 搜索入口切片已把原 command/search modal 的 `Workspaces` 分组改为 `Canvases`，搜索索引改用 `canvas-*` 与个人草稿/团队/legacy canvas 标签，并继续复用 `/api/workspaces` 的 `canvasScope` / `isInternalWorkspace` 元数据。
- 最新 Phase 11 设置页切片已把 workflow MCP server 详情里的 `Add to Workspace` / `Added to Workspace` 迁移为 `Add to Canvas` / `Added to Canvas`，降低普通用户在画布设置里看到旧 workspace 心智的概率。
- 最新 Phase 11 设置页扩展切片已继续迁移 API keys、BYOK、Inbox、team management invite/roster/no-organization/remove-member 对话中的用户可见 workspace 文案；底层 `workspaceId`、`workspaceKeys` 和权限 API 命名仍保留为内部资源边界。
- 最新 Phase 11 邀请/团队管理切片已把原 sidebar header invite modal 和 team canvas health/Agent Skill 空态中的 “this workspace / workspace permissions / team workspace” 用户可见文案改为 canvas 语义。
- 最新 Phase 11 `/workspace` 入口切片已把根入口重定向改为优先打开本地最近访问 canvas，其次 server last-active canvas，再回退默认团队画布；这避免已有团队画布时总是覆盖个人草稿最近访问，也让 `redirect_workflow` 继续使用同一 canvas fallback。
- 最新 Phase 11 settings/sidebar 深层文案切片继续迁移 Integrations、Secrets、Inbox enable、Subscription plan/tooltip、ownership transfer 和 sidebar resource 分组中的 workspace 用户可见文案；保留底层 `workspaceId`、API route 和 credential type 作为内部资源键。
- 最新 Phase 11 邀请/邮件切片把 invite 登录页、单个/批量邀请邮件、批量邀请 subject 和 published visibility 的 owner-only 文案迁移为 canvas 语义；内部 invitation grant 仍保留 workspace 字段名。
- 最新 Phase 11 模板入口切片让公共 template edit selector 消费 `/api/workspaces` 的 `canvasScope` / `isInternalWorkspace` 元数据，显示 Personal draft / Team / Legacy canvas 标签，并把无写权限与无访问提示改为 canvas 语义。
- 最新 Phase 11 邀请错误文案切片把 invite 接收页 fallback、邀请发送 fallback、workspace invitation batch API 和 invitation edit/resend API 的用户可见错误迁移为 canvas 语义；内部 `kind = workspace`、grant `workspaceId` 和权限 helper 命名仍保持不变。
- 最新 Phase 11 fallback 入口文案切片把 form/chat 不可用状态页的返回按钮和 credential-account 已连接成功页的跳转说明改为 canvas 语义；实际兼容跳转仍走 `/workspace` 路由。
- 最新 Phase 11 组织批量邀请错误文案切片把 organization invitation batch grant 的选择、隐藏个人画布、无权限、非组织画布和跨组织画布错误迁移为 canvas 语义；响应里的 `workspaceGrantsPerInvite` 仍保留为现有 API wire 字段。
- 最新 Phase 11 canvas permission 错误文案切片把 `/api/workspaces/[id]/permissions` 的 not found、personal shared-member、owner/billing/admin 和 500 fallback 错误迁移为 canvas 语义；底层 permission entity 仍为 `workspace`。
- 最新 Phase 11 knowledge header 切片把 Knowledge Base 详情页的归属选择器从 workspace 文案迁移为 canvas 文案，并在下拉项显示 Personal draft / Team / Project / Legacy canvas 标签与权限级别；底层 `currentWorkspaceId` 和 knowledge updates 仍保留为内部资源键。

需要注意：当前工作树仍有两个非本轮文档相关的未提交项，后续不要误混入协作提交：

| 状态 | 文件 | 说明 |
| --- | --- | --- |
| modified | `apps/realtime/src/routes/http.ts` | 既有未提交改动，本文档未触碰 |
| untracked | `apps/sim/components/workbench/canvas-launch-button.tsx` | 既有未跟踪文件，本文档未触碰 |

## 2. 已完成的主要提交链

最近与“原主界面画布协作”直接相关的提交如下：

| Commit | 内容摘要 |
| --- | --- |
| `00839fd03` | Phase 11 Knowledge Base header 归属选择器迁移为 canvas wording，并消费 canvas metadata 标签 |
| `153bdbd6b` | Phase 11 workspace permissions API 用户可见错误迁移为 canvas wording |
| `da309e00c` | Phase 11 organization invitation batch grant 错误迁移为 canvas wording |
| `a7cbaace0` | Phase 11 form/chat fallback 和 credential-account 成功页返回文案迁移为 canvas wording |
| `bb00136e7` | Phase 11 invitation 接收页、发送 fallback 和邀请 API 错误迁移为 canvas wording |
| `3838424e6` | Phase 11 公共模板编辑入口消费 canvas metadata 并迁移 workspace 文案 |
| `56d4905ae` | Phase 11 invite/email/published visibility 用户可见 workspace 文案迁移为 canvas wording |
| `4bff93528` | Phase 11 settings/sidebar 深层用户可见 workspace 文案迁移为 canvas/resources wording |
| `629062e92` | Phase 11 `/workspace` 根入口优先使用最近访问 canvas，并补选择器单测 |
| `be6856618` | Phase 11 sidebar invite modal 与团队管理健康/Agent Skill 空态迁移为 canvas wording |
| `ec67e90fe` | Phase 11 settings 中 API keys/BYOK/Inbox/team management 明显可见 workspace 文案迁移为 canvas wording |
| `0af9de617` | Phase 11 workflow MCP server 设置页按钮和说明迁移为 canvas wording |
| `267883e82` | Phase 11 搜索/命令面板 workspace 分组迁移为 canvas entrypoints |
| `dc6a30e75` | Phase 11 原 workspace shell 增加 canvas creation capabilities，并清理 published/showcase workspace 心智泄露 |
| `b27b1794c` | Phase 10 项目管理员中心增加失败审计独立 retention cleanup |
| `f39d9d9c1` | Phase 10 通用项目通知中心扩展 SSO 安全设置审计事件类型 |
| `08149ec6f` | Phase 10 通用项目通知中心扩展 subscription cancellation billing 审计事件类型 |
| `2b8fa3329` | Phase 10 通用项目通知中心扩展 invoice payment failed/recovered billing 审计事件类型 |
| `cf1819aaf` | Phase 10 通用项目通知中心扩展 plan switch 和 credits purchase billing 审计事件类型 |
| `ce32155b5` | Phase 10 通用项目通知中心扩展 enterprise cleanup 执行审计事件类型 |
| `e9158bdd2` | Phase 10 通用项目通知中心扩展组织设置和 seat billing 审计事件类型 |
| `eab6a1188` | Phase 10 通用项目通知中心扩展 retention、data drain 和组织管理审计事件类型 |
| `dc9f264cd` | Phase 10 通用项目通知中心扩展成员、团队和 Agent 策略审计事件类型 |
| `260778fb3` | Phase 10 通用项目通知中心扩展发布治理审计事件类型 |
| `0d9e5109c` | Phase 10 项目管理员中心增加通用通知中心独立全屏页 |
| `eeb4c894d` | Phase 10 项目管理员中心增加通用通知中心当前页与当前筛选 CSV 导出 |
| `0287e3875` | Phase 10 项目管理员中心增加通用通知中心筛选、分页和详情 drawer |
| `377e79b13` | Phase 10 项目管理员中心把顶部铃铛扩展为通用项目通知中心首版 |
| `668640513` | Phase 10 项目管理员中心增加发布通知顶部铃铛和已读状态 |
| `a87421c9c` | Phase 10 项目管理员中心增加发布评审 email provider delivery |
| `9e6b652c5` | Phase 10 项目管理员中心增加发布通知持久 inbox |
| `d2ef64eea` | Phase 10 项目管理员中心增加发布评审 webhook provider delivery |
| `ccde418ee` | Phase 10 项目管理员中心增加失败审计 retention controls |
| `c9be7ac83` | Phase 10 项目管理员中心增加失败审计详情 drawer |
| `c673414d7` | Phase 10 项目管理员中心增加失败审计趋势和保留窗口概览 |
| `2ebd2f609` | Phase 10 项目管理员中心增加失败审计历史分页和导出 |
| `4e7ae8d63` | Phase 10 项目管理员中心增加失败审计历史筛选 |
| `2c03e43fd` | Phase 10 项目管理员中心增加服务端失败审计历史面板 |
| `7ce13ca3b` | Phase 10 项目管理员中心增加服务端持久失败审计 |
| `203fc6576` | Phase 10 项目管理员中心增加发布通知持久 outbox |
| `dfeb172a4` | Phase 10 项目管理员中心增加服务端发布通知投递记录 |
| `061707461` | Phase 10 项目管理员中心增加失败操作审计 |
| `0442cb600` | Phase 10 项目管理员中心增加发布通知投递草稿 |
| `2d3ae9469` | Phase 10 项目管理员中心增加发布依赖冲突处理动作 |
| `35a87ff16` | Phase 10 项目管理员中心增加发布评审通知队列 |
| `6f31152e4` | Phase 10 项目管理员中心增加跨团队依赖冲突提示 |
| `84132a953` | Phase 10 项目管理员中心增加发布 approval workflow |
| `cb6531c5d` | Phase 10 项目管理员中心增加发布 reviewer 指派 |
| `fb1c909d7` | Phase 10 项目管理员中心增加风险 Skill guardrails |
| `116dec10b` | Phase 10 项目管理员中心增加过期/未提交团队发布 nudges |
| `c7b82e93e` | Phase 10 项目管理员中心增加 Agent Skill 跨团队策略复制 |
| `57aced7ad` | Phase 10 项目管理员中心增加发布冲突修复向导 |
| `8532fa28d` | Phase 10 项目管理员中心增加发布详情编辑 |
| `2e56fadfb` | Phase 10 项目管理员中心增加节点级发布 diff preview |
| `95fe059ec` | Phase 10 项目管理员中心增加 Agent 策略影响预览 |
| `a66239ea2` | Phase 10 项目管理员中心增加发布依赖影响预览 |
| `010cefa87` | Phase 10 项目管理员中心增加发布批量治理动作 |
| `1a9bdea0e` | Phase 10 项目管理员中心增加项目级 Agent Skill 策略 |
| `4cb9a6e16` | Phase 10 项目管理员中心增加发布冲突处理动作 |
| `bde7e2885` | Phase 10 项目管理员中心增加发布冲突检测 |
| `3989ab628` | Phase 10 项目管理员中心增加发布版本 diff preview |
| `a097b0956` | Phase 10 项目管理员中心增加发布治理详情 drawer |
| `0e79d8334` | Phase 10 项目管理员中心增加项目级发布治理写操作 |
| `e49f51318` | Phase 10 项目管理员中心增加项目级 Agent 模板 |
| `e32b0f1cf` | Phase 10 项目管理员中心增加团队归档操作 |
| `0dbb16899` | 项目级 activity 增加批量成员分配聚合事件 |
| `42a68ed2b` | 项目管理员成员批量分配改为事务性 bulk API |
| `10cdf0d00` | 项目管理员成员分配增加智能团队建议 |
| `ee0528e98` | 项目级 activity drilldown 增加当前筛选全量 CSV 导出 |
| `8d6802782` | 项目级 activity drilldown 增加时间范围与 actor 精确筛选 |
| `037cb78d8` | 项目级 activity drilldown 增加 offset 分页、当前页 CSV 导出、服务测试和接手文档更新 |
| `3747a0071` | 新增团队协作活动日志 API、React Query hook、团队管理页日志区块，并把个人草稿删除弹窗文案从 workspace 改为 canvas |
| `6b813eca6` | Sidebar 增加 workgroup canvas switcher，多团队用户可切换团队上下文并进入对应个人/团队画布 |
| `3ecddd26c` | 团队管理页增加团队发布创建控件，可从团队 workflow 发布 showcase |
| `0c78c65cd` | 新增团队 Agent Skill 管理 API 和团队管理页开关能力 |
| `0309066b8` | 跨画布工具按当前 workgroup 作用域执行，删除不再使用的 workbench shell |
| `25710e4e1` | 个人草稿画布切换器只显示当前 active workgroup 下的个人草稿 |
| `1fb18b3d9` | 原 shell 团队发布生命周期面板，支持归档/撤回 |
| `d87609e32` | 团队邀请 pending/resend/cancel 管理 |
| `d35ec6c0a` | 团队邀请接受后写入 workgroup membership |
| `9e8b881ff` | 原 shell 团队管理页基础能力 |
| `63ae85bcc` | 原 shell 下新增 split canvas workbench 首个切片 |
| `29d187085` | workflow 右键菜单接入跨画布复制入口 |
| `b724d903f` | 后端跨画布 selection copy 权限和数据清洗加固 |
| `d96d87df9` | 发布生命周期后端路由与状态 |
| `9974a6cd8` | 展示画布状态树元数据扩展 |
| `595359119` 及之前 Phase 4 提交 | 画布权限、文件、日志、凭证、Copilot、Realtime 只读边界加固 |

## 3. 已完成能力清单

### 3.1 原主界面入口与视觉纠偏

已完成：

- `/workspace/[workspaceId]/home` 保留原 Copilot/Mothership 首页能力，同时增加三张原风格入口卡片：个人草稿画布、团队画布、展示画布。
- 样式沿用原前端 token：`var(--bg)`、`var(--surface-*)`、`var(--border)`、`text-[var(--text-body)]`、小图标、8px 圆角和原 spacing。
- Sidebar 增加 `Canvases` 分组，用户在深层 workflow、showcase、team-management、split 页面都能切回三类画布。
- 旧 `/workbench` 路由保留兼容 redirect，不再作为主要产品外壳。
- `Published workflows` 从普通 Workspace 分组迁出，展示类入口收敛到 `Showcase canvas`。
- 最新提交进一步把个人草稿删除确认弹窗从 `Delete Workspace` 调整为 `Delete Canvas`，减少主入口里的 workspace 心智泄露。
- `dc6a30e75` 起 `/api/workspaces` 的合约响应包含 `canvasCreationCapabilities`；服务端基于当前用户 active workgroup membership 推导是否可创建个人草稿画布，以及是否存在“当前用户是 admin 且尚未初始化团队画布”的团队画布创建机会。Sidebar 顶部个人草稿创建按钮不再只靠本地 `activeWorkgroupId` 判断，Home 的团队画布初始化入口也会同时看服务端 capability。
- `dc6a30e75` 同步把 Published/Showcase 表格列名和空状态提示从 `Team Workspace` / `current workspace` 改为 `Team Canvas` / workgroup canvas 语义，避免普通用户在展示入口看到底层 workspace 配置提示。
- `267883e82` 把 Sidebar 搜索/命令面板里的 workspace 切换分组迁移成 `Canvases`：搜索项从 `/api/workspaces` rows 继承 `canvasScope` 与 `isInternalWorkspace`，展示 `Personal draft canvas` / `Team canvas` / `Legacy canvas` 标签，搜索关键词也从 `workspace-{id}` 改为 `canvas-{id}`，减少 command palette 里的 workspace 主心智。
- `0af9de617` 先迁移设置页中 workflow MCP server 详情区的普通用户可见按钮和提示：`Add to Workspace` / `Added to Workspace` / “add server to workspace” 已改为 canvas 语义；底层变量仍保留 `workspaceId`，因为 MCP server 绑定关系当前仍以 workspace/canvas 容器 ID 为内部资源键。
- `ec67e90fe` 继续迁移 settings 内其他高频用户可见文案：API keys 的 `Workspace` 分组显示为 `Canvas`，创建 modal 说明改为“all workflows in this canvas”；BYOK 删除/保存说明、Inbox email task 说明、team management 的 invite dropdown、organization roster 空态/搜索提示、no-organization 空态和外部成员移除确认均改为 canvas 语义。该提交不改内部 keyType、workspace permission 或组织 roster 数据模型。
- `be6856618` 补齐 sidebar header 的邀请弹窗和原 shell 团队管理页中的残留普通用户文案：外部邀请、已是成员、移除成员、fallback modal title、team canvas health permission 检查，以及 Agent Skill 空态均使用 canvas wording；权限 mutation、pending invitation 和 `teamWorkspaceId` 命名仍是内部实现。
- `629062e92` 把 `/workspace` 根入口的 legacy workspace fallback 抽成 `selectCanvasLandingTarget`：选择顺序改为 local recency -> server last-active -> default workgroup team canvas -> default workgroup personal canvas -> 其他 team/personal/legacy canvas，并补单测覆盖“最近个人草稿不被默认团队画布覆盖”“local recency 失效时使用 server last-active”“首次进入仍回默认团队画布”。该切片修复了此前 default workgroup 有 team canvas 时过早 redirect、导致 `redirect_workflow` 和最近访问都无法参与决策的问题。
- `4bff93528` 继续补 settings/sidebar 深层残留文案：Integrations 分享按钮与错误、Atlassian credential 重名错误、Secrets 的 canvas secret/override/分组、Inbox enable 说明、Subscription plan feature 和 billed-account tooltip、ownership transfer 的 shared canvas 影响提示，以及 sidebar aria label/resource 分组均使用 canvas/resources 语义。该提交只改用户可见文案，不改 `workspaceId`、`env_workspace`、API path 或权限数据模型。
- `56d4905ae` 继续迁移邀请和发布列表边界：未登录 invite 接收页从“join this workspace”改为“join this canvas”，单个 workspace invitation email 的 preview/body 默认称为 canvas，批量邀请邮件的 team role 说明、canvas access 分组和 subject 改为 canvas，Published/Showcase visibility 中的 `workspace` 可见范围显示为 `Owner canvas only`。该提交不改 invitation grant schema、`workspaceName` 参数或 publication visibility enum。
- `3838424e6` 继续迁移公共模板详情页的编辑入口：`/templates/[id]` 的可编辑目标列表从 `/api/workspaces` 保留 `canvasScope` / `isInternalWorkspace`，下拉二级文案显示 `Personal draft canvas` / `Team canvas` / `Legacy canvas`，无写权限空态改为 `No canvases with write access`，无模板源访问提示改为 canvas containing this template。该提交不改 template use/import API 的 `workspaceId` 参数。
- `bb00136e7` 继续迁移 invitation 错误边界：invite 接收页 fallback title/error、`sendInvitationEmail` 的缺失 grant 与未知目标 fallback、`prepareWorkspaceInvitationContext` 的 not found / personal shared-member / duplicate access / pending invite 错误，以及 `PATCH/DELETE/POST /api/invitations/[id](/resend)` 的权限、缺失 canvas、外部邀请和 grant 更新错误均改为 canvas wording。该提交同步更新相关 route tests，仍不改 `kind = workspace`、grant `workspaceId`、`workspaceName` 或权限 helper 内部命名。
- `a7cbaace0` 继续清理旧入口 fallback：form 和 chat embed 不可用状态页的按钮从 `Return to Workspace` 改为 `Return to Canvas`，credential-account 邀请接受后 provider 已连接状态从 `Redirecting to workspace...` 改为 `Redirecting to canvas...`。该提交只改用户可见文案，仍保留 `/workspace` 作为兼容 landing route。
- `da309e00c` 继续迁移组织邀请 batch grant 的错误边界：空 grant 选择提示、隐藏个人画布 404、缺少画布邀请权限、非组织画布和跨组织画布错误均改为 canvas wording，并同步更新 `app/api/organizations/[id]/invitations/route.test.ts`。该提交只改用户可见错误，不改 `workspaceInvitations` request 字段、`workspaceGrantsPerInvite` response 字段或 `hasWorkspaceAdminAccess` 内部权限模型。
- `153bdbd6b` 继续迁移 canvas 成员/权限 API 的用户可见错误：`GET/PATCH /api/workspaces/[id]/permissions` 的 not found、personal shared permission、personal shared member、owner permission、billing account admin 和 fetch/update fallback 错误均改为 canvas wording，并同步更新 route tests。该提交不改 contract path、permission entityType、audit resource 或权限 helper 命名。
- `00839fd03` 继续迁移 Knowledge Base 详情页深层旧入口：归属选择器 tooltip、空态、未归属项和无写权限提示从 workspace 改为 canvas，并在可选目标下方显示 `Personal draft canvas` / `Team canvas` / `Project canvas` / `Legacy canvas` 与权限级别，复用 `/api/workspaces` 已返回的 `canvasScope` / `isInternalWorkspace` 元数据。该提交只改用户可见下拉文案与展示标签，不改 `currentWorkspaceId`、knowledge update payload 或底层 workspace 容器。

仍需注意：

- 代码内部仍大量使用 `workspace` 命名，这是底层模型和路径兼容需要；用户可见主路径应继续逐步替换为 canvas 语义。
- Workspace 技术设置页和 sidebar header 邀请弹窗已开始迁移 workflow MCP server、API keys、BYOK、Inbox、Integrations、Secrets、Subscription、team management invite/roster/no-organization/remove-member/ownership transfer、团队健康检查、Agent Skill 空态、invite/email、邀请错误、组织批量邀请错误、canvas permission 错误、form/chat/credential-account fallback、published visibility、公共 templates edit selector 和 Knowledge Base header 归属选择器中的明显可见文案；`/workspace` 根入口已开始消费 recent/last-active canvas 语义；product tour 与 split mobile pane 当前未发现明显 workspace 用户文案，Recently Deleted 当前未发现明显 workspace 用户文案，mobile nav/onboarding 等深层旧入口后续仍需 Phase 11 系统排查；技术资源名确实以 workspace 为授权边界时应谨慎保留。

### 3.2 个人草稿画布

已完成：

- 原 Sidebar 顶部 workspace 下拉已变成个人草稿画布切换器。
- 下拉只列出当前 active workgroup 下 `canvasScope = personal` 的个人草稿。
- `+ New personal draft canvas` 使用协作专用 `POST /api/workgroups/[workgroupId]/personal-workspace`，不再依赖组织级 `POST /api/workspaces` 创建策略。
- 普通团队成员可以创建多个个人草稿画布。
- 新建个人草稿后自动创建默认 workflow，并直接进入默认节点图。
- 数据库迁移已去掉 `userId + workgroupId` 唯一约束，支持同一用户同一团队下多个个人草稿。
- 个人草稿 owner-only 权限已纳入 `checkWorkspaceAccess`、`listAccessibleWorkspaceIds`、workflow authz、文件、日志、凭证、Copilot 等路径加固。

仍需继续：

- 个人草稿归档、排序、最近打开、重命名体验还有提升空间。
- 如果后续要做“管理员接管个人草稿”，必须单独设计审批和审计；v1 当前不做。

### 3.3 团队画布

已完成：

- Sidebar 有 `Team canvas` / `Initialize team canvas` 入口。
- 普通成员只能进入已有团队画布；团队管理员可以初始化团队画布。
- 团队画布初始化会创建默认 workflow，并给团队成员同步 workspace permission。
- 新增团队画布初始化 audit 记录，团队活动日志可展示该事件。
- 多 workgroup 用户可在 Sidebar 的轻量切换器中切换团队上下文。
- 当前团队解析会优先使用当前 workspace 的 `workgroupId`，避免非默认团队个人草稿误操作到默认团队。

仍需继续：

- v1 仍是每个 workgroup 一个 `teamWorkspaceId`。如果产品确认一个团队需要多个团队画布，需要新增 `team_canvas_workspace` 表及配套 API。
- 团队画布 presence 头像和协作健康状态仍需要更完整 UI。

### 3.4 展示画布与发布版本

已完成：

- 新增原 shell 下 `/workspace/[workspaceId]/showcase` 和详情页，展示画布打开后仍保留 Sidebar。
- 展示画布复用 publication snapshot，不直接读取可变团队 live workflow。
- 发布树已扩展 `description`、`status`、`visibility`、`sourceWorkgroup`、`sourceDiscipline`、`agentCode`、`dependsOnPublicationIds` 等元数据。
- 发布生命周期支持 `published`、`superseded`、`archived`、`retracted` 等状态。
- 团队管理员可在团队管理页发布团队 workflow，并选择组织可见或指定团队可见。
- 团队管理员可在发布后继续编辑可见范围，在组织可见和指定团队可见之间切换，并更新目标团队列表。
- 团队管理员可归档、撤回，或把历史版本恢复为当前发布版本。
- 团队管理员可维护发布版本的 `reviewState` 与 `riskLevel`，当前枚举为 `pending`、`in_review`、`approved`、`changes_requested`、`rejected` 以及 `low`、`medium`、`high`、`critical`。
- 发布、可见范围更新、归档、撤回、恢复当前版本、审核/风险更新已写入 audit；对可见的其他团队会额外写入 team activity 广播事件。
- `/workspace/[workspaceId]/showcase` 已新增首版全局状态树聚合面板，按工种、团队和 Agent 聚合可见发布，展示当前/最新版本、历史版本、状态、可见范围和可见依赖版本。
- 状态树面板已补治理提示：同一工种/团队/Agent 下多个当前版本、critical risk 会标红；缺少当前 published 版本、当前版本超过默认 14 天未更新、当前版本未 approved 会标黄。

仍需继续：

- 全局状态树目前已有首版聚合视图，但还不是完整项目级治理视图。
- 发布通知/广播已有首版 team activity 事件，版本回滚已有“恢复为当前版本”首版能力，审核/风险字段、reviewer 指派、approval workflow、跨团队依赖冲突提示、依赖冲突处理动作和项目管理员中心评审通知队列已有管理入口；项目管理员中心已补 in-app digest、email digest 和 webhook payload 投递草稿，并新增服务端 `POST /api/organizations/[id]/publications/notifications` 记录通知投递、写入 `notification.created` audit、回流到项目 activity filter；最新切片已把 in-app/email/webhook delivery body 持久化到 `outbox_event`，让 cron outbox processor 注册 `collaboration.publication-review-digest` handler；webhook channel 通过 SSRF-safe `secureFetchWithValidation` 发送结构化 provider payload，email channel 已可输入收件人并通过通用 `sendEmail` 邮件 provider 后台发送；跨会话站内铃铛收件箱已有项目管理员中心内的持久 inbox 首版，并新增原 sidebar 顶部项目管理员通知铃铛；已读状态以 `audit_log.metadata.readAtByUserId` 按用户保存，中心页和顶部铃铛都可单条或批量标记已读。后续如果要扩展到所有通知类型，还需把当前发布评审 inbox 抽象成通用 bell shell。

### 3.5 跨画布复制与分屏

已完成：

- `POST /api/workflows/[id]/copy-selection` 已完成服务端权限边界：源 workflow read、目标 workflow write、源/目标 canvas type 校验、目标 workflow/workspace 一致性校验。
- 复制会重写 block/edge ID，只复制 selection 内合法边，并返回 `mappings.blockIds` / `mappings.edgeIds` 供前端高亮。
- `sanitizeWorkflowSnapshot` 已增强文件字段脱敏，降低个人/团队/展示之间复制时泄露私有文件引用的风险。
- 原 workflow 右键菜单已有 `Copy to team canvas` / `Copy to personal draft` 入口。
- `/workspace/[workspaceId]/split` 已有首个原 shell 分屏切片，桌面左右 pane 默认加载个人草稿和团队画布，移动端已优化为单 pane tab 切换。
- 分屏 pane 已支持独立多节点选择：普通点击替换当前 pane selection，Shift/Ctrl/Cmd-click 追加或移除节点。
- 分屏复制成功后会按 `mappings.blockIds` 在目标 pane 选中新生成节点，作为复制结果高亮；复制 payload 会带上当前 pane 的多节点 `blockIds`，服务端继续自动复制 selection 内部合法边。
- 分屏复制 placement 已从固定 offset 升级为优先对齐目标 pane 当前可见视口中心；如果目标 viewport 尚未上报，则回退到安全固定 offset。
- 分屏 pane 已支持显式边选择：点击边可把 `edgeIds` 带入 copy-selection；未选边时仍复制所选节点之间的全部内部合法边，选边后只复制两端节点也被选中的连接。目标 pane 会用 `mappings.edgeIds` 高亮新连接。
- 分屏复制结果已支持自动定位动画：目标 pane 在 workflow state 刷新出新节点后，会把新复制节点 fit 到可见区域，同时继续上报 viewport 给下一次 placement 使用。
- 分屏 pane 已支持按 pane/workflow 维度持久化 viewport：左右 pane 的 pan/zoom 会分别写入本地存储，重新打开同一 workflow 时优先恢复该 pane 的视口；未保存过视口的 workflow 仍走自动 fit。
- 分屏移动端已从上下堆叠改为 tab：一次只显示一个 pane，切换 tab 会同步复制源 pane，复制成功后自动切到目标 pane 查看高亮结果。
- 分屏 pane 已新增 `Box select` 模式：管理员/成员可在个人草稿或团队画布预览中拖拽框选多个节点，支持触摸指针事件，并可按 Shift/Ctrl/Cmd 叠加到当前 selection。

仍需继续：

- 当前分屏是“只读预览 + 显式复制”，不是两个完整可编辑 ReactFlow 编辑器。
- 完整双编辑器 store 隔离仍需 Phase 7 后续实现；框选已完成首版，后续可继续补键盘快捷键和更细的触摸提示。

### 3.6 团队管理闭环

已完成：

- `/workspace/[workspaceId]/team-management` 已在原 shell 下落地，普通成员看到权限提示，团队管理员可进入管理功能。
- 管理员可添加已有用户，支持 email 或 userId。
- 管理员可发送 team canvas invitation，接受后自动加入对应 workgroup。
- 管理员可在邀请 tab 中一次输入多个 email（逗号、空格或换行分隔）批量发送 team canvas invitation，接受后自动加入对应 workgroup；提交后会逐项显示 sent、already member、pending invite、invalid email、failed 等结果。
- Pending invitations 支持查看、重发、取消，并显示过期或 48 小时内即将过期的视觉状态，方便管理员决定重发或取消。
- 管理员可更新成员 role、移除成员；服务端保护最后一个 admin 不被降级或移除。
- 发布创建表单、发布生命周期面板、Agent Skill 管理、团队活动日志已经接入同一个团队管理页。
- 最新活动日志切片新增 `GET /api/workgroups/[workgroupId]/activity`，按团队上下文聚合 `audit_log` 中的成员、团队画布初始化、发布、Agent Skill 事件。
- 团队管理页已按原 shell 风格拆成 `Members`、`Invites`、`Publications`、`Agent Skill`、`Activity` 五个本地 tab；所有原有 hooks、表单和操作仍在同一页面内复用，只改变信息架构，避免单页无限下滚。
- 团队管理页顶部新增 `Team canvas health` 概览，管理员可直接看到团队画布是否初始化、是否存在 workflow graph、workgroup 成员和 team workspace permission 是否同步，以及最近展示发布版本状态。
- `Team canvas health` 已补一键修复按钮，可在原页面内初始化缺失的 team canvas、为已有 team workspace 创建默认 workflow graph，并按 workgroup role 同步可修复的 team workspace permission；修复动作复用现有 team workspace、workflow、workspace permissions API 和既有 audit。

仍需继续：

- 批量邀请、邀请过期视觉状态和逐项结果反馈已完成首版；后续仍可补更深的投递失败根因、seat/权限失败的审计归因。
- 团队管理页 tab 已完成首版；后续如功能继续膨胀，可再把复杂发布治理或成员批量操作拆成 drawer。
- 权限拒绝类 warn 是否写 audit 还未完整设计。
- 团队画布健康状态和一键修复已完成首版；后续可继续补更明确的失败操作审计规则、owner/billing 特殊权限人工处理提示和健康修复历史。

### 3.7 Copilot 与 Agent

已完成：

- 已有 11 个工种到 10 个 Agent 的定义与映射，PMO 复用 `chief_director`。
- Copilot workspace context 能注入当前 workgroup/discipline/agent 上下文。
- 团队管理员可对当前团队 Agent Skill 做 team override 启用/禁用。
- Copilot context、resources、VFS、metadata、server write tools 已做 Phase 4 权限加固和脱敏。

仍需继续：

- 10 个 Agent 的 system prompt、默认 skill、工具边界和项目级模板配置仍未完整产品化。
- 切换 active workgroup 后 Copilot Agent 行为需要更多端到端验证。

### 3.8 项目管理员中心

已完成：

- `/workspace/[workspaceId]/project-admin` 已在原 shell 下新增首个只读项目管理员中心。
- Sidebar 会在当前用户具备组织 owner/admin 语义时显示 `Project admin` 入口；普通团队管理员仍使用 `Team management`。
- 项目管理员中心复用现有 `useMyWorkgroups`、`useOrganizationWorkgroups`、`useDisciplines`、`useAgentProfiles`，并新增组织级 publication list 读取能力；写操作继续走合约路由和服务层权限判断。
- 首版概览显示工种覆盖率、团队数量、成员数量、当前可见展示发布数量，以及 critical risk、未审核发布、缺失 team canvas 的治理 watchlist。
- 项目管理员可在中心页创建新的工种团队；创建动作复用现有 `useCreateWorkgroup`、`POST /api/organizations/[id]/workgroups` 和 `createWorkgroup` 服务，仍由 `assertOrganizationAdmin` 保护，并自动生成 team canvas 与默认 workflow graph。
- 项目管理员可在中心页从组织 roster 选择既有用户，或按 email/user ID 手动输入，把用户分配到任意团队并选择普通成员或团队管理员角色；成员分配表单会基于 roster 成员当前 team canvas access 和团队人数推荐一个尚未加入且人数最少的团队，并自动作为默认目标；动作复用 `useOrganizationRoster`、`useAddWorkgroupMember`、`POST /api/workgroups/[workgroupId]/members`、`addWorkgroupMember`，仍走既有 workgroup admin/org admin 权限判断。
- 项目管理员成员分配表单已补事务性批量分配首版：textarea 接收 email/user ID，按逗号、空格、分号或换行拆分并去重，使用 `useBatchAddWorkgroupMembers` 调用新的 `POST /api/workgroups/[workgroupId]/members/batch`；服务端会先解析全部目标，再在一个 DB transaction 内 upsert 成员和 team canvas 权限，任一目标无效则整批不提交。
- 事务性批量分配已补项目级聚合审计：每次 bulk API 成功后额外写入 `member.batch_assigned` 事件，记录 targetCount、targetUserIds 和 batchOperationId；项目 activity 可按 `Batch member assignment` 筛选并导出该聚合行。
- 项目管理员中心已补团队归档首版：新增 `POST /api/workgroups/[workgroupId]/archive` 合约路由和 `archiveWorkgroup` 服务，仅组织 owner/admin 可将 workgroup 与对应 team workspace 一起标记 archived；用户团队列表、团队画布权限和发布权限默认排除已归档团队，并写入 `workgroup.archived` activity。
- 项目管理员中心已补项目级 Agent 模板首版：新增 `organization_agent_template` 表、`GET/PATCH /api/organizations/[id]/agent-templates` 合约路由、React Query hook 和 UI 区块；项目管理员可按 Agent 查看关联工种、预览基础 system prompt，并维护会追加到 `resolveAgentForWorkspace` 返回 prompt 的项目级补充说明。
- 项目级 Agent 模板更新会写入 `agent_template.updated` 审计事件；项目级 activity 支持按该动作筛选，且项目级审计行仅在未按团队/工种下钻时进入全项目 activity。
- 项目管理员中心已补项目级 Agent Skill 默认策略首版：新增 `GET/PATCH /api/organizations/[id]/agent-skills` 合约路由、`useOrganizationAgentSkillPolicies` / `useUpdateOrganizationAgentSkillPolicy` 和 UI 区块；项目管理员可按 Agent 查看匹配团队画布中的 Skill，并设置默认启用/禁用策略，团队管理员仍可在团队管理页用 team override 做本地调整。
- 项目级 Agent Skill 策略更新复用 `agent_skill_binding` 的 `agent_template` scope、写入 `skill.updated` 审计事件，并同步更新 API validation route baseline 到 `total=755, zod=730, nonZod=25`。
- 项目管理员中心已补 Agent 策略影响预览首版：在 Project Agent templates 内按当前 Agent 汇总受影响工种、团队画布、当前展示发布、未 approved current、critical risk current、Prompt 字符变化和项目级 Skill 默认启用/禁用姿态，方便保存模板或调整默认 Skill 前先判断影响面。
- 项目管理员中心已补 Agent Skill 跨团队策略复制首版：在项目级 Skill 默认策略区展示重复 Skill 名称的 copy candidates，并可从任意行把 enabled/disabled 默认姿态复制到同名且当前姿态不同的匹配团队画布 Skill；底层仍逐条复用既有组织级 Skill policy mutation、React Query 失效和审计链路。
- 项目管理员中心已补风险 Skill guardrails 首版：在当前 Agent 的项目级 Skill 默认策略中，用 `delete/deploy/execute/publish/credential/secret/api key/webhook/file/write` 等风险关键词识别已启用的 action-oriented 默认 Skill；如果该 Agent 当前承载 critical risk 发布则以 danger 语气提示，并可一键批量禁用这些 project-default Skill，底层仍复用既有组织级 Skill policy mutation、React Query 失效和审计链路。
- 项目管理员中心已补项目级发布状态树治理写操作首版：新增 `GET /api/organizations/[id]/publications` 合约路由和 `useOrganizationPublications`，组织管理员可跨全组织读取 published、superseded、archived、retracted 发布版本；中心页可直接维护 review/risk，执行 archive、retract、restore，底层复用既有 publication lifecycle/review 服务审计和权限边界。
- 项目管理员中心已补发布治理详情 drawer 首版：每个发布版本可打开右侧详情面板，查看 review/risk/status/visibility、restore 影响说明、父版本和 dependsOn 链路；同时 `canReadPublication` 已允许组织 owner/admin 读取 selected-workgroups 发布的 tree 详情，保证项目管理员能进行跨团队状态树审阅。
- 发布治理 drawer 已补真实 snapshot diff preview 首版：打开非 retracted 版本时会加载 restore candidate 与当前 published 版本详情，比较 blocks、edges、loops、parallels、variables、workflow metadata 和 block type 计数差异，用于恢复前快速评估结构变化。
- 发布治理 drawer 已补节点级 diff preview 首版：在 restore impact preview 中继续展开 added/removed/changed blocks、added/removed/changed edges 和变量变化清单，并展示 block type、连接端点和 top-level changed fields，方便项目管理员在恢复前定位具体节点和连线影响。
- 项目管理员中心已补发布冲突检测首版：复用 publication state tree 分组逻辑，在 KPI、Governance watchlist、发布列表和发布详情 drawer 中标出多 current version、无 current version、过期 current、未 approved current、critical-risk current 等状态树治理告警。
- 项目管理员中心已补发布冲突处理动作首版：在发布详情 drawer 的 `Conflict detection` 区块中可针对多 current version 逐个归档额外当前版本、针对无 current version 恢复最新可见版本、针对未审核 current 一键标记 approved、针对过期 current 发起 refresh review、针对 critical risk current 将风险降为 high；所有动作复用既有 publication lifecycle/review mutation、服务层审计和权限边界。
- 项目管理员中心已补发布冲突修复向导首版：把 state tree governance alerts 转成按顺序执行的 repair guide，先解释多 current / 无 current / 未审核 / 过期 / critical risk 的修复顺序、推荐动作和治理原因，再连接到既有 `Resolution actions`。
- 项目管理员中心已补发布批量治理首版：在 `Project publication governance` 顶部新增 `Batch governance actions`，可跨全局状态树批量 approve 未审核 current、批量把 stale current 标记为 refresh review、批量把 critical risk current 降为 high、批量归档 duplicate current、批量恢复缺失 current 的最新可见版本；每个批量动作仍逐条复用既有 publication review/lifecycle mutation 和审计链路。
- 项目管理员中心已补团队发布 nudge 首版：基于组织团队列表和 publication state tree 构建 stale current、missing current、never published 三类团队提示，项目管理员可直接发起 refresh review、恢复最新可见版本，或跳转团队管理页推动首次发布。
- 发布治理 drawer 已补依赖影响预览首版：基于组织级 publication list 和当前 publication tree，在恢复、归档或撤回前展示直接依赖、直接依赖当前版本的下游发布、同一版本家族中的 parent/dependsOn 链路，并把 current 下游、critical risk 下游、未 approved 下游和无法解析的直接依赖标成风险提示。
- 项目管理员中心已补跨团队依赖冲突提示首版：基于 publication state tree 识别当前发布依赖缺失版本、非当前跨团队基线、未 approved 依赖和 critical-risk 依赖；`Project publication governance` 与 `Governance watchlist` 会展示 dependency alerts，并可直接打开源发布或依赖发布详情。
- 发布治理 drawer 已补发布详情编辑首版：项目管理员可在详情 drawer 中编辑发布 title/description，新的 `PATCH /api/publications/[publicationVersionId]/details` 走合约、服务层 workgroup/org admin 权限、审计和 team activity 广播，并同步镜像到 published workflow shell。
- 项目管理员中心已补发布 reviewer 指派首版：`workflow_publication_version` 新增 reviewer assignment 字段，`PATCH /api/publications/[publicationVersionId]/review` 可在保留 review/risk 的同时指派或清空组织 roster 成员作为 reviewer；项目级发布治理列表和详情 drawer 会显示当前 reviewer，服务层校验 reviewer 必须属于同一组织，并继续写入 `publication.updated` 审计。
- 项目管理员中心已补发布 approval workflow 首版：详情 drawer 新增 reviewer / review / critical-risk / decision gates 审批门禁，展示 complete/ready/blocked 状态，并复用现有 review/risk mutation 执行 start review、set risk high、approve、request changes、reject。
- 项目管理员中心已补失败操作审计首版并接入服务端持久审计：创建/归档团队、成员分配、批量导入、activity 导出、项目级 Agent 模板与 Skill 策略、发布详情/review/reviewer/lifecycle/依赖处理/批量治理和通知投递失败时，会继续记录到本地 session failure audit，按 scope 汇总数量、展示最新失败和最近 12 条失败明细，并可一键清空；同时新增 `POST /api/organizations/[id]/project-admin/failures` 合约路由、`useRecordProjectAdminFailureAudit` hook 和服务层 `recordProjectAdminFailureAudit`，组织管理员的失败操作会写入 `project_admin_failure.recorded` audit，metadata 保留 `failureId`、scope、operation、target 和 message；组织 activity response 已扩展 `projectAdminFailure` 结构化字段，Project Admin Center 的 Failure audit 面板会直接查询服务端持久失败历史，并可按失败 scope、actor 精确值、开始/结束日期筛选、翻页、导出当前页 CSV 或导出当前筛选下的全部失败历史；最新趋势卡会抽样最近 100 条持久失败，显示 24 小时失败数、7 天趋势数、Top scope、unique actors 和已加载时间范围，并提示在组织 retention cleanup 前导出证据；该趋势卡内已接入组织 Data Retention 的只读控制入口，直接读取 `useOrganizationRetention` 展示 effective/configured/default log retention hours，并跳转 `/workspace/[workspaceId]/settings/data-retention` 管理组织日志保留策略；持久失败历史行可打开详情 drawer，查看 failure message、failureId、scope、target、actor、team、discipline、audit row id、action、resource 和 retention 提醒；Project activity filter 也可选择 `Project admin failure` 做全量筛选。
- 项目管理员中心已补服务端通知投递记录、持久 outbox、webhook/email provider delivery、持久通知 inbox 和通用项目通知中心顶部铃铛首版：新增 `POST /api/organizations/[id]/publications/notifications` 合约路由、`useDeliverPublicationNotifications` 和服务层 `deliverOrganizationPublicationNotifications`，服务端会按当前组织发布状态树重新计算 review notification queue，针对 in-app/email/webhook channel 返回规范 delivery body，并把 delivery body、publicationIds、severity counts、channel、email recipients 和 webhook URL 写入 `outbox_event`；`/api/webhooks/outbox/process` 已注册 `collaboration.publication-review-digest` handler，in-app channel 完成持久记录消费，email channel 通过通用 `sendEmail` 使用 Resend/Azure/本地 logging fallback 投递，webhook channel 通过 SSRF-safe `secureFetchWithValidation` 发送结构化 provider payload，provider 失败会抛出可重试错误；同时写入 `notification.created` audit，metadata 包含 `outboxEventId`、title/detail/body 和 severity counts，项目 activity filters 新增 `Notification delivery`，中心页投递时会刷新项目 activity，in-app 仍回写当前浏览器 bell，并额外通过 `GET /api/organizations/[id]/publications/notifications/inbox` 在项目管理员中心显示跨会话持久 inbox；随后把 inbox response 扩展为 `readAt`，新增 `PATCH /api/organizations/[id]/publications/notifications/inbox` 标记单条或全部已读，并在原 sidebar 顶部新增项目管理员专用铃铛，显示最近 10 条发布评审通知和未读红点；之后新增 `GET/PATCH /api/organizations/[id]/notifications/center` 通用项目通知中心合约路由和 `useProjectNotificationCenter` / `useMarkProjectNotificationCenterRead` hook，服务层把 `notification.created` 的发布评审 digest、`project_admin_failure.recorded` 的服务端失败审计以及带 `organizationId` metadata 的 `publication.created` / `publication.updated` / `publication.archived` / `publication.retracted` / `publication.restored` 发布治理审计统一映射为 `publication_review` / `project_admin_failure` / `publication_governance` 三类通知，复用 `audit_log.metadata.readAtByUserId` 维护按用户已读状态，并让 sidebar 顶部铃铛切换为通用 `Project notification center`；随后切片把项目管理员中心内的 publication-only persistent inbox 面板替换为通用 `Project notification center` 面板，支持按通知类型筛选、offset 翻页、按当前筛选批量标记已读、单条标记已读，以及右侧详情 drawer 查看 severity、channel、actor、read state、audit row id 和 delivery body；随后切片在该面板补当前页与当前筛选 CSV 导出，导出字段覆盖 audit row ID、通知类型、severity、title/detail、channel/body、数量、actor 和 read state，前端复用合约化 `fetchProjectNotificationCenter` 分页拉取当前筛选，不新增 API route；新增 `/workspace/[workspaceId]/project-notifications` 独立全屏通知中心页，继续保留原 workspace shell，支持更大的 20 条分页视图、类型筛选、未读页内统计、当前筛选批量已读、单条已读、当前页/当前筛选 CSV 导出和右侧详情面板；sidebar 顶部铃铛的通知点击与 `Open full notification center` 会进入该全屏页，项目管理员中心也提供 `Open full center` 链接；随后切片把发布创建、详情/可见范围/review 更新、归档、撤回、恢复等治理审计纳入通用通知中心的 `Publication governance` 类型，归档/撤回按 warning 展示，其他治理事件按 info 展示；最新切片继续把 `member.invited`、`member.batch_assigned`、`member.role_changed`、`member.removed`、`workgroup.archived`、team canvas `workspace.created`、`agent_template.updated` 和 project-default `skill.updated` 映射为 `member_management` / `team_management` / `agent_policy` 三类通知，并补齐这些新审计写入的 `metadata.organizationId`，以便后续筛选、已读和导出走同一套中心能力；注意历史 member/team/publication audit 若缺少 `metadata.organizationId` 不会被 retroactive 纳入中心；email 要求输入 1-20 个收件人并把 digest 交给 outbox handler 后台发送，webhook 则要求输入 HTTPS URL 并把 provider payload 交给 outbox handler 后台发送。
- 通用项目通知中心最新补充 retention、data drain 和组织管理审计：`projectNotificationCenterKindSchema` 新增 `retention_policy`、`data_drain`、`organization_management`，服务层把 data retention 的 `organization.updated`（仅限 `metadata.retentionEvent = data_retention.settings_updated`）、`data_drain.created/updated/deleted/ran/tested`、`org_member.*` 和 `org_invitation.*` 映射进统一中心；前端项目管理员中心、全屏通知中心和 sidebar 顶部铃铛同步增加筛选/徽标文案。为保证组织级筛选和已读状态可复用，最新写入已在 data retention 更新、组织成员角色/移除、组织邀请创建/更新/接受/拒绝/撤销/重发、ownership transfer 等 audit metadata 中补 `organizationId`；data drain audit 之前已带 `organizationId`，历史 retention/org invitation/member audit 若缺少该字段不会被 retroactive 纳入中心，普通 organization settings update 也不会被误归为 retention。
- 随后切片继续新增 `organization_settings` 与 `billing_management` 类型：组织基础设置更新写入 `metadata.organizationEvent = organization.settings_updated`，白标/品牌更新写入 `organization.whitelabel_updated`，seat 变更路由在 Stripe quantity 更新成功后写入 `billingEvent = organization.seats_updated` 并记录 `previousSeats` / `seats`；billing lifecycle 切片继续把组织订阅 plan switch 写入 `organization.plan_switched`，把组织 credit purchase 写入 `credit.purchased` + `billingEvent = organization.credits_purchased`，并通过 `metadata.organizationId` 纳入同一个 `billing_management` 通知类型；个人 credit purchase 刻意不写 `billingEvent` / `organizationId`，因此不会进入项目通知中心。webhook billing 切片新增 `recordOrganizationBillingLifecycleAudit`，在 Stripe `invoice.payment_failed` 阻断组织成员后写入 `organization.invoice_payment_failed`，在后续 `invoice.payment_succeeded` 发现组织从 payment_failed block 中恢复时写入 `organization.invoice_payment_recovered`；失败通知按 warning 展示，恢复通知按 info 展示，未被阻断的普通成功账单不会制造噪声。最新 subscription cancellation 切片让 `handleSubscriptionDeleted` 只在 org-scoped Team/Enterprise 取消时写入 `organization.subscription_cancelled`；个人 Pro cancellation 刻意不写 `billingEvent` / `organizationId`，因此不会进入项目通知中心。该事件在通知中心按 warning 展示，并在 metadata 中携带 `cancellationKind`、`totalOverage`、`remainingOverage`、`restoredProCount`、`membersSynced` 与 `workspacesDetached`，方便项目管理员判断取消订阅后的 dormant transition 影响范围。
- 最新 SSO 安全设置切片继续复用 `organization_settings` 类型：`/api/auth/sso/register` 在组织级 SAML/OIDC provider 注册成功后写入 `metadata.organizationEvent = organization.security_sso_configured`，并记录 `providerId`、`providerType`、`domain`、`issuer` 和 `organizationId`；个人级 SSO provider 不会进入项目通知中心。通用通知中心据此展示 `Organization SSO settings updated`，severity 仍为 info，方便项目管理员在发布/失败/billing 之外看到组织登录安全配置变更。
- 最新失败审计 retention cleanup 切片补齐独立清理入口：新增 `cleanupProjectAdminFailureContract`、`POST /api/organizations/[id]/project-admin/failures/cleanup`、服务层 `cleanupProjectAdminFailureAudit` 和 `useCleanupProjectAdminFailureAudit`。服务端先校验组织管理员，只匹配当前组织下 `action = project_admin_failure.recorded` 且 `createdAt` 早于 cutoff 的 audit row；dry-run 只返回 `matchedCount`，正式执行才删除匹配行，并记录 `organization.updated` + `metadata.cleanupEvent = cleanup.execution_completed` / `jobType = project_admin_failure_audit_retention`。Project Admin Center 的 Audit retention controls 下新增小时窗口输入、`Preview cleanup` 和 `Delete old failures`，删除前要求浏览器确认并提示先导出证据；通用通知中心继续复用 `cleanup_execution` 类型显示 dry-run / cleanup 结果，metadata 保留 `retentionHours`、`cutoff`、`matchedCount`、`deletedCount` 和 `dryRun`。
- 上一切片继续新增 `cleanup_execution` 类型：enterprise cleanup runner 在 `cleanup-logs`、`cleanup-soft-deletes`、`cleanup-tasks` 完成后通过 `recordEnterpriseCleanupAudit` 写入 `organization.updated` audit，metadata 使用 `cleanupEvent = cleanup.execution_completed`，并保留 `jobType`、retention hours、workspaceIds、row/file 删除数量、失败数量和耗时；通用通知中心据此把 cleanup 成功归为 info，把 row/file failure 归为 warning。该能力只针对能解析到 `organizationId` 的 enterprise workspace cleanup scope，free/pro/team 全局 cleanup 不会出现在项目通知中心。
- 项目管理员批量分配已补首版建议填充：基于 organization roster 和当前所选团队的 team canvas access map，提示尚未拥有该团队画布访问权的 roster 成员，并可一键把建议 email 合并进批量输入框。
- 项目管理员批量分配已补文件导入首版：可上传 CSV/TSV/TXT，前端提取 email 或 user ID 并合并进现有批量输入框，仍由管理员显式点击 `Assign batch transaction` 后才批量提交。
- 项目管理员中心新增 `Project activity filters`，可在项目级入口按团队、工种、动作、失败 scope、时间范围、actor 精确值和搜索文本筛选 audit-backed 最近活动；该能力复用新的 `useOrganizationWorkgroupActivity` / `GET /api/organizations/[id]/workgroups/activity`，不走 enterprise audit subscription gate。
- 项目级 activity drilldown 已补分页、时间范围、actor 精确筛选、失败 scope 筛选、当前页与全量 CSV 导出首版：后端 `GET /api/organizations/[id]/workgroups/activity` 支持 `offset + limit + nextOffset`、`startDate/endDate`、`actor` 和 `failureScope`，前端保留当前筛选条件翻页，并可导出当前页或当前筛选下的全部审计活动；Failure audit 历史面板复用同一能力展示 scope / actor / date 下钻结果，并补独立的失败历史分页和 CSV 导出按钮。
- 团队列表可从项目中心跳转到对应团队管理页，复杂写操作仍留在团队级页面。

仍需继续：

- 这仍只是 Phase 10 的阶段性首版；项目级状态树治理已有 review/risk、reviewer 指派、approval workflow、跨团队依赖冲突提示、依赖冲突处理动作、发布评审通知队列、通知投递草稿、服务端通知投递记录、持久通知 outbox、webhook/email provider delivery、持久通知 inbox、通用项目通知中心顶部铃铛和项目中心筛选/详情/导出面板及独立全屏页、发布治理/成员/团队/Agent 策略/retention/data drain/组织管理/组织设置/billing（seat/plan switch/org credits/invoice failure recovery/subscription cancellation）/cleanup 执行审计通知类型、本地失败操作审计、服务端持久失败审计、历史面板、历史筛选、历史分页、CSV 导出、趋势/保留窗口概览、失败详情 drawer、组织日志 retention policy 只读控制入口、lifecycle 写操作、详情 drawer、详情编辑、结构 diff preview、节点级 diff preview、冲突检测、冲突修复向导、首批冲突处理动作、发布批量治理、过期/未提交团队 nudges 和跨团队依赖影响预览，Agent Skill 默认策略已有跨团队复制和风险关键词 guardrails；批量导入目前仍只是前端文件解析，通知投递已进入通用 outbox 持久队列，webhook channel 已接入 SSRF-safe provider 发送，email channel 已接入通用邮件 provider 发送，项目管理员中心已有跨会话持久通知 inbox 首版，最近发布评审通知已有按用户持久化的已读/未读状态，顶部铃铛已扩展为通用项目通知中心首版，可同时显示发布评审 digest、项目管理员失败审计条目、发布治理审计条目、成员/团队管理条目、Agent 策略条目、retention policy 条目、data drain 条目、组织成员/邀请条目、组织设置条目、seat billing、plan switch、组织 credits purchase、invoice payment failed/recovered、subscription cancellation 条目和 cleanup 执行条目，项目管理员中心已支持通用通知筛选、分页、详情 drawer、当前页 CSV 导出、当前筛选 CSV 导出和独立全屏页，失败审计历史已支持 scope / actor / date 筛选、翻页、导出、最近 100 条趋势抽样、详情查看和组织日志保留策略跳转；但还没有失败审计专属的独立 retention mutation 或自动删除策略，通用通知中心后续可继续纳入产品确认需要更细粒度的其他 Stripe webhook billing 生命周期，以及组织安全设置变更分类等更多项目级事件。

- 更新：`b27b1794c` 已补齐上一条中提到的“失败审计专属独立 retention mutation / cleanup policy”缺口；后续不应再把该项列为未完成，只需继续观察是否需要自动定时执行或更细的 cleanup 审批流。

### 3.9 权限与安全加固

Phase 4 已完成一轮系统性收尾，已覆盖：

- HTTP read path：只读 owner 个人草稿、所属团队画布、授权展示画布。
- HTTP write path：写入统一要求 write/admin；展示/发布画布服务端拒绝写。
- Realtime：room join 服务端解析 scope，read role 拒绝 mutation 和 position update。
- Copilot：上下文、工具、VFS、metadata 均按用户权限过滤或脱敏。
- Files/assets：上传、直传、分片、parse、rename、delete、restore 等写路径依赖 `checkWorkspaceAccess(...).canWrite`。
- Logs/metrics：列表、导出、统计、详情、execution 快照和 workspace metrics 均按真实 workspace access 过滤。
- Credentials/environment/API key/BYOK：只读或展示读者不能读取源 workspace 敏感配置。
- Legacy workspace discovery：workspace list、recent、workflow/folder 发现路径不返回其他成员个人草稿。

## 4. 当前验证状态

最近已通过或复跑的关键校验包括：

最新 Phase 11 invitation 错误文案切片已验证：

```powershell
Set-Location apps\sim; bunx biome check --write "app/invite/[id]/invite.tsx" "lib/invitations/workspace-invitations.ts" "lib/invitations/send.ts" "app/api/invitations/[id]/route.ts" "app/api/invitations/[id]/resend/route.ts" "app/api/workspaces/invitations/route.test.ts" "app/api/invitations/[id]/resend/route.test.ts"
Set-Location apps\sim; bunx vitest run "app/api/workspaces/invitations/route.test.ts" "app/api/invitations/[id]/route.test.ts" "app/api/invitations/[id]/resend/route.test.ts" "lib/invitations/core.test.ts"
bun run check:api-validation:strict
$patterns = @('Canvas not found','Personal canvases','external canvas invitations','canvas admin','sendInvitationEmail','workspace-invitations','invite.tsx','resend/route','workspaces/invitations/route.test','invitations/[id]/route.test'); $output = bun run type-check 2>&1; $matches = $output | Select-String -Pattern $patterns; if ($matches) { $matches | ForEach-Object { $_.Line }; exit 1 } else { 'NO_TOUCHED_PATH_TYPECHECK_MATCHES' }
git diff --check
```

最新 Phase 11 fallback 入口文案切片已验证：

```powershell
Set-Location apps\sim; bunx biome check --write "app/form/[identifier]/components/error-state.tsx" "app/chat/components/error-state/error-state.tsx" "app/credential-account/[token]/page.tsx"
bun run check:api-validation:strict
$patterns = @('Return to Canvas','Redirecting to canvas','FormErrorState','ChatErrorState','credential-account','error-state.tsx'); $output = bun run type-check 2>&1; $matches = $output | Select-String -Pattern $patterns; if ($matches) { $matches | ForEach-Object { $_.Line }; exit 1 } else { 'NO_TOUCHED_PATH_TYPECHECK_MATCHES' }
git diff --check
```

最新 Phase 11 组织批量邀请错误文案切片已验证：

```powershell
Set-Location apps\sim; bunx biome check --write "app/api/organizations/[id]/invitations/route.ts" "app/api/organizations/[id]/invitations/route.test.ts"
Set-Location apps\sim; bunx vitest run "app/api/organizations/[id]/invitations/route.test.ts"
bun run check:api-validation:strict
$patterns = @('organization canvas','Canvas not found','organization-owned canvas','invite users to canvas','organizations/[id]/invitations','route.test.ts'); $output = bun run type-check 2>&1; $matches = $output | Select-String -Pattern $patterns; if ($matches) { $matches | ForEach-Object { $_.Line }; exit 1 } else { 'NO_TOUCHED_PATH_TYPECHECK_MATCHES' }
git diff --check
```

最新 Phase 11 canvas permission 错误文案切片已验证：

```powershell
Set-Location apps\sim; bunx biome check --write "app/api/workspaces/[id]/permissions/route.ts" "app/api/workspaces/[id]/permissions/route.test.ts"
Set-Location apps\sim; bunx vitest run "app/api/workspaces/[id]/permissions/route.test.ts"
bun run check:api-validation:strict
$patterns = @('Personal canvases do not expose','Personal canvases do not support','canvas owner permissions','Canvas billing account','Failed to fetch canvas permissions','Failed to update canvas permissions','workspaces/[id]/permissions','route.test.ts'); $output = bun run type-check 2>&1; $matches = $output | Select-String -Pattern $patterns; if ($matches) { $matches | ForEach-Object { $_.Line }; exit 1 } else { 'NO_TOUCHED_PATH_TYPECHECK_MATCHES' }
git diff --check
```

最新 Phase 11 Knowledge Base header canvas selector 文案切片已验证：

```powershell
Set-Location apps\sim; bunx biome check --write "app/workspace/[workspaceId]/knowledge/components/knowledge-header/knowledge-header.tsx"
bun run check:api-validation:strict
$patterns = @('getKnowledgeCanvasLabel','Not assigned to canvas','No canvas','No canvases with write access','knowledge-header'); $output = bun run type-check 2>&1; $matches = $output | Select-String -Pattern $patterns; if ($matches) { $matches | ForEach-Object { $_.Line }; exit 1 } else { 'NO_TOUCHED_PATH_TYPECHECK_MATCHES' }
git diff --check
```

最新失败审计 retention cleanup 切片已验证：

```powershell
Set-Location apps\sim; bunx biome check --write "app/api/organizations/[id]/project-admin/failures/cleanup/route.ts" "app/api/organizations/[id]/project-admin/failures/cleanup/route.test.ts" "lib/api/contracts/collaboration.ts" "lib/collaboration/service.ts" "lib/collaboration/service.test.ts" "hooks/queries/collaboration.ts" "app/workspace/[workspaceId]/project-admin/project-admin-center.tsx"
Set-Location apps\sim; bunx biome check "app/api/organizations/[id]/project-admin/failures/cleanup/route.ts" "app/api/organizations/[id]/project-admin/failures/cleanup/route.test.ts" "lib/api/contracts/collaboration.ts" "lib/collaboration/service.ts" "lib/collaboration/service.test.ts" "hooks/queries/collaboration.ts" "app/workspace/[workspaceId]/project-admin/project-admin-center.tsx"
bunx biome check scripts\check-api-validation-contracts.ts
Set-Location apps\sim; bunx vitest run app/api/organizations/[id]/project-admin/failures/route.test.ts app/api/organizations/[id]/project-admin/failures/cleanup/route.test.ts lib/collaboration/service.test.ts
bun run check:api-validation:strict
$patterns = @('cleanupProjectAdminFailure','ProjectAdminFailureCleanup','project-admin/failures/cleanup','Failure audit cleanup','project_admin_failure_audit_retention','cleanup.execution_completed','check-api-validation-contracts','project-admin-center','lib/collaboration/service','hooks/queries/collaboration','contracts/collaboration'); $output = bun run type-check 2>&1; $matches = $output | Select-String -Pattern $patterns; if ($matches) { $matches | ForEach-Object { $_.Line }; exit 1 } else { 'NO_TOUCHED_PATH_TYPECHECK_MATCHES' }
git diff --check
```

上一轮 SSO 切片验证：

```powershell
Set-Location apps\sim; bunx biome check --write "app/api/auth/sso/register/route.ts" "app/api/auth/sso/register/route.test.ts" "lib/collaboration/service.ts" "lib/collaboration/service.test.ts"
Set-Location apps\sim; bunx biome check "app/api/auth/sso/register/route.ts" "app/api/auth/sso/register/route.test.ts" "lib/collaboration/service.ts" "lib/collaboration/service.test.ts"
Set-Location apps\sim; bunx vitest run app/api/auth/sso/register/route.test.ts lib/collaboration/service.test.ts
bun run check:api-validation:strict
$patterns = @('organization.security_sso_configured','security_sso_configured','sso/register','registerSSOProvider','organization_settings','OrganizationSettingsEvent','ProjectNotificationCenter','projectNotification','notifications/center','lib/collaboration/service'); $output = bun run type-check 2>&1; $matches = $output | Select-String -Pattern $patterns; if ($matches) { $matches | ForEach-Object { $_.Line }; exit 1 } else { 'NO_TOUCHED_PATH_TYPECHECK_MATCHES' }
git diff --check
```

已知情况：

- `bun run check:api-validation:strict` 当前基线为 `total=761, zod=736, nonZod=25`，新增 cleanup route 和 SSO route 都走既有合约和 `parseRequest`，最近 invitation 文案切片未改变边界合约；严格校验继续通过。
- `bun run type-check` 仍退出 2，但按最新 invitation/fallback/organization invitation/canvas permission 触碰路径和文案标识过滤输出 `NO_TOUCHED_PATH_TYPECHECK_MATCHES`；全量 type-check 仍有仓库既有历史错误，不能宣称全量通过。
- `git diff --check` 本轮通过，没有 whitespace error。
- `Set-Location packages\audit; bunx vitest run src/log.test.ts` 目前仍会在收集阶段失败：`@sim/testing` 的 request mock 会导入 `next/server`，而 `packages/audit` 包上下文没有该依赖；需后续拆分 testing mock 子入口或补包级测试依赖后再作为有效信号。

## 5. 后续详细计划

### Phase 5：发布流程与全局状态树继续收口

目标：让展示画布从“能发布和查看”升级为“可治理、可追踪、可回滚的项目级状态树”。

建议任务：

1. 已补发布可见范围编辑的服务层和 route 测试：覆盖非管理员拒绝、跨组织目标团队过滤、组织可见清空 scope；后续继续推进全局状态树治理。
2. 全局状态树聚合页首版已在原 shell 下落地，按工种、团队、Agent、状态、版本分组，并展示可见 parent/dependsOn 链路、多个当前版本冲突和过期提示；后续继续补治理操作。
3. 版本关系治理：展示 superseded 链路、parent/dependsOn 关系、当前有效版本和历史版本。
4. 发布通知/广播首版已补：发布、归档、撤回、恢复当前版本、可见范围更新后，对当前可见的其他团队写入 `publication.*` team activity 事件；项目管理员通知 outbox 已能持久化 in-app/email/webhook digest，对 email channel 通过通用邮件 provider delivery 发送，对 webhook channel 通过 SSRF-safe provider delivery 推送，并在项目管理员中心提供持久 notification inbox 首版；项目管理员顶部铃铛和按用户已读状态已补首版，且已抽象为通用项目通知中心（发布评审 + 项目失败审计 + 发布治理审计 + 成员/团队/Agent 策略审计 + retention/data drain/组织/billing（seat/plan switch/org credits/invoice failure recovery/subscription cancellation）/cleanup 执行审计），项目中心面板已支持筛选、分页、详情和 CSV 导出，独立全屏页已在原 workspace shell 内落地。
5. 版本回滚首版已补：团队管理员可把未撤回的历史版本恢复为当前 `published`，服务层会把其他当前版本标记为 `superseded` 并用该版本 snapshot 重写 published workflow state。
6. 审核/风险首版已补：新增 `PATCH /api/publications/[publicationVersionId]/review`、团队管理页 review/risk 控件、状态树未审核/critical risk 治理提示，以及项目级 reviewer 指派、approval workflow；后续继续补通知和更完整项目级治理。

建议提交：`Implement publication state tree workflow` 或拆成 `Edit showcase publication visibility`、`Add publication state tree view`。

### Phase 6：跨画布复制体验完善

目标：把已有 copy-selection 后端能力打磨成稳定前端工作流。

建议任务：

1. 已在分屏里用 `mappings.blockIds` 把复制结果映射为目标 pane selection，高亮新节点。
2. 已支持 Shift/Ctrl/Cmd-click 多节点复制和显式边选择；未显式选边时边会随服务端 selection 内部合法边自动复制，显式选边时只复制两端节点也入选的连接。框选仍待补齐。
3. 已支持复制到目标 pane 当前 viewport center；目标 viewport 未就绪时才回退固定 offset。
4. UI 明确展示目标画布不可写、目标 workflow 缺失、源为只读展示画布等原因。
5. 增加前端组件/Hook 测试，验证复制 payload 不会把 source/target workspaceId 串线。

建议提交：`Polish cross-canvas copy experience`。

### Phase 7：分屏工作台继续推进

目标：从“只读预览 + 显式复制”升级为可长期承载个人/团队/展示对照工作的双 pane 体验。

建议任务：

1. 已拆分 pane-scoped selection、current workflow、copy target highlight、viewport snapshot 和按 pane/workflow 持久化的 zoom/pan 状态。
2. 若要双编辑器，拆分 workflow store 或引入 pane id，避免左右 ReactFlow 操作串线。
3. 已增加 pane 级目标高亮、目标 workflow state/list 刷新、viewport-center placement、目标边高亮和复制后自动定位动画。
4. 增加组合场景：个人草稿 + 团队画布、团队画布 + 展示画布、展示画布 + 个人草稿。
5. 移动端已从上下布局优化为 tab 切换；后续可继续补触摸框选和更完整的小屏提示。

建议提交：`Add pane-scoped split canvas state`。

### Phase 8：10 个 Agent 深度接入

目标：让 Copilot 真正按当前工种团队进入专属 Agent 工作模式。

建议任务：

1. 为 10 个 Agent 明确默认 system prompt、默认 Skill、禁用 Skill、风险等级。
2. active workgroup 切换后，Copilot prompt、tools、resource context 同步切换。
3. 团队 Agent Skill override 与项目级模板策略合并解析。
4. 展示画布只读场景禁用修改类工具。
5. 增加 Agent resolve fallback 指标和测试。

建议提交：`Wire discipline agents into Copilot`。

### Phase 9：团队管理员闭环收尾

目标：让团队管理员不离开原主界面即可完成日常管理。

当前已完成成员、邀请、发布、生命周期、Agent Skill、团队活动日志的首版闭环。后续继续：

1. 发布详情治理和更细的可见范围变更反馈。
2. 团队管理页分区优化首版已完成：成员、邀请、发布、Agent Skill、活动日志已拆成 tabs；后续继续补复杂治理 drawer。
3. 批量邀请、邀请过期状态和逐项结果反馈已完成首版；后续继续补更细的投递失败根因、seat/权限失败审计归因。
4. 权限拒绝/失败操作是否进入 activity 或 audit 的规则。
5. 团队画布健康状态首版已完成：显示 workflow graph、成员权限同步和最近发布状态，并支持一键初始化画布、创建默认 workflow graph、同步可修复成员权限；后续继续补失败操作审计和 owner/billing 特殊权限提示。

建议提交：`Complete team admin workbench`。

### Phase 10：项目管理员中心

目标：让组织/项目管理员管理整个剧场项目，而不是只管理单个团队。

建议任务：

1. 原 shell 下 `/workspace/[workspaceId]/project-admin` 首版已完成，并已补项目级创建团队、单用户成员分配、批量成员分配、团队归档、项目级 Agent 模板、项目级 Agent Skill 策略、项目级发布治理和 activity drilldown 入口；后续继续扩展其他项目级管理操作。
2. 工种管理：首版已展示工种、对应 Agent、团队数量和当前发布/风险概览，且项目级 Agent prompt 补充说明已按 Agent 维度落地；后续补工种启用/停用、显示名和更细的 Agent 策略。
3. 团队管理：首版已展示团队、成员数量并跳转团队管理页，且已支持创建团队和归档团队；后续补设置团队管理员、查看团队画布和发布详情 drawer。
4. 用户分配：已支持从组织 roster 或手动 email/user ID 把既有用户加入任意工种团队并指定 member/admin，并已补 textarea 事务性批量分配、文件导入、基于团队画布访问权的建议填充和批量分配聚合审计首版；后续继续补更细的批处理失败归因。
5. 全局状态树治理：组织级读取所有团队发布版本、首批 review/risk/lifecycle 写操作、reviewer 指派、approval workflow、跨团队依赖冲突提示、依赖冲突处理动作、发布评审通知队列、通知投递草稿、服务端通知投递记录、持久通知 outbox、webhook/email provider delivery、持久通知 inbox、通用项目通知中心顶部铃铛、项目中心筛选/详情/导出面板和独立全屏页、发布治理/成员/团队/Agent 策略/retention/data drain/组织管理/组织设置/billing（seat/plan switch/org credits/invoice failure recovery/subscription cancellation）/cleanup 执行审计通知类型、本地和服务端失败操作审计、历史面板、历史筛选、历史分页、CSV 导出、趋势/保留窗口概览、组织日志 retention policy 只读控制入口和失败详情 drawer、详情 drawer、详情编辑、结构 diff preview、节点级 diff preview、冲突检测、冲突修复向导、冲突处理动作、批量治理、过期/未提交团队 nudges 和依赖影响预览已落地；后续补更完整的审批联动，并继续扩展产品确认需要更细粒度的其他 Stripe webhook billing 生命周期和组织安全设置变更等通用通知中心事件类型。
6. Agent 模板与 Skill 策略：项目级 prompt 附加说明、默认 Skill 启用/禁用策略、Agent 策略影响预览、跨团队策略复制和风险 Skill guardrails 首版已落地；后续补更细的风险分级、白名单和 reviewer 审批联动。
7. 审计日志：已有项目级 activity filters 首版，可按团队、工种、动作、搜索文本、时间范围、actor 精确值和失败 scope 筛选，并已补 offset 分页、当前页与全量 CSV 导出、批量成员分配聚合事件；Failure audit 的服务端历史面板已复用这些筛选能力按 scope / actor / date 下钻，并支持独立分页、当前页 CSV、筛选全集 CSV 导出、最近 24 小时/7 天趋势、Top scope 统计、组织日志 retention policy 只读入口、单条失败详情 drawer 和独立 retention cleanup。

建议提交：下一步可继续把产品确认需要更细粒度的其他 Stripe webhook billing 生命周期与组织安全设置变更纳入通用项目通知中心，或转入 Phase 11 legacy workspace 入口迁移。

### Phase 11：Legacy workspace 入口迁移

目标：普通用户不再以 workspace 为主心智，但底层 workspace 继续服务 workflow/editor。

建议任务：

1. 排查 sidebar、settings、onboarding、templates、recent、search、command palette、mobile nav 的 workspace 文案和创建入口；search/command palette 首个迁移切片已由 `267883e82` 完成，workflow MCP server 设置页首个文案切片已由 `0af9de617` 完成，API keys/BYOK/Inbox/team management 设置文案切片已由 `ec67e90fe` 完成，sidebar invite/team-management 健康与 Agent Skill 空态文案切片已由 `be6856618` 完成，`/workspace` 根入口 recent canvas 选择切片已由 `629062e92` 完成，settings/sidebar 深层 Integrations/Secrets/Subscription/ownership 文案切片已由 `4bff93528` 完成，invite/email/published visibility 文案切片已由 `56d4905ae` 完成，公共模板编辑入口 canvas metadata 切片已由 `3838424e6` 完成，invitation 接收页/发送 fallback/API 错误边界切片已由 `bb00136e7` 完成，form/chat/credential-account fallback 文案切片已由 `a7cbaace0` 完成，organization invitation batch grant 错误切片已由 `da309e00c` 完成，canvas permission API 错误切片已由 `153bdbd6b` 完成，Knowledge Base header canvas selector 文案与 canvas metadata 标签切片已由 `00839fd03` 完成；仍需继续排查 mobile nav、onboarding 和其他旧入口。
2. 普通成员看到“新建个人草稿画布”，不再看到“create workspace”。
3. 团队管理员看到“初始化/修复团队画布”，项目管理员看到“创建团队”。
4. 老链接继续兼容跳转或展示说明，不直接报错。
5. `/api/workspaces` 已返回 `canvasScope`、`workgroupId`、`disciplineId`、`isInternalWorkspace`，并在 `dc6a30e75` 补上 `canvasCreationCapabilities.canCreatePersonalCanvas` / `canCreateTeamCanvas`；search/command palette、公共 template edit selector 已消费 canvas 元数据，`/workspace` 根入口已消费 recent/last-active/default workgroup canvas 选择顺序；后续继续把 mobile nav、onboarding 和其他深层入口消费这些字段。

建议提交：`Migrate legacy workspace entrypoints`。

### Phase 12：测试、审计、发布与监控

目标：上线前证明权限隔离、发布、分屏、Agent、团队管理都可靠。

建议任务：

1. 自动化测试矩阵：collaboration authz、snapshot sanitizer、copy-selection、publication lifecycle、workgroup activity、Realtime permissions。
2. 手工验收脚本：普通成员、团队管理员、其他团队成员、项目管理员、无团队用户五类角色。
3. 审计要求：成员加入/移除/角色变更、发布/撤回/归档、Agent Skill 变化、项目管理员操作。
4. 监控指标：personal canvas create、team canvas join、publication create、copy-selection、realtime denied、Copilot agent fallback。
5. 灰度和回滚：保留旧 workflow/editor 数据和 workspace 内部容器，发布版本 append-only，撤回用状态不物理删除。

建议提交：`Add collaboration release hardening`。

## 6. 建议下一步执行顺序

推荐短期按以下顺序继续，避免范围过大：

1. 发布可见范围编辑、全局状态树首版视图、依赖链路、冲突/过期/未审核/critical risk 提示、回滚、review/risk 管理和 reviewer 指派、approval workflow、跨团队依赖冲突提示、依赖冲突处理动作、发布评审通知队列、通知投递草稿、服务端通知投递记录、持久通知 outbox、webhook/email provider delivery、持久通知 inbox、通用项目通知中心顶部铃铛、项目中心筛选/详情/导出面板和独立全屏页、发布治理/成员/团队/Agent 策略/retention/data drain/组织管理/组织设置/billing（seat/plan switch/org credits/invoice failure recovery/subscription cancellation）/cleanup 执行审计通知类型、本地和服务端失败操作审计、历史面板、历史筛选、历史分页、CSV 导出、趋势/保留窗口概览、组织日志 retention policy 控制入口、详情 drawer 和失败审计专属 retention cleanup 已补齐；下一步可补通用通知中心里产品确认需要更细粒度的其他 Stripe webhook billing 生命周期与组织安全设置变更事件类型。
2. Phase 7 的“目标高亮 + pane-scoped selection + viewport-center placement + 显式边选择 + 复制后自动定位动画 + pane-scoped zoom/pan 持久化 + 移动端 tab + Box select 框选”已补首版；下一步继续完整双编辑器 store 隔离或触摸提示优化。
3. Phase 9 的团队管理页结构优化、批量邀请、邀请过期状态、逐项结果反馈、团队画布健康状态和一键修复已完成首版；下一步可继续更深的失败归因审计或进入 Phase 10 项目管理员中心后续治理。
4. Phase 10 项目管理员中心已启动概览，并补创建团队、成员分配、roster 选择器、批量成员分配、文件导入、建议填充、项目级 activity filters、团队归档、项目级 Agent 模板、项目级 Agent Skill 策略、Agent 策略影响预览、风险 Skill guardrails、项目级发布治理、发布详情 drawer、结构 diff preview、节点级 diff preview、冲突检测、首批冲突处理动作、发布批量治理、发布详情编辑、reviewer 指派、approval workflow、跨团队依赖冲突提示、依赖冲突处理动作、发布评审通知队列、通知投递草稿、服务端通知投递记录、持久通知 outbox、webhook/email provider delivery、持久通知 inbox、通用项目通知中心顶部铃铛、项目中心筛选/详情/导出面板和独立全屏页、发布治理/成员/团队/Agent 策略/retention/data drain/组织管理/组织设置/billing（seat/plan switch/org credits/invoice failure recovery/subscription cancellation）/cleanup 执行审计通知类型、本地和服务端失败操作审计、历史面板、历史筛选、历史分页、CSV 导出、趋势/保留窗口概览、组织日志 retention policy 控制入口、详情 drawer、失败审计专属 retention cleanup、冲突修复向导、过期/未提交团队 nudges 和发布依赖影响预览。下一步可继续做产品确认需要更细粒度的其他 Stripe webhook billing 生命周期与组织安全设置变更的通用通知中心事件类型，或进入 Phase 11 legacy workspace 入口迁移；不要一开始就做复杂图形编辑器。
5. 最后做 Phase 11/12 的 legacy 入口迁移和上线硬化。

每个切片提交前建议至少运行：

```powershell
git status --short
Set-Location apps\sim; bunx biome check --write <touched-files>
bun run check:api-validation:strict
Set-Location apps\sim; bunx vitest run <relevant-tests>
git diff --check
```

如果涉及 Realtime：

```powershell
Set-Location apps\realtime; bunx vitest run src/middleware/permissions.test.ts
```

## 7. 接手注意事项

- 不要恢复独立 `/workbench` shell；旧 `/workbench` 只作为兼容 redirect。
- 不要把组织级 workspace creation policy 重新接回普通个人草稿创建；普通成员创建个人草稿应走 workgroup personal workspace API。
- 不要让 team admin 默认查看成员个人草稿；v1 个人草稿仍 owner-only。
- 不要只靠前端隐藏按钮实现展示画布只读；HTTP、Realtime、Copilot tool 都要服务端强制。
- 不要混入当前未提交的 `apps/realtime/src/routes/http.ts` 和 `apps/sim/components/workbench/canvas-launch-button.tsx`，除非后续任务明确要求处理。
