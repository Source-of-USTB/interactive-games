import { describe, expect, it } from "vitest";
import { compileProgram } from "./program.js";
import { collectSlots } from "./program.js";
import { executeProgram } from "./engine.js";
import { GAME_MAPS } from "./maps.js";

describe("formal map catalog", () => {
  it("contains only the six simplest maps", () => {
    expect(GAME_MAPS).toHaveLength(6);
    expect(GAME_MAPS.every((map) => map.difficulty === 1 || map.difficulty === 2)).toBe(true);
  });

  for (const map of GAME_MAPS) {
    it(`${map.id} compiles and its standard program succeeds`, () => {
      const compiled = compileProgram(map.template, map.standardChoices, map.maxSteps);
      expect(compiled.issues).toEqual([]);
      const result = executeProgram(map, compiled.program);
      expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
      expect(result.executedActionCount).toBeLessThanOrEqual(map.maxSteps);
    });

  }
});

const generatedCases = GAME_MAPS.flatMap((map) => Array.from({ length: 20 }, (_, variant) => ({ map, variant })));

describe("bounded program properties: at least 20 cases per map", () => {
  it.each(generatedCases)("$map.id generated case $variant is bounded and traceable", ({ map, variant }) => {
    const slots = collectSlots(map.template);
    const choices = variant === 0
      ? { ...map.standardChoices }
      : Object.fromEntries(slots.map((slot, slotIndex) => [
          slot.slotId,
          slot.options[(variant * 7 + slotIndex * 2) % slot.options.length]!,
        ]));
    const compiled = compileProgram(map.template, choices, map.maxSteps);
    expect(compiled.ok).toBe(true);
    expect(compiled.maximumExpandedSteps).toBeLessThanOrEqual(map.maxSteps);
    const result = executeProgram(map, compiled.program);
    expect(result.executedActionCount).toBeLessThanOrEqual(map.maxSteps);
    expect(result.trace.map((event) => event.sequence)).toEqual(result.trace.map((_, index) => index + 1));
    expect(result.trace.every((event) => event.sourceLine >= 0)).toBe(true);
  });
});
