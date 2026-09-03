import { describe, expect, it } from "vitest";
import { chooseNextRound } from "./director.js";
import { mapsForMode } from "./maps.js";

describe("round director", () => {
  it("does not schedule the removed Bug Clinic mode", () => {
    expect(mapsForMode("BUG_CLINIC")).toHaveLength(0);

    for (let index = 0; index < 24; index += 1) {
      const decision = chooseNextRound([], 12, `co-code-${index}`);

      expect(decision.mode).toBe("COCODE");
      expect(decision.map.mode).toContain("COCODE");
      expect(decision.map.difficulty).toBeLessThanOrEqual(2);
    }
  });
});
