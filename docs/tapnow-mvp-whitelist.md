# TapNow MVP 白名单启用说明

## 1. 目标

这份文档说明如何启用当前仓库里已经接好的第一版工具/Block 裁剪策略。

对应代码入口：

- `apps/sim/lib/product/tool-policy.ts`
- `apps/sim/tools/registry.ts`
- `apps/sim/blocks/registry.ts`
- `apps/sim/tools/utils.ts`

当前这套策略的设计目标不是立刻删代码，而是先做一层“软下线”：

- 先收窄产品能力面
- 先隐藏大部分长尾第三方集成
- 先让旧 workflow / Agent / Copilot 在命中下线工具时给出明确错误
- 后续再决定哪些目录物理删除

## 2. 当前行为

如果你什么环境变量都不配，当前行为是：

- 不裁剪任何 tool
- 不裁剪任何 block
- 不影响现有产品

也就是说，这套能力默认是安全的，不会因为代码合入就直接改坏当前仓库。

## 3. 最简单的启用方式

在 `apps/sim/.env` 里加：

```env
NEXT_PUBLIC_SIM_TOOL_POLICY_PRESET=tapnow-mvp
```

这会启用第一版 TapNow MVP 预设。

当前预设会优先保留这些 tool service：

- `file`
- `mcp`
- `search`
- `slack`
- `gmail`
- `notion`

当前预设会优先保留这些核心 tool id：

- `http_request`
- `search_tool`
- `file_parser`
- `file_parser_v2`
- `file_parser_v3`
- `file_append`
- `file_write`

当前预设会优先保留这些 block type：

- `agent`
- `api`
- `chat_trigger`
- `condition`
- `file`
- `function`
- `generic_webhook`
- `loop`
- `mcp`
- `note`
- `parallel`
- `response`
- `router`
- `search`
- `start_trigger`
- `variables`
- `webhook_request`

## 4. 更细粒度的控制方式

除了 preset，还可以直接写显式白名单。

### 4.1 Tool service 白名单

```env
NEXT_PUBLIC_SIM_ENABLED_TOOL_SERVICES=file,mcp,search,slack,gmail,notion
```

适合场景：

- 你们想按 service 成组裁剪
- 不想一个一个点 tool id

### 4.2 Tool id 白名单

```env
NEXT_PUBLIC_SIM_ENABLED_TOOL_IDS=http_request,search_tool,file_parser,file_parser_v2,file_parser_v3,file_append,file_write
```

适合场景：

- 你们只想保留极少数基础能力
- 某些工具不走标准 `/api/tools/{service}` 目录推断

### 4.3 Block type 白名单

```env
NEXT_PUBLIC_SIM_ENABLED_BLOCK_TYPES=agent,api,chat_trigger,condition,file,function,generic_webhook,loop,mcp,note,parallel,response,router,search,start_trigger,variables,webhook_request
```

适合场景：

- 你们想先把画布菜单收得很小
- 避免出现“tool 被裁掉了，但 block 还在 UI 里”这种坏体验

## 5. 叠加规则

当前规则是“并集”逻辑，不是覆盖逻辑：

- `preset` 提供一组默认保留项
- 显式环境变量会在这个基础上继续追加

所以如果你设置了：

```env
NEXT_PUBLIC_SIM_TOOL_POLICY_PRESET=tapnow-mvp
NEXT_PUBLIC_SIM_ENABLED_TOOL_SERVICES=github
```

最终效果不是只保留 `github`，而是：

- 保留 `tapnow-mvp` 预设
- 另外再追加 `github`

## 6. 对 TapNow 风格二开的建议

如果你们当前目标是“先做一个简单、AI 驱动、画布体验强”的 MVP，建议先收得很狠。

### 6.1 第一批建议保留

- `agent`
- `api`
- `file`
- `search`
- `mcp`
- `slack`
- `gmail`
- `notion`

这里的原则不是“保留最多”，而是“只保留最容易支撑核心演示路径的能力”。

### 6.2 第一批建议下线

- `agentmail`
- `agentphone`
- `stagehand`
- 大量 CRM 集成
- 大量 HR / ATS 集成
- 大量 Ads / Analytics 集成
- 大量数据库长尾集成
- 与 TapNow 核心体验无关的垂类 SaaS

## 7. 预期效果

启用白名单以后，当前仓库会先得到这几层效果：

1. `tools/registry.ts` 不再导出被裁掉的内建工具
2. `blocks/registry.ts` 不再暴露被裁掉的 block
3. 执行链里如果命中被裁掉的 built-in tool，会报：

```text
Tool disabled in this product edition: <toolId>
```

这意味着：

- 新流程更难再碰到长尾功能
- 旧流程不会静默坏掉，而是给出明确提示

## 8. 这一步还没有做什么

当前这套策略还没有做这些事情：

- 还没有物理删除 `apps/sim/tools/{service}` 目录
- 还没有物理删除 `apps/sim/app/api/tools/{service}` 路由
- 还没有清理全部模板、Copilot 推荐、starter flow

所以它本质上还是第一阶段：

- 先收窄产品面
- 先保证二开主线推进
- 再做第二阶段的物理删除和模板清理

## 9. 推荐实施顺序

建议按这个顺序推进：

1. 先在开发环境启用 `NEXT_PUBLIC_SIM_TOOL_POLICY_PRESET=tapnow-mvp`
2. 再根据你们真实演示路径微调三个白名单变量
3. 再清模板、block 菜单、Copilot 推荐入口
4. 最后再批量物理删除已经确认不会恢复的 service 目录
