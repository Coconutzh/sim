# 阶段1：Hermes codex-ppt-skill 接入验证

## 目标

先把 PPT 生成的职责明确放在 Hermes Agent 侧：Hermes 作为 SIM 的主控 Agent 识别 PPT 需求，加载 `codex-ppt` skill 完成图片式 PPT 生成；SIM 暂不重写 PPT 生成流程，只负责后续接收最终 artifact、存入 workspace、写回画布 PPT 节点。

## 当前证据

- `E:\project\codex-ppt-skill\README.md` 明确说明该 skill 支持 Hermes Agent，并建议非 Codex 环境通过 OpenAI 兼容 API/CLI fallback 配置 `gpt-image-2` 或兼容生图模型。
- `E:\project\codex-ppt-skill\skills\codex-ppt\SKILL.md` 定义了完整阶段化流程：大纲确认、风格确认、生图后端确认、样张确认、逐页生图、生成 `speech.md`、组装 `.pptx`。
- `E:\project\codex-ppt-skill\skills\codex-ppt\scripts\assemble_ppt.py` 支持将 `origin_image/slide_XX.png` 组装成最终 `.pptx`。
- `E:\project\codex-ppt-skill\skills\codex-ppt\scripts\image_gen.py` 支持 `generate`、`generate-batch`、`edit`，可以作为 Hermes 环境下的 CLI/API fallback 生图入口。
- `E:\project\hermes-agent\agent\prompt_builder.py` 会扫描 `SKILL.md`，构建 Hermes skills prompt，并支持 external skill directories；因此 `codex-ppt` 可以作为 Hermes skill 被加载。
- SIM 侧已存在 Hermes 受控工具桥：`apps/sim/app/api/internal/hermes/canvas-agent/run/route.ts`、`apps/sim/app/api/internal/hermes/canvas-task/run/route.ts`、`apps/sim/app/api/internal/hermes/canvas-media/export/route.ts`。

## 阶段边界

本阶段不把 `codex-ppt-skill` 复制进 SIM，也不让 SIM 直接执行 Python 脚本。阶段1只确认集成方向：

```text
SIM 用户请求
  -> Hermes Agent 识别 PPT 任务
  -> Hermes 加载 codex-ppt skill
  -> Hermes 在自身运行目录生成 PPT 项目
  -> 后续阶段通过 SIM internal API 回传 PPTX artifact
```

## 对后续阶段的要求

1. Hermes 不能只返回本地路径给用户，必须通过受控工具把 `.pptx`、封面图、manifest 回传 SIM。
2. SIM 不能把每页中间图片平铺成画布节点；画布只展示一个最终 PPT artifact 节点。
3. 生成风格默认由 Hermes 根据用户需求和 `codex-ppt` 风格库自动判断，用户明确指定风格时再覆盖。
4. 所有回传文件必须进入 SIM workspace storage，并遵守 workspace/user 权限和 Hermes service token 鉴权。
5. 后续每个阶段都要提交以阶段名称开头的文档，方便审计阶段目标、证据和未完成项。

## 验收结论

阶段1完成标准是：明确采用“`Hermes + codex-ppt-skill` 负责生成，SIM 负责 artifact 接收和画布展示”的最小改动路线。当前代码和本地仓库证据支持该方向，可以进入阶段2：实现 Hermes PPT artifact 回传接口。
