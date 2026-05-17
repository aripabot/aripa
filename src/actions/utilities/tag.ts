import type { PermissionResolvable } from "discord.js";
import type { Action, ActionContext, ActionReply } from "@/bot/action.ts";
import { getGuildConfigStore, type GuildConfigStore } from "@/config/guild-config-store.ts";

const TAG_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_TAG_CONTENT_LENGTH = 2_000;
const RESERVED_SUBCOMMANDS = new Set(["add", "edit", "remove", "list"]);
const REQUIRED_TAG_MANAGEMENT_PERMISSION = "ManageMessages";

const tagAction = {
  name: "tag",
  requiredUserPermissions: [],
  resolveRequiredUserPermissions(context) {
    return getTagManagementPermissions(context.args);
  },
  description: "View or manage guild tags.",
  usage: "<name> | add <name> <content> | edit <name> <content> | remove <name> | list",
  async execute(context) {
    return handleTagAction(context);
  },
} satisfies Action;

export default tagAction;

export async function handleTagAction(
  context: ActionContext,
  store: GuildConfigStore = getGuildConfigStore(),
): Promise<ActionReply> {
  if (!context.message.inGuild() || !context.message.guildId) {
    return context.reply("Tags can only be used from inside a server.");
  }

  const subcommand = context.args[0]?.toLowerCase();

  if (!subcommand) {
    return context.reply(formatTagUsage(context));
  }

  switch (subcommand) {
    case "add":
      return addTag(context, store);
    case "edit":
      return editTag(context, store);
    case "remove":
      return removeTag(context, store);
    case "list":
      return listTags(context, store);
    default:
      return showTag(context, store, subcommand);
  }
}

async function addTag(context: ActionContext, store: GuildConfigStore): Promise<ActionReply> {
  const permissionError = ensureTagManagementPermission(context);

  if (permissionError) {
    return context.reply(permissionError);
  }

  const rawName = context.args[1];
  const content = context.args.slice(2).join(" ").trim();

  const validationError = validateTagDefinition(rawName, content);

  if (validationError) {
    return context.reply(validationError);
  }

  const existingTag = store.getTag(context.message.guildId!, rawName!);

  if (existingTag) {
    return context.reply(
      `Tag \`${existingTag.name}\` already exists. Use \`${context.prefix}${context.actionName} edit ${existingTag.name} <content>\`.`,
    );
  }

  const tag = store.upsertTag(context.message.guildId!, rawName!, content);

  context.log
    .withMetadata({
      guildId: tag.guildId,
      tagName: tag.name,
      userId: context.message.author.id,
    })
    .info("Created guild tag.");

  return context.reply(`Added tag \`${tag.name}\`.`);
}

async function editTag(context: ActionContext, store: GuildConfigStore): Promise<ActionReply> {
  const permissionError = ensureTagManagementPermission(context);

  if (permissionError) {
    return context.reply(permissionError);
  }

  const rawName = context.args[1];
  const content = context.args.slice(2).join(" ").trim();

  const validationError = validateTagDefinition(rawName, content);

  if (validationError) {
    return context.reply(validationError);
  }

  const existingTag = store.getTag(context.message.guildId!, rawName!);

  if (!existingTag) {
    return context.reply(`Tag \`${rawName}\` does not exist.`);
  }

  const tag = store.upsertTag(context.message.guildId!, rawName!, content);

  context.log
    .withMetadata({
      guildId: tag.guildId,
      tagName: tag.name,
      userId: context.message.author.id,
    })
    .info("Edited guild tag.");

  return context.reply(`Edited tag \`${tag.name}\`.`);
}

async function removeTag(context: ActionContext, store: GuildConfigStore): Promise<ActionReply> {
  const permissionError = ensureTagManagementPermission(context);

  if (permissionError) {
    return context.reply(permissionError);
  }

  const rawName = context.args[1];

  if (!rawName) {
    return context.reply(formatTagUsage(context));
  }

  const validationError = validateTagName(rawName);

  if (validationError) {
    return context.reply(validationError);
  }

  const deleted = store.deleteTag(context.message.guildId!, rawName);

  if (!deleted) {
    return context.reply(`Tag \`${rawName}\` does not exist.`);
  }

  context.log
    .withMetadata({
      guildId: context.message.guildId,
      tagName: rawName.toLowerCase(),
      userId: context.message.author.id,
    })
    .info("Removed guild tag.");

  return context.reply(`Removed tag \`${rawName.toLowerCase()}\`.`);
}

async function listTags(context: ActionContext, store: GuildConfigStore): Promise<ActionReply> {
  const tags = store.listTags(context.message.guildId!);

  if (tags.length === 0) {
    return context.reply("No tags are configured in this server.");
  }

  return context.reply(`Tags: ${tags.map((tag) => `\`${tag.name}\``).join(", ")}`);
}

async function showTag(
  context: ActionContext,
  store: GuildConfigStore,
  name: string,
): Promise<ActionReply> {
  const validationError = validateTagName(name);

  if (validationError) {
    return context.reply(validationError);
  }

  const tag = store.getTag(context.message.guildId!, name);

  if (!tag) {
    return context.reply(`Tag \`${name}\` does not exist.`);
  }

  return context.reply(tag.content);
}

function ensureTagManagementPermission(context: ActionContext): string | null {
  if (context.invoker.can(REQUIRED_TAG_MANAGEMENT_PERMISSION)) {
    return null;
  }

  return `You do not have permission to manage tags. Missing: \`${REQUIRED_TAG_MANAGEMENT_PERMISSION}\`.`;
}

function getTagManagementPermissions(args: readonly string[]): PermissionResolvable[] {
  const subcommand = args[0]?.toLowerCase();

  if (subcommand === "add" || subcommand === "edit" || subcommand === "remove") {
    return [REQUIRED_TAG_MANAGEMENT_PERMISSION];
  }

  return [];
}

function validateTagDefinition(name: string | undefined, content: string): string | null {
  const nameError = validateTagName(name);

  if (nameError) {
    return nameError;
  }

  if (!content) {
    return "Tag content cannot be empty.";
  }

  if (content.length > MAX_TAG_CONTENT_LENGTH) {
    return `Tag content must be at most ${MAX_TAG_CONTENT_LENGTH} characters so it can fit in one Discord message.`;
  }

  return null;
}

function validateTagName(name: string | undefined): string | null {
  if (!name) {
    return "Tag name is required.";
  }

  if (!TAG_NAME_PATTERN.test(name)) {
    return "Tag names must be 1-64 characters and use only letters, numbers, `_`, or `-`, starting with a letter or number.";
  }

  if (RESERVED_SUBCOMMANDS.has(name.toLowerCase())) {
    return `Tag name \`${name.toLowerCase()}\` is reserved for the tag command.`;
  }

  return null;
}

function formatTagUsage(context: ActionContext): string {
  return [
    "Usage:",
    `\`${context.prefix}${context.actionName} <name>\``,
    `\`${context.prefix}${context.actionName} add <name> <content>\``,
    `\`${context.prefix}${context.actionName} edit <name> <content>\``,
    `\`${context.prefix}${context.actionName} remove <name>\``,
    `\`${context.prefix}${context.actionName} list\``,
  ].join("\n");
}
