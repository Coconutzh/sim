# 阶段5-Agent对话生成PPT

## 目标

把 PPT 生成能力接入 Hermes Agent 对话路径，让用户既可以在 PPT 节点里点击生成，也可以直接在对话中说“参考这些节点生成 PPT”。Hermes 仍然是主控：负责理解意图、选择 `codex-ppt-skill` 风格、调用生成流程和上传工具；SIM 负责画布节点、引用关系、权限校验、最终 artifact 展示。

## 本阶段实现

- 更新 Hermes SIM 系统提示：`apps/sim/lib/hermes/sim-agent.ts`
  - 将 PPT、presentation、deck、slides、答辩/汇报类请求明确路由到 `presentation` 内容节点工作流。
  - 指导 Hermes 使用 `sim_canvas_task_propose` / preview 工具创建或更新 PPT 节点。
  - 指导 Hermes 写入 `presentationPrompt`、`presentationSlideCount`、`contentReferences`。
  - 明确风格由 Hermes 根据用户需求和 `codex-ppt` 支持风格自动判断，不要求前端传固定 `stylePreset`。
  - 明确真实 PPTX 生成使用 `codex-ppt-skill`，产物回传使用 `sim_presentation_artifact_upload`。
  - 明确批量页图只作为 Hermes/codex-ppt 内部中间产物，SIM 画布只接收最终 PPTX、可选封面图和 manifest。

- 扩展 Hermes Canvas Task Gateway：`apps/sim/lib/api/contracts/internal/hermes-canvas-task.ts`、`apps/sim/lib/hermes/canvas-task-gateway.ts`
  - 允许 Hermes 的业务级 canvas task 创建和更新 `kind: 'presentation'` 节点。
  - 允许任务内容携带 `presentationPrompt` 和 `presentationSlideCount`。
  - 编译 PPT 节点创建/更新时，把提示词、页数、artifact、file、contentReferences 写入合法 patch 字段。
  - schema/capability 查询可以识别 `presentation` 节点，并暴露 PPT 节点字段。
  - 不把 `presentation` 加入普通 `output_generate` 输出类型，避免误走图片/视频/音频/文本的本地生成链路；真实 PPTX 仍走 Hermes `codex-ppt-skill + sim_presentation_artifact_upload`。

- 更新 Hermes-SIM 插件 schema：`E:\project\hermes-agent-sim\plugins\sim\tools.py`
  - `sim_canvas_task_propose` 的 node kind / kindHint 枚举支持 `presentation`。
  - 工具描述明确 PPT 节点使用 `content.presentationPrompt`、`content.presentationSlideCount`，最终 PPTX artifact 由 `sim_presentation_artifact_upload` 上传。

## 对话路径

```text
用户对 Hermes 说：参考这些节点生成一个 10 页科研答辩 PPT
  -> Hermes 调用 sim_canvas_query 读取当前画布/选中节点
  -> Hermes 调用 sim_canvas_task_propose 创建或更新 presentation 节点并挂引用
  -> 用户确认后 Hermes 调用 sim_canvas_apply_pending 写入 PPT 节点
  -> Hermes 使用 codex-ppt-skill 生成 PPTX，并自行判断最合适风格
  -> Hermes 调用 sim_presentation_artifact_upload 上传最终 PPTX/封面/manifest
  -> Hermes 再通过 SIM canvas task 更新目标 PPT 节点 artifact 字段
  -> 用户在画布看到最终 PPT 产物预览和下载入口
```

节点内按钮路径则继续使用阶段4的同步闭环：SIM 路由读取目标 PPT 节点和引用上下文后调用 Hermes，并在服务端直接回写当前节点。

## 设计边界

1. Agent 对话路径不让前端直接调用 `codex-ppt-skill`。
2. Hermes 不需要也不应该要求固定 `stylePreset`；用户明确指定风格时才作为偏好。
3. 批量生成的每页图片不进入画布节点列表，只作为 PPT 组装中间产物。
4. `presentation` 不走通用 `output_generate`，避免和已有 text/image/video/audio 生成链路混淆。
5. 所有画布写入仍经过 SIM canvas task 的 proposal/confirmation 或 preview 机制。

## 验收标准

- Hermes 系统提示包含 PPT 节点、`codex-ppt`、`sim_presentation_artifact_upload` 和自动风格判断规则。
- Hermes canvas task contract 接受 `kind: 'presentation'` 的创建/更新任务。
- Canvas Task Gateway 能把 PPT 节点任务编译成 create/update/reference patch。
- Hermes-SIM 插件 schema 对外暴露 `presentation` node kind。
- 用户对话方式和节点按钮方式共用同一个最终 artifact 数据结构：`presentationArtifact` + `file=pptxFile`。
