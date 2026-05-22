# 剧场项目多团队画布协作系统进度与后续目标

> 更新时间：2026-05-22  
> 基准文档：`docs/theater-collaboration-phased-implementation-plan-zh.md`  
> 当前推进阶段：Phase 4「权限隔离加固」进行中

## 1. 当前结论

当前仓库已经具备剧场协作系统的核心基础：组织/工种/团队、个人草稿画布、团队画布、发布展示画布、Copilot Agent 映射、团队管理入口、权限辅助逻辑和一批后端 API/前端工作台页面已经落地。

最近的工作重点集中在 Phase 4：把「个人草稿只归本人」「团队画布只归团队成员」「展示画布只读」「Copilot 不越权读取或修改」这些隔离要求落到真实 HTTP、Copilot tool、Realtime/工作流权限路径上。

需要明确：Phase 4 尚未整体完成，Phase 5 到 Phase 12 也不能视为完成。后续仍需按阶段继续审计、补齐、验证和提交。

## 2. 已有基础能力

### 2.1 协作基础提交

以下基础提交已经存在，后续不需要重复造轮子：

| Commit | 内容 |
| --- | --- |
| `d54d11236` | Add team canvas collaboration foundation |
| `96781c0e5` | Test collaboration discipline definitions |
| `2f95e1818` | Add team management workbench page |
| `8bcd6dbcb` | Document theater collaboration rollout plan |

### 2.2 已落地的主要代码面

| 领域 | 现状 |
| --- | --- |
| 数据模型 | 已有 `discipline`、`agent_profile`、`workgroup_member`、`personal_canvas_workspace`、`workflow_publication_version`、`agent_skill_binding` 等协作相关结构 |
| 协作服务 | `apps/sim/lib/collaboration/service.ts` 承载团队成员、个人/团队画布、发布版本、展示树、Agent 解析等逻辑 |
| 权限 helper | `apps/sim/lib/collaboration/authz.ts` 和 `packages/workflow-authz/src/index.ts` 已定义个人/团队/展示画布读写发布边界 |
| API contracts | `apps/sim/lib/api/contracts/collaboration.ts` 已纳入协作 API 合约 |
| 工作台入口 | 已有 `/workbench`、`/workbench/personal`、`/workbench/team`、`/workbench/showcase`、`/workbench/team-management` 等入口 |
| Copilot 上下文 | `apps/sim/lib/copilot/chat/workspace-context.ts` 已能注入当前协作/Agent 上下文，并在近期继续加固过滤 |
| Realtime 权限 | `apps/realtime/src/middleware/permissions.ts` 已接入 workflow/canvas scope 权限，并将展示/发布画布强制只读 |

## 3. 最近已完成的 Phase 4 加固

### 3.1 展示画布与发布 workflow 只读

| Commit | 内容 |
| --- | --- |
| `4cfd2aa9c` | Published workflow 被统一解析为 `showcase`，Realtime/workflow auth 对发布 workflow 强制 read role，并拒绝 mutation |
| `88f5a2cf0` | 发布 workflow 摘要返回 `locked: true`，避免旧客户端或下游逻辑误判为可编辑 |

已增强的约束：

- `workflow.track === 'published'` 不再被当作普通可编辑 workflow。
- 展示/发布画布的服务端写入被拒绝，而不是只靠 UI 隐藏按钮。
- 旧客户端读取 summary 时也能看到只读锁定状态。

### 3.2 Copilot 上下文和工具权限

| Commit | 内容 |
| --- | --- |
| `0c712654f` | `/api/copilot/chat/resources` 按 workflow read access 过滤资源 |
| `403986483` | workspace context 和 VFS workflow materialization 只暴露当前用户可读 workflow |
| `5e8fcb787` | 跨团队展示/发布读者不能通过 `get_credentials` 读取源 workspace 凭证/环境上下文 |
| `8ef9e43b8` | Copilot execution summary 按 workflow 权限校验，跨团队展示读者不能读取源执行摘要 |
| `786bfd6cf` | Copilot workflow metadata 对 showcase reader 做脱敏：隐藏 folderId、部署状态、运行次数、lastRunAt 等 |
| `e4d78ce57` | Copilot server write tools 在缺失 `userPermission` 时改为 fail-closed |
| `5ec01e8c0` | Copilot nested tool args 里的 `operation/action` 在参数展开前先做写权限校验 |

已增强的约束：

- Copilot 不应把用户无权访问的 workflow 注入上下文。
- 跨团队展示画布读者只能看脱敏后的展示信息，不能借 Copilot 读取源 workspace 的凭证、环境、执行详情。
- Copilot 写工具不再因为权限字段缺失或 nested args 包装而绕过写权限判断。

### 3.3 workflow 写入与日志写入

| Commit | 内容 |
| --- | --- |
| `4fa8be45d` | `apps/sim/app/api/workflows/[id]/log/route.ts` 改为要求 workflow write access |

已增强的约束：

- 只读展示访问不能写 workflow log。
- workflow log 写入不再只依赖较宽泛的读权限。

### 3.4 团队管理员边界

| Commit | 内容 |
| --- | --- |
| `dcf39f35f` | 防止把 workgroup 最后一个 admin 降级为 member |

已增强的约束：

- `removeWorkgroupMember` 已保护最后一个 admin 删除。
- `updateWorkgroupMemberRole` 现在也保护最后一个 admin 降级。
- 团队不会因为角色调整失去最后的管理者。

### 3.5 类型和审计债务减少

| Commit | 内容 |
| --- | --- |
| `8fee99fd5` | 移除 Copilot/tool metadata 路径中的 3 个 `as unknown as ToolConfig`，新增 `ToolMetadataConfig` |

影响：

- 这不改变画布和智能体交互行为。
- 主要作用是让 Copilot/tool metadata gate 更类型安全，降低后续权限加固时的误判风险。

## 4. 已验证或已有测试覆盖的关键点

当前已有或近期补充的测试覆盖重点包括：

| 文件 | 覆盖点 |
| --- | --- |
| `apps/sim/lib/collaboration/authz.test.ts` | 个人 owner-only、团队成员读写、团队/组织管理员发布、项目管理员默认不能读个人草稿、publication visibility |
| `apps/sim/lib/collaboration/service.test.ts` | workgroup admin 管理边界，包括最后一个 admin 降级保护 |
| `apps/sim/lib/copilot/tools/server/router.test.ts` | Copilot 写工具缺失权限 fail-closed、nested args 写操作权限检查 |
| `apps/sim/lib/copilot/tools/server/user/get-credentials.test.ts` | 跨团队展示读者不能读取源 workspace credential/env context |
| `apps/sim/lib/copilot/tools/server/workflow/get-execution-summary.test.ts` | execution summary 需要 workflow 级授权 |
| `apps/sim/app/api/workflows/[id]/log/route.test.ts` | workflow log 写入需要 write access |
| `apps/sim/app/api/workflows/[id]/duplicate/route.test.ts` | 跨团队展示访问不能复制源 workflow |
| `apps/sim/app/api/workflows/[id]/variables/route.test.ts` | 跨团队展示访问不能读写 variables |
| `apps/sim/app/api/workflows/[id]/executions/[executionId]/stream/route.test.ts` | 跨团队展示访问不能读取 execution stream |

最近切片中使用过的验证命令：

```powershell
Set-Location apps\sim; bunx vitest run lib/collaboration/service.test.ts
Set-Location apps\sim; bunx vitest run lib/copilot/tools/server/router.test.ts
Set-Location apps\sim; bunx biome check --write lib/copilot/tools/server/router.ts lib/copilot/tools/server/router.test.ts
Set-Location apps\sim; bun run type-check 2>&1 | Select-String -Pattern "lib/copilot/tools/server/router"
bun run check:api-validation:strict
git diff --check
```

## 5. 当前不能宣称完成的内容

### 5.1 Phase 4 仍未整体完成

Phase 4 文档要求排查以下路径。当前已经加固了其中一部分，但还需要继续做完整审计矩阵：

| 路径 | 当前状态 |
| --- | --- |
| workflow load/save/duplicate/publish | 已做多处加固，但还需最终全量复核 |
| workspace list/detail | 已有 `listAccessibleWorkspaceIds` 与 canvas metadata，但仍需围绕旧入口和个人草稿泄露做最终审计 |
| folder/list/sidebar/recent/search | 尚需系统排查，确保不会列出其他人的个人草稿或不可见团队画布 |
| files/assets | 正在排查，workspace files 多数路径已有 read/write 权限校验，但仍需完成 `/api/files/**` 与 presigned/serve/upload 全链路复核 |
| credentials | 已加固 Copilot credential context，但普通 credential/API 路径仍需按展示读者场景复核 |
| Copilot context | 已做多处过滤和脱敏，仍需继续查 tools、VFS、resource attachment、workspace mode 分支 |
| Realtime room join/operation | 已有只读/发布画布限制，仍需补齐测试覆盖和 presence 隔离复核 |
| webhooks/internal tasks | 尚需排查，尤其是内部任务是否可能借 workspaceId 绕过 canvas 边界 |

### 5.2 Phase 5 到 Phase 12 尚未完成

后续阶段不能因为已有基础页面或部分服务而视为完成：

| 阶段 | 主要剩余目标 |
| --- | --- |
| Phase 5 发布流程与全局状态树 | 完整发布流程、状态树更新、可见范围广播、发布版本生命周期 |
| Phase 6 跨画布节点复制 | 个人草稿到团队画布复制、ID 重写、敏感字段剥离、源读/目标写权限矩阵 |
| Phase 7 分屏工作台 | `/workbench/split`、左右 pane 独立状态、复制入口、移动端降级 |
| Phase 8 Copilot 10 个 Agent 深度接入 | active workgroup/discipline 驱动 Agent、Skill、提示词、工具能力边界 |
| Phase 9 团队管理员闭环 | 成员管理、发布管理、团队 Agent Skill 设置的完整日常闭环 |
| Phase 10 项目管理员中心 | 工种/团队/成员分配、全局状态树、Agent 模板、权限和审计 |
| Phase 11 Legacy workspace 入口迁移 | 普通用户不再以 workspace 为主入口，旧链接兼容和创建入口收敛 |
| Phase 12 测试、审计、发布与监控 | 自动化测试、手工验收脚本、审计日志、监控指标和发布/回滚策略 |

## 6. 建议继续推进目标

### 6.1 立即继续：完成 Phase 4 权限隔离审计

建议按小切片继续，不要一次改完：

1. **files/assets 切片**
   - 排查 `apps/sim/app/api/files/**`。
   - 排查 `apps/sim/app/api/workspaces/[id]/files/**`。
   - 确认 read-only showcase reader 不能上传、注册、删除、改名、覆盖源 workspace 文件。
   - 确认 serve/download/presigned 路径不能通过 key 或 workspaceId 猜测读取个人草稿或团队私有资源。

2. **logs/metrics 切片**
   - 排查 `apps/sim/app/api/logs/**`。
   - 排查 `apps/sim/app/api/workspaces/[id]/metrics/executions/route.ts`。
   - 确认展示读者不能看到源团队执行细节、trace、文件、成本、错误输入输出。

3. **workspace/sidebar/recent/search 切片**
   - 排查 `apps/sim/app/api/workspaces/**`、workflow list、folder list、sidebar 数据源、recent workflows、搜索入口。
   - 确保旧 workspace API 不返回别人的个人草稿。
   - 确保非团队成员看不到团队画布。

4. **Realtime 测试切片**
   - 对 `apps/realtime/src/middleware/permissions.ts` 和 operation handlers 补更直接的测试。
   - 覆盖非 owner 不能进个人草稿 room、非成员不能进团队 room、展示画布 mutation 被拒绝、read role position update 被拒绝。

5. **webhooks/internal tasks 切片**
   - 排查 webhook、scheduled/internal cleanup、agentmail、outbox 等内部任务是否可能只凭 workspaceId 或 workflowId 绕过新的 canvas 边界。

### 6.2 Phase 4 完成前建议验收门槛

Phase 4 可以进入收尾前，至少需要形成一张审计表，逐项记录：

| 项 | 需要证明的证据 |
| --- | --- |
| HTTP read path | 当前用户只能读个人 owner、所属团队、授权展示画布 |
| HTTP write path | write/admin 才能写，展示画布服务端拒绝 |
| publication path | publish permission 独立校验，不能等同于普通 write |
| Realtime join | room join 由服务端解析 scope，不信任客户端 mode |
| Realtime mutation | read role mutation 被拒绝 |
| Copilot context | 上下文、工具、VFS、metadata 都按用户权限过滤/脱敏 |
| legacy workspace API | 不泄露其他人的个人草稿 |
| tests | Phase 4 关键路径有自动化测试覆盖 |

建议完成 Phase 4 前至少运行：

```powershell
Set-Location apps\sim; bunx vitest run lib/collaboration/authz.test.ts
Set-Location apps\sim; bunx vitest run lib/collaboration/service.test.ts
Set-Location apps\sim; bunx vitest run lib/copilot/tools/server/router.test.ts
Set-Location apps\sim; bunx vitest run app/api/workflows/[id]/route.test.ts
Set-Location apps\sim; bunx vitest run app/api/workflows/[id]/log/route.test.ts
bun run check:api-validation:strict
git diff --check
```

如涉及 Realtime 改动，再运行：

```powershell
Set-Location apps\realtime; bunx vitest run src/middleware/permissions.test.ts
```

## 7. 后续提交策略

继续按文档阶段推进，推荐粒度如下：

| 顺序 | 建议提交主题 |
| --- | --- |
| 1 | `Harden workspace file authorization` |
| 2 | `Gate collaboration logs and metrics` |
| 3 | `Filter legacy workspace discovery paths` |
| 4 | `Test realtime canvas authorization boundaries` |
| 5 | `Complete canvas authorization audit` |
| 6 | `Implement publication state tree workflow` |
| 7 | `Implement cross-canvas selection copy` |
| 8 | `Add split view canvas workbench` |
| 9 | `Wire discipline agents into Copilot` |
| 10 | `Complete team admin workbench` |
| 11 | `Add project collaboration admin center` |
| 12 | `Migrate legacy workspace entrypoints` |
| 13 | `Add collaboration release hardening` |

每次提交前继续执行：

```powershell
git status --short
```

并且只 stage 本切片相关文件，避免混入用户改动或无关格式化。

