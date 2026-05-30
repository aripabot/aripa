import type { Action } from "@aripabot/core/bot/action.ts";

const helpAction = {
  name: "help",
  requiredUserPermissions: [],
  aliases: ["actions"],
  description: "List available actions.",
  async execute({ actions, prefix, reply }) {
    const visibleActions = actions
      .all()
      .filter((action) => !action.hidden)
      .sort((left, right) => left.name.localeCompare(right.name));

    if (visibleActions.length === 0) {
      await reply("No actions are loaded.");
      return;
    }

    const lines = visibleActions.map((action) => {
      const usage = action.usage ? ` ${action.usage}` : "";
      const description = action.description ? ` - ${action.description}` : "";
      return `\`${prefix}${action.name}${usage}\`${description}`;
    });

    await reply(`Available actions:\n${lines.join("\n")}`);
  },
} satisfies Action;

export default helpAction;
