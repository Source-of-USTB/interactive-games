import { appendFile as appendFileAsync } from "node:fs/promises";

export type ServerLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LOG_LEVELS: Record<ServerLogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

export interface ServerLoggerOptions {
  path: string;
  level: string;
  writeConsole?: (line: string, level: ServerLogLevel) => void;
}

export interface ServerLogger {
  log(level: ServerLogLevel, message: string): void;
  flush(): Promise<void>;
}

function configuredPriority(level: string): number {
  return LOG_LEVELS[level.toUpperCase() as ServerLogLevel] ?? LOG_LEVELS.INFO;
}

export function createServerLogger(options: ServerLoggerOptions): ServerLogger {
  const minimumPriority = configuredPriority(options.level);
  const pendingLines: string[] = [];
  let flushScheduled = false;
  let flushPromise: Promise<void> | undefined;

  const writeConsole = options.writeConsole ?? ((line, level) => {
    const colors: Record<ServerLogLevel, string> = {
      DEBUG: "\u001b[90m",
      INFO: "\u001b[36m",
      WARN: "\u001b[33m",
      ERROR: "\u001b[31m",
    };
    const reset = "\u001b[0m";
    console.log(process.stdout.isTTY ? `${colors[level]}${line}${reset}` : line);
  });

  const flushQueue = (): Promise<void> => {
    if (flushPromise) return flushPromise;

    const run = (async () => {
      while (pendingLines.length > 0) {
        const lines = pendingLines.splice(0, pendingLines.length);
        try {
          await appendFileAsync(options.path, lines.join(""), "utf8");
        } catch (error) {
          console.error(`Failed to write server log: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    })();

    flushPromise = run;
    run.then(
      () => {
        if (flushPromise === run) flushPromise = undefined;
        if (pendingLines.length > 0) scheduleFlush();
      },
      () => {
        if (flushPromise === run) flushPromise = undefined;
      },
    );
    return run;
  };

  function scheduleFlush(): void {
    if (flushScheduled) return;
    flushScheduled = true;
    setImmediate(() => {
      flushScheduled = false;
      void flushQueue();
    });
  }

  return {
    log(level, message) {
      if (LOG_LEVELS[level] < minimumPriority) return;
      const line = `${new Date().toISOString()} [${level}] ${message}`;
      writeConsole(line, level);
      pendingLines.push(`${line}\n`);
      scheduleFlush();
    },
    flush: flushQueue,
  };
}
