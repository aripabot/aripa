import { describe, expect, test } from "vitest";
import modelAction from "@aripabot/bot/actions/general/model.ts";
import type { ActionContext } from "@aripabot/core/bot/action.ts";
import { config } from "@aripabot/core/config/config.ts";

describe("modelAction", () => {
  test("returns the current agent model slug", async () => {
    const replies: string[] = [];

    await modelAction.execute({
      reply: async (content: string) => {
        replies.push(content);
        return content;
      },
    } as ActionContext);

    expect(replies).toEqual([`Current agent model: \`${config.models.agent.model}\`.`]);
  });
});
