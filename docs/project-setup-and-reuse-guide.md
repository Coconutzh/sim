# Sim 项目拉取、配置与复用操作手册

这份手册面向第一次从 `https://github.com/Coconutzh/sim.git` 拉取项目的协作者，目标是让对方可以完成本地配置、启动服务、复用右侧 Copilot agent 与左侧画布工作流能力。

## 1. 推荐环境

- Git
- Docker Desktop，推荐开启并确认 Docker daemon 已运行
- Bun `1.3.x`
- Node.js `20+`
- PowerShell 7 或 Windows PowerShell
- 可用内存建议 `12GB+`

如果只是想最快启动完整服务，优先使用 Docker Compose。若要改代码和调试前端/后端，使用手动开发模式。

## 2. 拉取项目

```powershell
git clone https://github.com/Coconutzh/sim.git
cd sim
```

后续只在这一个 Git clone 里工作，避免多个本地副本同时占用 `3000` 和 `3002` 端口。

## 3. 快速启动方式：Docker Compose

适合只想运行项目、不做深度开发的人。

```powershell
docker compose -f docker-compose.local.yml up -d --build
```

启动后访问：

- App: `http://localhost:3000`
- Realtime health: `http://localhost:3002/health`

查看状态：

```powershell
docker compose -f docker-compose.local.yml ps
```

停止服务：

```powershell
docker compose -f docker-compose.local.yml down
```

如果需要清空数据库卷重新开始：

```powershell
docker compose -f docker-compose.local.yml down -v
```

## 4. 开发启动方式：本机 Bun + Postgres

适合需要改代码、看热更新、调试 Copilot 行为的人。

### 4.1 安装依赖

```powershell
bun install
bun run prepare
```

### 4.2 启动 Postgres + pgvector

如果本机还没有数据库，可以用 Docker 单独启动：

```powershell
docker run --name simstudio-db `
  -e POSTGRES_PASSWORD=postgres `
  -e POSTGRES_DB=simstudio `
  -p 5432:5432 `
  -d pgvector/pgvector:pg17
```

如果容器已存在但没启动：

```powershell
docker start simstudio-db
```

### 4.3 创建环境变量文件

```powershell
Copy-Item apps/sim/.env.example apps/sim/.env
Copy-Item apps/realtime/.env.example apps/realtime/.env
Copy-Item packages/db/.env.example packages/db/.env
```

至少确认三处数据库 URL 一致：

```text
postgresql://postgres:postgres@localhost:5432/simstudio
```

需要保持一致的共享密钥：

- `BETTER_AUTH_SECRET`
- `INTERNAL_API_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `BETTER_AUTH_URL`

开发调试时可以在 `apps/sim/.env` 和 `apps/realtime/.env` 里启用：

```env
DISABLE_AUTH=true
```

这会绕过登录，适合本地私有调试，不建议用于公开部署。

### 4.4 运行数据库迁移

```powershell
cd packages/db
bun run db:migrate
cd ../..
```

### 4.5 启动开发服务

推荐一条命令同时启动 Next.js 和 realtime：

```powershell
bun run dev:full
```

Windows 也可以用仓库提供的一键脚本：

```powershell
.\start-dev.ps1
```

或双击：

```text
start-dev.cmd
```

访问：

- `http://localhost:3000`
- `http://localhost:3002/health`

## 5. Copilot agent 配置

右侧聊天 agent 有两种工作模式。

### 5.1 远程 Copilot 完整模式

如果有 Sim Copilot key，在 `apps/sim/.env` 设置：

```env
COPILOT_API_KEY=你的_copilot_key
SIM_AGENT_API_URL=https://www.copilot.sim.ai
```

然后重启服务。

这是最完整的 agent 路径，适合复杂自然语言规划、工具调用和更开放的画布编辑。

### 5.2 本地 fallback 模式

当本地启用 `DISABLE_AUTH=true` 且没有 `COPILOT_API_KEY` 时，项目会走本地 fallback。当前本地 fallback 已支持：

- 普通基础聊天，例如“一加一等于几”
- 读取当前画布并描述节点和连线
- 创建“文生图 -> 图生视频”工作流
- 把已有图生视频链路改成“多个分镜图 -> 视频”
- 添加文本生成 Agent 节点
- 生成简单横向或纵向布局 diff，只调整节点 position

如果想让本地 fallback 也具备更开放的模型回答能力，可以配置：

```env
LOCAL_COPILOT_PROVIDER=deepseek
LOCAL_COPILOT_MODEL=deepseek-chat
DEEPSEEK_API_KEY=你的_deepseek_key
```

或：

```env
LOCAL_COPILOT_PROVIDER=openai
LOCAL_COPILOT_MODEL=gpt-4o-mini
OPENAI_API_KEY=你的_openai_key
```

也可以统一使用：

```env
LOCAL_COPILOT_API_KEY=你的_provider_key
```

## 6. 文生图和图生视频配置

如果只是让 agent 创建节点，不一定需要真实媒体 provider key。如果要真正执行图片/视频生成，需要配置对应 key。

图片生成常用：

```env
OPENAI_API_KEY=你的_openai_key
NEXT_PUBLIC_OPENAI_IMAGE_CONFIGURED=true
```

视频生成至少配置一个 provider：

```env
RUNWAY_API_KEY=你的_runway_key
NEXT_PUBLIC_RUNWAY_CONFIGURED=true
```

可选视频 provider：

```env
GEMINI_API_KEY=你的_gemini_key
NEXT_PUBLIC_VEO_CONFIGURED=true

LUMA_API_KEY=你的_luma_key
NEXT_PUBLIC_LUMA_CONFIGURED=true

MINIMAX_API_KEY=你的_minimax_key
NEXT_PUBLIC_MINIMAX_CONFIGURED=true

FAL_API_KEY=你的_fal_key
NEXT_PUBLIC_FAL_CONFIGURED=true
```

改完 `.env` 后必须重启服务。

## 7. 推荐测试提示词

进入任意 workflow 画布后，打开右侧聊天 agent，可以试：

```text
一加一等于几？
```

```text
创建文生图生视频功能
```

```text
描述现在画布内的功能
```

```text
把刚刚实现的功能修改一下，实现文生多个分镜图再生视频
```

```text
添加一个文本生成模型节点
```

```text
把目前画布的布局调整成横向
```

```text
把目前画布的布局调整成纵向
```

画布修改通常会先进入 diff 面板，需要点击 `Accept` 才会应用到当前画布。

## 8. 日常更新流程

别人后续更新仓库后，本地同步：

```powershell
git pull
bun install
cd packages/db
bun run db:migrate
cd ../..
bun run dev:full
```

Windows 可以直接运行：

```powershell
.\update-and-start.ps1
```

或双击：

```text
update-and-start.cmd
```

## 9. 常见问题

### 端口被占用

检查 `3000` 和 `3002`：

```powershell
Get-NetTCPConnection -LocalPort 3000,3002 -State Listen |
  Select-Object LocalPort, OwningProcess
```

结束占用进程：

```powershell
Stop-Process -Id <PID> -Force
```

### 页面还是旧代码

通常是启动了另一个本地副本。检查进程命令行：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -in @('node.exe', 'bun.exe') } |
  Select-Object ProcessId, Name, CommandLine
```

确认命令行路径是当前 clone。

### vLLM/Ollama models 404

这些本地 provider 是可选能力。没有配置对应服务时，模型列表为空是正常的；不影响主应用启动。若要使用：

```env
OLLAMA_URL=http://localhost:11434
VLLM_BASE_URL=http://localhost:8000
VLLM_API_KEY=可选
```

### Copilot 401

远程 Copilot 模式缺少或无效：

```env
COPILOT_API_KEY
```

没有 key 时可以使用本地 fallback，但复杂开放规划能力会弱一些。

### 媒体节点能创建但执行失败

检查是否配置了真实 provider key，例如：

- `OPENAI_API_KEY`
- `RUNWAY_API_KEY`
- `GEMINI_API_KEY`
- `LUMA_API_KEY`
- `MINIMAX_API_KEY`
- `FAL_API_KEY`

## 10. 提交前建议验证

```powershell
bun run check:api-validation
bunx tsc --noEmit --pretty false --project apps/sim/tsconfig.json
```

如果只改 Copilot fallback，可额外运行：

```powershell
cd apps/sim
node ..\..\node_modules\vitest\vitest.mjs run --config vitest.config.ts lib/copilot/request/lifecycle/local-workflow-fallback.test.ts
```

