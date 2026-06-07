# 本地画布 Agent 第一阶段实现审计

审计日期：2026-06-07

审计范围：

- `docs/local-canvas-agent-phase-1-retest-notes-zh.md`
- `docs/local-canvas-agent-phase-1-manual-test-checklist-zh.md`
- `docs/local-canvas-agent-runtime-design-zh.md`
- `apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/**`
- `apps/sim/lib/copilot/request/lifecycle/content-canvas-agent.ts`
- `apps/sim/lib/copilot/request/lifecycle/run.ts`
- `apps/sim/lib/copilot/chat/**`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/**` 中 Copilot/画布相关 UI
- local canvas agent、content canvas agent、lifecycle 相关测试

说明：`local-canvas-agent-phase-1-retest-notes-zh.md` 是第一轮手工测试后的复测说明，不是完整方案。完整方案对照主要参考 `local-canvas-agent-runtime-design-zh.md`，手工清单用于验收点和测试集泄露审计。

## 一、结论摘要

当前右侧 Copilot 已经实际接入新的 `Local Canvas Agent Runtime`：UI 仍发送 `workflowCopilotMode: 'content_canvas_v1'`，但后端在 `run.ts` 中直接路由到 `runLocalCanvasAgent`，不是旧 `runContentCanvasAgent`。

与 runtime design 的阶段 1-5 基本形态一致：有个人历史隔离、工种 profile、skill 加载、adapter registry、高层 canvas tools、多步 tool loop、manual Confirm/Revise、patch 后 verify。

但它仍是第一阶段可测实现，不是完整方案：routing 永远 true、工具筛选不够动态、token-aware 只是固定字符预算、team/task scope 未实现、生成后 verify 语义偏弱、取消生成不够彻底。

测试集泄露判断：不确定，未发现高危直接特判。

未发现生产代码按 `A-01` 等编号、完整手工输入句子或“春季发布会主视觉”写分支造答案。发现了中危测试污染风险：生产 prompt/清洗逻辑硬编码了复测文档里的 persona 禁用词，如“总导演”“各组注意”“导演这边”。这更像针对真实 persona 泄露问题的 guard，但确实复制了测试预期中的具体禁用文案。

最大的风险：

1. `routing.ts` 永远返回 true，右侧 Copilot 会把所有 content canvas 模式请求都交给本地画布 agent，非画布问题仍可能被拉回画布语境。
2. 生成服务调用未传 `abortSignal`，H-04 “取消长任务”存在继续生成/写回风险。
3. `canvas.verify_patch` 对生成写回没有具体 patch 时只读画布，不验证目标字段；生成函数内部有断言，但 UI 里的 verify tool 语义偏空。
4. 附件上下文会把 `key/url/path` 放进 agent context；节点 file detail 已脱敏为文件名，但附件/file context 仍有泄露风险。
5. manual Confirm/Revise 的 pending plan 只存在进程内 Map，没有 TTL 清理/重启恢复；多实例或服务重启下不可确认。

## 二、方案对照表

| 方案/测试要求 | 当前实现位置 | 当前行为 | 结论 | 证据文件行号 | 影响 |
|---|---|---|---|---|---|
| 右侧 Copilot 走本地 agent runtime | UI + lifecycle | UI 固定发送 `content_canvas_v1`，后端直接调用 `runLocalCanvasAgent` | 符合 | `copilot-tab.tsx:298-300,493-495`; `run.ts:142-149` | 右侧 Copilot 已实际接入新 runtime |
| routing 按复杂度/场景选择新旧 runtime | `routing.ts` | `shouldRunLocalCanvasAgent` 永远 true | 部分符合/不一致 | `routing.ts:3-4`; `runtime-design:257-279` | 非画布请求、简单 fallback、复杂请求没有真实分流 |
| 默认个人历史隔离 | `context-manager.ts`, `memory.ts`, `session.ts` | chat history 按 `chatId + userId + workspaceId + workflowId` 读取；memory key 含 user/workspace/workflow/agent/chat | 符合个人 scope，缺 team/task | `context-manager.ts:87-109`; `memory.ts:11-24`; `session.ts:15-55` | 第一阶段单用户 OK；团队/任务 scope 未实现 |
| 解析 workgroup/discipline/agent profile | `workgroup-profile.ts` | 从 personal canvas/workspace workgroup 找 discipline agent，加载 DB/fallback profile，并加 local canvas guard | 部分符合 | `workgroup-profile.ts:36-89,114-165` | 工种身份有，但 user-facing persona 被强压制 |
| 加载 enabled skills 和 override | `skills.ts` | 读取 agent template skill，并用 team override 覆盖/禁用 | 部分符合 | `skills.ts:16-53,56-84` | 仅 `teamWorkspaceId` 存在时加载；未见 workspace source 实现 |
| token-aware 分层上下文 | `context-manager.ts` | 有 Agent/Profile/Permissions/Skills/Canvas/Selected/Relevant/Attachments/History/Memory/User 分层，但用固定字符预算 | 部分符合 | `context-manager.ts:27-38,382-464` | 比旧版强，但不是真正 token-aware |
| selected nodes 给完整 detail | UI + context + adapters | UI 同步选中 content 节点；请求带 `autoSelectionContexts`；context 读取 selected detail | 符合 content 节点，非 content 不完整 | `workflow.tsx:3244-3266`; `user-input.tsx:769-781`; `context-manager.ts:122-135,387-440`; `copilot-tab.tsx:133-143` | B-01/B-03 通过率提升；document/table/image_editor 选中 UI 路径弱 |
| text/image/video/audio adapter | node adapters | 四类节点有 readable/writable/generate 能力与字段 | 符合 | `node-adapters/index.ts:16-24`; `text.ts:24-90`; `image.ts:20-84`; `video.ts:22-95`; `audio.ts:24-88` | A/B/E/G 基础能力具备 |
| document/table/image_editor 至少可识别 | node adapters | 三类 adapter 存在，但只读 | 部分符合 | `document.ts:10-63`; `table.ts:13-61`; `image-editor.ts:10-61` | H-02 可拒绝写入；方案后续写入/生成未实现 |
| 高层 canvas tools | `tool-registry.ts`, `canvas-tools.ts` | read/search/schema/propose/apply/verify/generate 工具存在 | 符合/部分 | `tool-registry.ts:7-17`; `canvas-tools.ts:405-560` | 工具覆盖第一批；动态工具筛选弱 |
| patch 通过 `editWorkflowServerTool` | `canvas-tools.ts`, `canvas-patch.ts` | 高层 patch 转 `EditWorkflowOperation` 后执行 edit workflow | 符合 | `canvas-tools.ts:512-539`; `canvas-patch.ts:143-224` | 不绕过现有画布工具 |
| 修改后 verify | `canvas-tools.ts`, `canvas-verify.ts` | apply patch 后立即 verify；verify 检查 create/update/connect | 部分符合 | `canvas-tools.ts:533-539`; `canvas-verify.ts:92-129` | layout 不验证位置；生成后的 verify_patch 无 patch 时偏弱 |
| G-01/G-04 生成写回 | `canvas-tools.ts` | text 写 `contentHtml`，image/video/audio 写 `file`，并断言字段写入 | 部分符合 | `canvas-tools.ts:319-402` | 真实服务依赖 env/额度；取消信号未传给生成服务 |
| Manual Confirm/Revise | `runtime.ts`, UI input | manual 模式先发 options；Confirm 执行 pending plan；Revise 放弃 | 部分符合 | `runtime.ts:252-282,157-211`; `user-input.tsx:779` | F-02/F-04 基本具备；pending plan 非持久、无 TTL |
| 破坏性请求不直接执行 | `planner.ts` | “删除/清空 + 全部/画布”等直接 clarification | 符合 | `planner.ts:201-205,573-590` | H-03 通过率较高 |
| 失败不能显示已完成 | `verifier.ts`, `canvas-tools.ts` | 任一 observation 失败则输出“已停止在安全边界内执行...” | 符合/部分 | `verifier.ts:76-81`; `canvas-tools.ts:154-174,405-430` | 错误可见；但失败文案可能暴露底层错误字符串 |

## 三、测试集泄露审计

### 高危：未发现

未发现生产 runtime 中出现 `A-01/A-02/B-01/B-03/E-01/C-01/D-01/F-02/G-01/H-03` 编号。

未发现生产 runtime 中直接匹配完整手工输入句子。完整句子只在 docs 和测试文件出现。

未发现生产代码按“春季发布会主视觉”关键词直接造答案。生产搜索逻辑是通用搜索节点标题、类型、摘要和 values：`canvas-context.ts:115-160`。该关键词只在 docs/tests 中作为测试数据出现。

### 中危：prompt/guard 复制测试预期，可能污染真实行为

1. `models/actor.ts:20-28` 把“总导演”“总导演 Agent”“各组注意”“导演这边”等列入 internal leak pattern。
   - 判断：这是生产代码硬编码复测文档中的禁用 persona 文案；用途是过滤输出，不是按测试输入造答案，但属于测试预期词进入生产 guard。

2. `planner.ts:110-113` 的 `hasPersonaLeak` 同样硬编码“总导演/各组注意/各位团队成员/导演这边”。
   - 判断：用于阻止 rewrite 写入 persona 污染，不是生成测试答案，但仍属于测试预期词进入生产运行时。

3. `workgroup-profile.ts:20-30`、`models/prompts.ts:6-12` 在 system guard 中禁止 director/chief director/team-broadcast。
   - 判断：英文通用 guard 合理；与中文具体禁用词相比泄露风险低。

4. `planner.ts:474-523` 对“完整短视频/内容链/一组/storyboard”确定性创建 text-image-video-audio 链。
   - 判断：覆盖 D-01 方向，但不是完整输入特判，属于通用内容链能力。

5. `planner.ts:573-590` 对破坏性全画布请求进行 clarification。
   - 判断：覆盖 H-03，但属于安全策略，不是测试泄露。

### 低危/合理：只在测试文件或文档中出现

完整手工输入句子、编号、`春季发布会主视觉` 大量出现在 `docs/local-canvas-agent-phase-1-*.md` 和 `local-canvas-agent/*.test.ts`。判断：合理的手工测试文档和单元测试数据。

`planner.test.ts:415,545,659,698,719`、`models/actor.test.ts:107,208,307` 等复用手工用例输入和关键词。判断：测试覆盖合理。

`canvas-tools.ts:62-70` 的 `patch.operations is required` 是通用参数校验错误，虽然出现在手工失败记录中，但不是测试分支。

`planner.ts:531-555` 的 `new_text_after_selection` 是通用 clientNodeId 占位，用于新建“选中节点后面的文本节点”；虽然手工文档记录过这个字符串，但当前实现通过 idMap 解析 clientNodeId，不是按失败用例特判。

## 四、未实现或不一致清单

1. 实现真实 routing / out-of-scope 判断
   - 修改位置：`apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/routing.ts`，并在 `planner.ts` 增加非画布请求的 answer/refuse 分支。
   - 原因：否则 A-03 这种“问高考”仍可能被画布 agent 强行解释画布。

2. 把生成后 verify 做成目标字段级验证
   - 修改位置：`canvas.verify_patch` 或新增 `canvas.verify_generation`。
   - 原因：`generate_node_output` 后应验证具体 `nodeId + field`，不要只跑无 patch 的 `verifyLocalCanvasPatch`。

3. 生成服务传递取消信号
   - 修改位置：`canvas-tools.ts:319-402` 及 text/image/video/audio 生成服务。
   - 原因：避免 H-04 停止后继续生成并写回。

4. 收紧附件/文件上下文脱敏
   - 修改位置：`context-manager.ts:340-352` 和 `context-tools.ts:65-79`。
   - 原因：节点详情已经在 `canvas-tools.ts:92-107` 做了 file name only，附件路径也应同等处理。

5. manual pending plan 持久化/过期清理
   - 修改位置：`runtime.ts:39-47` 附近。
   - 原因：当前使用进程内 Map；`createdAt` 没有 TTL 检查。多实例、重启、长时间后 Confirm 都不可控。

6. 补 team/task scope 和更细权限模型
   - 修改位置：`context-manager.ts`、`memory.ts`、`types.ts`。
   - 原因：当前 `sessionScope` 固定 personal，memory 类型也固定 personal；方案里的 team/task scope 还没落地。

7. 清理旧 `content-canvas-agent.ts` 或改名避免误判
   - 修改位置：`apps/sim/lib/copilot/request/lifecycle/content-canvas-agent.ts`。
   - 原因：旧文件目前只有测试引用，但仍保留大量旧 prompt/few-shot。生产路径已不走它，但后续维护很容易混淆。

## 五、建议的下一步验证

本审计未执行测试。建议最小验证：

```powershell
bunx vitest run `
  apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/runtime.test.ts `
  apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/planner.test.ts `
  apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/tool-loop.test.ts `
  apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/canvas-tools.test.ts `
  apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/canvas-verify.test.ts `
  apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/models/actor.test.ts `
  apps/sim/lib/copilot/request/lifecycle/local-canvas-agent/models/verifier.test.ts
```

再跑较小的入口/UI 验证：

```powershell
bunx vitest run apps/sim/lib/copilot/request/lifecycle/run.test.ts apps/sim/app/workspace/[workspaceId]/home/hooks/use-chat.test.ts
```

PR 前仍建议：

```powershell
bun run check:api-validation
```

如果要验证浏览器手工通过率，优先复测 A-03、F-02/F-03/F-04、G-01/G-04、H-04，因为这些正好覆盖当前最大风险点。
