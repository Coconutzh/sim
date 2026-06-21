# 阶段2：Hermes PPT 产物回传接口

## 目标

让 Hermes 在完成 `codex-ppt-skill` 生成后，不再把本地路径直接返回给用户，而是通过受控工具把最终 `.pptx`、封面图和 manifest 回传 SIM。SIM 负责校验 Hermes service token、校验用户对 workspace 的写权限、上传到 workspace storage，并返回安全的 `UserFile` 元数据。

## SIM 侧实现

新增文件：

- `apps/sim/lib/api/contracts/internal/hermes-presentation-artifacts.ts`
- `apps/sim/lib/hermes/presentation-artifacts.ts`
- `apps/sim/app/api/internal/hermes/presentation-artifacts/upload/route.ts`
- `apps/sim/app/api/internal/hermes/presentation-artifacts/upload/route.test.ts`

新增 internal API：

```text
POST /api/internal/hermes/presentation-artifacts/upload
```

请求包含：

- `userId`、`workspaceId`、可选 `workflowId`、`chatId`、`targetNodeId`
- `title`、`slideCount`、`selectedStyle`、`styleBrief`
- `pptx.base64`
- 可选 `coverImage.base64`
- 可选 `outlineMarkdown`、`speechMarkdown`

响应返回：

- `pptxFile`
- `coverImageFile`
- `manifestFile`
- `manifest`
- `auditId`

## Hermes 插件侧实现

在 `E:\project\hermes-agent-sim\plugins\sim` 新增工具：

```text
sim_presentation_artifact_upload
```

该工具读取 Hermes 本地生成目录里的：

- `.pptx`
- 可选封面图
- 可选 `outline.md`
- 可选 `speech.md`

然后将文件转成 base64，通过 SIM internal API 上传。工具要求所有文件都在 `projectDir` 内，避免模型将任意本地路径作为 artifact 读取。

## 安全边界

1. SIM 只接受 `HERMES_SERVICE_TOKEN` 认证的 internal 请求。
2. SIM 在上传前调用 workspace membership 检查，要求当前用户有写权限。
3. Hermes 插件只读取 `projectDir` 内文件。
4. SIM 只返回 workspace `UserFile` 元数据，不把 Hermes 本地路径暴露给前端。
5. 上传操作写入 `hermes_tool_call_audit`，工具名为 `sim_presentation_artifact_upload`。

## 验证

已运行：

```text
bunx vitest run "app/api/internal/hermes/presentation-artifacts/upload/route.test.ts"
python -m py_compile E:\project\hermes-agent-sim\plugins\sim\tools.py E:\project\hermes-agent-sim\plugins\sim\__init__.py
```

结果：

- SIM route test：4 个测试通过。
- Hermes-SIM 插件 Python 语法检查通过。

## 下一阶段

阶段3需要新增 SIM 画布 PPT 节点，使阶段2上传的 `pptxFile`、封面图和 manifest 能写回到一个最终 PPT artifact 节点，而不是只停留在 workspace files。
