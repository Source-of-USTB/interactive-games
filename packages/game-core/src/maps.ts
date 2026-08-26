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
  const buggyChoices = { ...standardChoices };
  const firstMove = spec.commands.findIndex((command) => command === "MOVE");
  if (firstMove >= 0) buggyChoices[`s${firstMove + 1}`] = "TURN_LEFT";

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
    buggyChoices,
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
    mode: ["COCODE", "BUG_CLINIC"],
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
    mode: ["COCODE", "BUG_CLINIC"],
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
    mode: ["COCODE", "BUG_CLINIC"],
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
    mode: ["COCODE", "BUG_CLINIC"],
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
    mode: ["COCODE", "BUG_CLINIC"],
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
    mode: ["COCODE", "BUG_CLINIC"],
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
  sequenceMap({
    id: "factory-02-return-switch",
    name: "回路开关",
    chapter: 2,
    difficulty: 3,
    mode: ["COCODE", "BUG_CLINIC"],
    width: 5,
    height: 5,
    start: state(4, 4, "W"),
    goal: { x: 2, y: 1 },
    commands: ["MOVE", "MOVE", "TURN_RIGHT", "MOVE", "MOVE", "MOVE"],
    tiles: [switchTile(3, 4, "B"), door(2, 2, "B"), wall(3, 3), wall(1, 3)],
    knowledgePoint: "程序状态会被保留，直到后续指令使用它。",
    mission: "激活开关 B，穿过中央门。",
  }),
  sequenceMap({
    id: "factory-03-conveyor",
    name: "传送带初体验",
    chapter: 2,
    difficulty: 3,
    mode: ["COCODE", "BUG_CLINIC"],
    width: 6,
    height: 5,
    start: state(0, 3, "N"),
    goal: { x: 4, y: 2 },
    commands: ["MOVE", "TURN_RIGHT", "MOVE", "MOVE", "MOVE"],
    tiles: [conveyor(0, 2, "E"), wall(0, 1), wall(2, 3), wall(3, 3)],
    knowledgePoint: "环境事件也属于执行轨迹，但不会改变程序行数。",
    mission: "借助传送带进入横向通道。",
  }),
  sequenceMap({
    id: "factory-04-cross-belt",
    name: "交叉传送",
    chapter: 2,
    difficulty: 3,
    mode: ["COCODE", "BUG_CLINIC"],
    width: 6,
    height: 4,
    start: state(4, 0, "S"),
    goal: { x: 1, y: 2 },
    commands: ["MOVE", "TURN_RIGHT", "MOVE", "MOVE", "TURN_LEFT", "MOVE"],
    tiles: [conveyor(4, 1, "W"), chip(2, 1, "c1"), wall(0, 1), wall(3, 2)],
    knowledgePoint: "执行环境事件后，机器人仍保留原来的朝向。",
    mission: "利用传送带横移，再转入终点。",
  }),
  sequenceMap({
    id: "factory-05-powered-hall",
    name: "动力长廊",
    chapter: 2,
    difficulty: 4,
    mode: ["COCODE", "BUG_CLINIC"],
    width: 6,
    height: 5,
    start: state(0, 4, "N"),
    goal: { x: 4, y: 2 },
    commands: ["MOVE", "MOVE", "TURN_RIGHT", "MOVE", "MOVE", "MOVE", "MOVE"],
    tiles: [switchTile(0, 3, "C"), door(2, 2, "C"), chip(3, 2, "c1"), wall(1, 3), wall(2, 3)],
    knowledgePoint: "状态、顺序和路径需要一起考虑。",
    mission: "为长廊供电并收集门后的芯片。",
  }),
];

const loopCorner: GameMap = {
  id: "logic-01-loop-corner",
  name: "循环转角",
  chapter: 3,
  difficulty: 3,
  mode: ["COCODE", "LOGIC_LAB"],
  width: 5,
  height: 5,
  start: state(0, 4, "N"),
  goal: { x: 2, y: 2 },
  tiles: [wall(1, 3), wall(2, 3), chip(0, 2, "c1")],
  template: [{
    kind: "loop",
    line: 1,
    timesSlotId: "times",
    prompt: "这段指令重复几次？",
    allowedTimes: [2, 3, 4],
    body: [
      { kind: "choice", line: 2, slotId: "a", prompt: "循环第 1 行", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
      { kind: "choice", line: 3, slotId: "b", prompt: "循环第 2 行", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
      { kind: "choice", line: 4, slotId: "c", prompt: "循环第 3 行", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
    ],
  }],
  standardChoices: { times: 2, a: "MOVE", b: "MOVE", c: "TURN_RIGHT" },
  buggyChoices: { times: 2, a: "MOVE", b: "TURN_LEFT", c: "TURN_RIGHT" },
  maxSteps: 16,
  parSteps: 5,
  knowledgePoint: "循环可以复用同一组指令，减少程序长度。",
  mission: "用一段重复程序绕过转角。",
  previewFocus: [{ x: 0, y: 2 }, { x: 2, y: 2 }],
};

const loopSquare: GameMap = {
  id: "logic-02-loop-square",
  name: "三边巡检",
  chapter: 3,
  difficulty: 4,
  mode: ["COCODE", "LOGIC_LAB"],
  width: 4,
  height: 4,
  start: state(1, 1, "E"),
  goal: { x: 1, y: 2 },
  tiles: [chip(2, 1, "c1"), chip(2, 2, "c2")],
  template: [{
    kind: "loop",
    line: 1,
    timesSlotId: "times",
    prompt: "巡检动作重复几次？",
    allowedTimes: [2, 3, 4],
    body: [
      { kind: "choice", line: 2, slotId: "a", prompt: "先做什么？", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
      { kind: "choice", line: 3, slotId: "b", prompt: "再做什么？", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
    ],
  }],
  standardChoices: { times: 3, a: "MOVE", b: "TURN_RIGHT" },
  buggyChoices: { times: 2, a: "MOVE", b: "TURN_RIGHT" },
  maxSteps: 16,
  parSteps: 5,
  knowledgePoint: "循环次数是程序行为的一部分。",
  mission: "巡检三条边后抵达左下角。",
  previewFocus: [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }],
};

const frontWallCondition = (
  id: string,
  name: string,
  startState: RobotState,
  goal: Position,
  tiles: MapTile[],
  standardChoices: Record<string, ChoiceValue>,
  mission: string,
): GameMap => ({
  id,
  name,
  chapter: 3,
  difficulty: 4,
  mode: ["COCODE", "LOGIC_LAB"],
  width: 5,
  height: 5,
  start: startState,
  goal,
  tiles,
  template: [
    { kind: "choice", line: 1, slotId: "pre", prompt: "先执行什么？", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
    {
      kind: "condition",
      line: 2,
      predicate: { kind: "FRONT_BLOCKED" },
      whenTrue: [{ kind: "choice", line: 3, slotId: "true", prompt: "前方有障碍时？", allowed: ["TURN_LEFT", "TURN_RIGHT"] }],
      whenFalse: [{ kind: "choice", line: 5, slotId: "false", prompt: "前方畅通时？", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] }],
    },
    { kind: "choice", line: 6, slotId: "after1", prompt: "条件结束后的第 1 行", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
    { kind: "choice", line: 7, slotId: "after2", prompt: "条件结束后的第 2 行", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
  ],
  standardChoices,
  buggyChoices: { ...standardChoices, true: standardChoices.true === "TURN_LEFT" ? "TURN_RIGHT" : "TURN_LEFT" },
  maxSteps: 16,
  parSteps: 4,
  knowledgePoint: "条件会根据执行时的环境选择不同分支。",
  mission,
  previewFocus: [...tiles.filter((tile) => tile.kind === "WALL").map(({ x, y }) => ({ x, y })), goal],
});

const conditionLong: GameMap = {
  id: "logic-03-condition-detour",
  name: "条件绕行",
  chapter: 3,
  difficulty: 4,
  mode: ["COCODE", "LOGIC_LAB"],
  width: 5,
  height: 5,
  start: state(1, 3, "N"),
  goal: { x: 3, y: 1 },
  tiles: [wall(1, 1), chip(2, 2, "c1")],
  template: [
    { kind: "choice", line: 1, slotId: "pre", prompt: "先靠近障碍", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
    {
      kind: "condition",
      line: 2,
      predicate: { kind: "FRONT_BLOCKED" },
      whenTrue: [{ kind: "choice", line: 3, slotId: "true", prompt: "有障碍时转向哪边？", allowed: ["TURN_LEFT", "TURN_RIGHT"] }],
      whenFalse: [{ kind: "choice", line: 5, slotId: "false", prompt: "无障碍时？", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] }],
    },
    { kind: "choice", line: 6, slotId: "a1", prompt: "绕行第 1 行", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
    { kind: "choice", line: 7, slotId: "a2", prompt: "绕行第 2 行", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
    { kind: "choice", line: 8, slotId: "turn", prompt: "接近终点前如何转向？", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
    { kind: "choice", line: 9, slotId: "end", prompt: "最后一行", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
  ],
  standardChoices: { pre: "MOVE", true: "TURN_RIGHT", false: "MOVE", a1: "MOVE", a2: "MOVE", turn: "TURN_LEFT", end: "MOVE" },
  buggyChoices: { pre: "MOVE", true: "TURN_LEFT", false: "MOVE", a1: "MOVE", a2: "MOVE", turn: "TURN_LEFT", end: "MOVE" },
  maxSteps: 16,
  parSteps: 6,
  knowledgePoint: "程序只执行条件判断选中的那个分支。",
  mission: "检测墙体后自动选择绕行方向。",
  previewFocus: [{ x: 1, y: 1 }, { x: 3, y: 1 }],
};

const conditionShort = frontWallCondition(
  "logic-04-condition-turn",
  "自动避障",
  state(3, 4, "N"),
  { x: 1, y: 3 },
  [wall(3, 2), chip(2, 3, "c1")],
  { pre: "MOVE", true: "TURN_LEFT", false: "MOVE", after1: "MOVE", after2: "MOVE" },
  "判断前方障碍并向西侧绕行。",
);

const colorCondition: GameMap = {
  id: "logic-05-color-branch",
  name: "蓝色分支",
  chapter: 3,
  difficulty: 5,
  mode: ["COCODE", "LOGIC_LAB"],
  width: 5,
  height: 4,
  start: state(0, 2, "E"),
  goal: { x: 3, y: 1 },
  tiles: [colorTile(2, 2, "BLUE"), directionTile(2, 1, "N"), chip(3, 1, "c1")],
  template: [
    { kind: "choice", line: 1, slotId: "p1", prompt: "走向检测地砖", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
    { kind: "choice", line: 2, slotId: "p2", prompt: "继续走向检测地砖", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
    {
      kind: "condition",
      line: 3,
      predicate: { kind: "ON_TILE", tile: "BLUE" },
      whenTrue: [{ kind: "choice", line: 4, slotId: "true", prompt: "站在蓝色地砖时？", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] }],
      whenFalse: [{ kind: "choice", line: 6, slotId: "false", prompt: "不在蓝色地砖时？", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] }],
    },
    { kind: "choice", line: 7, slotId: "up", prompt: "进入上层通道", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
    { kind: "choice", line: 8, slotId: "turn", prompt: "面向终点", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
    { kind: "choice", line: 9, slotId: "end", prompt: "抵达终点", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
  ],
  standardChoices: { p1: "MOVE", p2: "MOVE", true: "TURN_LEFT", false: "MOVE", up: "MOVE", turn: "TURN_RIGHT", end: "MOVE" },
  buggyChoices: { p1: "MOVE", p2: "MOVE", true: "TURN_RIGHT", false: "MOVE", up: "MOVE", turn: "TURN_RIGHT", end: "MOVE" },
  maxSteps: 16,
  parSteps: 6,
  knowledgePoint: "条件不仅能检查墙体，也能读取当前位置的状态。",
  mission: "在蓝色地砖上切换到上层路线。",
  previewFocus: [{ x: 2, y: 2 }, { x: 2, y: 1 }, { x: 3, y: 1 }],
};

const showcaseOne = sequenceMap({
  id: "show-01-power-grid",
  name: "核心战：供电网格",
  chapter: 4,
  difficulty: 4,
  mode: ["CORE_BATTLE"],
  width: 6,
  height: 6,
  start: state(0, 5, "N"),
  goal: { x: 5, y: 2 },
  commands: ["MOVE", "MOVE", "MOVE", "TURN_RIGHT", "MOVE", "MOVE", "MOVE", "MOVE", "MOVE"],
  tiles: [switchTile(0, 4, "CORE"), door(2, 2, "CORE"), chip(4, 2, "c1"), wall(1, 3), wall(2, 3)],
  knowledgePoint: "长程序依然由相同的顺序规则执行。",
  mission: "启动核心供电并穿过安全门。",
});

const showcaseTwo: GameMap = {
  id: "show-02-loop-grid",
  name: "核心战：循环阵列",
  chapter: 4,
  difficulty: 5,
  mode: ["CORE_BATTLE"],
  width: 5,
  height: 5,
  start: state(0, 4, "N"),
  goal: { x: 3, y: 1 },
  tiles: [switchTile(0, 3, "D"), door(2, 1, "D"), chip(3, 1, "c1")],
  template: [
    { kind: "choice", line: 1, slotId: "p1", prompt: "先启动开关", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
    { kind: "choice", line: 2, slotId: "p2", prompt: "继续进入上层", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
    { kind: "choice", line: 3, slotId: "p3", prompt: "到达上层通道", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
    { kind: "choice", line: 4, slotId: "turn", prompt: "转向门的方向", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] },
    {
      kind: "loop",
      line: 5,
      timesSlotId: "times",
      prompt: "向前动作重复几次？",
      allowedTimes: [2, 3, 4],
      body: [{ kind: "choice", line: 6, slotId: "body", prompt: "循环体指令", allowed: ["MOVE", "TURN_LEFT", "TURN_RIGHT"] }],
    },
  ],
  standardChoices: { p1: "MOVE", p2: "MOVE", p3: "MOVE", turn: "TURN_RIGHT", times: 3, body: "MOVE" },
  buggyChoices: { p1: "MOVE", p2: "MOVE", p3: "MOVE", turn: "TURN_RIGHT", times: 2, body: "MOVE" },
  maxSteps: 16,
  parSteps: 7,
  knowledgePoint: "循环可以压缩重复的直线路径。",
  mission: "为阵列供电，再用循环穿过安全门。",
  previewFocus: [{ x: 0, y: 3 }, { x: 2, y: 1 }, { x: 3, y: 1 }],
};

const showcaseThree = frontWallCondition(
  "show-03-final-compiler",
  "核心战：最终编译",
  state(0, 4, "N"),
  { x: 3, y: 3 },
  [conveyor(0, 3, "E"), wall(1, 2), chip(2, 3, "c1")],
  { pre: "MOVE", true: "TURN_RIGHT", false: "MOVE", after1: "MOVE", after2: "MOVE" },
  "借助传送带并根据障碍选择最终路径。",
);
showcaseThree.chapter = 4;
showcaseThree.difficulty = 5;
showcaseThree.mode = ["CORE_BATTLE"];

export const GAME_MAPS: GameMap[] = [
  ...sequenceMaps,
  loopCorner,
  loopSquare,
  conditionLong,
  conditionShort,
  colorCondition,
  showcaseOne,
  showcaseTwo,
  showcaseThree,
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
