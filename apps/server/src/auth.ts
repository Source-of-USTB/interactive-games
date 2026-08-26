import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

interface SessionPayload {
  id: string;
  issuedAt: number;
}

function signature(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(secret: string): { sessionId: string; token: string } {
  const value: SessionPayload = { id: randomUUID(), issuedAt: Date.now() };
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return { sessionId: value.id, token: `${payload}.${signature(secret, payload)}` };
}

export function verifySessionToken(secret: string, token: string): SessionPayload | undefined {
  const [payload, providedSignature] = token.split(".");
  if (!payload || !providedSignature) return undefined;
  const expected = signature(secret, payload);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(providedSignature);
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (typeof parsed.id !== "string" || typeof parsed.issuedAt !== "number") return undefined;
    if (Date.now() - parsed.issuedAt > 24 * 60 * 60_000) return undefined;
    return { id: parsed.id, issuedAt: parsed.issuedAt };
  } catch {
    return undefined;
  }
}

export function secureTokenMatches(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}
