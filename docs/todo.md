# 问题清单

## 已修复

- [x] `crypto.randomUUID` 在局域网 HTTP下不可用, 提示 undefined — **`7746798`**
- [x] 127.0.0.1 卡"正在连接人类编译器"(localStorage 里的旧 token 超过 24h / SESSION_SECRET 变更后失效, `ensurePlayerToken`)— **5a9efc4**
- [x] Web 地图格子大小不固定、机器人移动时格子跳动(只设了 `gridTemplateColumns`, 行高默认 `auto` 由内容撑)— **82cbc19**
- [x] **Admin 投票时间设置太短**: 服务端 `updateTimings` 硬钳 `voteMs` 3~10 秒、`briefingMs` 3~12 秒; 默认 `voteMs: 5_000` 太短; 滑条范围窄; 界面没有说明"每步投票"、不显示本关共多少步
- [x] **PREDICT 预测阶段只有 3 秒**(`predictMs: 3_000`)、**DEBUG_SELECT 定位 6 秒**, 过短; admin 面板完全无法调整这两项(`updateTimings` 只接受 `voteMs`/`briefingMs`)
- [x] **DEBUG_SELECT 阶段青色行自动高亮**: `currentTraceLine` 在非执行阶段返回 `execution.failureLine`, 出现莫名奇妙的高亮, 猜测为卡死的行提前显示, 至少不是集成上次的高亮; 并且debug任务可选选项没有提示
- [x] **Godot 程序面板溢出**: 每行固定 `y += 66`, 面板高 452px 只能放约 5 行, 地图指令多时画到底部之外, 与"协作能量"挤一起
- [x] **Godot 浮点显示**: `JSON.parse` 数字全变 float, `str()` 直接拼出 `0.0 人参与`、`第 2.0 章`、`难度 3.0`、今日统计/投票数/预测人数同样问题
- [x]  **玩家端地图显示**：缩小 `/join` 页面的机器人图标，将机器人固定在地块中心，并确保图标不会超出地块边界。
- [x] **占用地块显示**：机器人占用芯片、开关、门等地块时，将地块符号移动到右上角，避免与机器人重叠；未被占用的地块仍保持符号居中。
- [x] **管理端秘钥超时失效**：管理端收到 HTTP 401 或 WebSocket 4401 鉴权失败后，自动清除过期管理密钥并返回密钥输入状态。

## 未修复

- [ ] **UI 丑**