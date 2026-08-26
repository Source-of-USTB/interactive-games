import { describe, expect, it } from "vitest";
import { getMapById, type PublicRoundState } from "@codegame/game-core";
import { GameRoom, type RoomCheckpoint } from "./game-room.js";

const fastTimings = {
  joinMs: 1,
  briefingMs: 1,
  voteMs: 1_100,
  revealMs: 1,
  compileMs: 1,
  predictMs: 1,
  debugSelectMs: 1_100,
  debugPatchMs: 1_100,
  emergencyPatchMs: 1_100,
  resultMs: 1,
  resetMs: 1,
};

function advance(room: GameRoom): PublicRoundState {
  const snapshot = room.snapshot();
  room.tick(snapshot.phaseEndsAt + 1);
  return room.snapshot(snapshot.phaseEndsAt + 1);
}

describe("GameRoom", () => {
  it("runs a complete co-code round with authoritative votes", () => {
    const checkpoints: RoomCheckpoint[] = [];
    const room = new GameRoom("TEST", { onCheckpoint: (value) => checkpoints.push(value) }, fastTimings);
    const map = getMapById("boot-01-first-route")!;
    room.connectPlayer("p1");
    room.start({ mode: "COCODE", mapId: map.id });
    advance(room); // JOIN -> BRIEFING
    advance(room); // BRIEFING -> AUTHORING

    while (room.currentPhase === "AUTHORING") {
      const snapshot = room.snapshot();
      const tally = snapshot.currentTally;
      if (tally && !tally.locked) {
        const expected = map.standardChoices[tally.slotId];
        expect(expected).toBeDefined();
        expect(room.castVote("p1", tally.slotId, expected!)).toEqual({ ok: true });
      }
      advance(room);
    }

    expect(room.currentPhase).toBe("COMPILE");
    advance(room); // PREDICT
    expect(room.castPrediction("p1", "success")).toEqual({ ok: true });
    advance(room); // EXECUTE
    advance(room); // RESULT
    const result = room.snapshot();
    expect(result.phase).toBe("RESULT");
    expect(result.execution?.success).toBe(true);
    expect(result.score?.missionStar).toBe(true);
    expect(result.score?.collaborationStar).toBe(true);
    expect(checkpoints.length).toBeGreaterThan(5);
  });

  it("runs Bug Clinic through line selection and a successful patch", () => {
    const room = new GameRoom("BUG", {}, fastTimings);
    const map = getMapById("boot-01-first-route")!;
    room.connectPlayer("p1");
    room.start({ mode: "BUG_CLINIC", mapId: map.id });
    advance(room); // briefing
    advance(room); // compile buggy
    advance(room); // predict
    advance(room); // execute
    advance(room); // debug select
    expect(room.currentPhase).toBe("DEBUG_SELECT");
    const candidate = room.snapshot().debugCandidateSlots.find((slotId) => map.buggyChoices[slotId] !== map.standardChoices[slotId]);
    expect(candidate).toBeDefined();
    expect(room.castDebugLine("p1", candidate!)).toEqual({ ok: true });
    advance(room); // patch
    const selected = room.snapshot().selectedDebugSlot!;
    expect(selected).toBe(candidate);
    expect(room.castDebugPatch("p1", selected, map.standardChoices[selected]!)).toEqual({ ok: true });
    advance(room); // reexecute
    advance(room); // result
    expect(room.snapshot().execution?.success).toBe(true);
    expect(room.snapshot().score?.badges).toContain("BUG_HUNTER");
  });

  it("publishes a successful teaching replay after the available patch fails", () => {
    const room = new GameRoom("TEACH", {}, fastTimings);
    const map = getMapById("boot-01-first-route")!;
    room.connectPlayer("p1");
    room.start({ mode: "BUG_CLINIC", mapId: map.id });
    advance(room);
    advance(room);
    advance(room);
    advance(room);
    advance(room);
    const brokenSlot = room.snapshot().debugCandidateSlots.find((slotId) => map.buggyChoices[slotId] !== map.standardChoices[slotId])!;
    room.castDebugLine("p1", brokenSlot);
    advance(room);
    const selected = room.snapshot().selectedDebugSlot!;
    const deliberatelyWrong = map.template
      .flatMap((node) => node.kind === "choice" && node.slotId === selected ? node.allowed : [])
      .find((value) => value !== map.standardChoices[selected] && value !== map.buggyChoices[selected]);
    expect(deliberatelyWrong).toBeDefined();
    room.castDebugPatch("p1", selected, deliberatelyWrong!);
    advance(room);
    advance(room);
    const result = room.snapshot();
    expect(result.phase).toBe("RESULT");
    expect(result.score?.missionStar).toBe(false);
    expect(result.solutionChoices).toEqual(map.standardChoices);
    expect(result.solutionTrace?.at(-1)?.type).toBe("SUCCESS");
  });
});
