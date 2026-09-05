export type ClientRole = "player" | "screen" | "admin";
export type StateAudience = "all" | "operators";

export function audienceForStateChange(reason: string): StateAudience {
  return reason === "vote-cast" ? "operators" : "all";
}

export function mergeStateAudience(previous: StateAudience, next: StateAudience): StateAudience {
  return previous === "all" || next === "all" ? "all" : "operators";
}

export function shouldReceiveStateSnapshot(role: ClientRole, audience: StateAudience): boolean {
  return audience === "all" || role !== "player";
}
