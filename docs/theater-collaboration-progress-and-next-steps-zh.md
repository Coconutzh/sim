# 剧场项目多团队画布协作系统进度与后续目标

> 更新时间：2026-05-24
> 基准文档：`docs/theater-collaboration-phased-implementation-plan-zh.md`
> 当前推进阶段：Phase 9「团队管理员闭环」继续在原 `/workspace` 外壳下收口团队发布管理、Agent Skill 绑定和协作日志；Phase 7 分屏已补多节点、目标高亮、viewport-center placement、显式边选择、复制后自动定位动画、pane-scoped zoom/pan 持久化和移动端 tab，仍保留框选/触摸选择优化待办

## 1. 当前结论

当前仓库已经具备剧场协作系统的核心基础：组织/工种/团队、个人草稿画布、团队画布、发布展示画布、Copilot Agent 映射、团队管理入口、权限辅助逻辑和一批后端 API/前端工作台页面已经落地。

最近的工作重点集中在 Phase 4：把「个人草稿只归本人」「团队画布只归团队成员」「展示画布只读」「Copilot 不越权读取或修改」这些隔离要求落到真实 HTTP、Copilot tool、Realtime/工作流权限路径上。

需要明确：Phase 4 已完成本轮代码加固、重点路径复核和自动化测试收口；Phase 5 到 Phase 12 仍不能视为完成，后续仍需按阶段继续实现、验证和提交。

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

### 3.12 Phase 4 收尾审计矩阵

| 项 | 当前结论 | 证据 |
| --- | --- | --- |
| HTTP read path | 当前用户只能读 owner 个人草稿、所属团队画布、授权展示画布；旧 workspace/workflow/log/file/credential 发现入口不再信任旧 permission row | `listAccessibleWorkspaceIds`、`checkWorkspaceAccess`、`authorizeWorkflowByWorkspacePermission` 相关测试已复跑 |
| HTTP write path | 写入统一要求 write/admin；展示/发布画布和 read-only workspace 服务端拒绝写 | workflow log、files、environment、credentials、schedules/webhooks 写路径测试已复跑 |
| publication path | published workflow 被解析为 showcase/read，源团队成员打开发布版本也不获得写权限 | `lib/collaboration/authz.test.ts`、`apps/realtime/src/middleware/permissions.test.ts` |
| Realtime join | room join 由服务端读取 workflow/workspace/canvas scope，不信任客户端 mode | `verifyWorkflowAccess` 覆盖非 owner、非成员、published workflow |
| Realtime mutation | read role 没有 mutation 权限，position update、batch update、replace state 等均拒绝 | `checkRolePermission` 覆盖所有 realtime operation |
| Copilot context | context、resources、VFS、metadata、写工具按 workflow/user permission 过滤或 fail-closed | `lib/copilot/tools/server/router.test.ts` 及前序 Copilot 权限测试 |
| credentials | environment/API key/BYOK/credential/credential-set 成员列表均避免 read-only 或非 admin 枚举敏感元数据 | credential 相关 route tests 已复跑 |
| webhooks/internal tasks | 用户管理入口按 workflow/workspace 权限过滤；外部触发和 cron/outbox 保持内部/部署语义，不作为用户越权入口 | webhooks、agentmail、schedules route tests 已复跑 |
| legacy workspace API | workspace list、recent、folder/workflow 发现路径不返回其他成员个人草稿或不可见团队画布 | workspace/workflow/folder 相关测试已复跑 |
| tests | Phase 4 关键路径已有自动化覆盖，收尾验证通过 | 本文档验证命令清单 |

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
Set-Location apps\sim; bunx vitest run lib/collaboration/authz.test.ts lib/collaboration/service.test.ts lib/copilot/tools/server/router.test.ts app/api/workflows/[id]/route.test.ts app/api/workflows/[id]/log/route.test.ts
Set-Location apps\sim; bunx vitest run app/api/webhooks/route.test.ts app/api/webhooks/[id]/route.test.ts app/api/webhooks/agentmail/route.test.ts app/api/schedules/route.test.ts app/api/schedules/[id]/route.test.ts app/api/schedules/execute/route.test.ts
bun run check:api-validation:strict
git diff --check
```

## 5. 当前不能宣称完成的内容

### 5.1 Phase 4 本轮收尾状态

Phase 4 文档要求排查以下路径。当前本轮已经完成加固、补证或复核，并纳入上面的收尾审计矩阵：

| 路径 | 当前状态 |
| --- | --- |
| workflow load/save/duplicate/publish | 已加固并复跑 workflow detail/log/collaboration authz 测试；发布版本保持 showcase/read-only |
| workspace list/detail | 已加固列表和 lastActiveWorkspaceId 过滤；detail/settings 类入口按 workspace access 或 admin/write gate 继续收敛 |
| folder/list/sidebar/recent/search | 已复跑 workspace/workflow/folder 发现路径测试，继续依赖 accessible workspace ids 和 checkWorkspaceAccess |
| files/assets | 已完成 workspace files 与全局 `/api/files/**` 主要上传、直传、分片、parse、serve/download/view/export/delete 路径复核和测试；已纳入本轮收尾审计矩阵 |
| logs/metrics | 已完成本轮补证：日志列表/导出/统计/详情/执行快照和 workspace metrics 均走 workspace access 或 accessible workspace ids 过滤 |
| credentials | 已加固 Copilot credential context、workspace environment 解密读取、workspace API key/BYOK 列表读取、普通 credential 点查/同步副作用/成员枚举、credential-set 成员枚举；邀请接受路径已有 token/email 校验覆盖 |
| Copilot context | 已做多处过滤和脱敏；tools、VFS、resource attachment、workspace mode 分支纳入本轮测试与矩阵 |
| Realtime room join/operation | 已有只读/发布画布限制，并已复跑 `apps/realtime/src/middleware/permissions.test.ts` 覆盖非 owner、非成员、showcase read-only 和 read role mutation 拒绝 |
| webhooks/internal tasks | 已复跑 webhooks、agentmail、schedules 相关测试；外部触发/cron/outbox 属内部执行语义，用户管理入口按 workflow/workspace 权限过滤 |

### 5.2 Phase 5 到 Phase 12 尚未完成

后续阶段不能因为已有基础页面或部分服务而视为完成：

| 阶段 | 主要剩余目标 |
| --- | --- |
| Phase 5 发布流程与全局状态树 | 完整发布流程、状态树更新、可见范围广播、发布版本生命周期 |
| Phase 6 跨画布节点复制 | 已有个人/团队复制、ID 重写、敏感字段剥离、源读/目标写权限矩阵、显式 edgeIds；普通编辑器目标跳转/高亮仍可补 |
| Phase 7 分屏工作台 | 原 `/workspace/[workspaceId]/split` 已有双 pane、多节点、显式边选择、目标高亮、viewport-center placement、复制后自动定位动画、pane-scoped zoom/pan 持久化和移动端 tab；框选/触摸选择仍待补 |
| Phase 8 Copilot 10 个 Agent 深度接入 | active workgroup/discipline 驱动 Agent、Skill、提示词、工具能力边界 |
| Phase 9 团队管理员闭环 | 成员管理、发布管理、团队 Agent Skill 设置的完整日常闭环 |
| Phase 10 项目管理员中心 | 工种/团队/成员分配、全局状态树、Agent 模板、权限和审计 |
| Phase 11 Legacy workspace 入口迁移 | 普通用户不再以 workspace 为主入口，旧链接兼容和创建入口收敛 |
| Phase 12 测试、审计、发布与监控 | 自动化测试、手工验收脚本、审计日志、监控指标和发布/回滚策略 |

### 5.3 Phase 5 已启动的切片

本轮已经开始 Phase 5 的全局状态树数据形态收敛：

- `getPublicationTree` 不再只返回最小版本链路，还会返回每个可见节点的 `description`、`status`、`visibility`、`sourceWorkgroup`、`sourceDiscipline`、`agentCode` 和 `dependsOnPublicationIds`。
- `publicationTreeSchema` 同步声明这些字段，前端展示画布/全局状态树可以直接按工种、团队、Agent 和依赖关系渲染。
- 当前 `status` 已从固定 `published` 推进为 DB 级生命周期字段，覆盖 `published/superseded/archived/retracted` 等状态。
- 已扩展 `apps/sim/lib/collaboration/service.test.ts`，确保发布树只返回当前用户可见节点，同时保留状态树元数据。

### 5.4 Phase 5 发布生命周期切片

本轮继续把 Phase 5 从“状态树数据形态”推进到“发布生命周期”：

- `workflow_publication_version` 增加 DB 级 `status`、`archivedAt`、`retractedAt`、`lifecycleUpdatedBy`、`lifecycleUpdatedAt`、`reviewState`、`riskLevel` 字段；迁移为 `packages/db/migrations/0208_publication_lifecycle_status.sql`。
- 发布新版本时写入 `status = published`，并把同一源 workflow 的旧 `published` 版本标记为 `superseded`，全局状态树可表达当前版本和历史版本关系。
- 展示列表默认只返回 `published/superseded`，可通过 `status` query 精确筛选；`retracted` 版本不再通过 `canReadPublication` 和详情/树接口暴露。
- 新增 `PATCH /api/publications/[publicationVersionId]`，团队管理员可 `archive` 或 `retract` 本团队发布，组织 admin/owner 继续通过 `assertWorkgroupAdmin` 管理团队发布生命周期。
- 发布创建、归档、撤回写入 `@sim/audit` 的 `publication.*` 审计动作；前端 React Query 增加 `useUpdatePublicationLifecycle` 并精准失效展示列表和详情缓存。

### 5.5 Phase 6 跨画布节点复制后端切片

本轮继续推进 Phase 6 的复制 API 闭环，重点先落服务端强制边界，保证后续分屏/右键 UI 接入时不依赖客户端自律：

- `POST /api/workflows/[id]/copy-selection` 现在以路由 `[id]` 作为源 workflow；如果请求体里的 `source.workflowId` 与路由不一致，直接返回 400，避免客户端把源/目标语义传错。
- 空 selection 不再提前返回；仍会先验证源 workflow read 和目标 workflow write，防止借空请求探测或绕过目标权限。
- 服务端会用 `resolveCanvasScope` 校验请求声明的 `source.type`、`target.type` 与真实授权上下文一致，个人/团队/展示画布类型不能由客户端伪造。
- 目标 workflow 必须属于请求声明的 `target.workspaceId`，避免 UI cache 或分屏 pane 状态串线时把节点写进错误画布。
- 复制响应除 `inserted` 外新增 `mappings.blockIds` 和 `mappings.edgeIds`，返回源 ID 到目标新 ID 的映射，后续前端可用于高亮新节点和刷新目标画布。
- `placement.offsetX/offsetY` 纳入合约，默认仍为 80/80，但分屏或 viewport-center UI 可以显式传入安全范围内的偏移。
- 节点复制继续重写 block/edge ID、只复制两端都在 selection 内的边、把目标节点 `locked` 设为 false，并保持源 workflow 不变。
- `sanitizeWorkflowSnapshot` 增强为识别 `UserFile` 形态和 `imageFile/files/uploadFile` 等文件字段，复制时会用占位符隐藏文件引用，同时保留 `profile` 这类非文件字段，降低跨个人/团队画布泄露私有文件 key/url/base64 的风险。
- 新增 `apps/sim/app/api/workflows/[id]/copy-selection/route.test.ts` 覆盖成功复制、源读/目标写拒绝、画布类型不匹配、源 workflow mismatch、空 selection 仍鉴权。
- 扩展 `apps/sim/lib/collaboration/snapshot-sanitizer.test.ts` 覆盖文件字段脱敏和 `profile` 非误伤。

### 5.6 Phase 6 跨画布复制前端入口切片

本轮继续把复制能力接入原 `/workspace/[workspaceId]/w/[workflowId]` 画布外壳，而不是新增独立 `/workbench` 操作面：

- `BlockMenu` 右键菜单新增可选 `Copy to team canvas` / `Copy to personal draft` 动作，保持现有 Popover/spacing/菜单风格。
- 当前 workspace 不是 active workgroup 的团队画布时，默认把 selection 复制到团队画布；当前在团队画布时，默认复制到个人草稿画布。
- 复制动作复用 `useCopySelection`，显式传 source/target canvas type、目标 workspaceId、目标 workflowId、选中 blockIds 和 edgeIds。
- 成功后通知当前用户复制数量；`useCopySelection` 会失效目标 workflow state 和目标 workspace workflow list，让目标画布下一次打开或已订阅视图刷新到新节点。
- 如果没有 active workgroup、没有 alternate canvas，或目标画布还没有节点图，菜单项会 disabled 并给出原因，不在前端绕过后端权限。

仍需继续：

- 目标画布新节点高亮已在分屏 pane 里按 `mappings.blockIds` 接入；普通右键菜单仍只负责复制和缓存刷新，未在原编辑器里自动跳转目标画布。
- Phase 7 分屏工作台需要复用这条 API，而不是再新增一套复制逻辑。

### 5.7 Phase 7 原主界面分屏工作台首个切片

本轮按“保留原 `/workspace/[workspaceId]` shell”的方向继续推进，不再回到独立 `/workbench` 外壳：

- 新增 `/workspace/[workspaceId]/split`，仍然挂在原 `layout.tsx`、原 Sidebar、原 Provider 树下面。
- Sidebar 的 `Canvases` 分组新增 `Split view`，用户在深层页面可以直接进入个人草稿 / 团队画布的并排工作区。
- 分屏页左侧默认加载当前 active workgroup 的个人草稿画布，右侧默认加载团队画布；每侧可以独立选择当前画布内的 workflow。
- 分屏页复用已有 `PreviewWorkflow` 做只读画布预览，避免在第一切片里复制一套完整 ReactFlow 编辑器状态。
- 用户点击任一 pane 的节点后，可以调用既有 `useCopySelection` / `POST /api/workflows/[id]/copy-selection` 把选中节点复制到另一侧画布；复制后使用 `mappings.blockIds` 选中新生成的目标节点。
- 移动端不强制左右双栏，已从上下两 pane 改为单 pane tab：一次只显示 Personal draft 或 Team canvas，切换 tab 会同步复制源 pane，复制成功后自动跳到目标 tab 查看高亮结果。
- 分屏 pane selection 已从单节点扩展为 pane-scoped 多节点数组：普通点击替换当前 pane selection，Shift/Ctrl/Cmd-click 追加或移除节点。
- 分屏复制 payload 会传入当前 pane 的多节点 `blockIds`；服务端仍按 selection 内部合法边复制边，因此多节点之间的连接会随节点一起进入目标画布。
- `PreviewWorkflow` 新增多选高亮输入和节点点击 modifier 信息，保留既有单选 `selectedBlockId` 兼容调用方。
- `PreviewWorkflow` 现在会上报当前预览 viewport；分屏复制会优先计算 source selection bounds 到目标 pane 视口中心的 `placement.offsetX/offsetY`，仅在 viewport 未就绪时回退固定 offset。
- 分屏 pane 已支持显式边选择：点击边会记录 pane-scoped `selectedEdgeIds` 并传给 copy-selection；如果未选边则复制所选节点之间的全部内部合法边，如果选边则只复制两端节点也被选中的连接。
- 复制结果会按 `mappings.blockIds` / `mappings.edgeIds` 同时高亮新节点和新连接，边选择不会在预览里显示编辑器删除按钮。
- 复制结果会把目标 pane 的新节点作为 `focusNodeIds` 传给 `PreviewWorkflow`；等目标 workflow state 刷新出这些节点后，预览会以动画 fit 到复制结果，同时继续上报 viewport 给下一次 placement 使用。
- 分屏 pane 的 viewport 会按 `pane kind + workflowId` 写入本地存储；再次打开同一 pane/workflow 时会优先恢复 x/y/zoom，未保存过的 workflow 才自动 fit。左右 pane 不共享 viewport，避免个人草稿和团队画布 pan/zoom 串线。
- 新增 `split-selection.ts` 和对应测试，覆盖点击替换、多选 toggle、边选择 toggle、复制映射保持源选择顺序和 selection 文案。

本轮同时继续收敛原主界面的画布语义：

- Workspace 下拉进一步变成个人草稿画布切换器，移除其中的邀请成员入口，避免把团队管理操作混进个人草稿切换语义。
- Workspace 下拉在团队画布/展示画布等页面也保持个人草稿切换语义，只列出当前 active workgroup 下的个人草稿，不再把当前团队 workspace 临时塞进下拉列表。
- Home 页和 Sidebar 在解析 active workgroup 时会优先使用当前 workspace 的 `workgroupId`，因此用户切到非默认团队的个人草稿后，三张卡片和左侧团队/展示入口仍指向对应团队。
- Workflow 右键跨画布复制、分屏页和团队管理页也改为优先使用当前 workspace 的 `workgroupId`，避免非默认团队的个人草稿误复制到默认团队或打开默认团队管理。
- 已删除不再使用的 `components/workbench/workbench-shell.tsx`，旧 `/workbench` 路由仅保留兼容 redirect，不再维护独立外壳组件。
- Sidebar `Canvases` 分组增加团队管理员入口 `Team management`，继续复用原设置页承接邀请/成员管理。
- `Published workflows` 从普通 Workspace 分组移除，展示类入口统一收敛到 `Showcase canvas`。
- 团队画布创建从“成员 GET 时懒创建”改为“管理员 POST 初始化”；普通成员只能读取已有团队画布。
- `createWorkgroup` 和管理员初始化团队画布都会创建默认 workflow，避免团队画布没有节点图导致复制目标不可用。

仍需继续：

- 当前分屏第一切片是“只读预览 + 显式复制”，还不是左右两侧完整可编辑 ReactFlow；后续如果要做真正双编辑器，需要拆分 workflow store / selection / viewport 为 pane-scoped 状态。
- 当前复制选择已支持多节点点击、显式边选择、目标 pane 节点/边高亮、viewport-center placement、复制后自动定位动画、pane-scoped zoom/pan 持久化和移动端 tab；框选/触摸选择仍需继续做。
- 团队管理员入口需要继续从通用组织设置页迁出；下一切片先补团队成员/初始化页，Phase 9 再补发布和 Agent Skill 管理。

### 5.8 原 shell 团队管理入口切片

本轮继续把管理员能力从通用组织/workspace 设置页迁回剧场协作语义：

- 新增 `/workspace/[workspaceId]/team-management`，仍然位于原 workspace shell 内，保留 Sidebar 和原 Provider 树。
- Sidebar `Team management` 不再跳到 `settings/organization`，而是进入当前 active workgroup 的团队管理页。
- Sidebar `Canvases` 分组在用户拥有多个 workgroup 时显示轻量团队切换器；切换后会写入 active workgroup，并优先进入目标团队的个人草稿画布，其次进入目标团队画布。
- 普通成员访问团队管理页时只看到权限提示，不能列成员、邀请成员或初始化团队画布。
- 团队管理员可以：
  - 查看当前 workgroup 成员；
  - 通过已存在用户的 email 或 userId 添加成员；
  - 通过 email 发送团队邀请；
  - 查看团队画布 pending invitation 列表；
  - 重发或取消尚未接受的团队邀请；
  - 设置 member/admin 角色；
  - 移除成员；
  - 初始化或打开团队画布；
  - 查看本团队展示发布版本；
  - 归档或撤回本团队展示发布版本。
- 后端 `POST /api/workgroups/[workgroupId]/members` 的 contract 支持 `userId` 或 `email` 两种输入，但仍由服务层统一执行 `assertWorkgroupAdmin`，不会让前端直接决定权限。
- `addWorkgroupMember` 会把 email 解析为已存在用户账号，再写入 `workgroup_member`，如果团队画布已存在则同步 workspace permission。
- 团队邀请复用现有 organization/workspace invitation 邮件链路；接受 team canvas grant 时会自动把用户加入该 workspace 对应的 workgroup。
- 团队管理页复用现有 workspace invitation 查询/取消/重发 hooks，发送邀请后会刷新 pending invitation 列表，避免管理员离开当前 shell 才能确认状态。
- 团队发布管理先接入本团队 publication 列表和生命周期操作，复用 `useShowcasePublications` 与 `useUpdatePublicationLifecycle`，管理员可从原 shell 直接归档/撤回展示版本并跳转到展示画布。
- 团队管理页新增发布创建表单，管理员可选择团队画布内 workflow、填写标题/说明，并选择组织可见或指定团队可见；提交后复用现有 `POST /api/workflows/[id]/publish` 发布快照并刷新本团队展示列表。

### 5.9 Phase 9 Team Agent Skill 绑定切片

本轮继续补团队管理员闭环中的 Agent Skill 管理能力：

- 新增 `GET/PATCH /api/workgroups/[workgroupId]/agent-skills`，路由使用 `collaboration.ts` contract 与 `parseRequest`，并在服务层统一执行 `assertWorkgroupAdmin`。
- `listWorkgroupAgentSkills` 会基于 workgroup 的 discipline agent，列出团队画布 workspace 内的 skills，并合并 `agent_skill_binding` 的 `team_override` enabled 状态。
- `updateWorkgroupAgentSkill` 会校验 skill 必须属于当前团队画布，再 upsert `agent_skill_binding(scope = team_override)`，并写入 `skill.updated` 审计事件。
- `useWorkgroupAgentSkills` 与 `useUpdateWorkgroupAgentSkill` 接入 React Query，更新后精准刷新当前团队的 Agent Skill 列表与 agent profile cache。
- `/workspace/[workspaceId]/team-management` 增加原风格 `Team Agent Skills` 区块，团队管理员可在原 Sidebar 外壳内直接启用/禁用本团队 Copilot Agent 的 skills。

仍需继续：

- 当前团队邀请已覆盖发送、接受后加入 workgroup、pending 列表、取消和重发；后续仍可补更细的错误分类、批量邀请和过期状态视觉。
- Phase 9 仍需补更完整的发布可见范围编辑和管理员闭环；发布创建表单与 Agent Skill 绑定已完成首个可用切片。

### 5.10 Phase 9 团队协作日志切片

本轮继续补齐团队管理员闭环里的协作日志入口，仍然保持在原 `/workspace/[workspaceId]/team-management` 外壳内：

- 新增 `GET /api/workgroups/[workgroupId]/activity`，route 使用 `collaboration.ts` contract 与 `parseRequest`，并在服务层统一执行 `assertWorkgroupAdmin`，普通成员不能读取团队管理日志。
- `listWorkgroupActivity` 从 `audit_log` 中按团队画布 `workspaceId`、`metadata.workgroupId`、`metadata.sourceWorkgroupId` 聚合最近活动，覆盖成员、团队画布初始化、发布生命周期和 Agent Skill 绑定等团队相关事件。
- `addWorkgroupMember`、`updateWorkgroupMemberRole`、`removeWorkgroupMember` 和 `createTeamWorkspace` 开始写入团队上下文 audit metadata，后续团队日志可以看到成员加入、角色调整、移除和团队画布初始化。
- `useWorkgroupActivity` 接入 React Query；成员、团队画布初始化、Agent Skill 更新会精准失效团队活动 query，发布和发布生命周期操作也会在团队管理页刷新活动列表。
- 团队管理页新增原风格 `Team activity` 区块，使用 `var(--bg)`、`var(--surface-*)`、`var(--border)` 和 8px 圆角展示最近活动，不引入新的工作台视觉体系。

仍需继续：

- 协作日志当前聚合 audit 记录，后续可继续补更细的 diff、失败权限拒绝告警、批量邀请和过期邀请状态。

### 5.11 Phase 5 发布可见范围编辑切片

本轮继续收口展示画布发布治理，把“发布时可选可见范围”推进到“发布后可编辑可见范围”：

- 新增 `PATCH /api/publications/[publicationVersionId]/visibility`，route 使用 `collaboration.ts` contract 与 `parseRequest`，并在服务层执行 `assertWorkgroupAdmin`。
- `updatePublicationVisibility` 会同步更新 `workflow_publication_version.visibility` 和对应 published workflow 的 `visibility`，并重建 `workflow_publication_scope`。
- 指定团队可见时，服务层会按同一 organization 校验目标 workgroup，只写入合法团队 scope；组织可见时会清空 scoped viewers。
- 发布列表响应新增 `targetWorkgroupIds`，团队管理页可以回显当前指定团队可见范围。
- 团队管理页 `Team publications` 区块新增可见范围编辑控件：管理员可在 `Organization visible` 与 `Selected teams` 之间切换，并勾选可见团队后保存。
- 可见范围更新写入 `publication.updated` audit 事件，团队活动日志可展示“Updated publication”。
- 可见范围更新后，服务层会对当前可见的其他团队额外写入 `publication.updated` team activity 广播事件，metadata 标记 `publicationBroadcast` 与目标 `workgroupId`。
- 已补 `apps/sim/lib/collaboration/service.test.ts` 和 `apps/sim/app/api/publications/[publicationVersionId]/visibility/route.test.ts`，覆盖非管理员拒绝、跨组织目标团队过滤、组织可见清空 scope、route contract 调用、默认空 target 列表和未登录拒绝。

仍需继续：

- 更完整的全局状态树治理、站内铃铛/邮件级通知、版本回滚和审核流仍是 Phase 5 后续任务。

### 5.12 Phase 5 展示画布全局状态树首版视图

本轮继续把 Phase 5 从“数据形态”推进到“原 shell 可见治理视图”：

- 新增 `apps/sim/lib/collaboration/publication-state-tree.ts`，把 `PublicationSummary` 按工种、来源团队和 Agent 聚合成状态树分组。
- `/workspace/[workspaceId]/showcase` 在原 Sidebar/Provider 外壳内新增 `Publication state tree` 面板，展示每组当前/最新可见版本、历史版本、状态、可见范围和目标团队数量。
- 该面板复用 `useShowcasePublications`，不新增独立 `/workbench` 外壳，也不绕过现有发布可见性过滤。
- 已补 `apps/sim/lib/collaboration/publication-state-tree.test.ts`，覆盖按工种/团队/Agent 分组、当前版本选择、历史版本和 selected team 计数。
- `publicationSummarySchema` 和 `listVisiblePublications` 现在返回可见的 `parentVersionId` / `dependsOnPublicationIds`；若父版本不在当前可见集合中则不泄露 ID。
- 状态树面板会把可见依赖版本展示为 `Depends on vN`，历史版本行也能看到对应父版本链路。
- 已补 `apps/sim/lib/collaboration/service.test.ts`，覆盖展示列表只返回可见 publication dependency link，并继续保留 selected team scope 计数。
- 状态树 helper 新增 governance alert：同一工种/团队/Agent 下多个 `published` 当前版本标记为 danger，缺少当前 `published` 版本或当前版本超过默认 14 天未更新标记为 warning。
- 状态树现在也读取 `reviewState` / `riskLevel`，当前版本未 `approved` 时标黄，`critical` risk 当前版本标红。
- `/workspace/[workspaceId]/showcase` 状态树卡片会以原 shell 风格显示这些治理提示，不新增路由或独立工作台外壳。

仍需继续：

- 状态树已接入首版发布广播事件、历史版本恢复当前能力和审核/风险治理提示；后续仍需要站内铃铛/邮件级通知、reviewer 指派、审批流和恢复前差异预览。

### 5.13 Phase 5 发布广播事件切片

本轮继续把 Phase 5 的“发布通知/广播”先落到可审计的团队活动事件：

- `createPublicationVersion`、`updatePublicationVisibility`、`updatePublicationLifecycleStatus` 在写主团队 audit 后，会按发布当前可见范围解析其他可见团队并写入 `publication.*` 广播 audit。
- 组织可见发布会广播给同组织内除源团队外的团队；指定团队可见发布只广播给合法 scoped viewer；归档/撤回会基于变更前的可见范围通知已有可见团队。
- 广播事件写入目标团队 `teamWorkspaceId`，并在 metadata 中带上 `workgroupId`、`sourceWorkgroupId`、`publishedWorkflowId`、`publicationEvent`、`publicationBroadcast`，因此现有 `GET /api/workgroups/[workgroupId]/activity` 可以直接聚合。
- 已补 `apps/sim/lib/collaboration/service.test.ts`，覆盖可见范围变更后给新可见团队写广播事件，以及 scoped publication 撤回前给 viewer 团队写广播事件。

仍需继续：

- 这只是 audit/team activity 级广播，不是完整站内铃铛、邮件或外部推送；版本回滚、审核流和更细的冲突通知仍需后续 Phase 5 切片。

### 5.14 Phase 5 发布版本恢复 / 回滚切片

本轮继续把 Phase 5 的“可回滚状态树”推进到可操作的首版版本恢复：

- `PATCH /api/publications/[publicationVersionId]` 的 lifecycle action 新增 `restore`，仍复用 contract + `parseRequest`，不新增 route-local schema。
- `updatePublicationLifecycleStatus` 在 `restore` 时会拒绝已撤回版本，要求源团队管理员权限，把同一源 workflow 的其他 `published` 版本标记为 `superseded`，并把目标版本恢复为 `published`。
- 恢复时会把目标 publication 的 immutable `snapshotState` 写回对应 published workflow normalized tables，并同步 published workflow 的标题、说明、可见性、publishedBy、publishedAt、lastSynced。
- 恢复动作写入 `publication.restored` audit，并沿用本轮发布广播机制给当前可见团队写 team activity 事件。
- 团队管理页 `Team publications` 区块新增 `Make current` 操作，管理员可以直接把历史 `superseded` 版本恢复为当前版本。
- 已补 `apps/sim/lib/collaboration/service.test.ts` 与 `apps/sim/app/api/publications/[publicationVersionId]/route.test.ts`，覆盖 route contract 调用、snapshot 写回、当前版本切换、audit 和广播事件。

仍需继续：

- 该切片是“恢复为当前版本”的首版回滚，不是完整审核流；reviewState/riskLevel 管理已在后续切片补齐，恢复前差异预览、站内铃铛/邮件通知和项目级审批仍需继续。

### 5.15 Phase 5 发布审核 / 风险治理切片

本轮继续把 Phase 5 的“审核流”先落到可编辑、可审计的发布版本治理字段：

- 新增 `PATCH /api/publications/[publicationVersionId]/review`，route 复用 `updatePublicationReviewContract` 与 `parseRequest`，并保持登录校验先于 contract parse。
- `apps/sim/lib/api/contracts/collaboration.ts` 新增 `publicationReviewStateSchema`、`publicationRiskLevelSchema`、`UpdatePublicationReviewBody` 和 `PublicationReviewUpdate`，同时让发布列表/详情/状态树响应带上 `reviewState` 与 `riskLevel`。
- `updatePublicationReview` 要求源团队 admin 权限，写入 `reviewState`、`riskLevel`、`lifecycleUpdatedBy`、`lifecycleUpdatedAt`，并记录 `publication.updated` audit metadata（前后 review/risk、source workflow/workgroup、published workflow、`publicationEvent: 'review_updated'`）。
- 团队管理页 `Team publications` 区块新增 review state 与 risk level 下拉控件，支持清空为 `Unreviewed` / `Risk unset`，保存后刷新发布列表和团队 activity。
- 展示画布状态树会显示当前版本的审核/风险状态，并把未 approved 当前版本标为 warning、critical risk 当前版本标为 danger。
- 已补 `apps/sim/app/api/publications/[publicationVersionId]/review/route.test.ts`、`apps/sim/lib/collaboration/service.test.ts` 与 `apps/sim/lib/collaboration/publication-state-tree.test.ts`，覆盖 route contract、清空字段、未登录拒绝、非管理员拒绝、audit 写入和状态树治理提示。

仍需继续：

- 该切片只是审核状态/风险等级的首版治理字段，不是完整审批工作流；后续还需要 reviewer 指派、审批备注历史、恢复前 diff preview、跨团队通知和项目级审批视图。

## 6. 建议继续推进目标

### 6.1 立即继续：收口 Phase 6 前端入口并进入 Phase 7 分屏

建议按小切片继续，不要一次改完：

1. **copy-selection frontend 切片**
   - 复用现有 `useCopySelection`，在画布选中节点后提供“复制到...”动作。
   - 个人草稿默认复制到当前团队画布；团队画布默认复制到个人草稿或分屏另一侧。
   - 成功后按 `mappings.blockIds` 高亮新节点，刷新目标 workflow，并 toast 显示复制数量。

2. **split view workbench 切片**
   - 在原 `/workspace/[workspaceId]` 布局下新增分屏入口，避免回到独立 `/workbench` 外壳。
   - 左右 pane 已独立保存 workflowId、节点/边 selection、目标侧和 pane/workflow 维度 viewport，复制动作显式传 source/target。
   - 移动端已降级为顶部 tab，不强制左右分屏或上下堆叠。

3. **publication state tree 后续切片**
   - 已完成基础串联、状态树元数据、生命周期状态、归档/撤回路由、历史版本恢复、审核/风险字段、审计动作和首版 team activity 广播；后续继续补全站内通知、reviewer 指派、审批流和前端治理操作。
   - 发布版本生命周期已覆盖已发布、替换、归档、撤回；草稿和显式回滚可在管理入口阶段继续细化。
   - 确保发布版本不返回源团队画布的可写 workspace id。

4. **showcase visibility 切片**
   - 发布时写入可见范围，支持当前项目/组织、指定 workgroup 或后续全局状态树节点。
   - 只读详情继续保留原 Sidebar，避免回到独立 `/workbench` 外壳。

5. **审计和回滚切片**
   - 发布、可见范围更新、归档、撤回、恢复当前版本、审核/风险更新已经写 audit；取消发布/替换版本的前端管理入口、审批历史和更完整端到端测试仍待补。
   - 继续给 Phase 5 增加端到端路由/服务测试，验证跨团队只读、源团队可管理、未授权团队不可见和广播行为。

### 6.2 Phase 4 已满足的验收门槛

本轮 Phase 4 收尾已经形成审计表，并逐项记录：

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

本轮收尾已运行或复跑：

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
