# 剧场协作系统状态与人工测试指南

> 更新时间：2026-05-25
> 适用仓库：`E:\project\sim`
> 主总结文档：`docs/theater-collaboration-current-summary-and-roadmap-zh.md`
>
> 本文档用于人工验收前快速确认：哪些已经完成、哪些不能宣称完成、下一步计划是什么，以及现阶段应该怎样手工测试。本文不替代主路线图，只作为当前验收与接手清单。

## 1. 当前结论

- 产品方向已经从独立 `/workbench` 外壳纠偏为在原 `/workspace/[workspaceId]` 主界面内承载协作能力。
- `workspace` 继续作为底层 workflow/editor 的内部容器和兼容路由；面向用户的心智应逐步迁移为 `Canvas`、个人草稿画布、团队画布、展示画布。
- Phase 4 权限隔离已完成一轮系统性加固；Phase 5 到 Phase 10 已完成多个可用闭环；Phase 11 正在进行 legacy workspace 入口迁移；Phase 12 自动化测试、审计、发布与监控硬化尚未完成。
- 现阶段可以先做人工测试；不需要等 Phase 12 补完所有自动化测试后再验收已实现部分。
- 当前工作树仍有两个非本轮文档相关项，人工测试和后续提交不要误混入：`apps/realtime/src/routes/http.ts`、`apps/sim/components/workbench/canvas-launch-button.tsx`。

## 2. 已完成能力

### 2.1 产品外壳与画布模型

- 原 `/workspace/[workspaceId]` shell 是主要入口；不要恢复或继续投资独立 `/workbench` shell。
- `/workspace` 根入口已优先打开本地最近访问 canvas，其次 server last-active canvas，再回退默认团队画布。
- `/api/workspaces` 已返回 `canvasScope`、`workgroupId`、`disciplineId`、`isInternalWorkspace` 和 `canvasCreationCapabilities`，供前端区分个人草稿、团队、展示/发布和 legacy canvas。
- 普通成员可以创建个人草稿画布，并进入默认节点图。
- 团队管理员可以初始化/修复团队画布，而不是通过普通 workspace creation policy 创建团队容器。

### 2.2 团队协作闭环

- 团队管理员已有成员管理、邀请/批量邀请、角色调整、成员移除、团队画布健康状态、一键初始化/修复、Agent Skill 管理和团队活动日志。
- 团队画布可以发布到展示画布，并已有发布版本生命周期基础。
- 展示/发布画布有只读查看路径；服务端 HTTP、Realtime、Copilot tool 等路径已做只读/权限边界加固。
- 发布可见范围、发布详情、review/risk、冲突检测、冲突处理、依赖影响预览、过期/未提交团队发布 nudges 等项目治理切片已陆续落地。

### 2.3 项目管理员中心

- 项目管理员中心已在原 `/workspace/[workspaceId]` shell 内落地。
- 已支持项目概览、工种/团队/成员/Agent 映射查看、创建工种团队、归档团队、单用户和批量成员分配、项目级 activity drilldown。
- 已支持项目级 Agent prompt 补充说明、Agent Skill 默认策略、策略影响预览、跨团队策略复制和风险 Skill guardrails。
- 已支持项目级发布治理、发布状态树、发布详情 drawer、结构 diff、节点级 diff、reviewer 指派和 approval workflow。
- 通用项目通知中心已有顶部铃铛、筛选、分页、详情、导出和独立全屏页；通知类型覆盖发布治理、失败审计、成员/团队/Agent 策略、retention/data drain、组织管理、组织设置、billing 和 cleanup 执行审计等首版范围。
- 失败审计已有服务端持久记录、历史筛选、分页、导出、趋势/保留窗口概览、详情 drawer 和独立 retention cleanup。

### 2.4 Phase 11 文案与旧入口迁移

- Sidebar、Home、Settings、Search/Command Palette、Template edit selector、Knowledge header、Files/Published UI、Deploy API key、delete modal、landing、LLM docs 等大量用户可见 workspace 文案已迁移到 canvas 语义。
- API/contract/runtime 错误中直接返回给用户的 `Workspace ID`、`workspace not found`、`workspace access` 等提示已在多个切片中迁移为 Canvas 语义。
- 最近完成的切片：
  - `48b29b76b`：Copilot MCP tool descriptions 和 platform actions quick reference 中面向用户的 workspace/workspaces 改为 canvas/canvases。
  - `a2c54538a`：更新主路线图文档记录上述切片。
  - `486dd08fb`：Copilot server/tool 输出中的 deployment status、导入、恢复、job logs、execution summary、credentials、environment secrets 和文件下载文案继续迁移为 canvas 语义。
- 以下技术命名仍应保留，不作为人工测试 bug：
  - `workspaceId`
  - `list_workspaces`
  - `/workspace/[workspaceId]`
  - DB schema、permission entity、API route、内部 helper/import path 中的 workspace 命名

## 3. 未完成事项

### 3.1 Phase 11 仍需继续

- 继续系统排查 mobile nav、onboarding、深层设置页、Copilot server/tool 辅助文案、旧链接 fallback 和其他低频入口中的用户可见 workspace 文案。
- 继续确认普通成员视角只看到“新建个人草稿画布”，团队管理员视角看到“初始化/修复团队画布”，项目管理员视角看到“创建团队/项目治理”。
- 继续确认老链接兼容跳转或展示说明，不直接暴露 confusing workspace 心智或无解释报错。

### 3.2 Phase 12 尚未开始/未完成

- 自动化测试矩阵尚未系统补齐：collaboration authz、snapshot sanitizer、copy-selection、publication lifecycle、workgroup activity、Realtime permissions。
- 手工验收脚本还需要按角色固化为可重复执行清单。
- 审计、监控指标、灰度发布和回滚手册还需要上线前整理。
- 当前可以先人工测试已实现部分，但不能宣称 Phase 12 完成。

### 3.3 已知验证限制

- `bun run check:api-validation:strict` 当前基线为 `total=761, zod=736, nonZod=25`，最近切片继续通过。
- `bun run type-check` 全量仍有仓库既有历史错误；最近切片使用触碰路径和文案标识过滤，结果为 `NO_TOUCHED_PATH_TYPECHECK_MATCHES`，不能宣称全量 type-check 通过。
- `packages/audit` 包级 `bunx vitest run src/log.test.ts` 仍会因 `@sim/testing` 引入 `next/server` 而在收集阶段失败，需后续拆分 testing mock 子入口或补包级依赖后再作为有效信号。

## 4. 后续计划

### 4.1 短期优先级

1. 继续 Phase 11 legacy workspace 入口迁移，优先找用户可见文案、按钮、toast、空态、错误提示。
2. 重点排查 mobile nav、onboarding、Copilot server/tool 输出、旧链接 fallback 和深层设置页。
3. 每完成一个小切片，跑 scoped validation，并把主路线图文档同步更新。
4. 人工测试发现的问题按页面路径和原文回填到 Phase 11 修复队列。

### 4.2 中期优先级

1. 把人工测试步骤固化为 Phase 12 可执行验收脚本。
2. 给关键权限隔离、发布生命周期、Realtime mutation deny、Copilot tool fail-closed 补自动化测试。
3. 补上线前监控指标和回滚手册。
4. 继续补项目通知中心中产品确认需要的更细 billing 生命周期和组织安全设置事件。

### 4.3 每个后续切片建议验证

```powershell
Set-Location E:\project\sim
git status --short
bunx biome check --write <touched-files>
bun run check:api-validation:strict
$patterns = @('<touched-path-or-new-text-marker>'); $output = bun run type-check 2>&1; $matches = $output | Select-String -Pattern $patterns; if ($matches) { $matches | ForEach-Object { $_.Line }; exit 1 } else { 'NO_TOUCHED_PATH_TYPECHECK_MATCHES' }
git diff --check -- <touched-files>
```

如涉及 Realtime，再补：

```powershell
Set-Location E:\project\sim\apps\realtime
bunx vitest run src/middleware/permissions.test.ts
```

## 5. 人工测试准备

### 5.1 启动

```powershell
Set-Location E:\project\sim
bun run dev:full
```

如果本机已有服务运行，先确认端口和日志，不要直接杀掉不明进程。测试期间记录：

- 登录用户和角色
- 当前 URL
- 操作步骤
- 实际看到的文案或错误
- 预期应该是 canvas 语义还是允许保留 workspace 技术命名

### 5.2 建议角色

- 普通成员：用于验证个人草稿画布创建、进入默认节点图、不可见其他成员个人草稿。
- 团队管理员：用于验证团队画布初始化/修复、成员管理、发布和 Agent Skill。
- 其他团队成员：用于验证跨团队只读/不可见边界。
- 项目管理员/组织管理员：用于验证项目管理员中心、团队/成员/发布治理。
- 无团队用户：用于验证空态、fallback、无权限说明。

## 6. 人工测试步骤

### 6.1 原 shell 与入口

1. 打开 `/workspace`。
2. 确认进入原 `/workspace/[workspaceId]` 主界面，而不是独立 `/workbench`。
3. 确认已有最近访问 canvas 时优先回到最近访问项。
4. 清理或换账号后，确认 fallback 到 server last-active canvas 或默认团队画布。
5. 验证旧 workflow/editor 链接仍可进入，不因文案迁移破坏路由。

通过标准：

- 页面主心智是 Canvas，不是 Workspace。
- URL 或内部参数仍出现 `/workspace/[workspaceId]` 可以接受。
- 不应出现独立 `/workbench` 新外壳。

### 6.2 普通成员个人草稿画布

1. 以普通团队成员登录。
2. 在 Sidebar/Home 中查找创建入口。
3. 确认入口文案是“个人草稿画布”或 canvas 语义，不是 create workspace。
4. 创建一个个人草稿画布。
5. 进入默认节点图，新增/保存一个简单 workflow。
6. 切换到团队画布后再切回个人草稿画布，确认最近访问和列表标签正常。

通过标准：

- 普通成员可以创建个人草稿画布。
- 不暴露 workspace creation policy 心智。
- 其他成员个人草稿不可见。

### 6.3 团队管理员团队画布

1. 以团队管理员登录。
2. 进入团队管理页或 Home 团队画布入口。
3. 若团队画布未初始化，执行初始化。
4. 若健康状态提示可修复，执行一键修复。
5. 添加/邀请成员，调整 member/admin 角色，移除测试成员。
6. 检查团队活动日志是否记录关键操作。

通过标准：

- 文案是团队画布初始化/修复，不是创建普通 workspace。
- 成员、权限和健康状态操作可完成。
- 活动日志能看到相应团队管理事件。

### 6.4 展示画布与发布只读

1. 以团队管理员从团队画布发布一个测试 workflow。
2. 打开展示/发布查看路径。
3. 以同团队成员、其他团队成员、项目管理员分别查看。
4. 尝试在展示/发布画布上执行写操作，例如编辑节点、保存、Realtime 拖动、Copilot 修改。
5. 检查是否被服务端拒绝或进入只读体验。

通过标准：

- 有权限用户可读展示内容。
- 展示/发布画布不能被普通写路径修改。
- 拒绝文案应是 canvas 语义。

### 6.5 搜索、命令面板和模板入口

1. 打开搜索或 command palette。
2. 搜索个人草稿画布、团队画布、legacy canvas。
3. 确认分组为 `Canvases`。
4. 检查条目标签是否区分 Personal draft / Team / Legacy canvas。
5. 打开公共 template edit selector，确认选择器使用 canvas 语义和权限提示。

通过标准：

- 用户可见分组和标签不再使用 Workspaces。
- 无写权限提示不再说 workspace。

### 6.6 Settings / Sidebar / Home 文案

1. 进入 Settings 中的 API keys、BYOK、Inbox、Integrations、Secrets、Subscription、team management。
2. 打开 Sidebar 邀请弹窗、resource 分组、canvas 下拉和右键菜单。
3. 打开 Home canvas gateway。
4. 检查按钮、标题、tooltip、toast、空态、错误提示。

通过标准：

- 用户可见位置应使用 canvas、personal draft、team canvas、showcase 等词。
- `workspaceId`、API route 或开发者字段不作为文案 bug。

### 6.7 Copilot / MCP / 平台帮助

1. 打开 Copilot。
2. 调用或查看平台快捷帮助。
3. 确认显示 `Quick Reference — Canvases`。
4. 检查 list folders、create workflow、create folder、move workflow/folder、generate API key、deploy、agent skill 等工具说明。
5. 如工具返回错误，检查错误文案是否是 Canvas ID / canvas access / canvas context。

通过标准：

- 面向用户的描述使用 canvas/canvases。
- `list_workspaces`、`list_user_workspaces`、`workspaceId` 仍保留为技术兼容名，不作为缺陷。

### 6.8 项目管理员中心

1. 以项目管理员进入 `/workspace/[workspaceId]/project-admin`。
2. 查看工种、团队、成员数量、Agent 映射和发布治理 watchlist。
3. 创建测试团队，分配/批量分配成员。
4. 查看项目级 activity drilldown 和通知中心。
5. 检查发布治理、失败审计、retention cleanup、组织日志 retention controls 等入口。

通过标准：

- 项目管理员能力位于原 workspace shell 内。
- 创建团队和分配成员不暴露普通 create workspace 心智。
- 详情、筛选、导出和通知中心首版可用。

### 6.9 权限隔离抽查

1. 普通成员尝试访问其他成员个人草稿画布。
2. 其他团队成员尝试访问非本团队团队画布写路径。
3. 展示画布读者尝试读源团队敏感配置，例如 credentials、environment、BYOK、API keys。
4. Copilot 尝试打开或修改无权资源。
5. Realtime 尝试在只读房间内 mutation 或 position update。

通过标准：

- 非授权资源应隐藏、404 或明确拒绝。
- 不应泄露其他成员个人草稿、源团队敏感配置或可写能力。
- 拒绝提示尽量使用 canvas 语义。

## 7. 问题记录模板

发现问题时按以下格式记录，便于继续修 Phase 11 或 Phase 12：

```text
角色：
URL：
入口/页面：
操作步骤：
实际结果：
预期结果：
是否用户可见 workspace 文案：
截图或日志：
```

判断规则：

- 需要修：按钮、标题、toast、错误提示、空态说明、邮件正文、帮助说明中出现面向用户的 workspace/workspaces。
- 可以保留：`workspaceId`、`list_workspaces`、`/workspace/[workspaceId]`、数据库字段、日志字段、测试数据、内部 helper/import path。

## 8. 接手注意事项

- 不要恢复独立 `/workbench` shell。
- 不要使用或继续投资 `CanvasLaunchButton` 作为产品入口。
- 不要把组织级 workspace creation policy 重新接回普通成员个人草稿创建。
- 不要让团队管理员默认查看成员个人草稿。
- 不要只靠前端隐藏按钮实现展示画布只读，必须保留服务端权限强制。
- 不要把 `apps/realtime/src/routes/http.ts` 和 `apps/sim/components/workbench/canvas-launch-button.tsx` 混入无关提交。
