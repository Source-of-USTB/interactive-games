import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  compileProgram,
  executeProgram,
  publicMap,
  type GameMap,
  type PublicRoundState,
} from "@codegame/game-core";
import { choiceGlyph, choiceLabel, MapBoard, PHASE_LABELS } from "./game-ui.js";

describe("participant-facing labels", () => {
  it("always pairs action commands with a glyph and Chinese text", () => {
    expect(choiceGlyph("MOVE")).toBe("↑");
    expect(choiceLabel("MOVE")).toBe("前进");
    expect(choiceGlyph("TURN_LEFT")).toBe("↶");
    expect(choiceLabel("TURN_LEFT")).toBe("左转");
    expect(choiceGlyph("TURN_RIGHT")).toBe("↷");
    expect(choiceLabel("TURN_RIGHT")).toBe("右转");
  });

  it("renders loop choices and every state without an empty label", () => {
    expect(choiceGlyph(4)).toBe("×4");
    expect(choiceLabel(4)).toBe("重复 4 次");
    expect(Object.values(PHASE_LABELS).every((label) => label.length > 0)).toBe(true);
  });
});

// One route exercises stacked collectibles, a linked door, and an in-place turn.
const mechanismMap: GameMap = {
  id: "render-mechanisms",
  name: "机关显示测试",
  chapter: 2,
  difficulty: 2,
  mode: ["COCODE"],
  width: 3,
  height: 2,
  start: { x: 0, y: 1, direction: "E", activeSwitches: [], collectedChips: [] },
  goal: { x: 2, y: 0 },
  tiles: [
    { kind: "SWITCH", id: "A", x: 1, y: 1 },
    { kind: "CHIP", id: "chip-a", x: 1, y: 1 },
    { kind: "DOOR", switchId: "A", x: 2, y: 1 },
  ],
  template: [
    { kind: "fixed", line: 1, command: "MOVE" },
    { kind: "fixed", line: 2, command: "MOVE" },
    { kind: "fixed", line: 3, command: "TURN_LEFT" },
    { kind: "fixed", line: 4, command: "MOVE" },
  ],
  standardChoices: {},
  maxSteps: 8,
  mission: "经过芯片和开关，穿过门后左转抵达终点。",
  knowledgePoint: "机关状态由执行轨迹驱动。",
  previewFocus: [],
};

function executionState(): PublicRoundState {
  const compiled = compileProgram(mechanismMap.template, {}, mechanismMap.maxSteps);
  const execution = executeProgram(mechanismMap, compiled.program);
  expect(compiled.ok).toBe(true);
  expect(execution.success).toBe(true);
  return {
    roomId: "test-room",
    roundId: "test-round",
    mode: "COCODE",
    phase: "EXECUTE",
    phaseStartedAt: 10_000,
    phaseEndsAt: 20_000,
    serverNow: 10_000,
    connectedPlayers: 1,
    map: publicMap(mechanismMap),
    slots: compiled.slots,
    currentSlotIndex: 0,
    lockedChoices: {},
    trace: execution.trace,
  };
}

function renderMap(state: PublicRoundState, now = state.phaseStartedAt): string {
  return renderToStaticMarkup(createElement(MapBoard, { state, now }));
}

function mapCells(markup: string): string[] {
  return markup.match(/<div class="map-tile\b[^>]*>.*?<\/div>/gs) ?? [];
}

describe("map rendering follows authoritative execution", () => {
  it("shows the switch and chip together when they occupy one cell", () => {
    const state = executionState();
    const markup = renderMap({ ...state, phase: "JOIN" });
    const stackedCell = mapCells(markup).find((cell) => cell.includes('aria-label="开关 A，能量芯片"'));

    expect(stackedCell).toBeDefined();
    expect(stackedCell).toContain(">A</span>");
    expect(stackedCell).toContain("◆</span>");
  });

  it("removes a collected chip and keeps the robot visible inside its opened door", () => {
    const state = executionState();
    const doorEntry = state.trace.findIndex((event) => event.type === "ACTION" && event.after.x === 2);
    expect(doorEntry).toBeGreaterThanOrEqual(0);
    const elapsed = state.trace.slice(0, doorEntry + 1).reduce((sum, event) => sum + event.durationMs, 0);
    const markup = renderMap(state, state.phaseStartedAt + elapsed);
    const doorCell = mapCells(markup).find((cell) => cell.includes('aria-label="门 A，门已开启，机器人"'));

    expect(markup).not.toContain("◆</span>");
    expect(markup).not.toContain("能量芯片");
    expect(markup).toContain("开关 A，开关已激活");
    expect(doorCell).toBeDefined();
    expect(doorCell).toContain('src="/assets/robot.webp"');
    expect(doorCell).toContain("▶</span>");
    expect(markup.match(/<img /g)).toHaveLength(1);
  });

  it("updates the accessible direction only when the turn has completed", () => {
    const state = executionState();
    const turnIndex = state.trace.findIndex((event) => event.command === "TURN_LEFT");
    expect(turnIndex).toBeGreaterThanOrEqual(0);
    const turnEndsAt = state.phaseStartedAt
      + state.trace.slice(0, turnIndex + 1).reduce((sum, event) => sum + event.durationMs, 0);

    expect(renderMap(state, turnEndsAt - 1)).toContain("机器人位于第 2 行第 3 列，朝东");
    const afterTurn = renderMap(state, turnEndsAt);
    expect(afterTurn).toContain("机器人位于第 2 行第 3 列，朝北");
    expect(afterTurn).toContain("▲</span>");
  });
});
