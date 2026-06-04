# 剧场项目任务时间轴执行状态

更新日期：2026-06-04

## 当前完成范围

- 已完成 Phase 3、Phase 4.1、Phase 4.2，以及 Phase 5.1 的第一版可测实现：项目任务 CRUD、提交/审核、任务内消息、DDL 前 24 小时提醒。
- 任务系统使用 `project_task`、`task_messages` 两张表，任务归属到 `workgroup`；导演权限以 organization owner/admin 和 `chief_director` 工种成员为准。
- API 没有复用 Mothership 旧的 `/api/tasks`，而是使用协作域路径：`/api/organizations/[id]/project-tasks` 与 `/api/project-tasks/**`。
- 实时提醒当前采用 SSE + React Query invalidation + Toast，不接入新的 Socket.IO UI 通知面板。
- 2026-06-04 人工检查后追加修复：任务时间轴不再覆盖画布，改为底部 Logs 面板内的“任务时间轴”标签；展示画布详情页可纵向滚动，画布区域放大，并支持只读点击节点查看详情。

## 已落地文件与能力

- 数据库迁移：
  - `packages/db/migrations/0212_project_tasks.sql`
  - `packages/db/migrations/0213_project_task_messages_and_reminders.sql`
- 任务 API contract 与路由：
  - `GET/POST /api/organizations/[id]/project-tasks`
  - `GET/PATCH/DELETE /api/project-tasks/[taskId]`
  - `POST /api/project-tasks/[taskId]/submit`
  - `PATCH /api/project-tasks/[taskId]/review`
  - `GET /api/project-tasks/events`
  - `GET/POST /api/project-tasks/[taskId]/messages`
  - `GET /api/cron/project-task-due-reminders`
- 业务服务集中在 `apps/sim/lib/collaboration/project-tasks.ts`，包含权限判断、任务格式化、状态机、消息计数、DDL 提醒筛选。
- React Query hooks 位于 `apps/sim/hooks/queries/project-tasks.ts`，通过 API contract + `requestJson` 访问同源 JSON 接口，并使用分层 query key。
- 任务时间轴组件位于 `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/project-task-timeline/project-task-timeline.tsx`，当前嵌入到底部终端面板，不再作为画布浮层。
- 展示画布只读预览位于 `apps/sim/components/workbench/showcase-readonly-canvas.tsx`，使用现有 PreviewWorkflow，不允许编辑，但支持节点详情弹窗。

## 产品规则确认

- 个人画布不能直接提交或发布到展示画布；这是当前产品链路设计，不是入口缺失。
- 只有团队画布内容可以进入展示画布。
- 非导演工种只看分配给本工种的任务；导演组可以查看和管理所有工种任务。
- 工种提交任务时需要在自己的画布里选中一个结果节点；任务会记录 `resultWorkspaceId/resultWorkflowId/resultNodeId`。
- 导演审核通过后任务进入 `completed`；驳回后回到可重新提交的状态。

## 2026-06-04 人工检查修复点

- 时间轴位置：从画布右下浮层移入底部 Logs 面板，增加 `Logs / 任务时间轴` 标签切换，保留原有底部面板高度拖拽能力。
- 时间轴加载错误：错误态改为独立提示区，说明需要确认数据库迁移已执行到 0212/0213，并提供重试按钮，避免只显示泛化的 `Failed to list project tasks`。
- 展示画布布局：展示详情页根容器改为纵向滚动，展示画布区域使用更高的视口高度，ResourceTable 保留在画布下方供下滑查看。
- 展示画布交互：只读预览仍不可拖动节点、不可保存、不可加入协同 presence；但点击节点可以查看节点 ID、类型、位置、父节点、启用状态、subBlocks、outputs 等详情。
- 视觉约束：本次 UI 继续使用 emcn 组件和 CSS variable tokens，没有新增全局样式或全新视觉风格。

## 手动测试建议

1. 执行数据库迁移，确认本地数据库包含 `project_task` 和 `task_messages`，以及 `project_task.message_count/last_message_at/reminder_sent_at` 字段。
2. 打开团队画布，确认底部面板能在 `Logs` 与 `任务时间轴` 间切换，并且时间轴不遮挡画布。
3. 用导演组账号创建任务，确认可以选择工种、填写 DDL、在时间轴中按 DDL 排列。
4. 用非导演工种账号进入画布，确认只显示分配给当前工种的任务。
5. 在非导演工种画布中选中一个节点后提交任务，确认任务进入待审核/已提交状态。
6. 用导演组账号审核通过或驳回任务，确认状态变化和 Toast/SSE 刷新符合预期。
7. 在时间轴中打开任务消息，发送消息后关闭再打开，确认消息列表和未读数表现正常。
8. 打开展示画布详情页，确认页面可下滑、画布区域足够大，点击任意节点可以查看只读详情。
9. 调用 `GET /api/cron/project-task-due-reminders` 并携带 `Authorization: Bearer $CRON_SECRET`，确认 DDL 前 24 小时提醒返回 `matchedCount/notifiedCount/taskIds`。

## 已执行校验

- 已在上一轮通过：`bunx biome check --write --no-errors-on-unmatched ...`、`bun run --filter sim type-check`、`bun run --filter sim test lib/api/contracts/project-tasks.test.ts`、`bun run check:api-validation`、`git diff --check`。
- 本轮 UI 修复后已重新执行：
  - `bunx biome check --write --no-errors-on-unmatched <本轮触达文件>`：通过，自动格式化 5 个 TS/TSX 文件。
  - `bun run --filter sim type-check`：通过。
  - `bun run --filter sim test lib/api/contracts/project-tasks.test.ts`：通过，6 个 contract 测试全部通过。
  - `bun run check:api-validation`：通过，当前 baseline 为 `total=434`、`zod=409`、`nonZod=25`。
  - `git diff --check`：通过。

## 后续建议

- 优化团队画布到展示画布的发布入口文案，明确“个人画布不能直接发布，团队画布可以发布到展示画布”。
- 将 DDL cron 从手动 API/外部 curl 升级为项目统一的 worker 或 Trigger.dev 任务。
- 如果需要更强消息未读能力，可把当前本地 read count 升级为服务端 read receipt。
- 后续可以为展示画布节点详情增加“跳转到源团队画布节点”的只读定位能力，但仍不开放展示画布编辑权限。
