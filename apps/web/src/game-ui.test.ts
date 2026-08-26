import { describe, expect, it } from "vitest";
import { choiceGlyph, choiceLabel, PHASE_LABELS } from "./game-ui.js";

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
