# Hermes Agent 接入 SIM 部署与运维手册

## 1. 目的与适用范围

本文用于约束 SIM + Hermes 分层多智能体方案的本地开发、测试环境、生产部署和日常运维。它是 `docs/hermes-agent-integration-architecture-plan-zh.md` 的落地补充，重点回答：

- Hermes fork 应如何部署成 SIM 可调用的服务。
- SIM 与 Hermes 之间需要哪些环境变量和密钥。
- 如何确认当前运行的 Hermes 版本、commit、toolset 是否符合预期。
- 如何避免 Hermes 工具权限过大、memory 串号、Skill 未审核发布等生产风险。

## 2. 基本拓扑

```text
SIM Next.js / Realtime / DB
        |
        | HERMES_API_URL + HERMES_API_KEY
        v
Hermes API Server
        |
        | SIM_INTERNAL_API_URL + SIM_SERVICE_TOKEN
        v
SIM internal Hermes APIs
  - /api/internal/hermes/canvas-agent/run
  - /api/internal/hermes/skill-proposals/run
```

强制边界：

- SIM 调 Hermes：只能调用 Hermes API Server，不直接 import Hermes Python 代码。
- Hermes 调 SIM：只能调用 SIM internal API，不直接连 SIM DB。
- 画布写入：只能由 SIM Local Canvas Agent Runtime 完成。
- 团队 / 组织 Skill 生效：只能经过 proposal + admin review + publish + revision。

## 3. 本地开发目录建议

推荐本地目录：

```text
E:\project\sim
E:\project\hermes-agent-sim
```

注意：

- 代码里不得写死上述路径；本地路径只出现在开发文档或个人脚本里。
- 上线目录可以完全不同，只要环境变量指向正确 URL 和密钥即可。
- Hermes fork 使用独立仓库和独立分支，便于与上游 Hermes rebase / merge。
- SIM 仓库不应 vendor Hermes 源码，避免两个项目生命周期耦合。

## 4. 必需环境变量

### 4.1 SIM 侧

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `HERMES_API_URL` | 是 | Hermes API Server base URL，例如 `http://127.0.0.1:8642` |
| `HERMES_API_KEY` | 是 | SIM 调 Hermes 的 Bearer token，应与 Hermes `API_SERVER_KEY` 一致 |
| `HERMES_SERVICE_TOKEN` | 是 | Hermes 调 SIM internal API 的服务令牌，至少 32 位随机字符串 |
| `HERMES_HEALTH_TIMEOUT_MS` | 否 | SIM 探测 Hermes health/capabilities/toolsets 的超时时间，默认 5000ms |
| `HERMES_REQUIRED_TOOLSETS` | 否 | SIM 要求 Hermes API Server 启用的 toolset，默认 `sim`；可设为 `sim,memory,skills` |
| `HERMES_FORBIDDEN_TOOLSETS` | 否 | SIM 生产流量禁止启用的 Hermes toolset；默认 `browser,code_execution,computer_use,cronjob,delegation,file,terminal` |
| `HERMES_HEALTH_NOTIFY_URL` | 否 | 发布阻断脚本的 webhook 告警地址；不配置则只输出本地日志 |
| `HERMES_HEALTH_NOTIFY_ON` | 否 | 发布阻断脚本的告警触发策略：`failure`、`always` 或 `never`，默认 `failure` |
| `INTERNAL_API_SECRET` | 是 | SIM 内部运维接口鉴权，`/api/internal/hermes/health` 使用 `x-api-key` 校验 |

### 4.2 Hermes 侧

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `API_SERVER_ENABLED` | 是 | 开启 Hermes API Server |
| `API_SERVER_KEY` | 是 | Hermes API Server Bearer token，对应 SIM `HERMES_API_KEY` |
| `SIM_INTERNAL_API_URL` | 是 | SIM base URL，例如 `http://127.0.0.1:3000` |
| `SIM_SERVICE_TOKEN` | 是 | Hermes 调 SIM internal API 的服务令牌，对应 SIM `HERMES_SERVICE_TOKEN` |
| `HERMES_HOME` | 是 | Hermes memory / skill / session state 根目录；生产必须按租户或环境隔离 |
| `HERMES_BUILD_COMMIT` | 建议 | 构建时注入当前 Hermes fork commit，便于 health 排障 |

## 5. Hermes config.yaml 必需配置

仅设置环境变量不够。`plugins/sim` 是 Hermes standalone plugin，必须在 Hermes `config.yaml` 显式启用，否则 `/v1/toolsets` 可能看到 `sim` 名称，但实际工具注册表没有 SIM 工具。

生产最小配置建议：

```yaml
plugins:
  enabled:
    - sim

memory:
  provider: sim

platform_toolsets:
  api_server:
    - sim
    - memory
    - skills
    - session_search
```

说明：

- `plugins.enabled: [sim]` 负责加载 SIM 插件，注册 `sim_canvas_agent_run`、`sim_skill_proposal_run` 和 `sim_external_evidence_prepare`。
- `memory.provider: sim` 负责启用 SIM-backed Hermes Memory Provider。Hermes 每轮通过 SIM internal API 召回/写入用户长期偏好，不直接读写 SIM DB。
- `platform_toolsets.api_server` 负责限制 HTTP API Server 可用工具面，避免默认 API Server 暴露过宽。
- SIM health 默认禁止 `browser`、`code_execution`、`computer_use`、`cronjob`、`delegation`、`file`、`terminal` 等高风险 toolset；如需放开，必须显式设置 `HERMES_FORBIDDEN_TOOLSETS` 并同步评审容器隔离、审计和审批策略。
- `memory` / `skills` 用于 Hermes 用户级偏好和 procedural skill；SIM 团队正式规范仍走 Skill Proposal 审核发布链路。
- 如需网页读取能力，先灰度加入 `web`，并要求 Hermes 对 `web_extract` / 文件解析结果调用 `sim_external_evidence_prepare` 生成引用、摘要和 prompt-injection 风险标记；`browser` 属于默认禁用的高风险工具面，必须单独评审后再放开。

SIM-backed memory 的边界：

- 只写入用户长期偏好、沟通风格、内容兴趣、工具习惯、跨项目 workflow habit。
- 不写入当前画布 task state、pendingActionId、tool result ref、画布/网页全文、密钥/token、团队未审核生产规范。
- SIM 侧存储表为 `hermes_user_memory`，按 `userId + organizationId + optional workspaceId` 隔离。
- Hermes 缺少 SIM session metadata 中的 `userId` 或 `organizationId` 时，SIM memory provider 必须空转，不得落到共享 profile。

## 6. Hermes 工具 allowlist 建议

生产环境默认启用最小 toolset：

```text
sim
memory
skills
session_search
web 或 browser 按业务需要二选一/灰度开启
```

默认禁止：

```text
terminal
file
process
shell
任意未审计 MCP server
```

原因：

- `sim` 是 Hermes 访问 SIM 画布和 Skill Proposal 的唯一受控入口。
- `memory` / `skills` 只存用户级偏好和 procedural skill，不直接改 SIM 团队规范。
- 网页 / 浏览器 / 文件工具必须把外部内容当作 evidence，不得当作系统指令；外部内容进入业务推理前应先经过 `sim_external_evidence_prepare`。
- 终端、文件、进程类工具会扩大服务器权限边界，除非容器隔离、审计和审批链路都已就绪。

## 7. 健康检查与版本确认

### 7.1 Hermes 原生 health

Hermes API Server 暴露：

```text
GET /health
GET /health/detailed
GET /v1/health
GET /v1/capabilities
GET /v1/toolsets
```

至少应确认：

- `status = ok`
- `platform = hermes-agent`
- `version` 非空
- `commit` 非空且符合当前部署 commit
- `/v1/capabilities` 可用，说明 `HERMES_API_KEY` / `API_SERVER_KEY` 匹配
- `/v1/toolsets` 中 required toolsets 均为 enabled
- `/v1/toolsets` 或能力探针中 `sim` 启用，且 Hermes 运行日志没有 `sim` plugin 未启用或缺少 `SIM_INTERNAL_API_URL` / `SIM_SERVICE_TOKEN` 的错误

### 7.2 SIM 侧聚合探针

SIM 新增内部探针：

```text
GET /api/internal/hermes/health
Header: x-api-key: <INTERNAL_API_SECRET>
```

该探针会聚合检查：

- SIM 是否配置了 `HERMES_API_URL` 和 `HERMES_API_KEY`
- Hermes `/health` 是否可达
- Hermes `/v1/capabilities` 是否通过 Bearer 鉴权
- `chat_completions` 能力是否存在
- `X-Hermes-Session-Key` 能力是否存在
- `HERMES_REQUIRED_TOOLSETS` 中声明的 toolset 是否已启用
- `sim` toolset 是否实际包含 `sim_canvas_agent_run`、`sim_skill_proposal_run` 和 `sim_external_evidence_prepare`
- `HERMES_FORBIDDEN_TOOLSETS` 中声明的高风险 toolset 是否未启用

返回状态建议：

| HTTP 状态 | 含义 | 处理方式 |
| --- | --- | --- |
| 200 | Hermes 可用且满足 SIM 要求 | 可以放量 |
| 401 | 调 SIM 探针的 `x-api-key` 错误 | 检查运维密钥 |
| 503 | Hermes 未配置、不可达或能力不完整 | 不放量，按 `error` 字段排查 |

### 7.3 发布阻断脚本

SIM 提供可用于 CI/CD 或上线前手动执行的阻断脚本：

```bash
bun run check:hermes-health -- --base-url https://sim.example.com --api-key "$INTERNAL_API_SECRET"
```

也可以直接传完整探针 URL：

```bash
bun run check:hermes-health -- --url https://sim.example.com/api/internal/hermes/health
```

CI/CD 告警示例：

```bash
bun run check:hermes-health -- \
  --base-url https://sim.example.com \
  --api-key "$INTERNAL_API_SECRET" \
  --notify-url "$HERMES_HEALTH_NOTIFY_URL"
```

脚本行为：

- 请求 `GET /api/internal/hermes/health`，自动带 `x-api-key`。
- HTTP 非 200、返回体 `ok !== true`、请求超时或网络错误时退出码为 1。
- 缺少 URL 或 `INTERNAL_API_SECRET` 时退出码为 2。
- 使用 `--json` 可输出结构化 payload，方便 CI 上传诊断日志。
- 配置 `--notify-url` 或 `HERMES_HEALTH_NOTIFY_URL` 后，默认仅在失败时发送 webhook；可用 `--notify-on always|failure|never` 覆盖。

### 7.4 跨服务 smoke test

上线前还应从 SIM 仓库根目录运行跨服务 smoke test，直接验证 Hermes API Server 的 health、capabilities、toolset policy，以及 SIM 聚合 health：

```bash
HERMES_API_URL=http://127.0.0.1:8642 \
HERMES_API_KEY=<same-as-API_SERVER_KEY> \
SIM_BASE_URL=http://127.0.0.1:3000 \
INTERNAL_API_SECRET=<sim-internal-secret> \
bun run hermes:smoke
```

默认 smoke test 是只读的，不会调用画布写入或创建 Skill Proposal。它会失败于：

- Hermes `/health` 非 `ok`。
- `/v1/capabilities` 缺少 `chat_completions` 或 `X-Hermes-Session-Key` 支持。
- `/v1/toolsets` 未启用 `HERMES_REQUIRED_TOOLSETS`。
- `sim` toolset 缺少 `sim_canvas_agent_run`、`sim_skill_proposal_run` 或 `sim_external_evidence_prepare`。
- 启用了 `HERMES_FORBIDDEN_TOOLSETS` 中的高风险 toolset。
- SIM `/api/internal/hermes/health` 返回非健康状态。

需要真实跑 Hermes chat 时加：

```bash
bun run hermes:smoke -- --chat
```

需要验证 Hermes -> SIM 只读画布工具调用时，显式提供上下文后再加 `--canvas-read`：

```bash
HERMES_SMOKE_USER_ID=<user-id> \
HERMES_SMOKE_ORGANIZATION_ID=<org-id> \
HERMES_SMOKE_WORKSPACE_ID=<workspace-id> \
HERMES_SMOKE_WORKFLOW_ID=<workflow-id> \
bun run hermes:smoke -- --canvas-read
```

需要验证 Hermes -> SIM Skill 只读列表时，显式提供组织上下文后加 `--skill-list`。该模式只允许读取 published skills，不创建 proposal：

```bash
HERMES_SMOKE_USER_ID=<user-id> \
HERMES_SMOKE_ORGANIZATION_ID=<org-id> \
bun run hermes:smoke -- --skill-list
```

需要验证 SIM-backed Hermes user memory 时，加 `--memory`。该模式会直接调用 SIM internal memory API，验证服务令牌、用户 A 写入、用户 A 召回、用户 B 隔离，以及“当前画布 / pendingActionId”等临时任务状态被拒绝写入：

```bash
HERMES_SERVICE_TOKEN=<same-as-sim-HERMES_SERVICE_TOKEN> \
HERMES_SMOKE_USER_ID=<user-a-id> \
HERMES_SMOKE_OTHER_USER_ID=<user-b-id> \
HERMES_SMOKE_ORGANIZATION_ID=<org-id> \
bun run hermes:smoke -- --memory
```

注意：

- `HERMES_SMOKE_USER_ID` 和 `HERMES_SMOKE_OTHER_USER_ID` 都必须是该组织下的有效用户，否则 SIM 权限校验会返回 403。
- `--memory` 是确定性服务级 smoke，不依赖 LLM 是否按提示调用 memory tool；Hermes fork 侧的 `plugins/memory/sim` provider 仍需通过 Python 测试证明它会把 `prefetch` / `sync_turn` / 显式记忆工具调用转发到同一个 SIM internal API。
- 若要验证完整 Hermes API Server + LLM 自动记忆链路，应在 `--memory` 通过后，再用同一个 `X-Hermes-Session-Key` 和 SIM metadata 做两轮真实 chat：第一轮表达长期偏好，第二轮换 session 询问偏好是否可召回。

### 7.5 Hermes -> SIM 工具调用审计

SIM 会把 Hermes 调用 internal tool 的关键链路写入：

```text
hermes_tool_call_audit
```

该表只记录摘要和引用，不记录完整 prompt、画布正文、网页全文或密钥。上线前必须执行迁移：

```text
packages/db/migrations/0220_hermes_tool_call_audit.sql
```

排障时优先按以下字段串联：

- `trace_id`
- `hermes_run_id`
- `sim_request_id`
- `user_id`
- `workspace_id`
- `workflow_id`
- `tool_name`
- `status`
- `error_code`

### 7.6 Hermes 工具调用审计导出与清理

管理员可在 Project Admin Center 的 Hermes tool-call audit 面板执行：

- 按当前筛选条件查看审计记录。
- 导出最多 1000 条 JSON 记录，用于发布前留证或事故排查。
- 设置 retention hours，并先 dry-run 预览，再清理过期的 `hermes_tool_call_audit` 行。

对应 API：

```text
GET  /api/organizations/[id]/hermes/tool-call-audits/export
POST /api/organizations/[id]/hermes/tool-call-audits/cleanup
```

注意事项：

- 两个 API 都要求当前用户是组织管理员。
- cleanup 只删除当前 organization 下的 Hermes tool-call audit，不删除 SIM workflow、chat、skill proposal 或 memory。
- 正式 cleanup 前建议先导出审计记录；cleanup 执行结果会写入 audit log，保留操作人、retention、cutoff 和删除数量。

## 8. 本地启动顺序

1. 启动 SIM 依赖：DB、Redis、Realtime、Next.js。
2. 启动 Hermes API Server，确保 `API_SERVER_KEY`、`SIM_INTERNAL_API_URL`、`SIM_SERVICE_TOKEN` 已设置。
3. 在 SIM 环境配置 `HERMES_API_URL`、`HERMES_API_KEY`、`HERMES_SERVICE_TOKEN`。
4. 调用 `bun run check:hermes-health -- --base-url <SIM_URL>`，确认退出码为 0。
5. 调用 `bun run hermes:smoke`，确认 Hermes capabilities、toolset policy 和 SIM 聚合 health 均通过。
6. 使用 `bun run hermes:smoke -- --chat` 验证 OpenAI-compatible chat completion 可用。
7. 使用 `bun run hermes:smoke -- --canvas-read` 或 SIM Copilot 的 `hermes_agent_v1` 模式做 read-only 画布读取。
8. 使用 `bun run hermes:smoke -- --memory` 验证 SIM-backed Hermes user memory 的写入、召回、用户隔离和临时画布状态拒绝。
9. 再做 propose -> 用户确认 -> apply_after_confirm 的完整写入回归。
10. 最后验证 Skill Proposal：Hermes 只创建 proposal，不直接 publish。

## 9. 生产发布检查清单

发布前必须确认：

- [ ] SIM 和 Hermes 使用不同进程 / 容器部署，故障域隔离。
- [ ] `HERMES_API_KEY` 与 `API_SERVER_KEY` 一致，且不是示例值。
- [ ] `HERMES_SERVICE_TOKEN` 与 `SIM_SERVICE_TOKEN` 一致，且至少 32 位。
- [ ] `HERMES_HOME` 不与其他环境、其他租户混用。
- [ ] Hermes health 返回的 commit 与部署清单一致。
- [ ] SIM `/api/internal/hermes/health` 返回 200。
- [ ] `bun run hermes:smoke` 退出码为 0；如上线含真实工具调用，`--chat`、`--canvas-read`、`--skill-list`、`--memory` 的对应 smoke 也通过。
- [ ] Hermes tool allowlist 不包含 `browser`、`terminal`、`file`、`code_execution`、`computer_use`、`delegation`、`cronjob` 等生产禁用 toolset。
- [ ] SIM internal route 鉴权在 body parse 之前执行。
- [ ] 画布写入仍走 SIM patch validation、apply、verify。
- [ ] Skill Proposal publish 和 rollback 只对管理员开放。
- [ ] Hermes memory provider 使用 `memory.provider: sim`，且未把当前画布状态、pendingActionId、原始网页全文或密钥写入长期用户 memory。
- [ ] 日志不记录完整 prompt、网页全文、密钥、token、用户隐私正文。

## 10. Skill Proposal 发布闭环

正确闭环：

```text
Hermes background review / 用户交互
        |
        v
propose_create / propose_patch
        |
        v
SIM skill_proposal(status=pending_review)
        |
        v
管理员 review approve/reject
        |
        v
publish -> skill + agentSkillBinding + skillRevision
        |
        v
必要时 rollback 到指定 revision
```

禁止闭环：

```text
Hermes 自动学习
        |
        v
直接写 SIM DB skill / 直接启用团队规则
```

原则：

- Hermes 可以成为 SIM Skill 的“自动教研员”。
- Hermes 不应成为“无需审批的生产规则发布者”。
- Hermes 用户级 memory / skill 与 SIM 团队级 DB skill 必须分层。

## 11. 常见故障排查

| 现象 | 可能原因 | 排查 |
| --- | --- | --- |
| SIM health 返回 `unconfigured` | SIM 未配置 `HERMES_API_URL` 或 `HERMES_API_KEY` | 检查 SIM 环境变量 |
| SIM health 返回 `unreachable` | Hermes 进程未启动、URL 错误、网络不通 | 直接访问 Hermes `/health` |
| capabilities 401 | `HERMES_API_KEY` 与 Hermes `API_SERVER_KEY` 不一致 | 重置两侧密钥 |
| missing toolsets: sim | Hermes API Server 未启用 SIM plugin/toolset | 检查 Hermes config/toolsets |
| required Hermes tools missing | Hermes `sim` toolset 启用但 SIM plugin 实际工具未注册完整 | 检查 `plugins.enabled: [sim]`、Hermes 启动日志和 `/v1/toolsets` 的 `tools` |
| forbidden Hermes toolsets enabled | Hermes API Server 暴露了 SIM 生产禁用 toolset | 收紧 `platform_toolsets.api_server`，或显式评审后调整 `HERMES_FORBIDDEN_TOOLSETS` |
| Hermes 用户偏好无法跨会话召回 | Hermes 未设置 `memory.provider: sim`，或 API Server 未启用 `memory` toolset，或 SIM session metadata 缺少 user/org | 检查 Hermes config、`SIM_INTERNAL_API_URL`、`SIM_SERVICE_TOKEN`、gateway metadata |
| canvas apply 返回 `CONFIRMATION_REQUIRED` | Hermes 未传 pendingActionId 或用户未确认 | 先 propose，再用户确认，再 apply |
| canvas apply 返回 `VERIFY_FAILED` | SIM verify 未通过 | 不宣称执行成功，提示用户恢复/重试 |
| proposal 无法 publish | 当前用户非组织管理员或 proposal 状态不对 | 走管理员审核流程 |
| 用户偏好串号 | `memory.provider` 未使用 SIM-backed provider，或 SIM metadata/user/org 传递错误 | 检查 `memory.provider: sim`、session key、SIM metadata 和 `hermes_user_memory` scope |

## 12. 回滚策略

### 12.1 Hermes 服务回滚

- 回滚 Hermes 容器镜像或 git commit。
- 保持 `API_SERVER_KEY` 不变，避免 SIM 配置同时变更。
- 回滚后立刻检查 `/health` commit 和 SIM 聚合 health。

### 12.2 SIM 接入回滚

- 将 SIM Copilot mode 从 `hermes_agent_v1` 切回现有本地画布 Agent 模式。
- 保留 Hermes internal routes，但停止入口流量。
- 不删除 proposal/revision 表，避免丢失审核记录。

### 12.3 Skill 内容回滚

- 使用 SIM rollback API 回滚到指定 `skillRevision`。
- 只回滚已发布团队 skill；Hermes 用户级 personal skill 由 Hermes 自身管理。
- 回滚后补一条 proposal 或审计备注，说明原因。

## 13. 后续增强项

- 对 SIM-backed memory 增加完整 Hermes API Server + LLM 两轮真实 chat A/B 隔离 E2E，并增强语义检索。
- Hermes user memory 已在 project-admin 提供基础只读排障面板；后续可继续补导出、删除/归档审核流和异常告警。
- Hermes health 发布阻断脚本已支持 webhook 告警；后续可为 project-admin health 面板补充同等通知策略和历史告警视图。
- 为 `hermes_tool_call_audit` 增加导出视图和 retention 策略。
- `sim_external_evidence_prepare` 已为网页 / 文件抓取结果提供基础摘要、引用和 prompt-injection 风险标记；后续可继续接入更强的网页结构化解析、来源可信度评分和引用覆盖率检查。
- 对 Skill Proposal 增加 diff 可视化、批注、灰度发布和团队回滚 UI。
