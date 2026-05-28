# 本地运行命令速查

这个文档只记录日常最容易忘的启动命令。所有命令都在仓库根目录执行：

```powershell
Set-Location E:\project\sim
```

## 生产预览模式

生产预览用于人工验收，内存压力通常比 dev 小。

每次前端代码改动后，先重新构建：

```powershell
bun run preview:build
```

构建成功后，再启动完整本地预览服务：

```powershell
bun run preview:full:local
```

注意：

- `preview:full:local` 只启动上一次构建出来的 `.next` 生产包。
- 它不会自动重新编译源码。
- 如果只跑 `preview:full:local`，你看到的可能还是旧页面。
- 前端代码改完后，正确顺序永远是先 `bun run preview:build`，再 `bun run preview:full:local`。

本地地址：

- 前端：`http://localhost:3000`
- realtime 健康检查：`http://localhost:3002/health`

## Dev 调试模式

dev 模式适合改代码时验证局部交互，支持热更新和更完整的调试信息，但内存占用会更高。

启动完整 dev 服务：

```powershell
bun run dev:full:local
```

只启动前端 dev：

```powershell
cd apps/sim
bun run dev:local
```

只启动 realtime：

```powershell
cd apps/realtime
bun run dev
```

## 什么时候用哪个

- 小改动：优先跑类型检查、格式检查、针对性测试，不一定启动页面。
- 前端入口或交互改动：用 `bun run dev:full:local` 验证一轮。
- 画布完整人工测试：用生产预览，先 `bun run preview:build`，再 `bun run preview:full:local`。
- 大改之后不要长期复用旧 dev 进程，重启一次再验收。

## 常见问题

### 改了代码但页面没变化

如果你用的是生产预览，这是正常的。生产预览不会热更新。

处理方式：

```powershell
bun run preview:build
bun run preview:full:local
```

### 画布右下角一直显示 Reconnecting

先确认 realtime 服务是否正常：

```powershell
Invoke-WebRequest -Uri http://localhost:3002/health -UseBasicParsing
```

如果 health 正常，但生产预览页面仍然 reconnecting，检查 `apps/sim/.env` 是否包含：

```env
NEXT_PUBLIC_SOCKET_URL=http://localhost:3002
```

修改 `.env` 后需要重启 `bun run preview:full:local`。如果刚修改过前端代码，也需要先重新跑 `bun run preview:build`。
