import { PinoTransport } from "@loglayer/transport-pino";
import { LogLayer } from "loglayer";
import { pino } from "pino";
import { config } from "@aripabot/core/config/config.ts";

const transport = process.stdout.isTTY
  ? {
      target: "pino-pretty",
      options: {
        colorize: true,
        ignore: "pid,hostname",
        translateTime: "SYS:standard",
      },
    }
  : undefined;

const pinoLogger = pino({
  level: config.logLevel,
  redact: {
    paths: ["token", "TOKEN", "authorization", "Authorization", "*.token"],
    censor: "[redacted]",
  },
  transport,
});

export const log = new LogLayer({
  transport: new PinoTransport({
    logger: pinoLogger,
  }),
  metadataFieldName: "metadata",
  contextFieldName: "context",
});
