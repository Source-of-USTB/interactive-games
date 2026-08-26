import { describe, expect, it } from "vitest";
import { createSessionToken, secureTokenMatches, verifySessionToken } from "./auth.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";

describe("anonymous session security", () => {
  it("accepts its signed token and rejects tampering", () => {
    const secret = "a-test-secret-long-enough-for-hmac";
    const created = createSessionToken(secret);
    expect(verifySessionToken(secret, created.token)?.id).toBe(created.sessionId);
    expect(verifySessionToken(secret, `${created.token.slice(0, -1)}x`)).toBeUndefined();
    expect(verifySessionToken("different-secret", created.token)).toBeUndefined();
  });

  it("compares management tokens without accepting prefixes", () => {
    expect(secureTokenMatches("correct-token", "correct-token")).toBe(true);
    expect(secureTokenMatches("correct-token", "correct")).toBe(false);
    expect(secureTokenMatches("correct-token", undefined)).toBe(false);
  });

  it("limits a fixed window and resets at the boundary", () => {
    const limiter = new FixedWindowRateLimiter();
    expect(limiter.allow("vote", 2, 1_000, 100)).toBe(true);
    expect(limiter.allow("vote", 2, 1_000, 200)).toBe(true);
    expect(limiter.allow("vote", 2, 1_000, 300)).toBe(false);
    expect(limiter.allow("vote", 2, 1_000, 1_100)).toBe(true);
  });
});
