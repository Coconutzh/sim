# TapNow 节点类型与 Sim Block 映射

本文档用于回答一个核心问题：

TapNow 里最重要的画布心智是“先选内容节点类型”，例如：

- 文本
- 图片
- 视频
- 文档
- 表格
- 图片编辑器

而 `sim` 当前并不是这套模型。`sim` 当前暴露给用户的是：

- `blocks`
- `tools`
- `triggers`

用户新增节点时，本质上是在“添加 workflow block”，而不是在“选择内容节点类型”。

因此，如果后续要把 `sim` 改造成更接近 TapNow 的产品，第一步不是直接改执行引擎，而是先在现有 block 体系之上抽一层“内容节点类型层”。

## 一、结论先说

对 TapNow 的这 6 类核心节点，`sim` 当前的支持情况如下：

| TapNow 节点类型 | Sim 现状 | 是否有直接一级 block | 当前最接近的 block / tool | 结论 |
|---|---|---:|---|---|
| 文本 | 只有近似替代 | 否 | `agent` / `note` / `response` | 需要新抽象 |
| 图片 | 有图像生成与图像理解能力 | 否 | `image_generator` / `vision` | 需要重新包装 |
| 视频 | 有视频生成能力 | 否 | `video_generator` | 可以包装成内容节点 |
| 文档 | 有文件与知识库能力 | 否 | `file` / `knowledge` | 需要重新包装 |
| 表格 | 有 | 是 | `table` | 可直接保留 |
| 图片编辑器 | 当前没有直接对标能力 | 否 | 无直接等价物 | 需要新增或重构 |

也就是说：

- `sim` 当前**只有 `table` 比较接近 TapNow 的一级内容节点**
- 其他几类大多只是“能力存在”，但组织方式不对
- 画布层还没有一套“内容优先”的节点模型

## 二、逐项映射

### 1. 文本节点

TapNow 的文本节点本质上是一个“内容创作起点”，用户心智通常是：

- 写脚本
- 写文案
- 写提示词
- 作为图片/视频生成的输入文本

而 `sim` 当前没有一个直接等价的一级文本节点。

最接近的几个 block：

- [agent.ts](D:/projects/sim/apps/sim/blocks/blocks/agent.ts:1)
  - `type: 'agent'`
  - `name: 'Agent'`
  - 强项是 LLM 调用、消息输入、工具调用、结构化输出
  - 本质是“智能体/编排块”，不是轻量文本创作节点

- [note.ts](D:/projects/sim/apps/sim/blocks/blocks/note.ts:1)
  - `type: 'note'`
  - `name: 'Note'`
  - 强项是注释、说明、Markdown 备注
  - 更像画布便签，不是可执行文本创作节点

- [response.ts](D:/projects/sim/apps/sim/blocks/blocks/response.ts:1)
  - `type: 'response'`
  - `name: 'Response'`
  - 面向 API 输出，不适合承担 TapNow 文本节点角色

结论：

- `sim` 没有真正的一级“文本节点”
- 后续若做 TapNow 化，建议新增一个“文本节点”产品层
- 底层可优先复用 `agent`，但 UI 和交互不应直接暴露成 Agent 配置器

建议映射：

- TapNow 文本节点 -> `agent` 的简化 preset
- 辅助备注 -> `note`

## 2. 图片节点

TapNow 的图片节点心智通常是：

- 输入 prompt 生成图片
- 接收来自其他节点的参考图
- 再继续做增强、扩图、抠图、融图

`sim` 当前有图片相关能力，但不是一个统一的一级图片节点。

最接近的 block：

- [image_generator.ts](D:/projects/sim/apps/sim/blocks/blocks/image_generator.ts:1)
  - `type: 'image_generator'`
  - `name: 'Image Generator'`
  - 支持模型、prompt、尺寸、质量、风格等
  - 这是当前最接近 TapNow 图片节点的能力入口

- [vision.ts](D:/projects/sim/apps/sim/blocks/blocks/vision.ts:1)
  - `type: 'vision'`
  - `name: 'Vision'`
  - 用于分析图片、OCR、视觉理解
  - 更像图片理解节点，不是图片创作节点

结论：

- `sim` 有“图像生成”和“图像理解”
- 但没有 TapNow 式统一“图片节点”
- 更没有把图片后处理工具做成节点上方的创作工具条

建议映射：

- TapNow 图片节点 -> `image_generator`
- TapNow 图片分析/识别 -> `vision`

但产品层需要重新包装成一个统一的“图片节点”，而不是让用户先理解生成器和视觉模型的差异。

## 3. 视频节点

TapNow 的视频节点心智通常是：

- 文本生视频
- 图生视频
- 视频作为创作产物继续流转

`sim` 当前已有接近能力：

- [video_generator.ts](D:/projects/sim/apps/sim/blocks/blocks/video_generator.ts:1)
  - `type: 'video_generator'`
  - `name: 'Video Generator'`
  - 支持多 provider、多模型、时长、比例、分辨率等

结论：

- 这类能力在 `sim` 里是存在的
- 但当前还是“复杂工具块”，不是 TapNow 式“内容视频节点”

建议映射：

- TapNow 视频节点 -> `video_generator`

这类是最容易包装成 TapNow 节点的，因为底层生成能力已经有了。

## 4. 文档节点

TapNow 的文档节点通常表示：

- 上传文档
- 查看/解析文档
- 文档作为后续创作或 AI 理解的输入

`sim` 当前没有一个统一的一级文档节点，但有两组近似能力：

- [file.ts](D:/projects/sim/apps/sim/blocks/blocks/file.ts:1)
  - `type: 'file'`
  - `name: 'File'`
  - 支持文件上传、URL 输入、解析多个文件
  - 更接近“文档导入/解析节点”

- [knowledge.ts](D:/projects/sim/apps/sim/blocks/blocks/knowledge.ts:1)
  - `type: 'knowledge'`
  - `name: 'Knowledge'`
  - 强项是知识库搜索、文档 CRUD、分块、标签、连接器
  - 更接近“知识检索节点”，不是轻量文档节点

结论：

- `file` 适合做 TapNow 文档节点的第一版底层承载
- `knowledge` 更适合做文档增强/知识库查询，而不是直接暴露给新手当“文档节点”

建议映射：

- TapNow 文档节点 -> `file`
- 高级文档检索/知识增强 -> `knowledge`

## 5. 表格节点

TapNow 的表格节点通常是：

- 用结构化方式查看、编辑、批量处理数据

`sim` 里这类能力相对明确：

- [table.ts](D:/projects/sim/apps/sim/blocks/blocks/table.ts:1)
  - `type: 'table'`
  - `name: 'Table'`

这是当前最接近 TapNow 一级内容节点的 block。

结论：

- `table` 可以直接作为 TapNow 表格节点的底层承载
- 这一类不需要重新发明概念，只需要做 UI 和入口收敛

建议映射：

- TapNow 表格节点 -> `table`

## 6. 图片编辑器节点

TapNow 的图片编辑器节点是非常重要的差异化节点，通常承载：

- 图层编辑
- 局部修改
- 蒙版
- 裁剪
- 贴纸/文字
- 对单图、多图做进一步创作

而 `sim` 当前没有一个直接对应的一级 block。

现状判断：

- 有图片生成能力：`image_generator`
- 有图片分析能力：`vision`
- 但没有一个“进入图片编辑器”的节点或独立画布编辑 block
- 也没有 TapNow 那种围绕节点本身的图片工具条心智

结论：

- 图片编辑器节点是当前 `sim -> TapNow` 改造中的明显缺口
- 这类不能只靠文案重命名解决

建议方向：

- 新增一个真正的“图片编辑器节点”
- 或者先做一个“图片节点 + 工具条 + 编辑侧板”的过渡方案

## 三、为什么 Sim 现在不等于 TapNow

不是因为 `sim` 没能力，而是因为它的组织方式不同。

`sim` 当前的结构更像：

- 编排块
- 工具块
- 触发器
- 执行链
- 调试/日志/权限/容器/协作

而 TapNow 的结构更像：

- 内容节点
- 创作节点
- 素材节点
- 画布内直接操作

所以真正要改的不是“有没有图片能力”，而是“用户第一眼看到的节点体系是什么”。

## 四、建议的产品层重构方式

建议不要直接把 `sim` 现有 `block registry` 暴露给 TapNow 化后的用户。

应该在上面增加一层“内容节点类型层”：

| 新的内容节点层 | 底层复用的 Sim 能力 |
|---|---|
| 文本节点 | `agent` / `note` |
| 图片节点 | `image_generator` / `vision` |
| 视频节点 | `video_generator` |
| 文档节点 | `file` / `knowledge` |
| 表格节点 | `table` |
| 图片编辑器节点 | 新增能力或重组图片相关能力 |

这样做的好处是：

- 保留 `sim` 现有执行引擎和 block/tool 基础设施
- 对用户暴露更接近 TapNow 的心智模型
- 后续还能逐步把高级编排能力藏到“高级模式”里，而不是一开始全部暴露

## 五、对后续开发的直接建议

如果下一步要改画布基础块操作，建议优先顺序如下：

1. 先定义新的一级节点类型层  
   不是直接让用户看 `agent / response / loop / webhook / condition`

2. 先做 4 个最核心节点  
   建议优先：
   - 文本
   - 图片
   - 视频
   - 文档

3. 表格节点直接沿用 `table`

4. 图片编辑器节点单独列为缺口能力  
   不要假装它已经在 `sim` 里存在

5. 让“新增节点”入口从 `Add Block` 改成“选择内容节点类型”

## 六、最终判断

如果从“能力是否存在”看，`sim` 并不是完全没有 TapNow 需要的东西。  
如果从“用户看到的一级节点模型”看，`sim` 现在和 TapNow 差异仍然非常大。

最大的差异不是模型供应商、不是工作流执行，而是：

- TapNow 暴露给用户的是内容节点
- `sim` 暴露给用户的是编排块和工具块

因此，后续改造画布时，最值得优先投入的不是继续删一些长尾工具，而是先把“节点类型层”重新定义出来。
