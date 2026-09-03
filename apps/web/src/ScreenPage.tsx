import { useEffect, useState } from "react";
import { ConnectionPill, Countdown, MapBoard, PHASE_LABELS, ProgramPanel, useClock } from "./game-ui.js";
import { useRealtime } from "./realtime.js";

export function ScreenPage() {
  const [token, setToken] = useState(() => localStorage.getItem("codegame.screen.token") ?? "");
  const [draftToken, setDraftToken] = useState(token);
  const realtime = useRealtime({ role: "screen", token, enabled: Boolean(token) });
  const now = useClock();

  useEffect(() => {
    if (!token || realtime.status !== "open") return;
    const timer = window.setInterval(() => void realtime.send({ type: "screen.ack" }).catch(() => undefined), 2_000);
    return () => window.clearInterval(timer);
  }, [realtime.send, realtime.status, token]);

  if (!token) return <ScreenLogin draft={draftToken} onDraft={setDraftToken} onSubmit={() => {
    localStorage.setItem("codegame.screen.token", draftToken);
    setToken(draftToken);
  }} />;
  if (!realtime.state) return <main className="screen-loading"><div className="status-core" /><h1>正在连接大屏服务</h1><ConnectionPill status={realtime.status} /></main>;

  const state = realtime.state;
  const correctedNow = now + realtime.clockOffset;
  const tally = state.currentTally;
  const maxVotes = Math.max(1, ...(tally?.options.map((option) => option.count) ?? [1]));
  return (
    <main className="screen-shell">
      <header className="screen-header">
        <div><p className="eyebrow">全场一起写代码</p><h1>{state.map.mission}</h1></div>
        <div className="screen-meta"><span>{state.connectedPlayers} 人参与</span><span>{PHASE_LABELS[state.phase]}</span>{state.phaseEndsAt > 0 && <Countdown endsAt={state.phaseEndsAt} clockOffset={realtime.clockOffset} localNow={now} />}</div>
      </header>
      <div className="screen-layout">
        <section className="screen-map-panel">
          <div className="map-title-row"><div><span>第 {state.map.chapter} 章 · 难度 {state.map.difficulty}</span><h2>{state.map.name}</h2></div><div className="energy-meter energy-meter--screen">{[0, 1, 2].map((index) => <span key={index} className={index < state.collaborationEnergy ? "energy-cell energy-cell--on" : "energy-cell"} />)}<small>协作能量</small></div></div>
          <MapBoard state={state} now={correctedNow} />
          {tally && (realtime.settings?.showVoteTrends ?? true) && <div className="vote-bars">
            {tally.options.map((option) => <div className="vote-bar" key={String(option.value)}><span>{typeof option.value === "number" ? `×${option.value}` : { MOVE: "↑ 前进", TURN_LEFT: "↶ 左转", TURN_RIGHT: "↷ 右转" }[option.value]}</span><div><i style={{ width: `${option.count / maxVotes * 100}%` }} /></div><b>{tally.locked ? option.count : ""}</b></div>)}
          </div>}
        </section>
        <aside className="screen-side-panel">
          <div className="qr-card">{realtime.settings?.qrMode !== "hidden" && <img key={realtime.settings?.qrMode} src={`/api/qr.png?mode=${realtime.settings?.qrMode ?? "public"}`} alt="扫码加入游戏" />}<div><strong>{realtime.settings?.qrMode === "hidden" ? "当前为只演示模式" : "扫码提交下一条指令"}</strong><span>{realtime.settings?.qrMode === "local" ? "请先连接现场 Wi-Fi" : "无需下载 · 无需注册"}</span></div></div>
          <section className="screen-program"><div className="panel-heading"><div><p className="eyebrow">共享程序</p><h2>全场正在编译</h2></div></div><ProgramPanel state={state} now={correctedNow} /></section>
          {state.phase === "RESULT" && <div className={`screen-result ${state.score?.missionStar ? "screen-result--success" : ""}`}><h2>{state.resultMessage}</h2><p>{state.map.knowledgePoint}</p>{state.predictionOutcome && <p>有 {state.predictions[state.predictionOutcome]} 位同学预测正确</p>}<div className="screen-stars"><span className={state.score?.missionStar ? "on" : ""}>★ 任务</span><span className={state.score?.algorithmStar ? "on" : ""}>★ 算法</span><span className={state.score?.collaborationStar ? "on" : ""}>★ 协作</span></div></div>}
          {realtime.daily && <div className="screen-daily"><strong>{realtime.daily.participantSessions}</strong> 人次共同提交了 <strong>{realtime.daily.commandsSubmitted}</strong> 条指令</div>}
        </aside>
      </div>
      <ConnectionPill status={realtime.status} />
    </main>
  );
}

function ScreenLogin({ draft, onDraft, onSubmit }: { draft: string; onDraft: (value: string) => void; onSubmit: () => void }) {
  return <main className="admin-login"><section className="admin-login-card"><p className="eyebrow">大屏备用页面</p><h1>输入大屏连接密钥</h1><input type="password" value={draft} onChange={(event) => onDraft(event.target.value)} placeholder="SCREEN_TOKEN" /><button className="primary-button" type="button" onClick={onSubmit}>打开大屏</button></section></main>;
}
