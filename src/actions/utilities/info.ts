import { EmbedBuilder, type GuildMember, type User } from "discord.js";
import type { Action, ActionContext, ActionReply } from "@/bot/action.ts";
import { safeReplyWithOptions } from "@/bot/action-context.ts";
import { resolveUserReference } from "@/commands/command-resolvers.ts";

const infoAction = {
  name: "info",
  requiredUserPermissions: [],
  description: "Show detailed user info for the target or the invoking user.",
  usage: "[target]",
  async execute(context) {
    return showUserInfo(context);
  },
} satisfies Action;

export default infoAction;

export async function showUserInfo(context: ActionContext): Promise<ActionReply> {
  const target = await resolveTargetUser(context);

  if (!target.ok) {
    return context.reply(target.message);
  }

  const embed = buildUserInfoEmbed(context, target.user, target.member);

  if (context.isAgent) {
    return context.reply(renderUserInfoSummary(target.user, target.member));
  }

  return safeReplyWithOptions(
    context.message,
    {
      embeds: [embed],
    },
    context.log,
  );
}

async function resolveTargetUser(
  context: ActionContext,
): Promise<{ ok: true; user: User; member: GuildMember | null } | { ok: false; message: string }> {
  const rawTarget = context.args[0];
  const targetUserId = rawTarget
    ? resolveUserId(rawTarget)
    : ({ ok: true, userId: context.message.author.id } as const);

  if (!targetUserId.ok) {
    return { ok: false, message: targetUserId.message };
  }

  const user = await context.client.users.fetch(targetUserId.userId).catch(() => null);

  if (!user) {
    return { ok: false, message: "I could not find that user." };
  }

  const member =
    context.message.inGuild() && context.message.guild
      ? await context.message.guild.members.fetch(targetUserId.userId).catch(() => null)
      : null;

  return { ok: true, user, member };
}

function resolveUserId(raw: string): { ok: true; userId: string } | { ok: false; message: string } {
  const resolved = resolveUserReference(raw);

  if (!resolved.ok) {
    return { ok: false, message: resolved.error.message };
  }

  return { ok: true, userId: resolved.value.id };
}

function buildUserInfoEmbed(
  context: ActionContext,
  user: User,
  member: GuildMember | null,
): EmbedBuilder {
  const roles = member
    ? [...member.roles.cache.values()]
        .filter((role) => role.id !== member.guild.id)
        .sort((left, right) => right.position - left.position)
        .map((role) => role.toString())
    : [];

  const embed = new EmbedBuilder()
    .setTitle(`User Info: ${user.tag ?? user.username}`)
    .setThumbnail(user.displayAvatarURL({ size: 512 }))
    .setColor(member?.displayColor || 0x5865f2)
    .addFields(
      { name: "User ID", value: `\`${user.id}\``, inline: true },
      { name: "Bot", value: user.bot ? "Yes" : "No", inline: true },
      { name: "Created", value: formatTimestamp(user.createdAt), inline: true },
    );

  if (user.globalName) {
    embed.addFields({ name: "Global Name", value: user.globalName, inline: true });
  }

  if (member) {
    embed.addFields(
      { name: "Display Name", value: member.displayName, inline: true },
      {
        name: "Joined Server",
        value: member.joinedAt ? formatTimestamp(member.joinedAt) : "Unknown",
        inline: true,
      },
      {
        name: "Roles",
        value: roles.length > 0 ? truncateRoles(roles) : "No roles",
      },
    );
  }

  embed.addFields({
    name: "Avatar",
    value: `[Open Avatar](${user.displayAvatarURL({ size: 1024 })})`,
    inline: false,
  });

  if (context.message.inGuild() && context.message.guild) {
    embed.setFooter({ text: context.message.guild.name });
  }

  return embed;
}

function renderUserInfoSummary(user: User, member: GuildMember | null): string {
  const lines = [
    `User: ${user.tag ?? user.username}`,
    `ID: ${user.id}`,
    `Bot: ${user.bot ? "Yes" : "No"}`,
    `Created: ${user.createdAt.toISOString()}`,
  ];

  if (user.globalName) {
    lines.push(`Global Name: ${user.globalName}`);
  }

  if (member) {
    lines.push(`Display Name: ${member.displayName}`);
    if (member.joinedAt) {
      lines.push(`Joined Server: ${member.joinedAt.toISOString()}`);
    }
  }

  lines.push(`Avatar: ${user.displayAvatarURL({ size: 1024 })}`);
  return lines.join("\n");
}

function formatTimestamp(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1_000)}:F>`;
}

function truncateRoles(roles: string[]): string {
  const maxLength = 1024;
  let output = "";

  for (const role of roles) {
    const candidate = output ? `${output}, ${role}` : role;

    if (candidate.length > maxLength) {
      return `${output}, ...`;
    }

    output = candidate;
  }

  return output || "No roles";
}
