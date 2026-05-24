# 剧场协作系统当前完成总结与后续详细计划

> 更新时间：2026-05-24
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
- 展示画布已经有只读查看路径和发布版本生命周期基础，服务端权限已对展示/发布画布做强只读约束。
- Phase 4 权限隔离已完成一轮系统性加固；Phase 5 到 Phase 9 已完成多个可用切片；Phase 10 到 Phase 12 仍未完成。

需要注意：当前工作树仍有两个非本轮文档相关的未提交项，后续不要误混入协作提交：

| 状态 | 文件 | 说明 |
| --- | --- | --- |
| modified | `apps/realtime/src/routes/http.ts` | 既有未提交改动，本文档未触碰 |
| untracked | `apps/sim/components/workbench/canvas-launch-button.tsx` | 既有未跟踪文件，本文档未触碰 |

## 2. 已完成的主要提交链

最近与“原主界面画布协作”直接相关的提交如下：

| Commit | 内容摘要 |
| --- | --- |
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

仍需注意：

- 代码内部仍大量使用 `workspace` 命名，这是底层模型和路径兼容需要；用户可见主路径应继续逐步替换为 canvas 语义。
- Workspace 技术设置页、搜索、最近访问、命令面板等深层旧入口后续仍需 Phase 11 系统排查。

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
- 发布通知/广播已有首版 team activity 事件，版本回滚已有“恢复为当前版本”首版能力，审核/风险字段已有管理入口；站内铃铛、邮件/外部推送、指派 reviewer、审批流、跨团队依赖冲突提示仍未完成。

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

### 3.8 权限与安全加固

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

```powershell
Set-Location apps\sim; bunx vitest run lib/collaboration/service.test.ts
bun run check:api-validation:strict
git diff --check
```

已知情况：

- `bun run check:api-validation:strict` 已因新增 publication visibility/review routes 更新 route baseline 到 `total=749, zod=724, nonZod=25` 后通过。
- `bun run type-check` 仍退出 1，但按本轮触碰路径过滤没有匹配错误；全量 type-check 仍有仓库既有历史错误，不能宣称全量通过。
- `git diff --check` 仅提示 `docs/theater-collaboration-progress-and-next-steps-zh.md` 的 CRLF/LF warning，没有 whitespace error。

## 5. 后续详细计划

### Phase 5：发布流程与全局状态树继续收口

目标：让展示画布从“能发布和查看”升级为“可治理、可追踪、可回滚的项目级状态树”。

建议任务：

1. 已补发布可见范围编辑的服务层和 route 测试：覆盖非管理员拒绝、跨组织目标团队过滤、组织可见清空 scope；后续继续推进全局状态树治理。
2. 全局状态树聚合页首版已在原 shell 下落地，按工种、团队、Agent、状态、版本分组，并展示可见 parent/dependsOn 链路、多个当前版本冲突和过期提示；后续继续补治理操作。
3. 版本关系治理：展示 superseded 链路、parent/dependsOn 关系、当前有效版本和历史版本。
4. 发布通知/广播首版已补：发布、归档、撤回、恢复当前版本、可见范围更新后，对当前可见的其他团队写入 `publication.*` team activity 事件；后续再接站内铃铛、邮件或外部推送。
5. 版本回滚首版已补：团队管理员可把未撤回的历史版本恢复为当前 `published`，服务层会把其他当前版本标记为 `superseded` 并用该版本 snapshot 重写 published workflow state。
6. 审核/风险首版已补：新增 `PATCH /api/publications/[publicationVersionId]/review`、团队管理页 review/risk 控件和状态树未审核/critical risk 治理提示；后续继续补 reviewer 指派、审批流、恢复前 diff preview 和项目级治理。

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

1. 新增原 shell 或组织设置下的 project admin 页面。
2. 工种管理：启用/停用、显示名、对应 Agent、团队数量。
3. 团队管理：创建/归档团队、设置团队管理员、查看团队画布和发布。
4. 用户分配：把用户加入工种团队、批量导入、默认团队建议。
5. 全局状态树治理：查看所有团队发布、风险、冲突、过期、未提交团队。
6. Agent 模板：项目级 prompt 附加说明、默认 Skill、风险 Skill 禁用策略。
7. 审计日志：按组织、工种、团队、用户、动作筛选。

建议提交：`Add project collaboration admin center`。

### Phase 11：Legacy workspace 入口迁移

目标：普通用户不再以 workspace 为主心智，但底层 workspace 继续服务 workflow/editor。

建议任务：

1. 排查 sidebar、settings、onboarding、templates、recent、search、command palette、mobile nav 的 workspace 文案和创建入口。
2. 普通成员看到“新建个人草稿画布”，不再看到“create workspace”。
3. 团队管理员看到“初始化/修复团队画布”，项目管理员看到“创建团队”。
4. 老链接继续兼容跳转或展示说明，不直接报错。
5. `/api/workspaces` 返回继续补齐 `canvasScope`、`workgroupId`、`disciplineId`、`isInternalWorkspace`、`canCreatePersonalCanvas`、`canCreateTeamCanvas` 等前端分组字段。

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

1. 发布可见范围编辑、全局状态树首版视图、依赖链路、冲突/过期/未审核/critical risk 提示、回滚和 review/risk 管理已补齐；下一步可继续 Phase 5 reviewer/审批/diff/通知，或继续 Phase 7 框选。
2. Phase 7 的“目标高亮 + pane-scoped selection + viewport-center placement + 显式边选择 + 复制后自动定位动画 + pane-scoped zoom/pan 持久化 + 移动端 tab + Box select 框选”已补首版；下一步继续完整双编辑器 store 隔离或触摸提示优化。
3. Phase 9 的团队管理页结构优化、批量邀请、邀请过期状态、逐项结果反馈、团队画布健康状态和一键修复已完成首版；下一步可继续失败操作审计或进入 Phase 10 项目管理员中心。
4. 接着启动 Phase 10 项目管理员中心，优先做工种/团队/成员分配，不要一开始就做复杂图形状态树。
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
