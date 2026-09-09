# 问题清单

## 已修复

- [x] **局域网 HTTP 下无法使用 `crypto.randomUUID`**（调用时返回 `undefined`）— **`7746798`**
- [x] **127.0.0.1 卡在“正在连接人类编译器”**（`localStorage` 中的旧 token 超过 24 小时或 `SESSION_SECRET` 变更后失效，`ensurePlayerToken` 未能恢复）— **`5a9efc4`**
- [x] **Web 地图格子大小不固定，机器人移动时格子跳动**（只设置了 `gridTemplateColumns`，行高默认由内容撑开）— **`82cbc19`**
- [x] **Admin 投票时间设置太短**（服务端 `updateTimings` 将 `voteMs` 限制在 3～10 秒、`briefingMs` 限制在 3～12 秒；默认 `voteMs: 5_000`；滑条范围过窄；界面未说明“每步投票”，也未显示本关总步数）— **`a3fa46f`**；后续 `BRIEFING` 已并入 `JOIN` — **`d069d32`**
- [x] **PREDICT 预测阶段和 DEBUG_SELECT 定位阶段过短**（`predictMs: 3_000`、定位阶段 6 秒；Admin 面板无法调整这两项，`updateTimings` 只接受 `voteMs` 和 `briefingMs`）— **`a3fa46f`**；后续 `DEBUG_SELECT` 与 `PREDICT` 分别被移除 — **`11e1124`**、**`7c503b6`**
- [x] **DEBUG_SELECT 阶段青色行自动高亮**（`currentTraceLine` 在非执行阶段返回 `execution.failureLine`，导致疑似卡死的行被提前显示；Debug 任务可选项也没有提示）— **`f86ca5b`**；后续 Debug 玩法被移除 — **`11e1124`**
- [x] **Godot 程序面板溢出**（每行固定 `y += 66`，452 px 高的面板只能显示约 5 行，地图指令较多时会超出底部并挤压“协作能量”）— **`ce62684`**；后续“协作能量”被移除 — **`7c503b6`**
- [x] **Godot 数字显示为浮点数**（`JSON.parse` 将数字解析为 float，直接调用 `str()` 会显示 `0.0 人参与`、`第 2.0 章`、`难度 3.0` 等文本）— **`10968f5`**
- [x] **玩家端机器人图标过大且未固定在地块中心**（机器人可能超出 `/join` 页面的地图格子）— **`ffe8757`**
- [x] **机器人遮挡所占地块的符号**（芯片、开关、门等符号与机器人均显示在地块中央）— **`ffe8757`**
- [x] **管理端密钥失效后仍停留在面板**（收到 HTTP 401 或 WebSocket 4401 后未清除过期密钥并返回输入状态）— **`1972874`**
- [x] **投票变化向玩家端广播无用状态快照**（`vote-cast` 原本以最高 40 Hz 向所有客户端发送包含 `currentTally` 的完整 `state.snapshot`；现保留 Godot 展示端和管理员的合并广播，玩家自己的选择通过 ACK 确认）— **`0056741`**
- [x] **投票截止前 1 秒无法提交**（服务端原本提前拒绝投票并提示“本步已经锁票”；现持续接受投票直至截止时刻，截止后提示“投票已结束”）— **`f4b65cd`**
- [x] **Godot 正式大屏左侧海报不显示**（新素材 `poster.png` 缺 `.import` 登记文件且从未导入，`ui.texture()` 加载失败返回 null；setup 的导入只在 `.env` 缺失时执行一次）— `start-local.sh` 每次启动前统一执行 Godot 导入 **`594bbca`**；`poster.png.import` 入库 **`f8223c2`**
- [x] **Godot 大屏海报被撑大到屏外（左上准、右下溢出）**（`TextureRect` 先赋 `texture` 会被钳制为图片原生尺寸 1061×1500，之后再设 `expand_mode`/`size` 均无效；需先设 `expand_mode = EXPAND_IGNORE_SIZE` 与目标尺寸，最后才赋 texture）— **`4d1404e`**
- [x] **`pnpm load-test` 报 "Timed out waiting for welcome snapshot"**（脚本用默认 development 密钥签 token，而服务端以 `.env` 的随机 `SESSION_SECRET` 校验，失败即关闭连接、不发 welcome；现脚本自动加载仓库 `.env` 的 `SESSION_SECRET`/`ADMIN_TOKEN`，找不到才回退默认值）— **`cd68c60`**
- [x] **百人同时扫码加入时部分玩家被限流**（`POST /api/session` 原本按 IP 限 60 次/分钟、全局 600 次/分钟，现场共用同一出口 IP 时 100 并发约 40 个 HTTP 429；上限改为 `.env` 可配的 `SESSION_RATE_PER_IP`（默认 600）与 `SESSION_RATE_GLOBAL`（默认 6000），按 300 人场次放宽）— **`ce2705f`**

## 未修复

- [ ] **UI 丑**（具体页面、视觉问题和验收标准待补充）
- [ ] **成功/失败提示**（程序执行结束后短暂显示明确的成功或失败提示，再自动进入下一关；不恢复预测、三星评分或独立结算阶段）
