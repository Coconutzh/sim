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

## 5. Hermes 工具 allowlist 建议

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
- 网页 / 浏览器工具必须把外部内容当作 evidence，不得当作系统指令。
- 终端、文件、进程类工具会扩大服务器权限边界，除非容器隔离、审计和审批链路都已就绪。

## 6. 健康检查与版本确认

### 6.1 Hermes 原生 health

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

### 6.2 SIM 侧聚合探针

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

返回状态建议：

| HTTP 状态 | 含义 | 处理方式 |
| --- | --- | --- |
| 200 | Hermes 可用且满足 SIM 要求 | 可以放量 |
| 401 | 调 SIM 探针的 `x-api-key` 错误 | 检查运维密钥 |
| 503 | Hermes 未配置、不可达或能力不完整 | 不放量，按 `error` 字段排查 |

### 6.3 Hermes -> SIM 工具调用审计

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

## 7. 本地启动顺序

1. 启动 SIM 依赖：DB、Redis、Realtime、Next.js。
2. 启动 Hermes API Server，确保 `API_SERVER_KEY`、`SIM_INTERNAL_API_URL`、`SIM_SERVICE_TOKEN` 已设置。
3. 在 SIM 环境配置 `HERMES_API_URL`、`HERMES_API_KEY`、`HERMES_SERVICE_TOKEN`。
4. 调用 `GET /api/internal/hermes/health`，确认 `ok = true`。
5. 使用 SIM Copilot 的 `hermes_agent_v1` 模式做 read-only 画布读取。
6. 再做 propose -> 用户确认 -> apply_after_confirm 的完整写入回归。
7. 最后验证 Skill Proposal：Hermes 只创建 proposal，不直接 publish。

## 8. 生产发布检查清单

发布前必须确认：

- [ ] SIM 和 Hermes 使用不同进程 / 容器部署，故障域隔离。
- [ ] `HERMES_API_KEY` 与 `API_SERVER_KEY` 一致，且不是示例值。
- [ ] `HERMES_SERVICE_TOKEN` 与 `SIM_SERVICE_TOKEN` 一致，且至少 32 位。
- [ ] `HERMES_HOME` 不与其他环境、其他租户混用。
- [ ] Hermes health 返回的 commit 与部署清单一致。
- [ ] SIM `/api/internal/hermes/health` 返回 200。
- [ ] Hermes tool allowlist 不包含 terminal/file/process 类高危工具。
- [ ] SIM internal route 鉴权在 body parse 之前执行。
- [ ] 画布写入仍走 SIM patch validation、apply、verify。
- [ ] Skill Proposal publish 和 rollback 只对管理员开放。
- [ ] 日志不记录完整 prompt、网页全文、密钥、token、用户隐私正文。

## 9. Skill Proposal 发布闭环

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

## 10. 常见故障排查

| 现象 | 可能原因 | 排查 |
| --- | --- | --- |
| SIM health 返回 `unconfigured` | SIM 未配置 `HERMES_API_URL` 或 `HERMES_API_KEY` | 检查 SIM 环境变量 |
| SIM health 返回 `unreachable` | Hermes 进程未启动、URL 错误、网络不通 | 直接访问 Hermes `/health` |
| capabilities 401 | `HERMES_API_KEY` 与 Hermes `API_SERVER_KEY` 不一致 | 重置两侧密钥 |
| missing toolsets: sim | Hermes API Server 未启用 SIM plugin/toolset | 检查 Hermes config/toolsets |
| canvas apply 返回 `CONFIRMATION_REQUIRED` | Hermes 未传 pendingActionId 或用户未确认 | 先 propose，再用户确认，再 apply |
| canvas apply 返回 `VERIFY_FAILED` | SIM verify 未通过 | 不宣称执行成功，提示用户恢复/重试 |
| proposal 无法 publish | 当前用户非组织管理员或 proposal 状态不对 | 走管理员审核流程 |
| 用户偏好串号 | `HERMES_HOME` 或 session key 复用 | 检查 session namespace 和部署隔离 |

## 11. 回滚策略

### 11.1 Hermes 服务回滚

- 回滚 Hermes 容器镜像或 git commit。
- 保持 `API_SERVER_KEY` 不变，避免 SIM 配置同时变更。
- 回滚后立刻检查 `/health` commit 和 SIM 聚合 health。

### 11.2 SIM 接入回滚

- 将 SIM Copilot mode 从 `hermes_agent_v1` 切回现有本地画布 Agent 模式。
- 保留 Hermes internal routes，但停止入口流量。
- 不删除 proposal/revision 表，避免丢失审核记录。

### 11.3 Skill 内容回滚

- 使用 SIM rollback API 回滚到指定 `skillRevision`。
- 只回滚已发布团队 skill；Hermes 用户级 personal skill 由 Hermes 自身管理。
- 回滚后补一条 proposal 或审计备注，说明原因。

## 12. 后续增强项

- 在 SIM 管理后台增加 Hermes health 面板。
- 将 Hermes memory provider 从本地 session namespace 升级为 SIM-backed provider。
- 为 `hermes_tool_call_audit` 增加管理后台查询、过滤和导出视图。
- 对网页 / 文件抓取加入内容摘要、引用和 prompt-injection 风险标记。
- 对 Skill Proposal 增加 diff 可视化、批注、灰度发布和团队回滚 UI。
