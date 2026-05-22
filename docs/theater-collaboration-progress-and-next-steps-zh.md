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

### 3.6 原主界面入口纠偏

本轮已把画布入口从独立 `/workbench` 外壳方向迁回原始 Sim 主界面：

- `/workspace/[workspaceId]/home` 保留原 Mothership/Copilot 能力，同时在空首页顶部增加“个人草稿画布 / 团队画布 / 展示画布”三张原风格入口卡片。
- 原 Sidebar 增加持久 `Canvases` 分组，用户可在深层页面中切回个人草稿、团队画布、展示画布。
- 新增 `/workspace/[workspaceId]/showcase` 与详情路径，复用现有只读 published workflow 展示能力，保证打开展示画布时仍保留原 Sidebar。
- `/workspace` 入口不再跳到 `/workbench`，而是优先进入当前团队画布所在的原 workspace shell。
- 个人草稿画布创建已改为走协作专用 `POST /api/workgroups/[workgroupId]/personal-workspace`，普通团队成员不再依赖组织级 `/api/workspaces` 创建策略；创建后自动生成默认 workflow 并跳转打开。
- 数据库迁移 `0207_personal_canvas_multiple_drafts.sql` 去掉 `userId + workgroupId` 唯一约束，使同一用户在同一团队下可以拥有多个个人草稿画布。
- 旧 `/workbench`、`/workbench/personal`、`/workbench/team`、`/workbench/showcase`、`/workbench/team-management` 已降级为兼容跳转到 `/workspace`，避免继续维护两套主入口外壳。
- 已补 `apps/sim/app/api/workgroups/[workgroupId]/personal-workspace/route.test.ts` 与 `apps/sim/lib/collaboration/service.test.ts` 覆盖个人多草稿创建、默认 workflow 创建、鉴权前置和合约校验。

仍需继续：

- 后续若团队需要多个团队画布，再新增 `team_canvas_workspace` 表；当前仍保持每个 workgroup 一个 `teamWorkspaceId` 的 v1 方案。

### 3.7 files/assets 权限切片

本轮继续推进 Phase 4 的文件与资产隔离：

- `apps/sim/app/api/files/authorization.ts` 不再二次依赖旧 `permissions` 表判断文件读写，而是直接使用 `checkWorkspaceAccess` 返回的 `hasAccess/canWrite`。这样个人草稿 owner-only、团队成员可写、展示/发布读者不能写源 workspace 文件都走统一画布边界。
- `/api/workspaces/[id]/files` 上传、直传 presigned、register、rename、delete、content update、restore 这些写路径统一改为检查 `access.canWrite`，避免团队画布成员因为缺少旧 permission row 被误拒，也避免只读读者绕过。
- `/api/files/upload`、`/api/files/presigned`、`/api/files/multipart` 的 workspace/mothership/execution/knowledge-base/chat 等带 workspace 上下文的写路径已改为依赖 `checkWorkspaceAccess(...).canWrite`；只读展示读者不能再仅凭旧 permission row 或可见 workspaceId 申请上传、直传或分片上传。
- `/api/files/parse` 的外部 URL 导入到 workspace 场景改为要求 `canWrite`，只读读者不会触发外部下载或把 URL 内容保存/复制进源 workspace。
- `/api/files/delete`、`/api/files/download`、`/api/files/serve`、`/api/files/view`、`/api/files/export` 继续通过 `verifyFileAccess`/`verifyFileWriteAccess` 回到统一文件授权 helper，按文件 metadata/key 映射到真实 workspace 后再判断画布边界。
- 已补 `apps/sim/app/api/files/authorization.test.ts` 覆盖“团队画布 write access 即使没有旧 permission row 也可写文件”。
- 已调整 workspace files 与全局 files 路由测试，让只读/展示类场景通过 `checkWorkspaceAccess(...).canWrite = false` 证明服务端拒绝写操作，同时证明团队画布 write access 不依赖旧 `permissions` row。

### 3.8 legacy accessible workspace helper 加固

本轮修复 `listAccessibleWorkspaceIds` 的画布边界：

- 用户自己的个人草稿画布即使挂在 workgroup 下，也会被纳入可访问 workspace 列表。
- 团队成员通过 workgroup membership 只能拿到 `organization` 团队画布，不能因为同属一个 workgroup 就拿到其他成员的 `personal` 草稿画布。
- 仅 owner 关系不再让用户访问 workgroup 团队画布；团队画布仍必须通过 workgroup membership 判断。
- 这个 helper 会影响 `/api/logs/execution/[executionId]` 这类按“可访问 workspace IDs”过滤的日志/快照路径，因此该修复同时降低了个人草稿执行数据被同团队成员枚举的风险。

### 3.9 logs/metrics 路由隔离补证

本轮收口 Phase 4 的日志与执行指标切片：

- 复核 `apps/sim/app/api/logs/**` 与 `apps/sim/app/api/workspaces/[id]/metrics/executions/route.ts`：列表、导出、统计、触发器、按 log id、按 execution id 和执行快照路径均在查询前经过 `checkWorkspaceAccess` 或 `listAccessibleWorkspaceIds`，不会把其他成员个人草稿或非成员团队画布执行数据暴露给当前用户。
- 新增 `apps/sim/app/api/logs/[id]/route.test.ts` 与 `apps/sim/app/api/logs/by-execution/[executionId]/route.test.ts`，证明详情入口统一委托 `fetchLogDetail` 的 workspace-scoped authorizer；当 authorizer 拒绝源 workspace 时返回 404，不泄露 source team execution detail。
- 保留并复跑已有日志覆盖：`/api/logs`、`/api/logs/export`、`/api/logs/stats`、`/api/logs/triggers`、`/api/logs/execution/[executionId]`、`fetchLogDetail` 和 workspace execution metrics。
- 顺手去掉 metrics route 中的 `any[]` 查询条件类型，改为 `SQL[]`，避免后续权限条件拼接退化成无类型路径。

### 3.10 workspace/recent 发现入口加固

本轮继续收口 Phase 4 的旧 workspace 发现路径：

- `GET /api/workspaces` 仍以 `listAccessibleWorkspaceIds(userId)` 作为唯一列表边界，并在返回 `lastActiveWorkspaceId` 前再次确认该 ID 仍属于当前用户可访问集合；如果设置里残留其他成员个人草稿或已失效团队画布 ID，响应改为 `null`，避免旧入口泄露不可访问 workspace id。
- `useWorkspaceManagement` 的本地最近访问记录只在当前 `workspaceId` 已出现在服务端返回的可访问 workspace 列表后写入；用户手动打开不可访问 URL 时不会再把该 ID 写入 `localStorage` 或同步到 user settings。
- 新增/扩展 `apps/sim/app/api/workspaces/route.test.ts` 覆盖“不可访问 last active workspace id 不返回给客户端”；并复跑 workspace/workflow 发现路径相关测试，确认 workflow 列表继续依赖 `listAccessibleWorkspaceIds` 和 `checkWorkspaceAccess`。

### 3.11 workspace environment 凭证隔离

本轮补上普通 workspace environment API 的凭证读取边界：

- `GET /api/workspaces/[id]/environment` 不再只要求 workspace 可见，而是要求 `checkWorkspaceAccess(...).canWrite`，避免只读成员或未来展示类读者拿到解密后的 workspace 环境变量。
- `PUT/DELETE /api/workspaces/[id]/environment` 同步改为依赖 `access.canWrite`，团队画布成员可按画布边界写入，read-only 访问统一返回 403。
- 已补 `apps/sim/app/api/workspaces/[id]/environment/route.test.ts` 覆盖隐藏 personal workspace 返回 404、read-only GET 不调用解密服务、read-only PUT/DELETE 被拒绝。
- Workspace API key 与 BYOK 列表读取也已收紧为 admin-only：read-only 用户不能列出 workspace API key display key，也不能读取 BYOK provider/masked key 元数据；更新/删除路径继续在 key lookup 前拒绝非 admin。
- 已补 `apps/sim/app/api/workspaces/[id]/api-keys/route.test.ts`、`apps/sim/app/api/workspaces/[id]/api-keys/[keyId]/route.test.ts`、`apps/sim/app/api/workspaces/[id]/byok-keys/route.test.ts` 覆盖 read-only 拒绝和隐藏 workspace 404。
- 普通 `/api/credentials` 查询继续依赖 workspace 可见性和 credential membership；按 `credentialId/accountId` 点查时也必须有 active credential member 关系，避免只读或展示读者凭猜测 ID 看到源 workspace 凭证元数据。
- `/api/credentials` 的 OAuth credential 同步副作用改为仅在当前用户对 workspace 有 `canWrite` 时触发，避免只读展示访问在 GET 路径上写入 credential membership 或规范化源凭证。
- `/api/credentials/[id]/members` 的成员列表读取收紧为 credential admin-only；普通 credential member 或只读 workspace 访问不能枚举成员姓名、邮箱和共享关系。
- `/api/credential-sets/[id]/members` 的成员列表读取收紧为组织 admin/owner-only；普通组织成员不能通过 credential set 管理页枚举成员账号和 provider accountId。

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
| `apps/sim/app/api/logs/[id]/route.test.ts` | log id 详情入口必须走 workspace-scoped detail authorizer，拒绝源 workspace 时返回 404 |
| `apps/sim/app/api/logs/by-execution/[executionId]/route.test.ts` | execution id 详情入口必须走 workspace-scoped detail authorizer，拒绝源 workspace 时返回 404 |
| `apps/sim/app/api/workspaces/[id]/metrics/executions/route.test.ts` | 执行指标读取需要真实 workspace read access，其他成员个人草稿返回 404 |
| `apps/sim/app/api/workspaces/route.test.ts` | workspace 列表和 lastActiveWorkspaceId 都必须先经过 accessible workspace ids 过滤 |
| `apps/sim/app/api/files/upload/route.test.ts` | workspace/mothership/execution 上传写入依赖 `checkWorkspaceAccess(...).canWrite`，团队画布成员不再依赖旧 permission row |
| `apps/sim/app/api/files/presigned/route.test.ts` | mothership/execution 直传 URL 申请需要画布 write 权限，隐藏 workspace 返回 404 |
| `apps/sim/app/api/files/multipart/route.test.ts` | 分片上传 initiate 阶段要求画布 write 权限，并把 execution 上传归一到真实 workflow workspace |
| `apps/sim/app/api/files/parse/route.test.ts` | 外部 URL 导入到 workspace 时，隐藏或只读 workspace 不会触发下载/保存 |
| `apps/sim/app/api/workspaces/[id]/environment/route.test.ts` | 解密环境变量读取需要画布 write 权限，隐藏 workspace 返回 404，read-only 访问返回 403 |
| `apps/sim/app/api/workspaces/[id]/api-keys/route.test.ts` | Workspace API key 列表和创建/删除需 admin；read-only 不会触发 key 查询或 display formatting |
| `apps/sim/app/api/workspaces/[id]/byok-keys/route.test.ts` | BYOK 列表和管理需 admin；read-only 不会触发 provider key 查询或解密 |
| `apps/sim/app/api/credentials/route.test.ts` | read-only workspace GET 不触发 OAuth credential 同步，credentialId/accountId 点查必须有 active credential membership |
| `apps/sim/app/api/credentials/[id]/members/route.test.ts` | Credential 成员列表读取需要 credential admin，非 admin 不会枚举共享成员 |
| `apps/sim/app/api/credential-sets/[id]/members/route.test.ts` | Credential set 成员列表读取需要组织 admin/owner，普通成员不能枚举成员账号和 provider accountId |
| `apps/realtime/src/middleware/permissions.test.ts` | 非 owner/非成员不能进个人或团队 room，展示/发布 workflow 强制 read，read role 不能提交位置更新 |

最近切片中使用过的验证命令：

```powershell
Set-Location apps\sim; bunx vitest run lib/collaboration/service.test.ts
Set-Location apps\sim; bunx vitest run lib/copilot/tools/server/router.test.ts
Set-Location apps\sim; bunx biome check --write lib/copilot/tools/server/router.ts lib/copilot/tools/server/router.test.ts
Set-Location apps\sim; bun run type-check 2>&1 | Select-String -Pattern "lib/copilot/tools/server/router"
Set-Location apps\sim; bunx vitest run app/api/logs/route.test.ts app/api/logs/export/route.test.ts app/api/logs/stats/route.test.ts app/api/logs/triggers/route.test.ts "app/api/logs/[id]/route.test.ts" "app/api/logs/by-execution/[executionId]/route.test.ts" app/api/logs/execution/[executionId]/route.test.ts app/api/workspaces/[id]/metrics/executions/route.test.ts lib/logs/fetch-log-detail.test.ts
Set-Location apps\sim; bunx vitest run app/api/workspaces/route.test.ts app/api/workflows/route.test.ts lib/workspaces/utils.test.ts lib/workflows/utils.test.ts
Set-Location apps\sim; bunx vitest run app/api/files/upload/route.test.ts app/api/files/presigned/route.test.ts app/api/files/multipart/route.test.ts app/api/files/parse/route.test.ts app/api/files/authorization.test.ts app/api/files/delete/route.test.ts app/api/files/download/route.test.ts app/api/files/serve/[...path]/route.test.ts app/api/files/view/[id]/route.test.ts app/api/files/export/[id]/route.test.ts
Set-Location apps\sim; bunx vitest run app/api/workspaces/[id]/environment/route.test.ts
Set-Location apps\sim; bunx vitest run app/api/workspaces/[id]/api-keys/route.test.ts app/api/workspaces/[id]/api-keys/[keyId]/route.test.ts app/api/workspaces/[id]/byok-keys/route.test.ts
Set-Location apps\sim; bunx vitest run app/api/credentials/route.test.ts app/api/credentials/[id]/members/route.test.ts app/api/credentials/[id]/route.test.ts app/api/credentials/memberships/route.test.ts app/api/credentials/draft/route.test.ts
Set-Location apps\sim; bunx vitest run app/api/credential-sets/[id]/members/route.test.ts app/api/credential-sets/invite/[token]/route.test.ts
Set-Location apps\realtime; bunx vitest run src/middleware/permissions.test.ts
bun run check:api-validation:strict
git diff --check
```

## 5. 当前不能宣称完成的内容

### 5.1 Phase 4 仍未整体完成

Phase 4 文档要求排查以下路径。当前已经加固了其中一部分，但还需要继续做完整审计矩阵：

| 路径 | 当前状态 |
| --- | --- |
| workflow load/save/duplicate/publish | 已做多处加固，但还需最终全量复核 |
| workspace list/detail | 已加固列表和 lastActiveWorkspaceId 过滤；仍需继续复核 detail/settings 等旧入口 |
| folder/list/sidebar/recent/search | 尚需系统排查，确保不会列出其他人的个人草稿或不可见团队画布 |
| files/assets | 已完成 workspace files 与全局 `/api/files/**` 主要上传、直传、分片、parse、serve/download/view/export/delete 路径复核和测试；Phase 4 收尾时仍需汇总审计矩阵并跟 credentials/realtime/internal tasks 联合复核 |
| logs/metrics | 已完成本轮补证：日志列表/导出/统计/详情/执行快照和 workspace metrics 均走 workspace access 或 accessible workspace ids 过滤 |
| credentials | 已加固 Copilot credential context、workspace environment 解密读取、workspace API key/BYOK 列表读取、普通 credential 点查/同步副作用/成员枚举、credential-set 成员枚举；邀请接受路径已有 token/email 校验覆盖，Phase 4 收尾时纳入总矩阵 |
| Copilot context | 已做多处过滤和脱敏，仍需继续查 tools、VFS、resource attachment、workspace mode 分支 |
| Realtime room join/operation | 已有只读/发布画布限制，并已复跑 `apps/realtime/src/middleware/permissions.test.ts` 覆盖非 owner、非成员、showcase read-only 和 read role mutation 拒绝；Phase 4 收尾时仍需纳入总矩阵 |
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

1. **workspace/sidebar/recent/search 切片**
   - 排查 `apps/sim/app/api/workspaces/**`、workflow list、folder list、sidebar 数据源、recent workflows、搜索入口。
   - 确保旧 workspace API 不返回别人的个人草稿。
   - 确保非团队成员看不到团队画布。

2. **Realtime 测试切片**
   - 对 `apps/realtime/src/middleware/permissions.ts` 和 operation handlers 补更直接的测试。
   - 覆盖非 owner 不能进个人草稿 room、非成员不能进团队 room、展示画布 mutation 被拒绝、read role position update 被拒绝。

3. **webhooks/internal tasks 切片**
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
