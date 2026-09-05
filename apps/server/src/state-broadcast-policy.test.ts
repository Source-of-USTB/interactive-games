import { describe, expect, it } from "vitest";
import {
  audienceForStateChange,
  mergeStateAudience,
  shouldReceiveStateSnapshot,
} from "./state-broadcast-policy.js";

describe("state broadcast policy", () => {
  it("sends vote-only updates to operators", () => {
    const audience = audienceForStateChange("vote-cast");

    expect(shouldReceiveStateSnapshot("player", audience)).toBe(false);
    expect(shouldReceiveStateSnapshot("screen", audience)).toBe(true);
    expect(shouldReceiveStateSnapshot("admin", audience)).toBe(true);
  });

  it("sends other state changes to every role", () => {
    const audience = audienceForStateChange("authoring-slot-locked");

    expect(shouldReceiveStateSnapshot("player", audience)).toBe(true);
    expect(shouldReceiveStateSnapshot("screen", audience)).toBe(true);
    expect(shouldReceiveStateSnapshot("admin", audience)).toBe(true);
  });

  it("keeps the broadest audience when changes are coalesced", () => {
    expect(mergeStateAudience("operators", "operators")).toBe("operators");
    expect(mergeStateAudience("operators", "all")).toBe("all");
    expect(mergeStateAudience("all", "operators")).toBe("all");
  });
});
