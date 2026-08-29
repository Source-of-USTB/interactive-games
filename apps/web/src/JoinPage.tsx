import { useEffect, useMemo, useState } from "react";
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
  if (state.phase === "DEBUG_PATCH" && state.selectedDebugSlot) {
    return state.slots.find((slot) => slot.slotId === state.selectedDebugSlot);
  }
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
  const isPatchOpen = state.phase === "DEBUG_PATCH" && !realtime.session.observerOnly;
  const selectedValue = isPatchOpen ? realtime.session.selectedDebugPatch : realtime.session.selectedVote;

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
        <div className="energy-meter" aria-label={`协作能量 ${state.collaborationEnergy} / 3`}>
          {[0, 1, 2].map((index) => <span key={index} className={index < state.collaborationEnergy ? "energy-cell energy-cell--on" : "energy-cell"} />)}
          <small>协作能量</small>
        </div>
      </section>

      {realtime.session.observerOnly && <section className="waiting-card"><h2>当前为只看模式</h2><p>现场操作位已达安全上限，你仍可同步观看本轮。</p></section>}

      {(state.phase === "BRIEFING" || state.phase === "EXECUTE" || state.phase === "REEXECUTE" || state.phase === "RESULT") && (
        <MapBoard state={state} now={correctedNow} compact />
      )}

      {(isVoteOpen || isPatchOpen) && slot && (
        <section className="action-card" aria-live="polite">
          <p className="step-kicker">{isPatchOpen ? `修复第 ${slot.line} 行` : `程序第 ${slot.line} 行`}</p>
          <h2>{isPatchOpen ? "换成哪条指令？" : slot.prompt}</h2>
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
                    type: isPatchOpen ? "debug.patch.cast" : "vote.cast",
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

      {state.phase === "DEBUG_SELECT" && (
        <section className="action-card">
          <p className="step-kicker">检测到 Bug</p>
          <h2>哪一行最可疑？</h2>
          <ProgramPanel
            state={state}
            now={correctedNow}
            selectable={state.debugCandidateSlots}
            {...(realtime.session.selectedDebugLine ? { selected: realtime.session.selectedDebugLine } : {})}
            onSelect={(slotId) => void submit({ type: "debug.line.cast", slotId })}
          />
          {realtime.session.selectedDebugLine && <p className="selection-confirmation">已选择一行，可在锁票前改选</p>}
        </section>
      )}

      {state.phase === "PREDICT" && (
        <section className="action-card">
          <p className="step-kicker">编译完成</p>
          <h2>这段程序会怎样？</h2>
          <div className="prediction-grid">
            {[
              ["success", "一次成功"],
              ["crash", "会碰撞"],
              ["incomplete", "走不到终点"],
            ].map(([value, label]) => (
              <button
                type="button"
                className={realtime.session.selectedPrediction === value ? "prediction-button prediction-button--selected" : "prediction-button"}
                key={value}
                onClick={() => void submit({ type: "prediction.cast", prediction: value })}
              >{label}</button>
            ))}
          </div>
        </section>
      )}

      {(state.phase === "COMPILE" || state.phase === "EXECUTE" || state.phase === "REEXECUTE") && (
        <section className="program-card">
          <p className="step-kicker">共享程序</p>
          <ProgramPanel state={state} now={correctedNow} />
          <p className="look-up">程序正在大屏上逐行运行</p>
        </section>
      )}

      {state.phase === "RESULT" && <ResultCard state={state} />}

      {(state.phase === "JOIN" || state.phase === "RESET" || state.phase === "PAUSED") && (
        <section className="waiting-card">
          <div className="waiting-orbit" />
          <h2>{state.phase === "PAUSED" ? "现场暂时暂停" : "你已加入本轮"}</h2>
          <p>{state.phase === "PAUSED" ? "大屏恢复后会从安全位置继续" : "下一次投票会自动出现在这里"}</p>
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

function ResultCard({ state }: { state: PublicRoundState }) {
  const score = state.score;
  const stars = useMemo(() => [
    ["任务", score?.missionStar],
    ["算法", score?.algorithmStar],
    ["协作", score?.collaborationStar],
  ] as const, [score]);
  return (
    <section className={`result-card ${score?.missionStar ? "result-card--success" : ""}`}>
      <p className="step-kicker">本轮完成</p>
      <h2>{state.resultMessage}</h2>
      <div className="stars-row">
        {stars.map(([label, active]) => <div key={label} className={active ? "star star--on" : "star"}><span>★</span><small>{label}</small></div>)}
      </div>
      {score && score.badges.length > 0 && <p className="badges">{score.badges.map(badgeLabel).join(" · ")}</p>}
      {state.predictionOutcome && <p className="prediction-result">运行前有 <strong>{state.predictions[state.predictionOutcome]}</strong> 位同学预测正确</p>}
      <p className="knowledge-point">{state.map.knowledgePoint}</p>
      {!score?.missionStar && state.solutionTrace && <p className="look-up">请抬头看大屏：正在回放一个标准解</p>}
    </section>
  );
}

function badgeLabel(value: string): string {
  return {
    FIRST_RUN: "一次过",
    BUG_HUNTER: "Bug 猎人",
    ALL_COMMITTED: "全员提交",
    SHORTEST_PROGRAM: "最短程序",
  }[value] ?? value;
}

function StatusPage({ title, detail, status = "connecting" }: {
  title: string;
  detail: string;
  status?: "connecting" | "open" | "reconnecting" | "closed";
}) {
  return <main className="status-page"><div className="status-core" /><h1>{title}</h1><p>{detail}</p><ConnectionPill status={status} /></main>;
}
