import { EmbedBuilder, type User } from "discord.js";
import type { Action, ActionContext, ActionReply } from "@/bot/action.ts";
import { safeReplyWithOptions } from "@/bot/action-context.ts";
import { resolveUserReference } from "@/commands/command-resolvers.ts";

const avatarAction = {
  name: "avatar",
  requiredUserPermissions: [],
  description: "Show the avatar for the target or the invoking user.",
  usage: "[target]",
  async execute(context) {
    return showAvatar(context);
  },
} satisfies Action;

export default avatarAction;

export async function showAvatar(context: ActionContext): Promise<ActionReply> {
  const target = await resolveAvatarTarget(context);

  if (!target.ok) {
    return context.reply(target.message);
  }

  const avatarUrl = target.user.displayAvatarURL({ size: 1024 });

  if (context.isAgent) {
    return context.reply(`Avatar for ${target.user.tag ?? target.user.username}: ${avatarUrl}`);
  }

  const embed = new EmbedBuilder()
    .setTitle(`Avatar: ${target.user.tag ?? target.user.username}`)
    .setColor(0x5865f2)
    .setImage(avatarUrl)
    .setDescription(`[Open Avatar](${avatarUrl})`);

  return safeReplyWithOptions(
    context.message,
    {
      embeds: [embed],
    },
    context.log,
  );
}

async function resolveAvatarTarget(
  context: ActionContext,
): Promise<{ ok: true; user: User } | { ok: false; message: string }> {
  const rawTarget = context.args[0];
  const targetUserId = rawTarget
    ? resolveUserId(rawTarget)
    : { ok: true as const, userId: context.message.author.id };

  if (!targetUserId.ok) {
    return { ok: false, message: targetUserId.message };
  }

  const user = await context.client.users.fetch(targetUserId.userId).catch(() => null);

  if (!user) {
    return { ok: false, message: "I could not find that user." };
  }

  return { ok: true, user };
}

function resolveUserId(raw: string): { ok: true; userId: string } | { ok: false; message: string } {
  const resolved = resolveUserReference(raw);

  if (!resolved.ok) {
    return { ok: false, message: resolved.error.message };
  }

  return { ok: true, userId: resolved.value.id };
}
