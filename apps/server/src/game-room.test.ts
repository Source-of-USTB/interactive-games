import { describe, expect, it } from "vitest";
import { getMapById, type PublicRoundState } from "@codegame/game-core";
import { GameRoom, type RoomCheckpoint } from "./game-room.js";

const fastTimings = {
  joinMs: 1,
  voteMs: 1_100,
  revealMs: 1,
  compileMs: 1,
};

function advance(room: GameRoom): PublicRoundState {
  const snapshot = room.snapshot();
  room.tick(snapshot.phaseEndsAt + 1);
  return room.snapshot(snapshot.phaseEndsAt + 1);
}

describe("GameRoom", () => {
  it("runs a complete co-code round with authoritative votes", () => {
    const checkpoints: RoomCheckpoint[] = [];
    const completed: boolean[] = [];
    const room = new GameRoom("TEST", {
      onCheckpoint: (value) => checkpoints.push(value),
      onRoundComplete: (value) => completed.push(value.success),
    }, fastTimings);
    const map = getMapById("boot-01-first-route")!;
    room.connectPlayer("p1");
    room.start({ mode: "COCODE", mapId: map.id });
    advance(room); // JOIN -> AUTHORING

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
    advance(room); // EXECUTE
    const executingRoundId = room.currentRoundId;
    advance(room); // next round JOIN
    expect(room.currentPhase).toBe("JOIN");
    expect(room.currentRoundId).not.toBe(executingRoundId);
    expect(completed).toEqual([true]);
    expect(checkpoints.length).toBeGreaterThan(5);
  });

  it("records a failed execution and immediately opens the next round", () => {
    const completed: boolean[] = [];
    const room = new GameRoom("TEST-FAIL", {
      onRoundComplete: (value) => completed.push(value.success),
    }, fastTimings);
    const map = getMapById("boot-01-first-route")!;
    room.connectPlayer("p1");
    room.start({ mode: "COCODE", mapId: map.id });
    advance(room);

    let wrongVoteCast = false;
    while (room.currentPhase === "AUTHORING") {
      const tally = room.snapshot().currentTally;
      if (tally && !tally.locked) {
        const expected = map.standardChoices[tally.slotId];
        const wrong = tally.options.find((option) => option.value !== expected)?.value;
        const vote = !wrongVoteCast && wrong !== undefined ? wrong : expected;
        if (!wrongVoteCast && wrong !== undefined) wrongVoteCast = true;
        expect(room.castVote("p1", tally.slotId, vote!)).toEqual({ ok: true });
      }
      advance(room);
    }

    expect(room.currentPhase).toBe("COMPILE");
    advance(room);
    const executingRoundId = room.currentRoundId;
    advance(room);
    expect(room.currentPhase).toBe("JOIN");
    expect(room.currentRoundId).not.toBe(executingRoundId);
    expect(completed).toEqual([false]);
  });

});
