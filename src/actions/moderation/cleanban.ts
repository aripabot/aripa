import type { Action, ActionContext, ActionReply } from "@/bot/action.ts";
import { resolveCount } from "@/commands/command-resolvers.ts";
import { banUserWithDeleteDays } from "@/actions/moderation/ban.ts";
import type { GuildConfigStore } from "@/config/guild-config-store.ts";
import { replyUsage } from "@/moderation/moderation-helpers.ts";

const cleanbanAction = {
  name: "cleanban",
  requiredUserPermissions: ["BanMembers"],
  description: "Ban a user and delete 1-7 days of their recent messages.",
  usage: "<days 1-7> <target> [reason]",
  async execute(context) {
    return cleanbanMember(context);
  },
} satisfies Action;

export default cleanbanAction;

export async function cleanbanMember(
  context: ActionContext,
  dependencies: { guildConfigStore?: GuildConfigStore } = {},
): Promise<ActionReply> {
  const rawDays = context.args[0];

  if (!rawDays) {
    return replyUsage(context, "<days 1-7> <target> [reason]");
  }

  const resolvedDays = resolveCount(rawDays, { min: 1, max: 7, label: "message delete days" });

  if (!resolvedDays.ok) {
    return context.reply(resolvedDays.error.message);
  }

  if (!context.args[1]) {
    return replyUsage(context, "<days 1-7> <target> [reason]");
  }

  return banUserWithDeleteDays(context, resolvedDays.value, "Cleanban", dependencies);
}
