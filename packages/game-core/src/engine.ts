import type {
  ActionCommand,
  Direction,
  ExecutionResult,
  FailureType,
  GameMap,
  MapTile,
  Position,
  Predicate,
  ProgramNode,
  RobotState,
  TraceEvent,
} from "./types.js";

const DIRECTION_ORDER: Direction[] = ["N", "E", "S", "W"];

function cloneState(state: RobotState): RobotState {
  return {
    x: state.x,
    y: state.y,
    direction: state.direction,
    activeSwitches: [...state.activeSwitches],
    collectedChips: [...state.collectedChips],
  };
}

function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

function step(position: Position, direction: Direction): Position {
  if (direction === "N") return { x: position.x, y: position.y - 1 };
  if (direction === "E") return { x: position.x + 1, y: position.y };
  if (direction === "S") return { x: position.x, y: position.y + 1 };
  return { x: position.x - 1, y: position.y };
}

function turn(direction: Direction, amount: -1 | 1): Direction {
  const current = DIRECTION_ORDER.indexOf(direction);
  return DIRECTION_ORDER[(current + amount + DIRECTION_ORDER.length) % DIRECTION_ORDER.length] ?? "N";
}

function tilesAt(map: GameMap, position: Position): MapTile[] {
  return map.tiles.filter((tile) => samePosition(tile, position));
}

function isOutOfBounds(map: GameMap, position: Position): boolean {
  return position.x < 0 || position.y < 0 || position.x >= map.width || position.y >= map.height;
}

function blockedReason(
  map: GameMap,
  state: RobotState,
  target: Position,
  movementDirection: Direction,
): FailureType | undefined {
  if (isOutOfBounds(map, target)) return "OUT_OF_BOUNDS";
  for (const tile of tilesAt(map, target)) {
    if (tile.kind === "WALL") return "COLLISION";
    if (tile.kind === "DOOR" && !state.activeSwitches.includes(tile.switchId)) return "MECHANISM";
    if (tile.kind === "DIRECTION" && tile.direction !== movementDirection) return "MECHANISM";
  }
  return undefined;
}

export function evaluatePredicate(map: GameMap, state: RobotState, predicate: Predicate): boolean {
  if (predicate.kind === "FRONT_BLOCKED") {
    const target = step(state, state.direction);
    return blockedReason(map, state, target, state.direction) !== undefined;
  }
  if (predicate.kind === "SWITCH_ACTIVE") return state.activeSwitches.includes(predicate.switchId);
  return tilesAt(map, state).some(
    (tile) => tile.kind === "COLOR" && tile.color === predicate.tile,
  );
}

export function executeProgram(
  map: GameMap,
  program: ProgramNode[],
  stepLimit = map.maxSteps,
): ExecutionResult {
  let state = cloneState(map.start);
  const trace: TraceEvent[] = [];
  let sequence = 0;
  let actionCount = 0;
  let stopped = false;
  let success = false;
  let failureType: FailureType | undefined;
  let failureLine: number | undefined;

  const emit = (event: Omit<TraceEvent, "sequence">): void => {
    sequence += 1;
    trace.push({ sequence, ...event });
  };

  const fail = (
    type: FailureType,
    line: number,
    label: string,
    before: RobotState,
    slotId?: string,
  ): void => {
    failureType = type;
    failureLine = line;
    stopped = true;
    emit({
      type: "FAILURE",
      sourceLine: line,
      ...(slotId ? { slotId } : {}),
      label,
      before,
      after: cloneState(state),
      durationMs: 700,
      failureType: type,
    });
  };

  const markSuccess = (line: number, before: RobotState, slotId?: string): void => {
    success = true;
    stopped = true;
    emit({
      type: "SUCCESS",
      sourceLine: line,
      ...(slotId ? { slotId } : {}),
      label: "抵达终点",
      before,
      after: cloneState(state),
      durationMs: 900,
    });
  };

  const processLanding = (line: number, slotId?: string, conveyorDepth = 0): void => {
    if (stopped) return;
    if (samePosition(state, map.goal)) {
      markSuccess(line, cloneState(state), slotId);
      return;
    }

    for (const tile of tilesAt(map, state)) {
      if (tile.kind === "CHIP" && !state.collectedChips.includes(tile.id)) {
        const before = cloneState(state);
        state.collectedChips.push(tile.id);
        emit({
          type: "CHIP",
          sourceLine: line,
          ...(slotId ? { slotId } : {}),
          label: "收集能量芯片",
          before,
          after: cloneState(state),
          durationMs: 350,
        });
      }

      if (tile.kind === "SWITCH") {
        const before = cloneState(state);
        const active = state.activeSwitches.includes(tile.id);
        state.activeSwitches = active
          ? state.activeSwitches.filter((id) => id !== tile.id)
          : [...state.activeSwitches, tile.id];
        emit({
          type: "SWITCH",
          sourceLine: line,
          ...(slotId ? { slotId } : {}),
          label: active ? `关闭开关 ${tile.id}` : `激活开关 ${tile.id}`,
          before,
          after: cloneState(state),
          durationMs: 450,
        });
      }
    }

    const conveyor = tilesAt(map, state).find((tile) => tile.kind === "CONVEYOR");
    if (!conveyor || conveyor.kind !== "CONVEYOR" || stopped) return;
    if (conveyorDepth >= 8) {
      fail("MECHANISM", line, "传送带循环异常", cloneState(state), slotId);
      return;
    }
    const before = cloneState(state);
    const target = step(state, conveyor.direction);
    const reason = blockedReason(map, state, target, conveyor.direction);
    if (reason) {
      fail(reason, line, "传送带路径被阻挡", before, slotId);
      return;
    }
    state.x = target.x;
    state.y = target.y;
    emit({
      type: "CONVEYOR",
      sourceLine: line,
      ...(slotId ? { slotId } : {}),
      label: "传送带移动",
      before,
      after: cloneState(state),
      durationMs: 450,
    });
    processLanding(line, slotId, conveyorDepth + 1);
  };

  const executeAction = (
    command: ActionCommand,
    line: number,
    slotId?: string,
    loopIteration?: number,
    loopTotal?: number,
  ): void => {
    if (stopped) return;
    actionCount += 1;
    if (actionCount > stepLimit) {
      fail("STEP_LIMIT", line, "程序执行步数超过限制", cloneState(state), slotId);
      return;
    }

    const before = cloneState(state);
    if (command === "TURN_LEFT" || command === "TURN_RIGHT") {
      state.direction = turn(state.direction, command === "TURN_LEFT" ? -1 : 1);
      emit({
        type: "ACTION",
        sourceLine: line,
        ...(slotId ? { slotId } : {}),
        command,
        label: command === "TURN_LEFT" ? "左转" : "右转",
        before,
        after: cloneState(state),
        durationMs: 400,
        ...(loopIteration ? { loopIteration } : {}),
        ...(loopTotal ? { loopTotal } : {}),
      });
      return;
    }

    const target = step(state, state.direction);
    const reason = blockedReason(map, state, target, state.direction);
    if (reason) {
      const label = reason === "OUT_OF_BOUNDS"
        ? "越界异常"
        : reason === "MECHANISM"
          ? "机关阻止通行"
          : "撞到障碍";
      fail(reason, line, label, before, slotId);
      return;
    }
    state.x = target.x;
    state.y = target.y;
    emit({
      type: "ACTION",
      sourceLine: line,
      ...(slotId ? { slotId } : {}),
      command,
      label: "前进",
      before,
      after: cloneState(state),
      durationMs: 550,
      ...(loopIteration ? { loopIteration } : {}),
      ...(loopTotal ? { loopTotal } : {}),
    });
    processLanding(line, slotId);
  };

  const executeNodes = (
    nodes: ProgramNode[],
    loopIteration?: number,
    loopTotal?: number,
  ): void => {
    for (const node of nodes) {
      if (stopped) break;
      if (node.kind === "action") {
        executeAction(node.command, node.line, node.slotId, loopIteration, loopTotal);
      } else if (node.kind === "loop") {
        for (let iteration = 1; iteration <= node.times && !stopped; iteration += 1) {
          executeNodes(node.body, iteration, node.times);
        }
      } else {
        const before = cloneState(state);
        const conditionValue = evaluatePredicate(map, state, node.predicate);
        emit({
          type: "CONDITION",
          sourceLine: node.line,
          label: conditionValue ? "条件为真" : "条件为假",
          before,
          after: cloneState(state),
          durationMs: 450,
          conditionValue,
        });
        executeNodes(conditionValue ? node.whenTrue : node.whenFalse, loopIteration, loopTotal);
      }
    }
  };

  executeNodes(program);

  if (!stopped) {
    const line = trace.at(-1)?.sourceLine ?? 1;
    failureType = "LOGIC";
    failureLine = line;
    const before = cloneState(state);
    emit({
      type: "FAILURE",
      sourceLine: line,
      label: "程序执行完毕，但尚未到达终点",
      before,
      after: cloneState(state),
      durationMs: 700,
      failureType: "LOGIC",
    });
  }

  const chipIds = map.tiles.filter((tile) => tile.kind === "CHIP").map((tile) => tile.id);
  const result: ExecutionResult = {
    success,
    state: cloneState(state),
    trace,
    executedActionCount: actionCount,
    collectedAllChips: chipIds.every((id) => state.collectedChips.includes(id)),
  };
  if (failureType) result.failureType = failureType;
  if (failureLine !== undefined) result.failureLine = failureLine;
  return result;
}

export function publicMap(map: GameMap) {
  return {
    id: map.id,
    name: map.name,
    chapter: map.chapter,
    difficulty: map.difficulty,
    width: map.width,
    height: map.height,
    start: cloneState(map.start),
    goal: { ...map.goal },
    tiles: map.tiles.map((tile) => ({ ...tile })),
    mission: map.mission,
    knowledgePoint: map.knowledgePoint,
    previewFocus: map.previewFocus.map((position) => ({ ...position })),
  };
}

export function traceDuration(trace: TraceEvent[]): number {
  return trace.reduce((sum, event) => sum + event.durationMs, 0);
}
