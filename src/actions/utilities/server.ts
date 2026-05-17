import { EmbedBuilder } from "discord.js";
import type { Action, ActionContext, ActionReply } from "@/bot/action.ts";
import { safeReplyWithOptions } from "@/bot/action-context.ts";

const serverAction = {
  name: "server",
  requiredUserPermissions: [],
  description: "Show detailed info about the current server.",
  async execute(context) {
    return showServerInfo(context);
  },
} satisfies Action;

export default serverAction;

export async function showServerInfo(context: ActionContext): Promise<ActionReply> {
  if (!context.message.inGuild() || !context.message.guild) {
    return context.reply("Server info can only be shown from inside a server.");
  }

  const guild = context.message.guild;
  const owner = await guild.fetchOwner().catch(() => null);

  const embed = new EmbedBuilder()
    .setTitle(`Server Info: ${guild.name}`)
    .setColor(0x57f287)
    .setThumbnail(guild.iconURL({ size: 512 }))
    .addFields(
      { name: "Server ID", value: `\`${guild.id}\``, inline: true },
      {
        name: "Owner",
        value: owner ? `${owner.user.tag} (\`${owner.id}\`)` : "Unknown",
        inline: true,
      },
      {
        name: "Created",
        value: `<t:${Math.floor(guild.createdAt.getTime() / 1_000)}:F>`,
        inline: true,
      },
      { name: "Members", value: String(guild.memberCount), inline: true },
      { name: "Channels", value: String(guild.channels.cache.size), inline: true },
      { name: "Roles", value: String(guild.roles.cache.size), inline: true },
      { name: "Boost Tier", value: String(guild.premiumTier), inline: true },
      { name: "Boosts", value: String(guild.premiumSubscriptionCount ?? 0), inline: true },
      { name: "Emoji", value: String(guild.emojis.cache.size), inline: true },
    );

  if (guild.description) {
    embed.setDescription(guild.description);
  }

  if (context.isAgent) {
    const lines = [
      `Server: ${guild.name}`,
      `ID: ${guild.id}`,
      `Owner: ${owner ? `${owner.user.tag} (${owner.id})` : "Unknown"}`,
      `Created: ${guild.createdAt.toISOString()}`,
      `Members: ${guild.memberCount}`,
      `Channels: ${guild.channels.cache.size}`,
      `Roles: ${guild.roles.cache.size}`,
      `Boost Tier: ${guild.premiumTier}`,
      `Boosts: ${guild.premiumSubscriptionCount ?? 0}`,
      `Emoji: ${guild.emojis.cache.size}`,
    ];

    if (guild.iconURL()) {
      lines.push(`Icon: ${guild.iconURL({ size: 1024 })}`);
    }

    return context.reply(lines.join("\n"));
  }

  return safeReplyWithOptions(
    context.message,
    {
      embeds: [embed],
    },
    context.log,
  );
}
