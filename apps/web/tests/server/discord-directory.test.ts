import { afterEach, describe, expect, test, vi } from "vitest";

import { channelKey, getDiscordDirectory } from "@/server/discord-directory";

describe("dashboard Discord directory", () => {
  const previousToken = process.env.TOKEN;

  afterEach(() => {
    vi.restoreAllMocks();

    if (previousToken === undefined) {
      delete process.env.TOKEN;
    } else {
      process.env.TOKEN = previousToken;
    }
  });

  test("fetches configured log channels instead of every guild channel", async () => {
    process.env.TOKEN = `test-token-${crypto.randomUUID()}`;
    const calls: string[] = [];

    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = new URL(input.toString());
      calls.push(url.pathname);

      if (url.pathname === "/api/v10/guilds/guild-1") {
        return jsonResponse({ id: "guild-1", name: "Guild One", icon: null });
      }

      if (url.pathname === "/api/v10/channels/log-1") {
        return jsonResponse({ id: "log-1", name: "mod-log" });
      }

      throw new Error(`Unexpected Discord fetch: ${url.pathname}`);
    });

    const directory = await getDiscordDirectory(
      ["guild-1"],
      [],
      [{ guildId: "guild-1", logChannelId: "log-1", muteRoleId: null }],
    );

    expect(directory.channels.get(channelKey("guild-1", "log-1"))?.name).toBe("mod-log");
    expect(calls).toEqual(["/api/v10/guilds/guild-1", "/api/v10/channels/log-1"]);
    expect(calls).not.toContain("/api/v10/guilds/guild-1/channels");
    expect(calls).not.toContain("/api/v10/guilds/guild-1/roles");
  });

  test("includes Discord retry-after detail when lookups are rate limited", async () => {
    process.env.TOKEN = `test-token-${crypto.randomUUID()}`;
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(null, {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "retry-after": "2.5" },
        }),
    );

    const directory = await getDiscordDirectory(["guild-1"], [], []);

    expect(directory.lookup.available).toBe(false);
    expect(directory.lookup.detail).toContain("Discord lookup rate limited");
    expect(directory.lookup.detail).toContain("Retry after 2.5 seconds");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}
