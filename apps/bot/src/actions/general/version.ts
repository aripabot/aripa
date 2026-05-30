import type { Action } from "@aripabot/core/bot/action.ts";
import packageJson from "../../../package.json" with { type: "json" };

const versionAction = {
  name: "version",
  requiredUserPermissions: [],
  description: "Check the bot's version.",
  async execute({ reply }) {
    await reply(`Aripa version ${packageJson.version}`);
  },
} satisfies Action;

export default versionAction;
