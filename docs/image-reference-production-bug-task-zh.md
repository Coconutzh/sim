# 生产环境图片引用故障修复任务

## 目标

- 修复生产环境中图片缩略图无法显示的问题。
- 修复所有生成能力中的图片引用失效问题。
- 修复 Wan 2.7 首尾帧生成时报 `Failed to download ... /api/files/serve/...` 的问题。
- 修复 Wan 2.6 首帧生成虽成功但未实际使用传入首帧的问题。
- 补充自动化测试，并给出部署配置与上线验证步骤。

## 当前结论

- [x] 确认运行代码目录为 `sim-canonical`，开始排查时工作树干净。
- [x] 报错中的图片地址是带公网 origin 的 `/api/files/serve/...` 绝对 URL。
- [x] `/api/files/serve` 对 workspace 文件要求登录会话或内部服务鉴权。
- [x] 实测无会话访问站内图片返回 HTTP 401；DashScope 无法携带 Sim 登录会话回下载该地址。
- [x] 确认当前进程的 `NEXT_PUBLIC_APP_URL` 和 `BETTER_AUTH_URL` 都是 `http://8.133.178.111:3000`。通过其他域名或 HTTPS 访问时，历史绝对地址会产生跨源、会话 cookie 不匹配或混合内容问题。
- [x] 确认 Wan 2.7 的参数为 `input.media[{ type, url }]`，Wan 2.6 首帧参数为 `input.img_url`，参数名映射正确。
- [x] 根因是 provider 将公网 IP 上的受保护站内 URL 误判成公开图片 URL并交给第三方匿名下载；本地 localhost 则会转 base64，因此只在部署环境复现。

## 修复任务

- [x] 统一规范化前端缩略图 URL，站内文件使用同源相对地址。
- [x] 生成服务读取站内图片时不依赖匿名 HTTP 回下载，改为按当前 workspace 校验文件后从存储层读取并转 base64。
- [x] 保持并验证 Wan 2.6 首帧与 Wan 2.7 首尾帧的正确 provider 参数。
- [x] 覆盖历史数据中已有的绝对站内文件 URL，无需迁移数据库。
- [x] 补齐视频帧缩略图、图片引用标签缩略图的同源 URL 解析。
- [x] 收紧共享站内文件 URL 判定，只按 pathname 识别，避免外部 URL 的 query 偶然包含 `/api/files/serve` 时被误判。
- [x] 添加公网 IP 站内 URL、URL 规范化、workspace 文件边界和跨 workspace 拒绝测试。
- [x] 执行类型检查、媒体相关单测、格式检查和 API 边界审计。

## 验收标准

- [x] 生产域名或反向代理访问时，已上传图片的缩略图正常显示。
- [x] Wan 2.7 同时传入首帧、尾帧后成功生成，且请求中包含两张正确图片。
- [x] Wan 2.6 传入首帧后成功生成，且生成结果使用该首帧。
- [x] 图片编辑、图片参考及其他使用 workspace 图片的能力不再因 `/api/files/serve` 鉴权或 origin 不一致而失效。
- [x] 自动化回归确认新 URL 与历史绝对站内 URL 均被正确处理。

## 验证结果

- [x] 媒体与会话相关测试：9 个测试文件、56 个用例通过。
- [x] 视频 provider、生成服务、路由、文件解析专项测试：7 个测试文件、32 个用例通过。
- [x] `bun run type-check` 通过。
- [x] `bun run check:api-validation` 通过。
- [x] 变更文件 Biome 检查和 `git diff --check` 通过。
- [x] 最终关键回归：6 个测试文件、41 个用例通过。
- [x] 生产环境人工验证通过，用户确认故障已修复。
- [x] 常规版 `sim-canonical` 与 `hermes-agent-sim` 服务已启动并通过内部健康检查；可编辑 PPT 测试服务已停用。

## 部署配置

- [ ] 将 `NEXT_PUBLIC_APP_URL` 设置为用户实际访问的唯一公网 HTTPS origin，例如 `https://sim.example.com`，不要设置成容器地址或与实际入口不同的裸 IP。
- [ ] 将 `BETTER_AUTH_URL` 设置为同一公网 HTTPS origin。
- [ ] 如果保留额外域名或 IP 入口，在 `TRUSTED_ORIGINS` 中显式列出；首选统一跳转到主域名。
- [ ] 反向代理必须转发 `/api/files/serve/*`，并保留 `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto` 和 Cookie。
- [ ] 发布新构建后，用生产登录会话执行下方人工验收。

## 下一步

1. [x] 将本次修复提交并同步到远端 `main`。
2. [ ] 配置正式公网 HTTPS 主域名后，按“部署配置”统一公网 origin 并复验登录与文件访问。
