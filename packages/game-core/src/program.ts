import type {
  ActionCommand,
  ChoiceValue,
  CompileIssue,
  CompileResult,
  Predicate,
  ProgramNode,
  ProgramSlot,
  ProgramTemplateNode,
} from "./types.js";

export function collectSlots(template: ProgramTemplateNode[]): ProgramSlot[] {
  const slots: ProgramSlot[] = [];

  const visit = (nodes: ProgramTemplateNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "choice") {
        slots.push({
          slotId: node.slotId,
          line: node.line,
          prompt: node.prompt,
          kind: "command",
          options: [...node.allowed],
        });
      } else if (node.kind === "loop") {
        slots.push({
          slotId: node.timesSlotId,
          line: node.line,
          prompt: node.prompt,
          kind: "number",
          options: [...node.allowedTimes],
        });
        visit(node.body);
      } else if (node.kind === "condition") {
        visit(node.whenTrue);
        visit(node.whenFalse);
      }
    }
  };

  visit(template);
  return slots;
}

function isCommand(value: ChoiceValue | undefined): value is ActionCommand {
  return value === "MOVE" || value === "TURN_LEFT" || value === "TURN_RIGHT";
}

export function compileProgram(
  template: ProgramTemplateNode[],
  choices: Record<string, ChoiceValue>,
  maxSteps: number,
): CompileResult {
  const issues: CompileIssue[] = [];

  const resolve = (nodes: ProgramTemplateNode[]): ProgramNode[] => {
    const output: ProgramNode[] = [];
    for (const node of nodes) {
      if (node.kind === "fixed") {
        output.push({ kind: "action", line: node.line, command: node.command });
        continue;
      }

      if (node.kind === "choice") {
        const value = choices[node.slotId];
        if (value === undefined) {
          issues.push({
            type: "MISSING_CHOICE",
            line: node.line,
            slotId: node.slotId,
            message: `程序第 ${node.line} 行尚未填写`,
          });
          continue;
        }
        if (!isCommand(value) || !node.allowed.includes(value)) {
          issues.push({
            type: "INVALID_CHOICE",
            line: node.line,
            slotId: node.slotId,
            message: `程序第 ${node.line} 行包含非法指令`,
          });
          continue;
        }
        output.push({
          kind: "action",
          line: node.line,
          command: value,
          slotId: node.slotId,
        });
        continue;
      }

      if (node.kind === "loop") {
        const value = choices[node.timesSlotId];
        if (typeof value !== "number") {
          issues.push({
            type: "MISSING_CHOICE",
            line: node.line,
            slotId: node.timesSlotId,
            message: `程序第 ${node.line} 行尚未选择循环次数`,
          });
          continue;
        }
        if (!node.allowedTimes.includes(value)) {
          issues.push({
            type: "INVALID_CHOICE",
            line: node.line,
            slotId: node.timesSlotId,
            message: `程序第 ${node.line} 行包含非法循环次数`,
          });
          continue;
        }
        output.push({
          kind: "loop",
          line: node.line,
          times: value,
          timesSlotId: node.timesSlotId,
          body: resolve(node.body),
        });
        continue;
      }

      output.push({
        kind: "condition",
        line: node.line,
        predicate: node.predicate,
        whenTrue: resolve(node.whenTrue),
        whenFalse: resolve(node.whenFalse),
      });
    }
    return output;
  };

  const program = resolve(template);
  const maximumExpandedSteps = countMaximumSteps(program);
  if (maximumExpandedSteps > maxSteps) {
    issues.push({
      type: "STEP_LIMIT",
      line: findLargestLoopLine(program) ?? 1,
      message: `程序展开后最多执行 ${maximumExpandedSteps} 步，超过上限 ${maxSteps}`,
    });
  }

  return {
    ok: issues.length === 0,
    program,
    slots: collectSlots(template),
    issues,
    maximumExpandedSteps,
  };
}

export function countMaximumSteps(program: ProgramNode[]): number {
  let count = 0;
  for (const node of program) {
    if (node.kind === "action") count += 1;
    else if (node.kind === "loop") count += node.times * countMaximumSteps(node.body);
    else count += Math.max(countMaximumSteps(node.whenTrue), countMaximumSteps(node.whenFalse));
  }
  return count;
}

function findLargestLoopLine(program: ProgramNode[]): number | undefined {
  let result: { line: number; size: number } | undefined;
  const visit = (nodes: ProgramNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "loop") {
        const size = node.times * countMaximumSteps(node.body);
        if (!result || size > result.size) result = { line: node.line, size };
        visit(node.body);
      } else if (node.kind === "condition") {
        visit(node.whenTrue);
        visit(node.whenFalse);
      }
    }
  };
  visit(program);
  return result?.line;
}

export function predicateLabel(predicate: Predicate): string {
  if (predicate.kind === "FRONT_BLOCKED") return "前方有障碍";
  if (predicate.kind === "ON_TILE") return `站在${predicate.tile === "BLUE" ? "蓝色" : "黄色"}地砖`;
  return `开关 ${predicate.switchId} 已激活`;
}
