import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

const LOCK_FILE_NAME = ".aripa-update.lock";
const STALE_LOCK_AGE_MS = 15 * 60_000;

export class UpdateLockConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpdateLockConflictError";
  }
}

export interface UpdateLock {
  release(): Promise<void>;
}

interface UpdateLockMetadata {
  pid: number;
  startedAt: string;
  repository: string;
  release: string;
}

export async function acquireUpdateLock(options: {
  repositoryRoot: string;
  release: string;
  now?: Date;
}): Promise<UpdateLock> {
  const path = join(options.repositoryRoot, LOCK_FILE_NAME);
  await mkdir(options.repositoryRoot, { recursive: true });
  const metadata: UpdateLockMetadata = {
    pid: process.pid,
    startedAt: (options.now ?? new Date()).toISOString(),
    repository: options.repositoryRoot,
    release: options.release,
  };

  try {
    await createLock(path, metadata);
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }

    const existing = await readLock(path);
    if (!isStaleLock(existing, options.now ?? new Date())) {
      throw new UpdateLockConflictError(
        `An update for ${existing?.release ?? "this repository"} is already running.`,
      );
    }

    await rm(path, { force: true });
    await createLock(path, metadata);
  }

  return {
    release: async () => {
      await rm(path, { force: true });
    },
  };
}

async function createLock(path: string, metadata: UpdateLockMetadata): Promise<void> {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(metadata)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
}

async function readLock(path: string): Promise<UpdateLockMetadata | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return isUpdateLockMetadata(value) ? value : null;
  } catch {
    return null;
  }
}

function isUpdateLockMetadata(value: unknown): value is UpdateLockMetadata {
  return (
    typeof value === "object" &&
    value !== null &&
    "pid" in value &&
    typeof value.pid === "number" &&
    "startedAt" in value &&
    typeof value.startedAt === "string" &&
    "repository" in value &&
    typeof value.repository === "string" &&
    "release" in value &&
    typeof value.release === "string"
  );
}

function isStaleLock(lock: UpdateLockMetadata | null, now: Date): boolean {
  if (!lock) {
    return true;
  }

  const startedAtMs = Date.parse(lock.startedAt);
  if (!Number.isFinite(startedAtMs) || now.getTime() - startedAtMs < STALE_LOCK_AGE_MS) {
    return false;
  }

  try {
    process.kill(lock.pid, 0);
    return false;
  } catch {
    return true;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
