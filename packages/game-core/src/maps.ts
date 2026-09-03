import type {
  ActionCommand,
  ChoiceValue,
  GameMap,
  GameMode,
  MapTile,
  Position,
  ProgramTemplateNode,
  RobotState,
} from "./types.js";

const state = (x: number, y: number, direction: RobotState["direction"]): RobotState => ({
  x,
  y,
  direction,
  activeSwitches: [],
  collectedChips: [],
});

const wall = (x: number, y: number): MapTile => ({ kind: "WALL", x, y });
const chip = (x: number, y: number, id: string): MapTile => ({ kind: "CHIP", x, y, id });
const switchTile = (x: number, y: number, id: string): MapTile => ({ kind: "SWITCH", x, y, id });
const door = (x: number, y: number, switchId: string): MapTile => ({ kind: "DOOR", x, y, switchId });
const conveyor = (x: number, y: number, direction: RobotState["direction"]): MapTile => ({
  kind: "CONVEYOR",
  x,
  y,
  direction,
});
const directionTile = (x: number, y: number, direction: RobotState["direction"]): MapTile => ({
  kind: "DIRECTION",
  x,
  y,
  direction,
});
const colorTile = (x: number, y: number, color: "BLUE" | "YELLOW"): MapTile => ({
  kind: "COLOR",
  x,
  y,
  color,
});

interface SequenceMapSpec {
  id: string;
  name: string;
  chapter: 1 | 2 | 3 | 4;
  difficulty: 1 | 2 | 3 | 4 | 5;
  mode: GameMode[];
  width: number;
  height: number;
  start: RobotState;
  goal: Position;
  commands: ActionCommand[];
  tiles?: MapTile[];
  parSteps?: number;
  knowledgePoint: string;
  mission: string;
  previewFocus?: Position[];
}

function sequenceMap(spec: SequenceMapSpec): GameMap {
  const template: ProgramTemplateNode[] = spec.commands.map((_, index) => ({
    kind: "choice",
    line: index + 1,
    slotId: `s${index + 1}`,
    prompt: `第 ${index + 1} 行写什么？`,
    allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"],
  }));
  const standardChoices: Record<string, ChoiceValue> = {};
  spec.commands.forEach((command, index) => {
    standardChoices[`s${index + 1}`] = command;
  });
  return {
    id: spec.id,
    name: spec.name,
    chapter: spec.chapter,
    difficulty: spec.difficulty,
    mode: [...spec.mode],
    width: spec.width,
    height: spec.height,
    start: spec.start,
    goal: spec.goal,
    tiles: spec.tiles ? [...spec.tiles] : [],
    template,
    standardChoices,
    maxSteps: 16,
    parSteps: spec.parSteps ?? spec.commands.length,
    knowledgePoint: spec.knowledgePoint,
    mission: spec.mission,
    previewFocus: spec.previewFocus ?? [spec.goal],
  };
}

const sequenceMaps: GameMap[] = [
  sequenceMap({
    id: "boot-01-first-route",
    name: "第一次启动",
    chapter: 1,
    difficulty: 1,
    mode: ["COCODE"],
    width: 5,
    height: 5,
    start: state(0, 4, "N"),
    goal: { x: 2, y: 2 },
    commands: ["MOVE", "MOVE", "TURN_RIGHT", "MOVE", "MOVE"],
    tiles: [wall(1, 3), wall(2, 3), wall(3, 3)],
    knowledgePoint: "程序会从第一行开始，按顺序逐行执行。",
    mission: "把小码送到蓝色终点。",
  }),
  sequenceMap({
    id: "boot-02-north-gate",
    name: "北门转弯",
    chapter: 1,
    difficulty: 1,
    mode: ["COCODE"],
    width: 5,
    height: 5,
    start: state(4, 4, "W"),
    goal: { x: 2, y: 1 },
    commands: ["MOVE", "MOVE", "TURN_RIGHT", "MOVE", "MOVE", "MOVE"],
    tiles: [wall(3, 3), wall(1, 2), chip(2, 3, "c1")],
    knowledgePoint: "转向只改变朝向，不会让机器人移动。",
    mission: "经过芯片并抵达北门。",
  }),
  sequenceMap({
    id: "boot-03-east-stairs",
    name: "东侧阶梯",
    chapter: 1,
    difficulty: 1,
    mode: ["COCODE"],
    width: 5,
    height: 4,
    start: state(0, 0, "E"),
    goal: { x: 3, y: 2 },
    commands: ["MOVE", "MOVE", "MOVE", "TURN_RIGHT", "MOVE", "MOVE"],
    tiles: [wall(1, 1), wall(2, 1), wall(4, 1)],
    knowledgePoint: "机器人始终按照当前朝向理解“前进”。",
    mission: "沿上层通道进入终点。",
  }),
  sequenceMap({
    id: "boot-04-south-dock",
    name: "南侧码头",
    chapter: 1,
    difficulty: 2,
    mode: ["COCODE"],
    width: 5,
    height: 4,
    start: state(4, 0, "S"),
    goal: { x: 1, y: 2 },
    commands: ["MOVE", "MOVE", "TURN_RIGHT", "MOVE", "MOVE", "MOVE"],
    tiles: [wall(3, 1), wall(2, 1), chip(3, 2, "c1")],
    knowledgePoint: "同一条前进指令会因朝向不同产生不同结果。",
    mission: "转向西侧码头并完成送达。",
  }),
  sequenceMap({
    id: "boot-05-chip-line",
    name: "芯片连线",
    chapter: 1,
    difficulty: 2,
    mode: ["COCODE"],
    width: 6,
    height: 5,
    start: state(0, 4, "N"),
    goal: { x: 4, y: 2 },
    commands: ["MOVE", "MOVE", "TURN_RIGHT", "MOVE", "MOVE", "MOVE", "MOVE"],
    tiles: [chip(0, 3, "c1"), chip(2, 2, "c2"), wall(1, 3), wall(3, 3), wall(4, 3)],
    knowledgePoint: "一段程序可以连续完成多个子目标。",
    mission: "收集沿途芯片并送到终点。",
  }),
  sequenceMap({
    id: "factory-01-switch-door",
    name: "开关与门",
    chapter: 2,
    difficulty: 2,
    mode: ["COCODE"],
    width: 5,
    height: 5,
    start: state(0, 3, "N"),
    goal: { x: 3, y: 1 },
    commands: ["MOVE", "MOVE", "TURN_RIGHT", "MOVE", "MOVE", "MOVE"],
    tiles: [switchTile(0, 2, "A"), door(2, 1, "A"), wall(1, 2), wall(2, 2)],
    knowledgePoint: "前面的指令可以改变后续指令执行时的环境状态。",
    mission: "踩下开关 A，再通过对应的门。",
    previewFocus: [{ x: 0, y: 2 }, { x: 2, y: 1 }, { x: 3, y: 1 }],
  }),
];

export const GAME_MAPS: GameMap[] = [
  ...sequenceMaps,
];

export function getMapById(id: string): GameMap | undefined {
  return GAME_MAPS.find((map) => map.id === id);
}

export function mapsForMode(mode: GameMode): GameMap[] {
  return GAME_MAPS.filter((map) => map.mode.includes(mode));
}

export function standardChoicesFor(map: GameMap): Record<string, ChoiceValue> {
  return { ...map.standardChoices };
}
