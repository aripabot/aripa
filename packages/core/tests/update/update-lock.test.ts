import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { acquireUpdateLock, UpdateLockConflictError } from "@aripabot/core/update/update-lock.ts";

describe("acquireUpdateLock", () => {
  test("allows one updater and rejects a concurrent owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "aripa-update-lock-"));

    try {
      const first = await acquireUpdateLock({ repositoryRoot: root, release: "v1.0.0" });
      await expect(
        acquireUpdateLock({ repositoryRoot: root, release: "v1.0.1" }),
      ).rejects.toBeInstanceOf(UpdateLockConflictError);
      await first.release();
      await expect(
        acquireUpdateLock({ repositoryRoot: root, release: "v1.0.1" }),
      ).resolves.toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("recovers an old lock whose owner is no longer running", async () => {
    const root = await mkdtemp(join(tmpdir(), "aripa-update-lock-stale-"));

    try {
      await writeFile(
        join(root, ".aripa-update.lock"),
        `${JSON.stringify({
          pid: 999_999_999,
          startedAt: "2000-01-01T00:00:00.000Z",
          repository: root,
          release: "v0.0.1",
        })}\n`,
      );

      const lock = await acquireUpdateLock({ repositoryRoot: root, release: "v1.0.0" });
      await lock.release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
