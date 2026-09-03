# 全场一起写代码

方案 C 的正式可运行工程。现场电脑运行唯一权威服务和 Godot 大屏；同学扫码后用手机 Web 投票，管理员用本机 Web 控制台主持。

## 已实现的完整范围

- 11 张常规关和 3 张整点展演关，含顺序、循环、条件、墙、芯片、开关、门、传送带、方向砖和颜色砖。
- 全场共编仅保留 6 张难度 1–2 的基础关，逻辑实验室和三阶段整点核心战保留独立关卡池。
- 匿名签名会话、每空位一票、改选、最后 1 秒锁票、前 60% 隐藏票型、可回放平票裁决、零票标准解。
- 编译、预测、带源码行的确定性执行轨迹、错误分类、选行 + 补丁两步调试、满能量紧急补丁、失败后标准解回放。
- 任务/算法/协作三星、四种徽章、当日科技城聚合进度、自动关卡导演。
- React 手机端、本地管理端、浏览器备用大屏，以及 Godot 4 正式大屏。
- SQLite WAL 检查点恢复、匿名聚合统计和 CSV 导出；WebSocket 断线重连、完整快照、幂等重试和大屏看门狗暂停。
- 公网隧道主入口、本地 Wi-Fi 备入口、Godot 无服务离线演示三级降级。

## 技术拓扑

| 部分 | 技术 | 本机入口 |
|---|---|---|
| 权威服务 | Node.js 24+ / Fastify / WebSocket / SQLite | `:3000` |
| 玩法核心 | TypeScript 纯函数编译器与执行器 | 服务内 |
| 手机/管理/备用大屏 | React 19 / Vite | `/join`, `/admin`, `/screen` |
| 正式大屏 | Godot 4.7，程序化 2D 演出与音效 | 本机窗口/全屏 |
| 公网扫码 | Cloudflare named tunnel | 只转发玩家路由 |

Node.js 决定票数、程序和胜负。Godot 只消费快照与轨迹，不能宣布通关。

## 首次在本电脑启动

环境要求：Node.js 24—26、pnpm 11、Godot 4.x、Linux。当前电脑已安装 Godot 4.7.1。

```bash
./scripts/setup-local.sh
./scripts/start-local.sh
```

`setup-local.sh` 只在 `.env` 不存在时创建密钥和本地 IP 配置，不会覆盖现有配置。`start-local.sh` 依次做现场预检、生产构建、启动服务和 Godot 全屏。

管理端为 `http://127.0.0.1:3000/admin`，密钥在本机 `.env` 的 `ADMIN_TOKEN`。开发时可用 `pnpm dev`。

## 同学是否需要连现场 Wi-Fi

- 公网模式：不需要。手机用自己的校园网或移动数据，二维码指向 `PUBLIC_ORIGIN`。现场电脑必须保持联网且 Cloudflare Tunnel 正常。
- 本地备用模式：需要。管理端把二维码切到“本地 Wi-Fi”，手机连入同一台关闭客户端隔离的路由器。
- 无服务模式：不接收手机。Godot 播放内置演示，现场不会黑屏。

公网隧道需要一次性配置域名和 Cloudflare 凭据，见 [现场运行手册](docs/现场运行手册.md)。完成后用 `./scripts/start-public.sh`。

未配域名时，默认使用不依赖 Cloudflare 的 `./scripts/start-easy-public.sh`。它通过系统自带的 SSH 向 localhost.run 申请免费随机 HTTPS 地址，无需注册或安装客户端；隧道只连接独立的玩家网关，管理页、大屏页、统计和导出均不对外暴露。启动 Godot 前会完整验证健康检查、玩家会话、Bootstrap 和 WebSocket。请保持终端打开，失败时运行 `./scripts/diagnose-easy-public.sh`，日志位于 `runtime/localhost-run.log`。

Cloudflare Quick Tunnel 仅保留为第二备选：`./scripts/start-quick-public.sh`。它的地址同样每次变化，不作为正式活动的稳定入口。

## 开发与验证

```bash
pnpm check                         # 类型、自动测试和生产构建
pnpm start                         # 只运行已构建的服务
pnpm load-test                     # 服务已运行时模拟 100 人逐空位锁票
godot --headless --path apps/godot --quit-after 2
docker compose up --build          # 可选：容器运行 Web/服务端
```

自动测试包括 18 张地图的标准解、编译/执行规则、共编全流程和 Bug 急诊全流程。百人压测会校验每个空位的 100 张有效票、获胜指令、协议序号和 ACK P95。

## 工程目录

```text
packages/game-core/   共享类型、18 张地图、编译器、执行器、自动导演
apps/server/          权威房间、实时协议、SQLite、安全和压测
apps/web/             手机参与端、管理端、浏览器备用大屏
apps/godot/           Godot 正式大屏、地图/轨迹动画、程序高亮、音效、离线演示
scripts/              初始化、预检、本地/公网启动
deploy/               Cloudflare 隧道限路由示例
docs/                 现场手册、网络切换卡、管理快捷表、故障演练
```
