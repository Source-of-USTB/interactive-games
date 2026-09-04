import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServerLogger } from "./server-logger.js";

describe("server logger", () => {
  it("filters debug messages at info level and flushes queued lines", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codegame-logger-"));
    const path = join(directory, "server.log");
    const consoleLines: string[] = [];
    try {
      const logger = createServerLogger({
        path,
        level: "info",
        writeConsole: (line) => consoleLines.push(line),
      });
      logger.log("DEBUG", "hidden");
      logger.log("INFO", "visible");
      logger.log("ERROR", "failure");
      await logger.flush();

      const file = await readFile(path, "utf8");
      expect(file).toContain("visible");
      expect(file).toContain("failure");
      expect(file).not.toContain("hidden");
      expect(consoleLines).toHaveLength(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
