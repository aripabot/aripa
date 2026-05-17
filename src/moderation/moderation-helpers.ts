import { RESTJSONErrorCodes } from "discord-api-types/v10";
import type {
  BaseMessageOptions,
  ColorResolvable,
  EmbedField,
  Guild,
  GuildMember,
  MessageCreateOptions,
  PermissionResolvable,
  Role,
  User,
} from "discord.js";
import { EmbedBuilder } from "discord.js";
import type { ActionContext } from "@/bot/action.ts";
import type { GuildConfigStore } from "@/config/guild-config-store.ts";
import { sendModLog } from "@/moderation/mod-log.ts";

const DISCORD_AUDIT_REASON_LIMIT = 512;
const DISCORD_MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1_000;

export interface ModerationSubject {
  user: User;
  member: GuildMember | null;
}

export async function resolveModerationSubject(
  context: ActionContext,
  userId: string,
): Promise<ModerationSubject | null> {
  const user = await context.client.users.fetch(userId).catch(() => null);

  if (!user) {
    return null;
  }

  const member = context.message.guild
    ? await context.message.guild.members.fetch(userId).catch(() => null)
    : null;

  return { user, member };
}

export async function fetchGuildRole(guild: Guild, roleId: string): Promise<Role | null> {
  const cachedRole = guild.roles.cache.get(roleId);

  if (cachedRole) {
    return cachedRole;
  }

  const fetchedRole = await guild.roles.fetch(roleId).catch(() => null);
  return fetchedRole ?? null;
}

export function ensureGuildActionContext(context: ActionContext, noun: string): Guild | null {
  if (!context.message.inGuild() || !context.message.guild || !context.message.guildId) {
    void context.reply(`${noun} can only be used from inside a server.`);
    return null;
  }

  return context.message.guild;
}

export function ensureReasonTail(args: readonly string[], startIndex: number): string | null {
  const reason = args.slice(startIndex).join(" ").trim();
  return reason || null;
}

export function formatUserLabel(userId: string): string {
  return `<@${userId}> (\`${userId}\`)`;
}

export function formatRoleLabel(roleId: string): string {
  return `<@&${roleId}> (\`${roleId}\`)`;
}

export function formatReason(reason: string | null): string {
  return reason ?? "No reason provided.";
}

export async function sendModerationDm(options: {
  user: User;
  content: string;
  context: ActionContext;
  channel?: SendablePrivateChannel | null;
}): Promise<boolean> {
  try {
    const deliveryTarget = options.channel ?? options.user;

    await deliveryTarget.send({
      content: options.content,
      allowedMentions: {
        parse: [],
        users: [],
        roles: [],
      },
    });

    return true;
  } catch (error) {
    options.context.log
      .withError(error)
      .withMetadata({
        guildId: options.context.message.guildId,
        userId: options.user.id,
      })
      .info("Failed to send moderation DM.");
    return false;
  }
}

export async function prepareModerationDmChannel(options: {
  user: User;
  context: ActionContext;
}): Promise<SendablePrivateChannel | null> {
  try {
    return await options.user.createDM();
  } catch (error) {
    options.context.log
      .withError(error)
      .withMetadata({
        guildId: options.context.message.guildId,
        userId: options.user.id,
      })
      .info("Failed to open moderation DM channel.");
    return null;
  }
}

export async function sendModerationLog(options: {
  context: ActionContext;
  title: string;
  details: string[];
  store?: GuildConfigStore;
  dryRun?: boolean;
}): Promise<boolean> {
  const guildId = options.context.message.guildId;

  if (!guildId) {
    return false;
  }

  const embed = buildModerationLogEmbed({
    guildName: options.context.message.guild?.name ?? null,
    title: options.title,
    details: options.details,
    dryRun: options.dryRun ?? false,
  });

  return sendModLog({
    client: options.context.client,
    guildId,
    log: options.context.log,
    store: options.store,
    embeds: [embed],
  });
}

export function buildModerationLogEmbed(options: {
  guildName: string | null;
  title: string;
  details: string[];
  dryRun?: boolean;
}): EmbedBuilder {
  const dryRun = options.dryRun ?? false;
  const embed = new EmbedBuilder()
    .setTitle(truncateEmbedText(dryRun ? `${options.title} (Dry Run)` : options.title, 256))
    .setColor(resolveModerationLogColor(options.title))
    .setTimestamp(new Date());

  const fields: EmbedField[] = [];

  if (dryRun) {
    fields.push({ name: "Dry Run", value: "Yes", inline: true });
  }

  for (const detail of options.details) {
    fields.push(parseModerationLogField(detail));
  }

  if (fields.length > 0) {
    embed.addFields(fields);
  }

  if (options.guildName) {
    embed.setFooter({ text: truncateEmbedText(options.guildName, 2048) });
  }

  return embed;
}

export function buildAuditReason(
  context: ActionContext,
  action: string,
  reason: string | null,
): string {
  const moderatorTag = `${context.message.author.username} (${context.message.author.id})`;
  const fullReason = `${action} by ${moderatorTag}${reason ? `: ${reason}` : ""}`;

  return fullReason.length <= DISCORD_AUDIT_REASON_LIMIT
    ? fullReason
    : `${fullReason.slice(0, DISCORD_AUDIT_REASON_LIMIT - 3)}...`;
}

export function validateTimeoutDuration(milliseconds: number): string | null {
  if (milliseconds < 1_000) {
    return "Timeouts must be at least 1 second.";
  }

  if (milliseconds > DISCORD_MAX_TIMEOUT_MS) {
    return "Timeouts cannot be longer than 28 days.";
  }

  return null;
}

export function formatDuration(milliseconds: number): string {
  const units = [
    { label: "week", value: 7 * 24 * 60 * 60 * 1_000 },
    { label: "day", value: 24 * 60 * 60 * 1_000 },
    { label: "hour", value: 60 * 60 * 1_000 },
    { label: "minute", value: 60 * 1_000 },
    { label: "second", value: 1_000 },
  ];

  for (const unit of units) {
    if (milliseconds >= unit.value && milliseconds % unit.value === 0) {
      const amount = milliseconds / unit.value;
      return `${amount} ${unit.label}${amount === 1 ? "" : "s"}`;
    }
  }

  return `${Math.ceil(milliseconds / 1_000)} seconds`;
}

export function getRoleMuteUnmuteReason(reason: string | null): string {
  return reason ? `Temporary mute expired: ${reason}` : "Temporary mute expired.";
}

export function isDiscordUnknownBanError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeDiscordError = error as { code?: unknown };
  return maybeDiscordError.code === RESTJSONErrorCodes.UnknownBan;
}

export function botCanManageRole(role: Role): boolean {
  return role.editable;
}

export function botCanManageMemberRoles(member: GuildMember): boolean {
  return member.manageable;
}

export function botCanTimeoutMember(member: GuildMember): boolean {
  return member.moderatable;
}

export function botCanKickMember(member: GuildMember): boolean {
  return member.kickable;
}

export function botCanBanMember(member: GuildMember): boolean {
  return member.bannable;
}

export function getInvokerHierarchyErrorForMember(
  context: ActionContext,
  member: GuildMember,
  action: string,
): string | null {
  const invokerMember = context.invoker.member ?? context.message.member;

  if (!invokerMember || invokerMember.id === member.guild.ownerId) {
    return null;
  }

  if (member.id === member.guild.ownerId) {
    return `You cannot ${action} the server owner.`;
  }

  if (highestRolePosition(invokerMember) <= highestRolePosition(member)) {
    return `You cannot ${action} ${formatUserLabel(member.id)} because their highest role is equal to or above yours.`;
  }

  return null;
}

export function getInvokerHierarchyErrorForRole(
  context: ActionContext,
  role: Role,
  action: string,
): string | null {
  const invokerMember = context.invoker.member ?? context.message.member;

  if (!invokerMember || invokerMember.id === role.guild.ownerId) {
    return null;
  }

  if (highestRolePosition(invokerMember) <= role.position) {
    return `You cannot ${action} ${formatRoleLabel(role.id)} because it is equal to or above your highest role.`;
  }

  return null;
}

export function hasBotPermissions(
  member: GuildMember,
  permissions: readonly PermissionResolvable[],
): boolean {
  const me = member.guild.members.me;
  return permissions.every((permission) => me?.permissions.has(permission));
}

export interface DeleteMessagesResult {
  deleted: number;
  failed: number;
}

export async function deleteMessagesIndividually(
  messages: readonly { delete: () => Promise<unknown> }[],
): Promise<DeleteMessagesResult> {
  let deleted = 0;
  let failed = 0;

  for (const message of messages) {
    try {
      await message.delete();
      deleted += 1;
    } catch {
      failed += 1;
    }
  }

  return { deleted, failed };
}

export function replyUsage(
  context: ActionContext,
  usage: string,
): Promise<import("@/bot/action.ts").ActionReply> {
  return context.reply(`Usage: \`${context.prefix}${context.actionName} ${usage}\``);
}

export function parseTrailingDryRunFlag(args: readonly string[]): {
  args: string[];
  dryRun: boolean;
} {
  const lastArg = args.at(-1)?.toLowerCase();

  if (lastArg === "--dry-run" || lastArg === "--dryrun" || lastArg === "-d") {
    return {
      args: args.slice(0, -1),
      dryRun: true,
    };
  }

  return {
    args: [...args],
    dryRun: false,
  };
}

export function isMissingBotPermissionsForRoleAction(
  role: Role,
  member: GuildMember,
): string | null {
  if (!botCanManageRole(role)) {
    return `I cannot manage ${formatRoleLabel(role.id)} because my highest role is not above it.`;
  }

  if (!botCanManageMemberRoles(member)) {
    return `I cannot manage ${formatUserLabel(member.id)} because their highest role is above mine.`;
  }

  return null;
}

interface SendablePrivateChannel {
  send: (options: string | MessageCreateOptions | BaseMessageOptions) => Promise<unknown>;
}

function parseModerationLogField(detail: string): EmbedField {
  const separatorIndex = detail.indexOf(": ");

  if (separatorIndex === -1) {
    return {
      name: "Details",
      value: truncateEmbedText(detail, 1024),
      inline: false,
    };
  }

  const name = detail.slice(0, separatorIndex).trim() || "Details";
  const value = detail.slice(separatorIndex + 2).trim() || "None";

  return {
    name: truncateEmbedText(name, 256),
    value: truncateEmbedText(value, 1024),
    inline: isModerationLogFieldInline(name, value),
  };
}

function isModerationLogFieldInline(name: string, value: string): boolean {
  if (name === "Reason" || name === "Error") {
    return false;
  }

  return value.length <= 80;
}

function resolveModerationLogColor(title: string): ColorResolvable {
  const normalizedTitle = title.toLowerCase();

  if (normalizedTitle.includes("warn")) {
    return 0xf59e0b;
  }

  if (normalizedTitle.includes("ban")) {
    return 0xed4245;
  }

  if (normalizedTitle.includes("kick")) {
    return 0x3498db;
  }

  if (normalizedTitle.includes("mute")) {
    return 0x99aab5;
  }

  return 0x5865f2;
}

function truncateEmbedText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function highestRolePosition(member: GuildMember): number {
  return member.roles.highest.position;
}
