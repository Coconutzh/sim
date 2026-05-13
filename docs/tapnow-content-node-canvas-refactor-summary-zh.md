# TapNow 化画布改造阶段总结

本文档记录本轮围绕 `sim` 画布交互做的 TapNow 化改造，重点是把用户入口从“工作流块”切到“内容节点”，并把高频编辑能力前移到节点卡片内部。

## 一、本轮完成的 5 步

### 1. 抽出内容节点映射层

新增：

- [apps/sim/lib/product/content-node-presets.ts](/D:/projects/sim/apps/sim/lib/product/content-node-presets.ts:1)

作用：

- 定义产品层内容节点：
  - Text
  - Image
  - Video
  - Document
  - Table
  - Image Editor（占位）
- 将内容节点映射到现有底层 block：
  - `agent`
  - `image_generator`
  - `video_generator`
  - `file`
  - `table`

### 2. 改造画布新增入口

改动：

- [canvas-menu.tsx](/D:/projects/sim/apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/canvas-menu/canvas-menu.tsx:1)
- [command-list.tsx](/D:/projects/sim/apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/command-list/command-list.tsx:1)
- [workflow.tsx](/D:/projects/sim/apps/sim/app/workspace/[workspaceId]/w/[workflowId]/workflow.tsx:1)

结果：

- 空白画布不再先强调 `New Agent` / `Search Blocks`
- 改成优先展示内容节点入口
- 右键菜单也不再是 `Add Block`
- 改成：
  - `New Text`
  - `New Image`
  - `New Video`
  - `New Document`
  - `New Table`

### 3. 节点卡片内联编辑

新增：

- [content-node-inline-editor.tsx](/D:/projects/sim/apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/content-node-inline-editor.tsx:1)

接入：

- [workflow-block.tsx](/D:/projects/sim/apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/workflow-block.tsx:1)

当前支持：

- Text 节点：直接写文本，内部写回 `agent.messages`
- Image 节点：直接写 `prompt`
- Video 节点：直接写 `prompt`，Runway 时可直接上传参考图
- Document 节点：直接上传文件
- Table 节点：直接选表、改操作类型

### 4. 右侧面板降级为高级设置

改动：

- [workflow-block.tsx](/D:/projects/sim/apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/workflow-block.tsx:1)
- [content-node-inline-editor.tsx](/D:/projects/sim/apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/content-node-inline-editor.tsx:1)
- [panel.tsx](/D:/projects/sim/apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/panel/panel.tsx:1)
- [tool-policy.ts](/D:/projects/sim/apps/sim/lib/product/tool-policy.ts:1)

结果：

- 节点卡片里不再重复展示已经内联编辑的字段摘要
- 每个内容节点卡片底部都有“高级设置”入口
- 右侧 `Editor` 标签改名为 `Advanced`
- TapNow MVP 白名单补入核心内容节点 block：
  - `file`
  - `image_generator`
  - `table`
  - `video_generator`

### 5. 定向验证

已完成：

- 对本轮涉及的 8 个文件执行 `bunx biome check`
- 结果：通过

执行命令时的范围包括：

- `content-node-presets.ts`
- `canvas-menu.tsx`
- `command-list.tsx`
- `content-node-inline-editor.tsx`
- `workflow-block.tsx`
- `panel.tsx`
- `workflow.tsx`
- `tool-policy.ts`

## 二、当前效果

现在的画布交互已经具备下面这些变化：

- 创建入口先是“内容节点”，不是“工作流块”
- 节点卡片本身可以直接创作和上传
- 右侧面板更明确地承担高级配置职责
- 没有重写 executor / realtime / store / subblocks 体系

也就是说，这一轮是“产品层改造”，不是“底层执行重构”。

## 三、当前仍然存在的边界

### 1. 图片编辑器节点仍然是占位

当前没有真正独立的一类底层图片编辑器 block。  
所以现在只是：

- 在产品映射层保留 `Image Editor`
- 但没有开放真实创建

### 2. 节点内联编辑仍然是最小版本

当前优先解决的是高频输入和上传，不是完整替代右侧高级配置。

例如：

- Text 节点只暴露简化文本输入，不等于完整 Agent 配置器
- Image 节点只优先暴露 prompt
- Table 节点只暴露轻量绑定和操作选择

### 3. 全量 TypeScript 检查在当前 Windows 机器上内存压力很大

尝试执行：

```powershell
bunx tsc --noEmit --pretty false -p apps/sim/tsconfig.json
```

结果是 Node 堆内存不足退出，不是本轮文件级 Biome 校验失败。  
因此本轮验证以“定向 Biome 检查 + 后续人工联调”为主。

## 四、建议的下一轮人工验收

建议重点跑下面这条链：

1. 空白工作流进入后，是否优先看到内容节点入口
2. 右键空白画布后，是否能直接新建 Text / Image / Video / Document / Table
3. Text 节点是否能在卡片内直接输入内容
4. Document 节点是否能在卡片内直接上传文件
5. Video 节点在 Runway provider 下是否能直接上传参考图
6. 点击节点底部高级设置后，是否能切到右侧 `Advanced` 面板
7. 创建后的节点是否仍能正常执行、连线、协作同步

## 五、下一步建议

如果继续做，我建议优先顺序是：

1. 把图片节点补成“prompt + 结果预览 + 重生成”
2. 把文本节点再做轻量化，例如更像单卡片文案编辑而不是弱化版 messages 结构
3. 单独设计图片编辑器节点，而不是继续把它混在图片节点里
4. 做一轮真实多人协作联调，确认 inline 编辑不会影响 realtime 同步
