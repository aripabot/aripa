import type { Action } from "@aripabot/core/bot/action.ts";
import { config } from "@aripabot/core/config/config.ts";

const modelAction = {
  name: "model",
  requiredUserPermissions: [],
  description: "Check the current agent model.",
  async execute({ reply }) {
    await reply(`Current agent model: \`${config.models.agent.model}\`.`);
  },
} satisfies Action;

export default modelAction;
