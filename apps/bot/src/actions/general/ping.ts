import type { Action } from "@aripabot/core/bot/action.ts";

const pingAction = {
  name: "ping",
  requiredUserPermissions: [],
  description: "Check whether the bot is responsive.",
  async execute({ client, reply }) {
    await reply(`Pong. Gateway latency is ${Math.round(client.ws.ping)}ms.`);
  },
} satisfies Action;

export default pingAction;
