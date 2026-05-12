# TapNow Phase 1 Completion Report

## 结论

截至当前提交，TapNow 向二开的阶段一可以认定为：

- 核心产品收口已完成
- 核心运行链路已保留
- 默认产品面已切到 TapNow MVP 白名单
- 长尾能力已从核心可见面和核心 AI 加块路径中收缩

但它还不是“整个仓库已经物理精简完毕”的状态。阶段一完成的是产品内核抽出，不是全量物理裁剪。

## 阶段一目标与结果

### 1. 保留 `workflow.tsx + use-collaborative-workflow + realtime handlers + execute route + agent block + panel copilot`

状态：已完成

保留的关键代码仍然是：

- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/workflow.tsx`
- `apps/sim/hooks/use-collaborative-workflow.ts`
- `apps/realtime/src/handlers/workflow.ts`
- `apps/realtime/src/handlers/operations.ts`
- `apps/sim/app/api/workflows/[id]/execute/route.ts`
- `apps/sim/blocks/blocks/agent.ts`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/panel/panel.tsx`

这条链路仍然支持：

- 建图
- 协作编辑
- Agent 执行
- Copilot 改图
- 工作流运行与日志调试

### 2. 收缩 `blocks/registry.ts`，只保留核心块

状态：按阶段一口径已完成

说明：

- 阶段一不是把 `blocks/registry.ts` 里的所有 import 物理删掉
- 阶段一是让产品默认只暴露 TapNow MVP 白名单中的 block

当前实现方式：

- `apps/sim/lib/product/tool-policy.ts` 维护 TapNow MVP block 白名单
- 默认预设已切到 `tapnow-mvp`
- 用户可见面只暴露白名单内 block
- Copilot 的关键 block 暴露入口也按白名单收口

这意味着：

- 阶段一的“收缩”已经在产品行为上生效
- 阶段二若继续推进，再做 registry 本体和文件层物理精简

### 3. 收缩 `tools/registry.ts`，只保留最小可用工具集

状态：按阶段一口径已完成

说明：

- 和 block 一样，阶段一先完成产品行为收缩
- 不是先去改成一个很小的物理 `ALL_TOOLS`

当前实现方式：

- `apps/sim/lib/product/tool-policy.ts` 维护 TapNow MVP tool service / tool id 白名单
- `apps/sim/tools/registry.ts` 导出面已经走白名单过滤
- 当前默认预设下，核心产品面只保留最小可用工具集

### 4. 隐藏而不是立刻物理删除长尾页面和入口

状态：已完成

当前策略是：

- 先隐藏
- 先阻止新入口继续暴露
- 先阻止 AI / Copilot 再继续生成这些能力
- 再分批做物理删除

本阶段已经收口的关键入口包括：

- Tool 选择入口
- Tool operation 搜索入口
- Trigger block 暴露入口
- Copilot server-side 加块 / 改类型 / 子流插入路径
- 嵌套节点创建路径

### 5. 先保证 MVP 可以完整完成“建图 -> 改图 -> 运行 -> 调试 -> 协作”

状态：代码侧已完成，运行验收仍建议单独执行一次

原因：

- 核心功能链路仍在
- 默认产品面已切到 MVP 白名单
- 核心可见入口和 AI 加块入口已收口

但当前轮没有完成真实 UI 联调和双端协作演练记录，所以更准确的说法是：

- 阶段一的代码改造完成
- 阶段一的最终人工验收仍建议补一次

## 本轮补齐的关键改动

对应提交：

- `bbc6b0eab` `feat: enforce TapNow MVP policy across core surfaces`

本轮补齐内容：

1. 默认产品预设改为 TapNow MVP

- 文件：`apps/sim/lib/product/tool-policy.ts`
- 行为：未显式配置时，默认启用 `tapnow-mvp`
- 如需临时回到全量面，可显式设置 `NEXT_PUBLIC_SIM_TOOL_POLICY_PRESET=off|full|all`

2. Tool 选择入口接入 block 白名单

- 文件：`apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/tool-input.tsx`

3. Tool operation 搜索索引接入白名单

- 文件：`apps/sim/lib/search/tool-operations.ts`

4. Trigger block 暴露入口接入白名单

- 文件：`apps/sim/lib/copilot/tools/server/blocks/get-trigger-blocks.ts`

5. Copilot server-side workflow edit 路径接入白名单

- 文件：`apps/sim/lib/copilot/tools/server/workflow/edit-workflow/operations.ts`
- 覆盖：
  - add
  - edit type
  - insert_into_subflow
  - nestedNodes child creation

## 当前阶段一的真实边界

阶段一已经完成的，是“产品内核抽出”：

- 默认产品面变小
- 默认可用 block/tool 变少
- AI 不再轻易生成长尾 block
- 关键交互面开始围绕 TapNow MVP 收口

阶段一还没有完成的，是“仓库物理极简化”：

- `blocks/registry.ts` 仍保留大量 import 和 `ALL_BLOCKS`
- `tools/registry.ts` 仍保留大量 import 和 `ALL_TOOLS`
- 大量长尾 `app/api/tools/**` 路由仍然在仓库里
- 长尾产品页和历史文档仍未做全量清理

这些属于阶段二及后续批量裁剪范围。

## 校验结果

已完成：

- `bunx biome check` 已通过本轮修改文件

未能完成：

- `bun run type-check` 在当前环境中直接报 `tsc` 命令不可用
- 改用 `bunx tsc --noEmit -p apps/sim/tsconfig.json` 后，先命中仓库基线的 TypeScript 6 `baseUrl` 弃用报错
- 加 `--ignoreDeprecations 6.0` 后又在全项目类型检查阶段 OOM

因此本轮没有拿到一份可用的全量类型检查通过结果，这属于当前仓库/环境基线问题，不是这批改动单独暴露出的局部报错。

## 建议的阶段一验收动作

为了把“代码完成”升级为“阶段一正式完成”，建议再补一轮人工联调：

1. 画布建图

- 新建工作流
- 确认 block 菜单只暴露 MVP 白名单能力

2. Copilot 改图

- 让 Copilot 添加/修改 block
- 确认不会再生成被白名单禁掉的 block

3. 运行与调试

- 执行一个包含 `agent + api/file/search` 的最小流
- 确认日志和执行状态正常

4. 协作

- 双端进入同一工作流
- 确认编辑、presence、操作广播正常

## 后续建议

阶段一结束后，建议直接进入阶段二：

- 继续按 service family 做物理删除
- 收缩 `blocks/registry.ts` 本体
- 收缩 `tools/registry.ts` 本体
- 逐步清理长尾模板、landing 入口和长尾页面
