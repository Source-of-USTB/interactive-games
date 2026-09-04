import { useEffect, useState } from "react";
import type { ChoiceValue, ProgramSlot, PublicRoundState } from "@codegame/game-core";
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

  if (startupError) return <StatusPage title="暂时无法加入" detail={startupError} />;
  if (!realtime.state) return <StatusPage title="正在连接人类编译器" detail="不需要登录，马上就好…" status={realtime.status} />;

  const state = realtime.state;
  const correctedNow = now + realtime.clockOffset;
  const slot = currentSlot(state);
  const voteOptions = state.currentTally?.options.map((option) => option.value) ?? slot?.options ?? [];
  const isVoteOpen = state.phase === "AUTHORING" && !state.currentTally?.locked && !realtime.session.observerOnly;
  const selectedValue = realtime.session.selectedVote;

  return (
    <main className="join-shell">
      <header className="mobile-header">
        <div>
          <p className="eyebrow">全场一起写代码</p>
          <h1>{state.map.name}</h1>
        </div>
        <ConnectionPill status={realtime.status} />
      </header>

      <section className="mission-card">
        <div className="phase-row">
          <span className="phase-label">{PHASE_LABELS[state.phase]}</span>
          <span className="player-count">{state.connectedPlayers} 人在线</span>
          {state.phaseEndsAt > 0 && <Countdown endsAt={state.phaseEndsAt} clockOffset={realtime.clockOffset} localNow={now} />}
        </div>
        <p>{state.map.mission}</p>
      </section>

      {realtime.session.observerOnly && <section className="waiting-card"><h2>当前为只看模式</h2><p>现场操作位已达安全上限，你仍可同步观看本轮。</p></section>}

      {(state.phase === "JOIN" || state.phase === "EXECUTE") && (
        <MapBoard state={state} now={correctedNow} compact />
      )}

      {isVoteOpen && slot && (
        <section className="action-card" aria-live="polite">
          <p className="step-kicker">程序第 {slot.line} 行</p>
          <h2>{slot.prompt}</h2>
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
                  <span>{choiceLabel(value)}</span>
                  {selected && <small>已提交，可改选</small>}
                </button>
              );
            })}
          </div>
          <p className="look-up">提交后请抬头看大屏</p>
        </section>
      )}

      {state.phase === "AUTHORING" && state.currentTally?.locked && (
        <section className="waiting-card" aria-live="polite">
          <span className="result-glyph">{state.currentTally.winner !== undefined ? choiceGlyph(state.currentTally.winner) : "…"}</span>
          <h2>{state.currentTally.winner !== undefined ? `${choiceLabel(state.currentTally.winner)} 写入程序` : "正在锁定结果"}</h2>
          <p>{state.currentTally.submittedCount} 张有效选票</p>
        </section>
      )}

      {(state.phase === "COMPILE" || state.phase === "EXECUTE") && (
        <section className="program-card">
          <p className="step-kicker">共享程序</p>
          <ProgramPanel state={state} now={correctedNow} />
          <p className="look-up">程序正在大屏上逐行运行</p>
        </section>
      )}

      {(state.phase === "JOIN" || state.phase === "PAUSED") && (
        <section className="waiting-card">
          <div className="waiting-orbit" />
          <h2>{state.phase === "PAUSED" ? "现场暂时暂停" : state.phase === "JOIN" ? "扫码加入，查看本轮任务" : "你已加入本轮"}</h2>
          <p>{state.phase === "PAUSED" ? "大屏恢复后会从安全位置继续" : state.phase === "JOIN" ? "开场结束后会自动进入第一轮投票" : "下一次投票会自动出现在这里"}</p>
        </section>
      )}

      {realtime.daily && (
        <footer className="daily-strip">
          今日已提交 <strong>{realtime.daily.commandsSubmitted}</strong> 条指令 · 修复 <strong>{realtime.daily.bugsFixed}</strong> 个 Bug
        </footer>
      )}

      {realtime.notice && <div className="toast" role="status" onClick={() => realtime.setNotice(undefined)}>{realtime.notice}</div>}

      {tutorialOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
          <div className="tutorial-card">
            <p className="eyebrow">3 秒上手</p>
            <h2 id="tutorial-title">看大屏地图，在手机选下一条指令</h2>
            <div className="tutorial-steps">
              <span><b>1</b> 看机器人朝向</span>
              <span><b>2</b> 选择前进或转向</span>
              <span><b>3</b> 抬头看全场程序运行</span>
            </div>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                localStorage.setItem("codegame.tutorial.seen", "true");
                setTutorialOpen(false);
              }}
            >开始提交指令</button>
          </div>
        </div>
      )}
    </main>
  );
}

function StatusPage({ title, detail, status = "connecting" }: {
  title: string;
  detail: string;
  status?: "connecting" | "open" | "reconnecting" | "closed";
}) {
  return <main className="status-page"><div className="status-core" /><h1>{title}</h1><p>{detail}</p><ConnectionPill status={status} /></main>;
}
