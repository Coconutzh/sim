# 阶段4-PPT节点触发Hermes生成闭环

## 目标

让画布中的 PPT 节点从“最终产物承载节点”升级为“可触发生成并自动回写最终 PPT”的闭环节点。用户在节点内填写提示词并点击生成后，SIM 负责鉴权、读取节点上下文和引用节点，Hermes Agent 负责调用 `codex-ppt-skill` 生成真实 PPTX，并通过既有上传工具把最终产物回传给 SIM。

## 本阶段实现

- 新增用户侧生成接口：`POST /api/content-canvas/presentations/generate`
  - 使用 `apps/sim/lib/api/contracts/content-canvas.ts` 中的 contract。
  - 先进行用户鉴权和 workflow 写权限校验，再解析和执行生成请求。
  - 校验 workflow 属于请求中的 workspace，且跨团队发布访问不能触发写入。
  - 调用前检查 workflow 是否可编辑，避免锁定画布被异步写入。
- 新增服务端生成编排：`apps/sim/lib/presentation/presentation-generation.ts`
  - 加载目标 PPT 节点和其 `contentReferences`。
  - 读取文字节点正文、图片/视频/音频/PPT 文件元数据，组成 Hermes 可读的上下文。
  - 将节点状态先写为 `presentationStatus = pending`，并清空旧 artifact/file。
  - 调用 Hermes Responses API，并要求 Hermes 使用 `codex-ppt-skill` 生成 PPTX。
  - 要求 Hermes 调用 `sim_presentation_artifact_upload` 上传最终 PPTX、可选封面图和 manifest。
  - 从 Hermes function call output 中提取上传结果。
  - 成功后回写：
    - `presentationStatus = complete`
    - `presentationArtifact = { pptxFile, coverImageFile, manifestFile, manifest, auditId, traceId }`
    - `file = pptxFile`
  - 失败后回写：
    - `presentationStatus = error`
    - `presentationError = message`
- 新增前端 React Query mutation：`useGenerateContentCanvasPresentation`
  - 通过 `requestJson(generateContentCanvasPresentationContract, ...)` 调用同源 JSON 接口。
  - 生成成功后同步更新当前节点的本地 subBlock 值，用户无需等待刷新即可看到最终 PPT。
- 更新 PPT 节点 UI：
  - 节点内新增“生成 PPT / 重新生成 PPT”按钮。
  - 生成中禁用提示词输入和按钮。
  - 成功后展示封面、页数、Hermes 自动选择的风格和 PPTX 下载入口。
  - 仍然只展示最终 PPT 产物，不把批量页图铺到画布。
- 更新 Hermes 健康检查必需工具：
  - `sim_presentation_artifact_upload` 加入 SIM toolset 必需工具列表，避免部署时遗漏上传回传能力。

## Hermes 对接策略

本阶段没有让前端直接接触 `codex-ppt-skill`，也没有把批量生图结果暴露给画布。SIM 只向 Hermes 提交结构化任务上下文：

- 用户提示词
- 目标页数
- 目标 PPT 节点 ID
- workspace/workflow/user 上下文
- 引用节点摘要和文件元数据

Hermes 的职责是：

1. 根据用户需求和引用内容判断 PPT 风格。
2. 选择最接近的 `codex-ppt-skill` 支持风格。
3. 生成真实 PPTX。
4. 调用 `sim_presentation_artifact_upload` 上传最终产物。
5. 返回简短结果说明。

SIM 的职责是：

1. 管理画布节点状态。
2. 提供上传和存储通道。
3. 从 Hermes 工具输出中提取最终 artifact。
4. 回写目标 PPT 节点。
5. 通知协作画布刷新。

## 验收标准

- 用户可以在 PPT 节点中输入提示词并点击生成。
- 生成请求必须经过当前用户的 workflow 写权限校验。
- 生成中节点进入 `pending` 状态。
- Hermes 上传成功后，目标节点进入 `complete` 状态并展示最终 PPT artifact。
- Hermes 或上传失败后，目标节点进入 `error` 状态并展示错误。
- 画布不展示中间批量页图，只展示最终 PPTX 和可选封面图。
- API contract、路由、React Query hook 和 UI 使用同一套边界类型。

## 后续阶段

阶段5将把同一套能力接入 Agent 对话：用户可以直接对 Hermes 说“参考这些节点生成 PPT”，Hermes 自动创建或更新 PPT 节点、关联引用节点，并触发同样的生成/上传/回写闭环。
