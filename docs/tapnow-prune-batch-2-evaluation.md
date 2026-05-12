# TapNow 下一批候选服务分批评估

## 1. 评估目标

本评估只针对下一批候选服务：

- `wealthbox`
- `stagehand`
- `spotify`
- `youtube`

目标不是立刻删除，而是先确认：

1. 每个 service 的真实删除面有多大
2. 是否只牵涉 `tools + block`
3. 是否还牵涉 OAuth、selector、route、Next 配置或页面嵌入
4. 哪些可以先删，哪些必须后置

## 2. 结论摘要

建议不要四个一起删。

推荐分批顺序：

1. `youtube`
2. `stagehand`
3. `spotify`
4. `wealthbox`

风险从低到高大致如下：

| service | 风险等级 | 主要原因 | 建议批次 |
| --- | --- | --- | --- |
| `youtube` | 低到中 | 主要是 `tools + block + landing`，但还牵涉模板提示和通用视频嵌入体验 | 第一优先 |
| `stagehand` | 中 | 除 `tools + block + route + contract` 外，还牵涉 `next.config.ts` 和依赖包 | 第二优先 |
| `spotify` | 中到高 | `tools` 体量很大，并且牵涉 OAuth provider 配置；同时要区分“工具集成删除”和“笔记内 Spotify 嵌入保留” | 第三优先 |
| `wealthbox` | 高 | 不只是 `tools + block`，还牵涉 selector、selector route、OAuth route、OAuth provider 配置 | 最后处理 |

一句话结论：

> 下一批最适合先动的是 `youtube`，其次是 `stagehand`；`spotify` 需要单独一批；`wealthbox` 应该后置，不要和前三个混删。

## 3. 单项评估

### 3.1 `youtube`

#### 代码面

核心文件：

- `apps/sim/tools/youtube/**`
- `apps/sim/blocks/blocks/youtube.ts`
- `apps/sim/tools/registry.ts`
- `apps/sim/blocks/registry.ts`
- `apps/sim/app/(landing)/integrations/data/integrations.json`
- `apps/sim/app/(landing)/integrations/data/icon-mapping.ts`

额外产品面引用：

- `apps/sim/app/workspace/[workspaceId]/home/components/template-prompts/consts.ts`
  - 有 `integrationBlockTypes: ['youtube']`
- `apps/sim/app/(landing)/components/landing-preview/components/landing-preview-workflow/preview-block-node.tsx`
  - 有 `youtube: YouTubeIcon`

非集成但仍引用 YouTube 的能力：

- `apps/sim/app/academy/components/lesson-video.tsx`
- `apps/sim/lib/academy/content/courses/sim-foundations.ts`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-block.tsx`
- `apps/sim/lib/core/security/csp.ts`

#### 风险判断

`youtube` 的“工具集成面”和“页面媒体嵌入面”混在同一个关键词上，但其实是两件事：

- 可以删：
  - YouTube 工具集成
  - YouTube block
  - landing 展示
  - 首页模板提示里的 YouTube 集成推荐
- 不应该因为删工具而一起删：
  - academy 视频播放
  - note block 的 YouTube 嵌入预览
  - CSP 中允许 YouTube iframe 的通用白名单

#### 结论

`youtube` 适合最先做物理删除。

原因：

- 没有 OAuth provider
- 没有内部 `/api/tools/youtube/**` route
- 没有 selector / webhook / auth route
- 删除边界相对清晰

#### 删除时必须一起处理

- `apps/sim/tools/youtube/**`
- `apps/sim/blocks/blocks/youtube.ts`
- `apps/sim/tools/registry.ts`
- `apps/sim/blocks/registry.ts`
- `apps/sim/app/(landing)/integrations/data/integrations.json`
- `apps/sim/app/(landing)/integrations/data/icon-mapping.ts`
- `apps/sim/app/(landing)/components/landing-preview/components/landing-preview-workflow/preview-block-node.tsx`
- `apps/sim/app/workspace/[workspaceId]/home/components/template-prompts/consts.ts`

#### 删除时明确保留

- `apps/sim/app/academy/components/lesson-video.tsx`
- `apps/sim/lib/academy/content/courses/sim-foundations.ts`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-block.tsx`
- `apps/sim/lib/core/security/csp.ts`

### 3.2 `stagehand`

#### 代码面

核心文件：

- `apps/sim/tools/stagehand/**`
- `apps/sim/blocks/blocks/stagehand.ts`
- `apps/sim/app/api/tools/stagehand/agent/route.ts`
- `apps/sim/app/api/tools/stagehand/extract/route.ts`
- `apps/sim/app/api/tools/stagehand/utils.ts`
- `apps/sim/lib/api/contracts/tools/stagehand.ts`
- `apps/sim/lib/api/contracts/tools/index.ts`
- `apps/sim/tools/registry.ts`
- `apps/sim/blocks/registry.ts`

额外配置和依赖：

- `apps/sim/next.config.ts`
  - `outputFileTracingIncludes['/api/tools/stagehand/*']`
- `apps/sim/package.json`
  - `@browserbasehq/stagehand`
- `apps/sim/app/(landing)/integrations/data/integrations.json`
- `apps/sim/app/(landing)/integrations/data/icon-mapping.ts`
- `apps/sim/content/blog/v0-5/index.mdx`
  - 文档里提到了 Stagehand

#### 风险判断

`stagehand` 比 `youtube` 更重，原因不是业务面更深，而是它已经进入：

- 内部 API route
- route contract
- Next build tracing 配置
- package dependency

它不牵 OAuth selector，也不牵 workspace 级产品能力，但牵构建配置。

#### 结论

`stagehand` 适合作为第二批单独删除。

不建议和 `wealthbox` 混在一起，因为风险类型不同：

- `stagehand` 是“运行时和构建配置耦合”
- `wealthbox` 是“账号体系和 selector 耦合”

#### 删除时必须一起处理

- `apps/sim/tools/stagehand/**`
- `apps/sim/blocks/blocks/stagehand.ts`
- `apps/sim/app/api/tools/stagehand/**`
- `apps/sim/lib/api/contracts/tools/stagehand.ts`
- `apps/sim/lib/api/contracts/tools/index.ts`
- `apps/sim/tools/registry.ts`
- `apps/sim/blocks/registry.ts`
- `apps/sim/next.config.ts`
- `apps/sim/package.json`
- `apps/sim/app/(landing)/integrations/data/integrations.json`
- `apps/sim/app/(landing)/integrations/data/icon-mapping.ts`

#### 可后置处理

- `apps/sim/content/blog/v0-5/index.mdx`

这类博客文案不是运行时阻塞项，可以在代码删完后单独清理。

### 3.3 `spotify`

#### 代码面

核心文件：

- `apps/sim/tools/spotify/**`
- `apps/sim/blocks/blocks/spotify.ts`
- `apps/sim/tools/registry.ts`
- `apps/sim/blocks/registry.ts`
- `apps/sim/app/(landing)/integrations/data/integrations.json`

认证相关：

- `apps/sim/lib/auth/auth.ts`
- `apps/sim/lib/oauth/oauth.ts`
- `apps/sim/lib/oauth/types.ts`
- `apps/sim/lib/oauth/oauth.test.ts`
- `apps/sim/lib/oauth/utils.test.ts`

非集成但仍引用 Spotify 的能力：

- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-block.tsx`
  - 支持 Spotify track/album/playlist/episode/show 嵌入
- `apps/sim/lib/core/security/csp.ts`
  - 允许 `https://open.spotify.com`

#### 风险判断

`spotify` 的问题不是 route，而是两个点：

1. `tools` 体量非常大
   - 80+ 文件
   - block 里挂了大量 operation
2. OAuth provider 已经进入共用认证配置
   - 不是删掉工具目录就结束

另外，Spotify 还和 note block 的内容嵌入体验共享同一个品牌词。

如果把“Spotify 工具集成”和“Spotify 嵌入能力”混删，会伤到通用内容展示体验。

#### 结论

`spotify` 不适合和 `youtube` 或 `stagehand` 同批。

建议单独一批删除，原因：

- 需要同时处理 OAuth provider 配置
- 改动面明显大于 `youtube`
- 但又没有 `wealthbox` 那种 selector route 复杂度

#### 删除时必须一起处理

- `apps/sim/tools/spotify/**`
- `apps/sim/blocks/blocks/spotify.ts`
- `apps/sim/tools/registry.ts`
- `apps/sim/blocks/registry.ts`
- `apps/sim/lib/auth/auth.ts`
- `apps/sim/lib/oauth/oauth.ts`
- `apps/sim/lib/oauth/types.ts`
- `apps/sim/lib/oauth/oauth.test.ts`
- `apps/sim/lib/oauth/utils.test.ts`
- `apps/sim/app/(landing)/integrations/data/integrations.json`
- `apps/sim/app/(landing)/integrations/data/icon-mapping.ts`

#### 删除时明确保留

- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-block.tsx`
- `apps/sim/lib/core/security/csp.ts`

也就是说：

- 删 Spotify 工具集成
- 不删“在 note 里贴一个 Spotify 链接后自动嵌入播放器”的通用体验

### 3.4 `wealthbox`

#### 代码面

核心文件：

- `apps/sim/tools/wealthbox/**`
- `apps/sim/blocks/blocks/wealthbox.ts`
- `apps/sim/tools/registry.ts`
- `apps/sim/blocks/registry.ts`

selector 和 contract：

- `apps/sim/lib/api/contracts/selectors/wealthbox.ts`
- `apps/sim/lib/api/contracts/selectors/index.ts`
- `apps/sim/hooks/selectors/providers/wealthbox/selectors.ts`
- `apps/sim/hooks/selectors/registry.ts`
- `apps/sim/hooks/selectors/types.ts`

route：

- `apps/sim/app/api/tools/wealthbox/items/route.ts`
- `apps/sim/app/api/tools/wealthbox/item/route.ts`
- `apps/sim/app/api/auth/oauth/wealthbox/items/route.ts`
- `apps/sim/app/api/auth/oauth/wealthbox/item/route.ts`

认证相关：

- `apps/sim/lib/auth/auth.ts`
- `apps/sim/lib/oauth/oauth.ts`
- `apps/sim/lib/oauth/types.ts`
- `apps/sim/lib/oauth/oauth.test.ts`
- `apps/sim/lib/oauth/utils.test.ts`

展示和文案：

- `apps/sim/app/(landing)/integrations/data/integrations.json`
- `apps/sim/app/(landing)/integrations/data/icon-mapping.ts`
- `apps/sim/lib/copilot/generated/tool-schemas-v1.ts`
- `apps/sim/lib/copilot/generated/tool-catalog-v1.ts`

#### 风险判断

`wealthbox` 是这四个里最不适合立刻动的。

原因：

1. 不是单纯工具集成
   - block 里直接依赖 `selectorKey: 'wealthbox.contacts'`
2. 有 selector contract 和 selector hook
   - 会牵连前端选择器体系
3. 既有 `/api/tools/wealthbox/**`
   - 也有 `/api/auth/oauth/wealthbox/**`
4. OAuth provider 已进入共享认证配置

它的复杂度已经从“工具删减”上升到了“产品能力拆除”。

#### 结论

`wealthbox` 应该最后处理。

不建议把它放进下一批第一轮物理删除。

如果要删，应该单独一个批次，并把 selector 体系一起清理干净。

#### 删除时必须一起处理

- `apps/sim/tools/wealthbox/**`
- `apps/sim/blocks/blocks/wealthbox.ts`
- `apps/sim/tools/registry.ts`
- `apps/sim/blocks/registry.ts`
- `apps/sim/lib/api/contracts/selectors/wealthbox.ts`
- `apps/sim/lib/api/contracts/selectors/index.ts`
- `apps/sim/hooks/selectors/providers/wealthbox/selectors.ts`
- `apps/sim/hooks/selectors/registry.ts`
- `apps/sim/hooks/selectors/types.ts`
- `apps/sim/app/api/tools/wealthbox/**`
- `apps/sim/app/api/auth/oauth/wealthbox/**`
- `apps/sim/lib/auth/auth.ts`
- `apps/sim/lib/oauth/oauth.ts`
- `apps/sim/lib/oauth/types.ts`
- `apps/sim/lib/oauth/oauth.test.ts`
- `apps/sim/lib/oauth/utils.test.ts`
- `apps/sim/app/(landing)/integrations/data/integrations.json`
- `apps/sim/app/(landing)/integrations/data/icon-mapping.ts`

#### 删除时建议一起评估

- `apps/sim/lib/copilot/generated/tool-schemas-v1.ts`
- `apps/sim/lib/copilot/generated/tool-catalog-v1.ts`

这两处不是第一阻塞项，但如果里面仍保留 Wealthbox 的能力描述，会让 Copilot 文案面和真实产品面不一致。

## 4. 建议的批次方案

### 批次 2A：`youtube`

目标：

- 先验证“非 OAuth、无内部 route 的纯工具集成”物理删除流程

特点：

- 风险最低
- 改动面清晰
- 还能顺手验证模板提示和 landing preview 的同步清理

### 批次 2B：`stagehand`

目标：

- 验证“带内部 route + contract + Next 配置 + 依赖包”的删除流程

特点：

- 比 `youtube` 重
- 但不碰 OAuth selector

### 批次 3：`spotify`

目标：

- 单独处理“大体量工具集成 + OAuth provider 配置”

特点：

- 不建议与别的 service 合批
- 删除时要明确保留 note block 嵌入能力

### 批次 4：`wealthbox`

目标：

- 单独处理“工具 + selector + OAuth route + OAuth provider”的复杂拆除

特点：

- 风险最高
- 需要单独验证 selector 体系是否完全摘干净

## 5. 最终建议

如果你要继续按方案 A 推进物理删除，下一步建议是：

1. 先做 `youtube`
2. 再做 `stagehand`
3. 再单独评估并删除 `spotify`
4. `wealthbox` 单独作为更后的一批

不建议的做法：

- 不要把 `wealthbox` 和 `stagehand` 放一批
- 不要把 `spotify` 和 `youtube` 简单当成同类一起删
- 不要因为删 YouTube/Spotify 工具，就顺手删掉 note block 嵌入和 academy 播放能力

一句话原则：

> 工具集成删除按依赖面分批，不按品牌名分批；同名的内容嵌入能力和工具集成能力要分开处理。
