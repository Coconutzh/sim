# 剧场协作任务时间轴执行状态

更新时间：2026-06-03

## 当前范围

- 本轮实现 Phase 3 与 Phase 4.1：项目任务 CRUD、导演/工种时间轴、任务提交、导演审核、SSE 轻量通知。
- 暂不实现 Phase 4.2 任务聊天、Phase 5 DDL 自动提醒，避免扩大数据模型和通知中心范围。
- 任务归属以 `workgroup` 为准；导演权限以组织 owner/admin 或 `chief_director` 工种成员为准。

## 已完成

- 新增 `project_task` 数据模型与 `project_task_status` 枚举，支持标题、描述、DDL、负责工种、创建者、状态、结果节点绑定、提交/审核信息、软归档。
- 新增手写迁移 `packages/db/migrations/0212_project_tasks.sql`，遵循当前 0207-0211 的手写迁移模式。
- 新增项目任务 API contract 与路由：
  - `GET/POST /api/organizations/[id]/project-tasks`
  - `GET/PATCH/DELETE /api/project-tasks/[taskId]`
  - `POST /api/project-tasks/[taskId]/submit`
  - `PATCH /api/project-tasks/[taskId]/review`
  - `GET /api/project-tasks/events`
- 新增服务层 `apps/sim/lib/collaboration/project-tasks.ts`，包含导演权限、工种成员权限、状态机、结果节点归属校验与软归档。
- 新增 SSE 事件通道，任务创建、更新、归档、提交、开始审核、通过、驳回后会推送给对应导演/工种视图并触发前端查询刷新。
- 新增 React Query hooks，统一使用 contract + `requestJson`，没有新增 route-local Zod 或 raw fetch。
- 在原始工作区画布 `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/workflow.tsx` 中挂载浮动任务时间轴，未新建外壳页面。
- 时间轴 UI 复用 emcn 的 `Button`、`Badge`、`Modal`、`FormField`、`Input`、`Textarea`、`Combobox`、`Skeleton`、`toast`，不引入第三方时间轴库。
- 新增 contract 测试 `apps/sim/lib/api/contracts/project-tasks.test.ts`，覆盖 self 查询约束、默认值、提交画布 ID 文案、驳回审核意见约束。

## 行为说明

- 导演视图：当前用户属于同一组织的 `chief_director` 工种时，时间轴请求 `scope=director`，展示该组织所有未归档任务；默认隐藏已完成任务。
- 工种视图：非导演用户请求 `scope=self&workgroupId=<activeWorkgroupId>`，只展示分配给当前工种的任务。
- 新建/编辑/归档：只有导演权限可用；归档为软删除，默认列表不展示。
- 提交：工种成员在自己画布中选中 1 个节点后，可将任务从 `todo/rejected` 提交为 `submitted`，并保存 `resultWorkspaceId/resultWorkflowId/resultNodeId`。
- 审核：导演可将 `submitted` 标记为 `in_review`，再通过为 `completed` 或驳回为 `rejected`；驳回必须填写审核意见。

## 验证记录

- 已运行 `bun run check:api-validation`，通过。
- 已运行 `bun run --filter sim type-check`，通过。
- 已运行 `bun run --filter sim test lib/api/contracts/project-tasks.test.ts`，通过 4 个 contract 测试。
- 已运行 `bunx biome check --write --no-errors-on-unmatched ...` 格式化本轮触达文件。
- 已运行 `git diff --check`，通过。

## 待手测路径

- 使用导演组用户进入任意团队画布，确认右下方出现“导演任务时间轴”，可新建任务并指派给其他工种。
- 使用被指派工种用户进入自己的画布，确认只看到本组任务。
- 在工种画布选中一个结果节点，打开任务详情并点击“提交审核”，确认任务状态变为“已提交”。
- 切回导演用户，确认时间轴收到刷新/Toast，打开任务详情后执行“开始审核”“通过”或“驳回”。
- 驳回后切回工种用户，确认任务可重新提交，且审核意见可见。
- 勾选“显示已完成”，确认已完成任务出现；取消后默认隐藏。

## 未完成与后续

- 任务内聊天与未读数未做，后续应新增 `task_messages` 表、消息 API 与弹窗/抽屉 UI。
- DDL 前一天自动提醒未做，后续应基于 cron/Trigger.dev 扫描 `dueAt` 并记录 `reminderSent`。
- 当前 SSE 通知为轻量 Toast + React Query 刷新，未写入持久站内通知中心。
- 当前任务详情只保存节点 ID，不直接读取或渲染节点内容；后续审核面板可补充节点摘要/预览。
- 手写迁移未更新 Drizzle `_journal.json`，保持与近期 0207-0211 手写迁移一致；如果团队后续恢复 drizzle-kit 生成链路，需要统一补 journal/snapshot。
