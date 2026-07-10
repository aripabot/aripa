import { describe, expect, test } from "vitest";

import { createRuntimePaths } from "@aripabot/core/config/runtime-paths.ts";

describe("createRuntimePaths", () => {
  test("uses one documented database candidate order", () => {
    const root = "/repo";
    const rootDatabase = `${root}/aripa.sqlite`;
    const botDatabase = `${root}/apps/bot/aripa.sqlite`;
    const coreDatabase = `${root}/packages/core/aripa.sqlite`;

    expect(
      createRuntimePaths({
        repositoryRoot: root,
        fileExists: (path) =>
          path === rootDatabase || path === botDatabase || path === coreDatabase,
      }).databasePath,
    ).toBe(rootDatabase);
    expect(
      createRuntimePaths({ repositoryRoot: root, fileExists: (path) => path === botDatabase })
        .databasePath,
    ).toBe(botDatabase);
    expect(
      createRuntimePaths({ repositoryRoot: root, fileExists: (path) => path === coreDatabase })
        .databasePath,
    ).toBe(coreDatabase);
  });

  test("honors configured paths without probing legacy candidates", () => {
    expect(
      createRuntimePaths({
        repositoryRoot: "/repo",
        env: {
          CONFIG_PATH: " /config/custom.json ",
          DATABASE_PATH: " /data/custom.sqlite ",
          DASHBOARD_AUTH_PATH: " /data/dashboard-auth.json ",
        },
        fileExists: () => {
          throw new Error("configured paths do not need a probe");
        },
      }),
    ).toMatchObject({
      configPath: "/config/custom.json",
      databasePath: "/data/custom.sqlite",
      dashboardAuthPath: "/data/dashboard-auth.json",
    });
  });
});
