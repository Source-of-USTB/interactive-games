import { useEffect, useRef, useState } from "react";
import type { ProgramSlot, PublicRoundState } from "@codegame/game-core";
import { ensurePlayerToken, useRealtime } from "./realtime.js";
import {
  choiceGlyph,
  choiceLabel,
  ConnectionPill,
  Countdown,
  MapBoard,
  PHASE_LABELS,
  ProgramPanel,
  useClock,
} from "./game-ui.js";

function currentSlot(state: PublicRoundState): ProgramSlot | undefined {
  return state.slots[state.currentSlotIndex];
}

export function JoinPage() {
  const [token, setToken] = useState<string>();
  const [startupError, setStartupError] = useState<string>();
  const [tutorialOpen, setTutorialOpen] = useState(() => localStorage.getItem("codegame.tutorial.seen") !== "true");
  const [busy, setBusy] = useState(false);
  const helpButton = useRef<HTMLButtonElement>(null);
  const realtime = useRealtime(token
    ? { role: "player", token, enabled: true }
    : { role: "player", enabled: false });
  const now = useClock();

  useEffect(() => {
    ensurePlayerToken().then(setToken).catch((error: unknown) => {
      setStartupError(error instanceof Error ? error.message : "无法加入游戏");
    });
  }, []);

  const submit = async (message: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    realtime.setNotice(undefined);
    try {
      await realtime.send(message);
      if ("vibrate" in navigator) navigator.vibrate(35);
    } catch (error) {
      realtime.setNotice(error instanceof Error ? error.message : "提交失败");
    } finally {
      setBusy(false);
    }
  };

  const closeTutorial = (): void => {
    localStorage.setItem("codegame.tutorial.seen", "true");
    setTutorialOpen(false);
    helpButton.current?.focus();
  };

  if (startupError) return <StatusPage title="暂时无法加入" detail={startupError} />;
  if (!realtime.state) return <StatusPage title="正在接入科技城" detail="正在连接现场，马上就好…" status={realtime.status} />;

  const state = realtime.state;
  const correctedNow = now + realtime.clockOffset;
  const slot = currentSlot(state);
  const voteOptions = state.currentTally?.options.map((option) => option.value) ?? slot?.options ?? [];
  const isVoteOpen = state.phase === "AUTHORING" && !state.currentTally?.locked && !realtime.session.observerOnly;
  const selectedValue = realtime.session.selectedVote;
  const activePhase = state.phase === "PAUSED" ? state.previousPhase : state.phase;
  const phaseStep = activePhase === "AUTHORING" ? 1 : activePhase === "COMPILE" || activePhase === "EXECUTE" ? 2 : 0;
  const hasSubmitted = selectedValue !== undefined;
  const isLastSlot = state.currentSlotIndex === state.slots.length - 1;

  return (
    <main className="join-shell">
      <header className="mobile-header">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">⌘</span><div className="brand-copy"><p className="brand-en">CROWD CODE</p><h1 className="brand-title">全场一起写代码</h1></div></div>
        <div className="mobile-tools"><ConnectionPill status={realtime.status} /><button ref={helpButton} className="help-button" type="button" onClick={() => setTutorialOpen(true)} aria-label="查看玩法说明">?</button></div>
      </header>

      <section className="mission-card" aria-labelledby="mission-title">
        <div className="mobile-mission-heading"><span className="mission-label">MISSION {String(state.map.chapter).padStart(2, "0")}</span><span className="mission-difficulty">难度 {state.map.difficulty}</span></div>
        <h2 id="mission-title">{state.map.name}</h2>
        <p>{state.map.mission}</p>
        <div className="phase-row">
          <span className="phase-label">{PHASE_LABELS[state.phase]}</span>
          <span className="player-count"><i />{state.connectedPlayers} 人在线</span>
          {state.phaseEndsAt > 0 && <Countdown endsAt={state.phaseEndsAt} clockOffset={realtime.clockOffset} localNow={now} />}
        </div>
      </section>

      <ol className="phase-steps" aria-label="本轮进度">
        {["加入任务", "选择指令", "执行程序"].map((label, index) => <li className={`${index === phaseStep ? "phase-step--active" : ""} ${index < phaseStep ? "phase-step--done" : ""}`} aria-current={index === phaseStep ? "step" : undefined} key={label}><b>{index < phaseStep ? "✓" : String(index + 1).padStart(2, "0")}</b><span>{label}</span></li>)}
      </ol>

      {realtime.session.observerOnly && <section className="waiting-card"><p className="step-kicker">观众席已就绪</p><h2>当前为只看模式</h2><p>现场操作位已达安全上限，你仍可同步观看本轮。</p></section>}

      {(state.phase === "JOIN" || state.phase === "ATTRACT" || state.phase === "EXECUTE") && (
        <section className="mobile-map-panel" aria-label="任务地图">
          <div className="map-title-row"><p className="eyebrow">城市探索地图</p><span className="live-label"><i />{realtime.status === "open" ? "实时同步" : "等待同步"}</span></div>
          <MapBoard state={state} now={correctedNow} compact />
          <div className="map-legend"><span><i className="legend-robot" />机器人</span><span><i className="legend-chip" />能量芯片</span><span><i className="legend-goal" />终点</span><span><i className="legend-wall" />障碍物</span></div>
        </section>
      )}

      {isVoteOpen && slot && (
        <section className="action-card" aria-live="polite">
          <div className="action-heading"><p className="step-kicker">编写第 <b>{String(slot.line).padStart(2, "0")}</b> 行</p><span className="submission-status">{busy ? "正在提交…" : hasSubmitted ? "✓ 选择已提交" : "等待你的选择"}</span></div>
          <h2>{slot.prompt}</h2>
          <p className="action-description">一起决定机器人的下一步，多数票将写入程序。</p>
          <div className="choice-grid">
            {voteOptions.map((value) => {
              const selected = selectedValue === value;
              return (
                <button
                  className={`choice-button ${selected ? "choice-button--selected" : ""}`}
                  type="button"
                  key={`${typeof value}:${String(value)}`}
                  disabled={busy || realtime.status !== "open"}
                  aria-pressed={selected}
                  onClick={() => void submit({
                    type: "vote.cast",
                    slotId: slot.slotId,
                    value,
                  })}
                >
                  <span className="choice-glyph">{choiceGlyph(value)}</span>
                  <span className="choice-label">{choiceLabel(value)}</span>
                  <span className="choice-shortcut">{typeof value === "number" ? `REPEAT ×${value}` : { MOVE: "MOVE", TURN_LEFT: "TURN LEFT", TURN_RIGHT: "TURN RIGHT" }[value]}</span>
                  {selected && <small>✓ 已提交，可改选</small>}
                </button>
              );
            })}
          </div>
          <p className="look-up">{hasSubmitted ? "选择已收到，抬头看看全场的决定" : "点击即可提交 · 锁票前可改选"}</p>
        </section>
      )}

      {state.phase === "AUTHORING" && state.currentTally?.locked && (
        <section className="waiting-card result-card" aria-live="polite">
          <p className="step-kicker">全场的共同选择</p>
          <span className="result-glyph">{state.currentTally.winner !== undefined ? choiceGlyph(state.currentTally.winner) : "…"}</span>
          <h2>{state.currentTally.winner !== undefined ? `${choiceLabel(state.currentTally.winner)} 写入程序` : "正在锁定结果"}</h2>
          <p>{state.currentTally.submittedCount} 张有效选票 · {isLastSlot ? "即将编译程序" : "下一条指令即将开始"}</p>
        </section>
      )}

      {(state.phase === "COMPILE" || state.phase === "EXECUTE") && (
        <section className="program-card">
          <div className="program-filebar"><span className="program-file"><i />program.code</span><span>我们的共享程序</span></div>
          <ProgramPanel state={state} now={correctedNow} />
          <p className="look-up">{state.phase === "COMPILE" ? "正在编译，机器人即将出发" : "程序正在大屏上逐行运行"}</p>
        </section>
      )}

      {(state.phase === "JOIN" || state.phase === "ATTRACT" || state.phase === "PAUSED") && (
        <section className="waiting-card welcome-card">
          <img className="welcome-robot" src="/assets/robot.webp" alt="科技城机器人" />
          <div className="welcome-copy"><p className="step-kicker">{state.phase === "PAUSED" ? "任务暂歇" : "城市协作计划 · 已就位"}</p><h2>{state.phase === "PAUSED" ? "现场暂时暂停" : "你好，城市共建者"}</h2><p>{state.phase === "PAUSED" ? "大屏恢复后会从安全位置继续。" : "机器人准备好了！投票开始后，和全场一起为它选择下一条指令。"}</p></div>
        </section>
      )}

      {realtime.daily && (
        <footer className="daily-strip"><span>今日已汇集 <strong>{realtime.daily.commandsSubmitted.toLocaleString()}</strong> 条指令</span><span>一起点亮科技城 <b aria-hidden="true">✧</b></span></footer>
      )}

      {realtime.notice && <div className="toast" role="status" onClick={() => realtime.setNotice(undefined)}>{realtime.notice}</div>}
      {tutorialOpen && <Tutorial onClose={closeTutorial} />}
    </main>
  );
}

function Tutorial({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    startButton.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  return <div className="modal-backdrop" role="presentation">
    <div className="tutorial-card" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="tutorial-title" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      const first = buttons?.[0];
      const last = buttons?.[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <button type="button" className="tutorial-close" onClick={onClose} aria-label="关闭玩法说明">×</button>
      <img className="tutorial-robot" src="/assets/robot.webp" alt="" />
      <p className="eyebrow">WELCOME TO CROWD CODE</p>
      <h2 id="tutorial-title">一条指令，<br />一起点亮科技城。</h2>
      <p className="tutorial-intro">你与全场观众，将共同编写机器人的冒险程序。</p>
      <div className="tutorial-steps"><span><b>01</b><span>观察地图<small>看清机器人朝向和任务终点</small></span></span><span><b>02</b><span>投出你的选择<small>选择前进、转向或重复次数</small></span></span><span><b>03</b><span>见证全场的决定<small>抬头看大屏，程序即将运行</small></span></span></div>
      <button ref={startButton} type="button" className="primary-button" onClick={onClose}>准备好了，加入任务 <span aria-hidden="true">↗</span></button>
      <p className="tutorial-footnote">无需编程经验，每个选择都算数</p>
    </div>
  </div>;
}

function StatusPage({ title, detail, status = "connecting" }: {
  title: string;
  detail: string;
  status?: "connecting" | "open" | "reconnecting" | "closed";
}) {
  return <main className="status-page"><div className="status-core" /><p className="eyebrow">CROWD CODE / 城市协作终端</p><h1>{title}</h1><p>{detail}</p><ConnectionPill status={status} /></main>;
}
