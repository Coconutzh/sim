# TapNow 化节点内编辑与右侧 Subblocks 分层方案

本文档用于回答一个具体实现问题：

在把 `sim` 的画布改成更接近 TapNow 的过程中，哪些字段应该直接放到节点卡片内部操作，哪些字段应该继续保留在右侧固定的 `subblocks` / panel 里。

本文档的核心原则是：

- 节点内：高频、直觉、内容型操作
- 右侧 `subblocks`：高级、工程化、执行型配置

也就是说，目标不是删除 `subblocks`，而是重新定义它们的角色：

- 以前：主编辑入口
- 以后：高级配置入口

## 一、总原则

### 1. 节点内优先放什么

节点内应该优先承载用户最常做、最像 TapNow 的操作：

- 直接写内容
- 直接上传素材
- 直接替换素材
- 直接预览结果
- 直接发起最常见的生成动作

用户不应该为了写一句话、传一张图、上传一个文档，就先点右侧复杂配置面板。

### 2. 右侧 `subblocks` 保留什么

右侧面板适合保留：

- 模型选择
- provider 选择
- 高级参数
- 响应格式
- 变量映射
- tool 配置
- 批处理/过滤/排序
- 不常改但非常重要的执行参数

### 3. 第一阶段目标

第一阶段不要重写底层 block 系统，而是：

- 节点内新增轻量输入/上传 UI
- 这些节点内操作仍然写回现有 block 的 `subblocks` / stores
- 右侧 `subblocks` 继续保留，只是降级为高级入口

## 二、逐类节点分层方案

## 1. 文本节点

### 建议底层承载

优先复用：

- [agent.ts](D:/projects/sim/apps/sim/blocks/blocks/agent.ts:1)

次要辅助：

- [note.ts](D:/projects/sim/apps/sim/blocks/blocks/note.ts:1)

### 节点内应显示

- 节点标题
- 文本正文输入区
- 文本预览摘要
- 快捷动作按钮
  - 继续生成
  - 清空
  - 展开编辑

### 节点内建议映射到的字段

主要映射：

- `messages`

即把文本节点的主内容输入，优先写进 `agent` 的：

- `id: 'messages'`

如果做得更贴近 TapNow，可以只暴露一个简化文本输入区，再在内部自动组装成 `messages` 结构。

### 右侧 `subblocks` 保留

建议继续保留这些字段在右侧：

- `model`
- `reasoningEffort`
- `verbosity`
- `thinkingLevel`
- `tools`
- `temperature`
- `responseFormat`

其中：

- `messages` 也仍然应在右侧保留完整编辑能力
- 节点内只是它的高频轻量版本

### 设计判断

文本节点的第一优先不是“把 Agent 全部暴露出来”，而是让用户先把内容写进去。  
所以节点卡片应该先像内容卡片，再像 Agent 配置器。

## 2. 图片节点

### 建议底层承载

主要复用：

- [image_generator.ts](D:/projects/sim/apps/sim/blocks/blocks/image_generator.ts:1)

可选辅助理解能力：

- [vision.ts](D:/projects/sim/apps/sim/blocks/blocks/vision.ts:1)

### 节点内应显示

- 图片预览区域
- 上传图片入口
- prompt 输入框
- 快捷动作按钮
  - 生成
  - 重新生成
  - 替换图片
  - 删除图片

### 节点内建议映射到的字段

图片生成主路径先映射：

- `prompt`

如果第一版只做“生成图节点”，节点内就先只暴露：

- prompt 输入
- 结果图预览

如果你还要支持“上传参考图”，可以新增一个产品层文件槽位，后续再映射到：

- `vision.imageFile`
- 或未来专门的图片输入字段

### 右侧 `subblocks` 保留

图片生成节点右侧建议保留：

- `model`
- `size`
- `quality`
- `style`
- `background`
- `outputFormat`
- `moderation`
- `apiKey`

这些都是高价值但不适合占据节点卡片主空间的参数。

### 设计判断

图片节点的关键不是把 OpenAI 图像参数全部搬到节点里，而是：

- 节点内能直接写 prompt
- 节点内能直接看到图
- 节点内能直接再次生成

## 3. 视频节点

### 建议底层承载

复用：

- [video_generator.ts](D:/projects/sim/apps/sim/blocks/blocks/video_generator.ts:1)

### 节点内应显示

- 视频封面 / 占位预览
- prompt 输入框
- 素材上传入口
  - 第一版可先支持上传图片作为输入素材
  - 视频上传可放第二阶段
- 快捷动作按钮
  - 生成
  - 重新生成
  - 替换素材

### 节点内建议映射到的字段

第一版主映射：

- `prompt`

后续如果做素材驱动视频：

- 需要增加对现有文件输入的产品层包装

### 右侧 `subblocks` 保留

视频节点右侧建议保留：

- `provider`
- `model`
- `endpoint`
- `duration`
- `aspectRatio`
- 分辨率/音频/镜头/高级控制等 provider 特有项

### 设计判断

视频节点不应该一上来就让用户看到一大堆 provider 条件字段。  
第一眼应该是：

- 我想做一个什么视频
- 我有没有素材

至于具体模型和时长细节，再放右侧。

## 4. 文档节点

### 建议底层承载

优先复用：

- [file.ts](D:/projects/sim/apps/sim/blocks/blocks/file.ts:1)

高级文档检索可延伸到：

- [knowledge.ts](D:/projects/sim/apps/sim/blocks/blocks/knowledge.ts:1)

### 节点内应显示

- 文件上传区域
- 文件名
- 文件类型
- 文件大小
- 上传/处理状态
- 快捷动作按钮
  - 替换文件
  - 删除文件
  - 预览文件

### 节点内建议映射到的字段

文档节点应优先映射：

- `file`

如果需要 URL 输入作为高级模式，再映射：

- `filePath`

### 右侧 `subblocks` 保留

文档节点右侧建议保留：

- `inputMethod`
- `filePath`
- `file`
- `fileType`

如果后续与知识库结合，再保留知识相关字段在右侧，而不要先塞到节点卡片里。

### 设计判断

文档节点最重要的是“上传即见、文件即见”。  
不要让用户先理解 URL 模式、解析器模式、知识库模式。

## 5. 表格节点

### 建议底层承载

直接复用：

- [table.ts](D:/projects/sim/apps/sim/blocks/blocks/table.ts:1)

### 节点内应显示

- 表名
- 表格摘要
  - 行数
  - 列数
  - 关键字段
- 快捷动作按钮
  - 打开表
  - 新增一行
  - 查看数据

### 节点内建议映射到的字段

用于轻量显示的核心字段：

- `tableSelector` / `manualTableId`
- `operation`

节点内不建议直接暴露复杂 JSON builder，而是显示：

- 当前绑定了哪个表
- 当前操作是什么

### 右侧 `subblocks` 保留

表格节点右侧建议保留：

- `operation`
- `tableSelector`
- `manualTableId`
- `rowId`
- `data`
- `rows`
- `bulkFilterMode`
- `bulkFilterBuilder`
- `filter`
- `sort`
- `limit`
- `offset`

### 设计判断

表格节点天然比较工程化，所以节点内不需要做太重编辑。  
它更适合：

- 节点内看摘要
- 右侧做数据操作配置

## 6. 图片编辑器节点

### 当前状态

`sim` 里当前没有一个可以直接对标 TapNow 图片编辑器的一级 block。

所以这类节点不建议第一阶段强上。

### 第一阶段过渡方案

先把“图片节点”做强：

- 节点内图片预览
- 节点内上传/替换
- 节点内生成/重生成
- 节点内预留“编辑”入口按钮

这个“编辑”入口第一阶段可以只是：

- 打开右侧高级图片设置
- 或打开未来的图片编辑弹层/侧板

### 右侧 `subblocks` 建议

如果第一阶段没有真正的图片编辑器 block，就不要伪造一套节点内复杂编辑字段。  
先把编辑相关高级操作保留在侧板或未来专门的编辑器里。

## 三、推荐的字段分层总表

| 节点类型 | 节点内优先展示 | 右侧 `subblocks` 保留 |
|---|---|---|
| 文本 | 标题、正文、摘要、继续生成 | `messages`、`model`、`temperature`、`tools`、`responseFormat`、推理相关参数 |
| 图片 | 预览、上传、prompt、生成/替换 | `model`、`size`、`quality`、`style`、`background`、`outputFormat` |
| 视频 | 封面、prompt、素材上传、生成/替换 | `provider`、`model`、`duration`、`aspectRatio`、高级 provider 参数 |
| 文档 | 上传、文件名、状态、替换/删除 | `inputMethod`、`filePath`、`file`、`fileType` |
| 表格 | 表名、摘要、快速打开 | `operation`、`tableId`、`data`、`filter`、`sort`、`limit` 等 |
| 图片编辑器 | 预览、编辑入口 | 第一阶段先不独立实现，后续再补 |

## 四、推荐实施顺序

建议按这个顺序落地：

1. 文本节点
2. 图片节点
3. 文档节点
4. 视频节点
5. 表格节点
6. 图片编辑器节点

原因：

- 文本、图片、文档三类最能马上体现 TapNow 化价值
- 视频稍复杂，但底层已有能力
- 表格不是最像 TapNow 的高频创作节点，但复用成本低
- 图片编辑器当前缺口最大，应最后独立处理

## 五、最终判断

这套方案的本质不是取消 `subblocks`，而是把 `subblocks` 从“唯一编辑入口”降级为“高级配置入口”。

真正的产品变化应该是：

- 节点卡片先让用户直接创作和上传
- 右侧面板继续承担深度配置

这样做的好处是：

- 用户第一感受更像 TapNow
- 不会破坏 `sim` 现有 block / store / realtime / execution 架构
- 可以在低风险下逐步推进画布改造
