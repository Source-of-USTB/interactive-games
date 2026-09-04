import { useEffect, useState } from "react";
import { choiceGlyph, choiceLabel, ConnectionPill, Countdown, MapBoard, PHASE_LABELS, ProgramPanel, useClock } from "./game-ui.js";
import { useRealtime } from "./realtime.js";

export function ScreenPage() {
  const [token, setToken] = useState(() => localStorage.getItem("codegame.screen.token") ?? "");
  const [draftToken, setDraftToken] = useState(token);
  const [loginError, setLoginError] = useState<string>();
  const realtime = useRealtime({ role: "screen", token, enabled: Boolean(token) });
  const now = useClock();

  useEffect(() => {
    if (!realtime.authInvalid) return;
    localStorage.removeItem("codegame.screen.token");
    setToken("");
    setDraftToken("");
    setLoginError("大屏连接密钥无效或已失效，请重新输入");
  }, [realtime.authInvalid]);

  useEffect(() => {
    if (!token || realtime.status !== "open") return;
    const timer = window.setInterval(() => void realtime.send({ type: "screen.ack" }).catch(() => undefined), 2_000);
    return () => window.clearInterval(timer);
  }, [realtime.send, realtime.status, token]);

  if (!token) return <ScreenLogin draft={draftToken} error={loginError} onDraft={(value) => {
    setDraftToken(value);
    setLoginError(undefined);
  }} onSubmit={() => {
    localStorage.setItem("codegame.screen.token", draftToken);
    setLoginError(undefined);
    setToken(draftToken);
  }} />;
  if (!realtime.state) return <main className="screen-loading"><div className="status-core" /><p className="eyebrow">CROWD CODE / DISPLAY</p><h1>正在连接大屏服务</h1><ConnectionPill status={realtime.status} /></main>;

  const state = realtime.state;
  const correctedNow = now + realtime.clockOffset;
  const tally = state.currentTally;
  const maxVotes = Math.max(1, ...(tally?.options.map((option) => option.count) ?? [1]));
  const lockedCount = state.slots.filter((slot) => state.lockedChoices[slot.slotId] !== undefined).length;
  const lockProgress = state.slots.length > 0 ? lockedCount / state.slots.length * 100 : 0;
  const currentSlot = state.slots[state.currentSlotIndex];
  const isLastSlot = state.currentSlotIndex === state.slots.length - 1;

  return (
    <main className="screen-shell">
      <header className="screen-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">⌘</span>
          <div className="brand-copy"><p className="brand-en">CROWD CODE <span>/ 城市协作终端</span></p><h1 className="brand-title">全场一起写代码</h1></div>
        </div>
        <div className="screen-meta">
          <div className="screen-round"><span className="live-label"><i />{realtime.status === "open" ? "现场协作中" : "等待恢复连接"}</span><strong>{state.connectedPlayers}<small> 人在线</small></strong></div>
          <span className="screen-phase">{PHASE_LABELS[state.phase]}</span>
          {state.phaseEndsAt > 0 && <Countdown endsAt={state.phaseEndsAt} clockOffset={realtime.clockOffset} localNow={now} />}
        </div>
      </header>

      <div className="screen-layout">
        <section className="screen-map-panel" aria-labelledby="map-title">
          <div className="map-title-row">
            <div className="map-heading"><span className="panel-index">{String(state.map.chapter).padStart(2, "0")}</span><div><p className="eyebrow">第 {state.map.chapter} 章 <span>· 难度 {state.map.difficulty}</span></p><h2 id="map-title">{state.map.name}</h2></div></div>
            <span className="live-label"><i />{realtime.status === "open" ? "实时地图" : "等待同步"}</span>
          </div>
          <p className="map-mission"><span>本轮任务</span>{state.map.mission}</p>
          <div className="map-stage"><MapBoard state={state} now={correctedNow} /></div>
          <div className="map-legend" aria-label="地图图例">
            <span><i className="legend-robot" />机器人</span><span><i className="legend-chip" />能量芯片</span><span><i className="legend-goal" />终点</span><span><i className="legend-wall" />障碍物</span>
          </div>
          {tally && (realtime.settings?.showVoteTrends ?? true) && <div className="vote-bars" aria-label="全场投票趋势">
            {tally.options.map((option) => <div className="vote-bar" key={String(option.value)}><span>{choiceGlyph(option.value)} {choiceLabel(option.value)}</span><div><i style={{ width: `${option.count / maxVotes * 100}%` }} /></div><b>{tally.locked ? option.count : ""}</b></div>)}
          </div>}
        </section>

        <aside className="screen-side-panel">
          <div className="qr-card">
            {realtime.settings?.qrMode !== "hidden" && <img key={realtime.settings?.qrMode} src={`/api/qr.png?mode=${realtime.settings?.qrMode ?? "public"}`} alt="扫码加入游戏" />}
            <div><p className="eyebrow">YOUR NEXT MOVE</p><strong>{realtime.settings?.qrMode === "hidden" ? "一起观看程序运行" : "扫码加入，一起编程"}</strong><span>{realtime.settings?.qrMode === "hidden" ? "当前为只演示模式" : realtime.settings?.qrMode === "local" ? "请先连接现场 Wi-Fi" : "无需下载 · 无需注册"}</span><p className="qr-instruction">{realtime.settings?.qrMode === "hidden" ? "跟随机器人，探索科技城" : "你的每一票，都决定机器人的下一步"}</p></div>
          </div>
          <section className="screen-program" aria-labelledby="program-title">
            <div className="panel-heading"><div><p className="eyebrow">COLLECTIVE INTELLIGENCE</p><h2 id="program-title">我们的共享程序</h2></div><span className="program-count">{state.slots.length} 行</span></div>
            <div className="program-filebar"><span className="program-file"><i />program.code</span><span>共同编写 · 实时同步</span></div>
            <ProgramPanel state={state} now={correctedNow} />
            <div className="program-progress"><div><span>指令锁定进度</span><strong>{lockedCount} <small>/ {state.slots.length}</small></strong></div><div className="progress-track" role="progressbar" aria-label="指令锁定进度" aria-valuenow={lockedCount} aria-valuemin={0} aria-valuemax={state.slots.length}><span style={{ width: `${lockProgress}%` }} /></div><p>{state.phase === "AUTHORING" && currentSlot ? tally?.locked ? `第 ${currentSlot.line} 行已锁定，${isLastSlot ? "即将编译程序" : "等待下一条指令"}` : `正在选择第 ${currentSlot.line} 行 · ${tally?.submittedCount ?? 0} 人已提交` : state.phase === "EXECUTE" ? "编译完成，机器人正在执行全场程序" : state.phase === "COMPILE" ? "指令已集结，正在编译程序" : state.phase === "PAUSED" ? "现场已暂停，等待恢复" : "等待大家加入，准备编写第一条指令"}</p></div>
          </section>
          <div className="screen-daily"><span className="live-label"><i />{state.phase === "AUTHORING" ? "每一票，让城市向前一步" : "一个人一条指令，全场一个程序"}</span><span>多数人的选择将写入程序</span></div>
        </aside>
      </div>

      <footer className="screen-footer">
        <div className="energy-summary"><span className="energy-icon" aria-hidden="true">ϟ</span><div><span>今日城市能量</span><strong>{realtime.daily ? realtime.daily.cityEnergy.toLocaleString() : "—"}<small> ENERGY</small></strong></div></div>
        <div className="footer-stat"><strong>{realtime.daily ? realtime.daily.participantSessions.toLocaleString() : "—"}</strong><span>参与人次</span></div>
        <div className="footer-stat"><strong>{realtime.daily ? realtime.daily.commandsSubmitted.toLocaleString() : "—"}</strong><span>已提交指令</span></div>
        <p className="footer-note">一起思考 · 一起编程 · 一起点亮科技城</p>
        <ConnectionPill status={realtime.status} />
      </footer>
    </main>
  );
}

function ScreenLogin({ draft, error, onDraft, onSubmit }: { draft: string; error: string | undefined; onDraft: (value: string) => void; onSubmit: () => void }) {
  return <main className="admin-login"><form className="admin-login-card" onSubmit={(event) => { event.preventDefault(); if (draft) onSubmit(); }}><div className="login-brand"><span className="brand-mark" aria-hidden="true">⌘</span><span>CROWD CODE</span></div><p className="eyebrow">城市协作终端 / DISPLAY</p><h1>连接现场大屏</h1><p>开启全场视角，一起点亮科技城。</p><label className="field-label" htmlFor="screen-token">大屏连接密钥</label><input id="screen-token" type="password" value={draft} onChange={(event) => onDraft(event.target.value)} placeholder="输入大屏连接密钥" autoComplete="current-password" required autoFocus aria-invalid={Boolean(error)} aria-describedby={error ? "screen-login-error" : undefined} />{error && <p id="screen-login-error" className="admin-login-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={!draft}>打开大屏 <span aria-hidden="true">↗</span></button><p className="login-footnote">全场一起写代码 · 现场大屏入口</p></form></main>;
}
