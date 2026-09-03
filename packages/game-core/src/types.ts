export type Direction = "N" | "E" | "S" | "W";

export type ActionCommand = "MOVE" | "TURN_LEFT" | "TURN_RIGHT";

export type Predicate =
  | { kind: "FRONT_BLOCKED" }
  | { kind: "ON_TILE"; tile: "BLUE" | "YELLOW" }
  | { kind: "SWITCH_ACTIVE"; switchId: string };

export interface Position {
  x: number;
  y: number;
}

export interface RobotState extends Position {
  direction: Direction;
  activeSwitches: string[];
  collectedChips: string[];
}

export type ProgramTemplateNode =
  | {
      kind: "choice";
      line: number;
      slotId: string;
      prompt: string;
      allowed: ActionCommand[];
    }
  | {
      kind: "fixed";
      line: number;
      command: ActionCommand;
    }
  | {
      kind: "loop";
      line: number;
      timesSlotId: string;
      prompt: string;
      allowedTimes: number[];
      body: ProgramTemplateNode[];
    }
  | {
      kind: "condition";
      line: number;
      predicate: Predicate;
      whenTrue: ProgramTemplateNode[];
      whenFalse: ProgramTemplateNode[];
    };

export type ProgramNode =
  | {
      kind: "action";
      line: number;
      command: ActionCommand;
      slotId?: string;
    }
  | {
      kind: "loop";
      line: number;
      times: number;
      timesSlotId: string;
      body: ProgramNode[];
    }
  | {
      kind: "condition";
      line: number;
      predicate: Predicate;
      whenTrue: ProgramNode[];
      whenFalse: ProgramNode[];
    };

export type ChoiceValue = ActionCommand | number;

export interface ProgramSlot {
  slotId: string;
  line: number;
  prompt: string;
  kind: "command" | "number";
  options: ChoiceValue[];
}

export interface WallTile extends Position {
  kind: "WALL";
}

export interface ChipTile extends Position {
  kind: "CHIP";
  id: string;
}

export interface SwitchTile extends Position {
  kind: "SWITCH";
  id: string;
}

export interface DoorTile extends Position {
  kind: "DOOR";
  switchId: string;
}

export interface ConveyorTile extends Position {
  kind: "CONVEYOR";
  direction: Direction;
}

export interface DirectionTile extends Position {
  kind: "DIRECTION";
  direction: Direction;
}

export interface ColorTile extends Position {
  kind: "COLOR";
  color: "BLUE" | "YELLOW";
}

export type MapTile =
  | WallTile
  | ChipTile
  | SwitchTile
  | DoorTile
  | ConveyorTile
  | DirectionTile
  | ColorTile;

export type GameMode = "COCODE";

export interface GameMap {
  id: string;
  name: string;
  chapter: 1 | 2 | 3 | 4;
  difficulty: 1 | 2 | 3 | 4 | 5;
  mode: GameMode[];
  width: number;
  height: number;
  start: RobotState;
  goal: Position;
  tiles: MapTile[];
  template: ProgramTemplateNode[];
  standardChoices: Record<string, ChoiceValue>;
  maxSteps: number;
  parSteps: number;
  knowledgePoint: string;
  mission: string;
  previewFocus: Position[];
}

export type FailureType =
  | "COLLISION"
  | "OUT_OF_BOUNDS"
  | "MECHANISM"
  | "LOGIC"
  | "STEP_LIMIT"
  | "COMPILE";

export type TraceEventType =
  | "ACTION"
  | "CONDITION"
  | "CHIP"
  | "SWITCH"
  | "CONVEYOR"
  | "SUCCESS"
  | "FAILURE";

export interface TraceEvent {
  sequence: number;
  type: TraceEventType;
  sourceLine: number;
  slotId?: string;
  command?: ActionCommand;
  label: string;
  before: RobotState;
  after: RobotState;
  durationMs: number;
  loopIteration?: number;
  loopTotal?: number;
  conditionValue?: boolean;
  failureType?: FailureType;
}

export interface CompileIssue {
  type: "MISSING_CHOICE" | "INVALID_CHOICE" | "STEP_LIMIT";
  line: number;
  slotId?: string;
  message: string;
}

export interface CompileResult {
  ok: boolean;
  program: ProgramNode[];
  slots: ProgramSlot[];
  issues: CompileIssue[];
  maximumExpandedSteps: number;
}

export interface ExecutionResult {
  success: boolean;
  state: RobotState;
  trace: TraceEvent[];
  failureType?: FailureType;
  failureLine?: number;
  executedActionCount: number;
  collectedAllChips: boolean;
}

export type RoundPhase =
  | "ATTRACT"
  | "JOIN"
  | "BRIEFING"
  | "AUTHORING"
  | "COMPILE"
  | "PREDICT"
  | "EXECUTE"
  | "RESULT"
  | "RESET"
  | "PAUSED";

export interface VoteTally {
  slotId: string;
  options: Array<{ value: ChoiceValue; count: number }>;
  eligibleCount: number;
  submittedCount: number;
  locked: boolean;
  winner?: ChoiceValue;
}

export interface RoundScore {
  missionStar: boolean;
  algorithmStar: boolean;
  collaborationStar: boolean;
  badges: Array<"FIRST_RUN" | "ALL_COMMITTED" | "SHORTEST_PROGRAM">;
}

export interface PublicMap {
  id: string;
  name: string;
  chapter: number;
  difficulty: number;
  width: number;
  height: number;
  start: RobotState;
  goal: Position;
  tiles: MapTile[];
  mission: string;
  knowledgePoint: string;
  previewFocus: Position[];
}

export interface PublicRoundState {
  roomId: string;
  roundId: string;
  mode: GameMode;
  phase: RoundPhase;
  previousPhase?: RoundPhase;
  phaseStartedAt: number;
  phaseEndsAt: number;
  serverNow: number;
  connectedPlayers: number;
  map: PublicMap;
  slots: ProgramSlot[];
  currentSlotIndex: number;
  currentTally?: VoteTally;
  lockedChoices: Record<string, ChoiceValue>;
  collaborationEnergy: number;
  trace: TraceEvent[];
  execution?: ExecutionResult;
  predictions: { success: number; crash: number; incomplete: number };
  predictionOutcome?: "success" | "crash" | "incomplete";
  score?: RoundScore;
  resultMessage?: string;
  showcaseStage: number;
  showcaseTotalStages: number;
}

export interface DailyStats {
  date: string;
  participantSessions: number;
  commandsSubmitted: number;
  bugsFixed: number;
  successfulDeliveries: number;
  roundsPlayed: number;
  cityEnergy: number;
}
