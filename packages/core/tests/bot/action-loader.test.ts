import { describe, expect, test } from "vitest";
import type { Action } from "@aripabot/core/bot/action.ts";
import { ActionDirectory } from "@aripabot/core/bot/action-loader.ts";

describe("ActionDirectory", () => {
  test("finds actions by name and alias", () => {
    const action = createAction("ping", ["pong"]);
    const actions = new ActionDirectory();

    actions.add(action, "ping.ts");

    expect(actions.find("ping")).toBe(action);
    expect(actions.find("PING")).toBe(action);
    expect(actions.find("pong")).toBe(action);
    expect(actions.size).toBe(1);
  });

  test("does not allow aliases to overwrite existing action names", () => {
    const ping = createAction("ping");
    const help = createAction("help", ["ping"]);
    const actions = new ActionDirectory();

    actions.add(ping, "ping.ts");
    actions.add(help, "help.ts");

    expect(actions.find("ping")).toBe(ping);
    expect(actions.find("help")).toBe(help);
    expect(actions.size).toBe(2);
  });
});

function createAction(name: string, aliases: string[] = []): Action {
  return {
    name,
    aliases,
    requiredUserPermissions: [],
    execute() {},
  };
}
