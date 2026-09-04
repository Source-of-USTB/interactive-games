import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  ActionCommand,
  ChoiceValue,
  MapTile,
  Position,
  PublicRoundState,
  RobotState,
  RoundPhase,
} from "@codegame/game-core";

export const COMMAND_LABELS: Record<ActionCommand, string> = {
  MOVE: "前进",
  TURN_LEFT: "左转",
  TURN_RIGHT: "右转",
};

export const COMMAND_GLYPHS: Record<ActionCommand, string> = {
  MOVE: "↑",
  TURN_LEFT: "↶",
  TURN_RIGHT: "↷",
};

export const PHASE_LABELS: Record<RoundPhase, string> = {
  ATTRACT: "等待加入",
  JOIN: "扫码加入 · 查看任务",
  AUTHORING: "全场编程",
  COMPILE: "正在编译",
  EXECUTE: "程序运行",
  PAUSED: "现场暂停",
};

export function choiceLabel(value: ChoiceValue): string {
  if (typeof value === "number") return `重复 ${value} 次`;
  return COMMAND_LABELS[value];
}

export function choiceGlyph(value: ChoiceValue): string {
  if (typeof value === "number") return `×${value}`;
  return COMMAND_GLYPHS[value];
}

export function useClock(interval = 100) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(timer);
  }, [interval]);
  return now;
}

export function Countdown({ endsAt, clockOffset, localNow }: { endsAt: number; clockOffset: number; localNow: number }) {
  const adjustedNow = localNow + clockOffset;
  const remaining = Math.max(0, endsAt - adjustedNow);
  const seconds = Math.ceil(remaining / 1000);
  return <span className={`countdown ${seconds <= 3 ? "countdown--urgent" : ""}`}>{seconds}</span>;
}

function positionKey(position: Position): string {
  return `${position.x}:${position.y}`;
}

function tileVisual(tile: MapTile): { className: string; text: string; label: string } {
  if (tile.kind === "WALL") return { className: "tile--wall", text: "", label: "墙体" };
  if (tile.kind === "CHIP") return { className: "tile--chip", text: "◆", label: "能量芯片" };
  if (tile.kind === "SWITCH") return { className: "tile--switch", text: tile.id, label: `开关 ${tile.id}` };
  if (tile.kind === "DOOR") return { className: "tile--door", text: "▥", label: `门 ${tile.switchId}` };
  if (tile.kind === "CONVEYOR") return { className: "tile--conveyor", text: directionGlyph(tile.direction), label: "传送带" };
  if (tile.kind === "DIRECTION") return { className: "tile--direction", text: directionGlyph(tile.direction), label: "方向地砖" };
  return { className: tile.color === "BLUE" ? "tile--blue" : "tile--yellow", text: "", label: `${tile.color} 地砖` };
}

function directionGlyph(direction: RobotState["direction"]): string {
  return { N: "▲", E: "▶", S: "▼", W: "◀" }[direction];
}

function displayRobot(state: PublicRoundState, now: number): RobotState {
  const trace = state.trace;
  if (state.phase === "EXECUTE" && trace.length > 0) {
    const elapsed = Math.max(0, now - state.phaseStartedAt);
    let cursor = 0;
    let robot = state.map.start;
    for (const event of trace) {
      cursor += event.durationMs;
      if (elapsed < cursor) break;
      robot = event.after;
    }
    return robot;
  }
  return state.map.start;
}

export function MapBoard({ state, now, compact = false }: { state: PublicRoundState; now: number; compact?: boolean }) {
  const robot = displayRobot(state, now);
  const tilesByPosition = useMemo(() => {
    const value = new Map<string, MapTile[]>();
    for (const tile of state.map.tiles) {
      const key = positionKey(tile);
      value.set(key, [...(value.get(key) ?? []), tile]);
    }
    return value;
  }, [state.map.tiles]);

  return (
    <div
      className={`map-board ${compact ? "map-board--compact" : ""}`}
      style={{
        "--map-ratio": `${state.map.width} / ${state.map.height}`,
        gridTemplateColumns: `repeat(${state.map.width}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${state.map.height}, minmax(0, 1fr))`,
      } as CSSProperties}
      role="img"
      aria-label={`${state.map.name} 地图，机器人位于第 ${robot.y + 1} 行第 ${robot.x + 1} 列，朝${{ N: "北", E: "东", S: "南", W: "西" }[robot.direction]}`}
    >
      {Array.from({ length: state.map.width * state.map.height }, (_, index) => {
        const x = index % state.map.width;
        const y = Math.floor(index / state.map.width);
        const key = `${x}:${y}`;
        const tiles = (tilesByPosition.get(key) ?? []).filter((tile) => tile.kind !== "CHIP" || !robot.collectedChips.includes(tile.id));
        const visuals = tiles.map(tileVisual);
        const isGoal = state.map.goal.x === x && state.map.goal.y === y;
        const isRobot = robot.x === x && robot.y === y;
        const activeDoor = tiles.some((tile) => tile.kind === "DOOR" && robot.activeSwitches.includes(tile.switchId));
        const activeSwitch = tiles.some((tile) => tile.kind === "SWITCH" && robot.activeSwitches.includes(tile.id));
        return (
          <div
            key={key}
            className={`map-tile ${visuals.map((visual) => visual.className).join(" ")} ${isGoal ? "tile--goal" : ""} ${activeDoor ? "tile--door-open" : ""} ${activeSwitch ? "tile--switch-active" : ""} ${isRobot ? "tile--occupied" : ""}`}
            aria-label={[...visuals.map((visual) => visual.label), isGoal ? "终点" : undefined, activeDoor ? "门已开启" : undefined, activeSwitch ? "开关已激活" : undefined, isRobot ? "机器人" : undefined].filter(Boolean).join("，")}
          >
            {isGoal && <><span className="goal-core" /><span className="goal-label">终点</span></>}
            {visuals.map((visual, tileIndex) => visual.text && <span key={tileIndex} className={`tile-symbol tile-symbol--${tiles[tileIndex]?.kind.toLowerCase()}`} style={{ "--tile-layer": tileIndex } as CSSProperties}>{visual.text}</span>)}
            {isRobot && <span className="robot" aria-hidden="true"><img src="/assets/robot.webp" alt="" draggable={false} /><span className={`robot-direction robot-direction--${robot.direction}`}>{directionGlyph(robot.direction)}</span></span>}
          </div>
        );
      })}
    </div>
  );
}

function currentTraceLine(state: PublicRoundState, now: number): number | undefined {
  if (state.phase !== "EXECUTE") return undefined;
  const trace = state.trace;
  const elapsed = Math.max(0, now - state.phaseStartedAt);
  let cursor = 0;
  for (const event of trace) {
    cursor += event.durationMs;
    if (elapsed <= cursor) return event.sourceLine;
  }
  return trace.at(-1)?.sourceLine;
}

export function ProgramPanel({ state, now, selectable, selected, onSelect }: {
  state: PublicRoundState;
  now: number;
  selectable?: string[];
  selected?: string;
  onSelect?: (slotId: string) => void;
}) {
  const currentLine = currentTraceLine(state, now);
  const visibleChoices = state.lockedChoices;
  return (
    <div className="program-panel">
      {state.slots.map((slot) => {
        const choice = visibleChoices[slot.slotId];
        const canSelect = selectable?.includes(slot.slotId) ?? false;
        const isSelected = slot.slotId === selected;
        const isWriting = state.phase === "AUTHORING" && state.slots[state.currentSlotIndex]?.slotId === slot.slotId && choice === undefined;
        return (
          <button
            type="button"
            className={`program-line ${slot.line === currentLine ? "program-line--active" : ""} ${isWriting ? "program-line--writing" : ""} ${choice !== undefined ? "program-line--locked" : ""} ${canSelect ? "program-line--selectable" : ""} ${isSelected ? "program-line--selected" : ""}`}
            key={slot.slotId}
            disabled={!canSelect}
            onClick={() => onSelect?.(slot.slotId)}
          >
            <span className="line-number">{String(slot.line).padStart(2, "0")}</span>
            <span className="line-command">{choice === undefined ? isWriting ? "正在选择指令…" : "等待全场选择…" : `${choiceGlyph(choice)} ${choiceLabel(choice)}`}</span>
            {!canSelect && <span className="line-state">{slot.line === currentLine ? "运行中" : isWriting ? "投票中" : choice !== undefined ? "已写入" : "待编写"}</span>}
            {canSelect && <span className="program-line-badge">可疑行</span>}
          </button>
        );
      })}
    </div>
  );
}

export function ConnectionPill({ status }: { status: "connecting" | "open" | "reconnecting" | "closed" }) {
  const label = { connecting: "连接中", open: "已连接", reconnecting: "正在恢复", closed: "未连接" }[status];
  return <span className={`connection-pill connection-pill--${status}`}><span className="connection-dot" />{label}</span>;
}
