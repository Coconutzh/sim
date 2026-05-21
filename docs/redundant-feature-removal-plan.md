# Sim 冗余功能梳理与移除思路

本文只整理当前代码里已经能明确定位的“兼容/别名/遗留分支”冗余点，目标是给后续安全下线提供分批方案，而不是一次性大删。

## 1. Mothership / Copilot 历史别名链路

### 现状证据

- `apps/sim/hooks/queries/tasks.ts`
  - `fetchChatHistory()` 先走 `getMothershipChatContract`，失败后再回退到原始 `fetch('/api/mothership/chat?chatId=...')`
  - 注释已经明确这里是“legacy copilot-shape alias”
- `apps/sim/app/api/copilot/chat/queries.ts`
  - 仍然承载 `/api/mothership/chat` 这类旧别名语义
- `apps/sim/lib/copilot/chat/lifecycle.ts`
  - `getAccessibleCopilotChat(..., { allowWorkspaceMembers: true })` 专门为旧 mothership alias 兼容保留

### 冗余问题

- 同一类“任务聊天详情”同时存在新 contract 路径和旧 alias 路径
- 前端解析同时兼容 `conversationId` 与 `activeStreamId` 两种返回形状
- 权限收敛、埋点、错误码、类型契约都被这条 fallback 链路稀释

### 建议移除步骤

1. 先补前端埋点，统计 `/api/mothership/chat` 的真实调用量与来源页面
2. 确认所有调用端都已迁到 `getMothershipChatContract`
3. 删除 `tasks.ts` 里的 raw fetch fallback
4. 删除 `copilot/chat/queries.ts` 中只为 alias 保留的 workspace-member 兼容逻辑
5. 最后删除 `/api/mothership/chat` 旧 alias 路由及对应测试

### 风险与验证

- 风险：老数据里仍有“copilot 表形状但 mothership 页面会打开”的聊天
- 验证：先在测试里覆盖“新 contract 读历史聊天”后，再灰度移除 fallback

## 2. 无 workspace 工作流的遗留兼容分支

### 现状证据

- `apps/sim/lib/execution/preprocessing.ts`
  - 明确返回：`Personal workflows are deprecated and cannot execute.`
- `apps/sim/lib/workflows/utils.test.ts`
  - 仍有“未挂 workspace 的工作流不可访问”的测试断言
- `apps/sim/lib/workflows/persistence/duplicate.ts`
  - 仍保留“未挂 workspace 的旧工作流不能 duplicate”的兜底分支

### 冗余问题

- 产品语义已经收敛到“工作流必须隶属 workspace”
- 但执行、读取、复制等路径仍保留一层“老数据兼容但拒绝执行”的分支
- 这些分支增加了权限推理复杂度，也让 goal3 这类 workspace 隔离更难彻底收口

### 建议移除步骤

1. 先写一个只读巡检脚本，统计 DB 中 `workflow.workspaceId IS NULL` 的真实存量
2. 如果线上/本地样本已为 0，补 migration 或一次性修复脚本，将残留数据挂回 workspace 或归档
3. 删掉执行、访问、复制中的 “workspaceId 为空” 兼容分支
4. 把对应错误文案从“deprecated”改成“不存在此状态”

### 风险与验证

- 风险：导入的历史 JSON / 老测试夹具可能仍会生成无 workspace 的 workflow
- 验证：导入、执行、duplicate、chat attach 四条链路都要回归

## 3. Legacy Starter / Split Trigger 兼容体系

### 现状证据

- `apps/sim/lib/workflows/triggers/triggers.ts`
  - `TRIGGER_TYPES.STARTER`
  - `StartBlockPath.LEGACY_STARTER / SPLIT_INPUT / SPLIT_API / SPLIT_CHAT / SPLIT_MANUAL`
  - `TriggerUtils.hasLegacyStarter()` 等整套兼容判断
- `apps/sim/executor/utils/start-block.ts`
  - 仍保留 `legacyStarterMode` 推导
- `apps/sim/serializer/index.ts`
  - 仍在处理 `advancedMode` 等老结构迁移

### 冗余问题

- 触发器体系已经有统一 `start_trigger`
- 但运行时、校验层、序列化层仍长期背着 legacy starter / split trigger 的兼容矩阵
- 每次改 trigger 行为都要同时考虑 unified 与 legacy path，维护成本很高

### 建议移除步骤

1. 先实现“打开工作流即自动迁移到 unified start”的持久化迁移
2. 后端保留只读兼容一段时间，但禁止再创建 legacy starter
3. 当存量工作流完成迁移后，删除：
   - `TRIGGER_TYPES.STARTER`
   - `StartBlockPath.LEGACY_*`
   - `legacyStarterMode` 相关分支
4. 最后清理围绕 legacy starter 的单测与 UI 冲突提示

### 风险与验证

- 风险：历史工作流导入、子工作流输入触发、API/manual/chat 三类启动路径可能出现回归
- 验证：重点跑 `triggers.ts`、`start-block.ts`、serializer、workflow import/export 的回归测试

## 建议执行顺序

1. 先删 Mothership / Copilot alias 链路
   - 这块边界最清晰，和 goal3 的权限收敛也直接相关
2. 再清无 workspace workflow 兼容
   - 可以进一步简化所有 workspace 权限判断
3. 最后做 legacy trigger 迁移
   - 影响面最大，适合单开一轮改造

## 建议提交粒度

- 提交 1：补观测/补测试，不删逻辑
- 提交 2：移除 Mothership / Copilot alias fallback
- 提交 3：移除无 workspace workflow 兼容
- 提交 4：迁移并移除 legacy starter 体系

这样能保证每一批都可单独回滚，不会把“兼容层移除”和“权限修复”揉成一个难回退的大提交。
