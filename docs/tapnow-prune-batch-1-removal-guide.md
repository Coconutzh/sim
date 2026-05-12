# TapNow 物理裁剪第一批说明

## 1. 背景

第一批物理裁剪已经完成，目标是先删除一组依赖链较短、不会直接牵动主产品核心画布链路的第三方集成能力。

对应提交：

- commit: `22ab4f24f`
- tag: `tapnow-prune-batch-1`

本批次删除的 service：

- `browser_use`
- `crowdstrike`
- `devin`
- `dspy`

这四个 service 的共同特点是：

- 主要属于 `tools + blocks + 部分 route/contract + landing 展示` 这一层
- 不承担工作流编辑器、实时协作、Copilot 主链路、Agent 主执行器的基础职责
- 适合拿来做第一批“真删代码”验证

## 2. 这批删掉了什么

本批次不是只从 UI 隐藏，而是已经做了物理删除。

处理范围包括四层：

1. 注册表入口删除
2. 具体 service 实现文件删除
3. API route / contract 删除
4. landing 展示数据删除

## 3. 删除清单

### 3.1 `browser_use`

删除的文件：

- `apps/sim/tools/browser_use/index.ts`
- `apps/sim/tools/browser_use/run_task.ts`
- `apps/sim/tools/browser_use/types.ts`
- `apps/sim/blocks/blocks/browser_use.ts`

同步修改的入口：

- `apps/sim/tools/registry.ts`
- `apps/sim/blocks/registry.ts`
- `apps/sim/app/(landing)/integrations/data/integrations.json`
- `apps/sim/app/(landing)/integrations/data/icon-mapping.ts`

### 3.2 `crowdstrike`

删除的文件：

- `apps/sim/tools/crowdstrike/index.ts`
- `apps/sim/tools/crowdstrike/get_sensor_aggregates.ts`
- `apps/sim/tools/crowdstrike/get_sensor_details.ts`
- `apps/sim/tools/crowdstrike/query_sensors.ts`
- `apps/sim/tools/crowdstrike/types.ts`
- `apps/sim/blocks/blocks/crowdstrike.ts`
- `apps/sim/app/api/tools/crowdstrike/query/route.ts`
- `apps/sim/app/api/tools/crowdstrike/query/route.test.ts`
- `apps/sim/lib/api/contracts/tools/crowdstrike.ts`

同步修改的入口：

- `apps/sim/tools/registry.ts`
- `apps/sim/blocks/registry.ts`
- `apps/sim/lib/api/contracts/tools/index.ts`
- `apps/sim/app/(landing)/integrations/data/integrations.json`
- `apps/sim/app/(landing)/integrations/data/icon-mapping.ts`

### 3.3 `devin`

删除的文件：

- `apps/sim/tools/devin/index.ts`
- `apps/sim/tools/devin/create_session.ts`
- `apps/sim/tools/devin/get_session.ts`
- `apps/sim/tools/devin/list_sessions.ts`
- `apps/sim/tools/devin/send_message.ts`
- `apps/sim/tools/devin/types.ts`
- `apps/sim/blocks/blocks/devin.ts`

同步修改的入口：

- `apps/sim/tools/registry.ts`
- `apps/sim/blocks/registry.ts`
- `apps/sim/app/(landing)/integrations/data/integrations.json`
- `apps/sim/app/(landing)/integrations/data/icon-mapping.ts`

### 3.4 `dspy`

删除的文件：

- `apps/sim/tools/dspy/index.ts`
- `apps/sim/tools/dspy/chain_of_thought.ts`
- `apps/sim/tools/dspy/predict.ts`
- `apps/sim/tools/dspy/react.ts`
- `apps/sim/tools/dspy/types.ts`
- `apps/sim/tools/dspy/utils.ts`
- `apps/sim/blocks/blocks/dspy.ts`

同步修改的入口：

- `apps/sim/tools/registry.ts`
- `apps/sim/blocks/registry.ts`
- `apps/sim/app/(landing)/integrations/data/integrations.json`
- `apps/sim/app/(landing)/integrations/data/icon-mapping.ts`

## 4. 删除后的边界状态

这批删除后，仓库状态是：

- 运行时不会再注册这些 tool id
- 画布菜单不会再出现这些 block
- landing integrations 页面不再展示这些集成
- `crowdstrike` 的内部 route 和对应 contract 也已经一起移除

仍然保留但不需要处理的内容：

- `apps/sim/components/icons.tsx` 里的图标定义暂时还在

原因：

- 图标定义本身不构成产品能力
- 先不在第一批清理里动大图标文件，可以降低无关冲突
- 后续如果累计删除的 service 足够多，再统一做图标死代码清理

## 5. 为什么第一批选这四个

选择原则不是“随便删四个”，而是优先删：

- 没有强耦合主产品页面的 service
- 没有额外 webhook / auth selector / workspace 配置面的 service
- 没有深度嵌入执行器基础语义的 service

没有放进第一批的典型例子：

- `wealthbox`
  - 还牵着 `auth/oauth` selector 相关 route
- `stagehand`
  - 还牵着 `next.config.ts` 里的额外配置
- `agentmail` / `agentphone`
  - 更偏产品能力，而不只是单纯第三方工具

## 6. 后续如果要重新接入，应该怎么做

不要直接从旧 commit 里把整个目录硬拷回来。正确方式是按“产品面 -> 注册面 -> 实现面 -> 校验面”恢复。

建议顺序如下。

### 6.1 先确认要不要恢复

先回答四个问题：

1. 这是 TapNow 风格产品当前版本真的需要的能力吗？
2. 它是 MVP 核心路径，还是某个行业特定长尾能力？
3. 它应该以通用工具存在，还是应该改造成更轻的产品化 block？
4. 它恢复后是否会重新拉高配置复杂度和菜单噪音？

如果这四个问题答不清，先不要恢复。

### 6.2 恢复代码的推荐来源

优先从以下来源恢复：

1. 当前仓库的 Git 历史
   - 直接参考 `22ab4f24f` 的前一个状态
2. 旧实现逻辑
   - 只复用真正需要的部分
3. 当前仓库现有规范
   - 以当前 contract / registry / block 规范为准，不要盲目复刻旧代码结构

也就是说，Git 历史是“恢复素材库”，不是“直接整体回滚按钮”。

### 6.3 恢复时最少需要补回哪些层

#### A. tool 实现层

至少补回：

- `apps/sim/tools/{service}/**`

要求：

- tool id 命名继续遵守 `service_action`
- 参数和输出保持当前仓库的 `ToolConfig` 规范
- 不要把旧时代的临时类型和临时工具封装直接原样带回

#### B. 注册层

至少补回：

- `apps/sim/tools/registry.ts`

要求：

- 增加 import
- 把 tool 放回 `ALL_TOOLS`
- 确认不会与当前 `tool-policy` 白名单策略冲突

#### C. block 层

如果这个能力要出现在画布里，还要补回：

- `apps/sim/blocks/blocks/{service}.ts`
- `apps/sim/blocks/registry.ts`

要求：

- block 的 `tools.access` 要和实际恢复的 tool id 一致
- `tools.config.tool()` 不要做破坏变量引用的类型转换
- 优先控制 subBlocks 数量，避免恢复成“配置面板过重”的旧形态

#### D. route / contract 层

只有当 service 确实依赖内部 `/api/tools/**` 转发时，才需要补回：

- `apps/sim/app/api/tools/{service}/**`
- `apps/sim/lib/api/contracts/tools/{service}.ts`
- `apps/sim/lib/api/contracts/tools/index.ts`

注意：

- route 要继续走当前的 contract + `parseRequest` 规范
- 不要恢复成 route 内部自写 boundary schema 的旧写法
- 如果 service 其实可以直接走外部 API，不一定要重新引入内部 route

#### E. 展示层

如果希望对外展示这个集成，再补回：

- `apps/sim/app/(landing)/integrations/data/integrations.json`
- `apps/sim/app/(landing)/integrations/data/icon-mapping.ts`

如果只是内部可用，不一定要立刻恢复 landing 展示。

## 7. 针对这四个 service 的恢复建议

### 7.1 `browser_use`

建议只有在你们明确需要“浏览器代理动作”时再恢复。

恢复建议：

- 优先先恢复 `tool`
- 确认是否真的需要恢复独立 block
- 如果只是给 Agent 提供浏览器能力，可以先作为隐藏工具能力恢复，而不是立刻重新暴露大而重的 block

### 7.2 `crowdstrike`

这是四个里恢复成本最高的一个，因为它不只是 tool，还带 route 和 contract。

恢复建议：

- 先确认这个能力是否仍然是产品重点行业场景
- 如果只是偶发安全客户需求，宁可后置，不要优先恢复
- 如果恢复，必须一起恢复：
  - tool
  - route
  - contract
  - block
  - 对应测试

### 7.3 `devin`

它本质上是一个“外部 agent 平台接入”。

恢复建议：

- 先定义产品上希望暴露的最小动作集
- 不一定要把旧的四个动作全部恢复
- 更好的做法是先恢复一个最小可用版本，例如：
  - 创建 session
  - 查询 session

### 7.4 `dspy`

它偏开发者和研究型集成，不是 TapNow 风格首要能力。

恢复建议：

- 只有在你们明确需要“自托管推理程序接入”时再恢复
- 可以先只恢复 `predict`
- `chain_of_thought` 和 `react` 未必需要第一时间恢复

## 8. 恢复时的检查清单

恢复任意一个 service 后，至少检查下面这些点：

1. `tools/registry.ts` 已恢复，运行时能拿到 tool
2. `blocks/registry.ts` 已恢复，画布能看到 block
3. block 的 `tools.access` 与真实 tool id 一致
4. 若有 route，`apps/sim/app/api/tools/**` 能正常编译
5. 若有 contract，`apps/sim/lib/api/contracts/**` 导出链完整
6. landing 如需展示，图标映射和 integrations 数据完整
7. `bunx biome check` 通过
8. 如涉及 route，确认没有新增 `check:api-validation` 违规

## 9. 推荐恢复策略

后续若要回接，不建议一口气恢复整个旧 service。

推荐策略：

1. 先恢复最小动作集
2. 先不恢复 landing 展示
3. 先不恢复所有次要操作
4. 先验证是否真的有人用
5. 再决定是否补齐完整 block 和完整 route

一句话原则：

> 恢复能力时，按当前产品目标重建最小可用版本，而不是把被删除的旧集成整包原样搬回来。
