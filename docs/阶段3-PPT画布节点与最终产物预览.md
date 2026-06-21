# 阶段3-PPT画布节点与最终产物预览

## 目标

在 Sim 画布中新增 PPT 内容节点，让用户可以像文本、图片、视频、音频节点一样放置 PPT 生成节点，并在节点上只预览最终 PPT 产物。

## 本阶段交付

- 新增 `presentation` 内容节点预设，工具栏可创建 `PPT` 节点。
- 扩展 `content` 纯画布块的隐藏字段：
  - `presentationPrompt`
  - `presentationSlideCount`
  - `presentationStatus`
  - `presentationError`
  - `presentationArtifact`
- 新增 PPT 节点卡片 UI：
  - 空状态展示 PPT 生成入口说明。
  - 生成中展示 pending 状态。
  - 失败展示错误信息。
  - 成功后展示封面图、页数、Hermes 选择的风格、PPTX 下载入口。
- 新增 PPT 产物结构归一化工具，用于读取 Hermes 上传接口返回的 `pptxFile`、`coverImageFile`、`manifestFile`、`manifest`。
- 扩展内容引用规则，使 PPT 节点可以引用文字、图片、视频、音频节点作为生成上下文。
- 扩展本地画布 Agent 的节点适配器，使 Agent 可以读取、创建、更新 PPT 节点字段，但生成动作仍留到后续阶段接入 Hermes。
- 预览模式支持展示最终 PPTX 产物，不展开中间页图。

## 设计边界

- PPT 节点不把每页图片作为画布节点展示，避免污染画布。
- `presentationArtifact` 保存最终产物元数据，`file` 可作为 PPTX 主文件的兼容字段。
- Hermes 自动判断风格；节点只保存结果中的 `selectedStyle` 和 `styleBrief`。
- 当前阶段不触发 Hermes 生成，只完成节点承载与预览闭环。

## 验证

- `bunx biome check` 已覆盖本阶段改动文件。
- `bunx vitest run "lib/product/content-node-presets.test.ts" "blocks/blocks/content.test.ts" "lib/workflows/content-references.test.ts" "app/api/internal/hermes/presentation-artifacts/upload/route.test.ts"` 通过。
- `bunx tsc --noEmit --project tsconfig.json --pretty false` 通过。
- `bun run check:api-validation` 通过。
