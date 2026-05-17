import type { Action, ActionContext, ActionReply } from "@/bot/action.ts";
import { getGuildConfigStore, type GuildConfigStore } from "@/config/guild-config-store.ts";

const MAX_BAN_MESSAGE_LENGTH = 1_800;

const banMessageAction = {
  name: "banmessage",
  requiredUserPermissions: ["ManageGuild"],
  aliases: ["ban-message"],
  description: "Set the guild ban message text.",
  usage: "<message | none>",
  async execute(context) {
    return setBanMessage(context);
  },
} satisfies Action;

export default banMessageAction;

export async function setBanMessage(
  context: ActionContext,
  store: GuildConfigStore = getGuildConfigStore(),
): Promise<ActionReply> {
  if (!context.message.inGuild() || !context.message.guildId) {
    return context.reply("Ban messages can only be configured from inside a server.");
  }

  const banMessage = context.args.join(" ").trim();

  if (!banMessage) {
    const currentBanMessage = store.getBanMessage(context.message.guildId);
    const lines = [`Usage: \`${context.prefix}${context.actionName} <message | none>\``];

    if (currentBanMessage) {
      lines.push(`Current ban message:\n${currentBanMessage}`);
    }

    return context.reply(lines.join("\n\n"));
  }

  if (banMessage.toLowerCase() === "none") {
    const config = store.setBanMessage(context.message.guildId, null);

    context.log
      .withMetadata({
        guildId: config.guildId,
        userId: context.message.author.id,
      })
      .info("Cleared guild ban message.");

    return context.reply("Ban message cleared.");
  }

  if (banMessage.length > MAX_BAN_MESSAGE_LENGTH) {
    return context.reply(
      `Ban message must be at most ${MAX_BAN_MESSAGE_LENGTH} characters so it can fit with ban details in one Discord message.`,
    );
  }

  const config = store.setBanMessage(context.message.guildId, banMessage);

  context.log
    .withMetadata({
      guildId: config.guildId,
      userId: context.message.author.id,
    })
    .info("Configured guild ban message.");

  return context.reply(`Ban message set to:\n${banMessage}`);
}
