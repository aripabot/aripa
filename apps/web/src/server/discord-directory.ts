import type { DiscordLookupStatus } from "@/lib/api-types";
import { readableError } from "@/lib/errors";
import { getEnv } from "@/server/env";

const DISCORD_DIRECTORY_CACHE_TTL_MS = 45_000;
const discordDirectoryCache = new Map<
  string,
  { expiresAtMs: number; directory: DiscordDirectory }
>();
const discordDirectoryInflight = new Map<string, Promise<DiscordDirectory>>();

export function resetDiscordDirectoryCacheForTests(): void {
  discordDirectoryCache.clear();
  discordDirectoryInflight.clear();
}

export async function getDiscordDirectory(
  guildIds: readonly string[],
  activeMutes: readonly { guildId: string; userId: string; muteRoleId: string }[],
  guildConfigs: readonly {
    guildId: string;
    logChannelId: string | null;
    muteRoleId: string | null;
  }[],
): Promise<DiscordDirectory> {
  const token = getEnv("TOKEN")?.trim();
  const cacheKey = discordDirectoryCacheKey(token, guildIds, activeMutes, guildConfigs);
  const cached = discordDirectoryCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.directory;
  }

  const inflight = discordDirectoryInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const promise = fetchDiscordDirectory(token, guildIds, activeMutes, guildConfigs).then(
    (directory) => {
      discordDirectoryCache.set(cacheKey, {
        expiresAtMs: Date.now() + DISCORD_DIRECTORY_CACHE_TTL_MS,
        directory,
      });
      return directory;
    },
  );
  discordDirectoryInflight.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    discordDirectoryInflight.delete(cacheKey);
  }
}

async function fetchDiscordDirectory(
  token: string | undefined,
  guildIds: readonly string[],
  activeMutes: readonly { guildId: string; userId: string; muteRoleId: string }[],
  guildConfigs: readonly {
    guildId: string;
    logChannelId: string | null;
    muteRoleId: string | null;
  }[],
): Promise<DiscordDirectory> {
  const output = {
    lookup: {
      available: Boolean(token),
      detail: token
        ? "Discord names are loaded from the bot token."
        : "Set TOKEN to show server, channel, role, and member names.",
    },
    guilds: new Map<string, DiscordGuildSummary>(),
    channels: new Map<string, DiscordNamedResource>(),
    roles: new Map<string, DiscordNamedResource>(),
    members: new Map<string, DiscordMemberSummary>(),
  };

  if (!token) {
    return output;
  }

  try {
    const logChannelIdsByGuild = groupConfiguredIds(
      guildConfigs,
      (guildConfig) => guildConfig.logChannelId,
    );
    const roleIdsByGuild = groupConfiguredIds(
      [
        ...guildConfigs.map((guildConfig) => ({
          guildId: guildConfig.guildId,
          id: guildConfig.muteRoleId,
        })),
        ...activeMutes.map((mute) => ({ guildId: mute.guildId, id: mute.muteRoleId })),
      ],
      (entry) => entry.id,
    );

    await Promise.all(
      guildIds.map(async (guildId) => {
        const [guild, channels, roles] = await Promise.all([
          discordGet<DiscordGuildResponse>(`/guilds/${guildId}`, token),
          Promise.all(
            [...(logChannelIdsByGuild.get(guildId) ?? [])].map((channelId) =>
              discordGet<DiscordChannelResponse>(`/channels/${channelId}`, token).catch(() => null),
            ),
          ),
          roleIdsByGuild.has(guildId)
            ? discordGet<DiscordRoleResponse[]>(`/guilds/${guildId}/roles`, token).catch(() => [])
            : [],
        ]);

        output.guilds.set(guildId, {
          id: guild.id,
          name: guild.name,
          iconUrl: guild.icon
            ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`
            : null,
        });

        for (const channel of channels) {
          if (!channel) {
            continue;
          }

          output.channels.set(channelKey(guildId, channel.id), {
            id: channel.id,
            name: channel.name,
          });
        }

        for (const role of roles) {
          output.roles.set(roleKey(guildId, role.id), { id: role.id, name: role.name });
        }
      }),
    );

    await Promise.all(
      activeMutes.map(async (mute) => {
        const member = await discordGet<DiscordMemberResponse>(
          `/guilds/${mute.guildId}/members/${mute.userId}`,
          token,
        ).catch(() => null);

        if (!member) {
          return;
        }

        const user = member.user;
        output.members.set(memberKey(mute.guildId, mute.userId), {
          userId: mute.userId,
          username: user?.global_name || user?.username || null,
          displayName: member.nick || user?.global_name || user?.username || null,
          avatarUrl: member.avatar
            ? `https://cdn.discordapp.com/guilds/${mute.guildId}/users/${mute.userId}/avatars/${member.avatar}.png?size=64`
            : user?.avatar
              ? `https://cdn.discordapp.com/avatars/${mute.userId}/${user.avatar}.png?size=64`
              : null,
        });
      }),
    );
  } catch (error) {
    output.lookup = {
      available: false,
      detail: readableError(error),
    };
  }

  return output;
}

function discordDirectoryCacheKey(
  token: string | undefined,
  guildIds: readonly string[],
  activeMutes: readonly { guildId: string; userId: string; muteRoleId: string }[],
  guildConfigs: readonly {
    guildId: string;
    logChannelId: string | null;
    muteRoleId: string | null;
  }[],
): string {
  const guildKey = [...guildIds].sort().join(",");
  const muteKey = activeMutes
    .map((mute) => `${mute.guildId}:${mute.userId}:${mute.muteRoleId}`)
    .sort()
    .join(",");
  const configKey = guildConfigs
    .map(
      (guildConfig) =>
        `${guildConfig.guildId}:${guildConfig.logChannelId ?? ""}:${guildConfig.muteRoleId ?? ""}`,
    )
    .sort()
    .join(",");

  return `${token ? hashString(token) : "no-token"}|${guildKey}|${muteKey}|${configKey}`;
}

async function discordGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: {
      Authorization: `Bot ${token}`,
      "User-Agent": "aripa-dashboard",
    },
  });

  if (!response.ok) {
    if (response.status === 429) {
      const retryAfterSeconds =
        response.headers.get("retry-after") ?? response.headers.get("x-ratelimit-reset-after");
      const retryDetail = retryAfterSeconds
        ? ` Retry after ${retryAfterSeconds} seconds.`
        : " Retry after Discord's rate limit resets.";
      throw new Error(
        `Discord lookup rate limited: ${response.status} ${response.statusText}.${retryDetail}`,
      );
    }

    throw new Error(`Discord lookup failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

function groupConfiguredIds<T extends { guildId: string }>(
  items: readonly T[],
  getId: (item: T) => string | null,
): Map<string, Set<string>> {
  const idsByGuild = new Map<string, Set<string>>();

  for (const item of items) {
    const id = getId(item);
    if (!id) {
      continue;
    }

    const existing = idsByGuild.get(item.guildId);
    if (existing) {
      existing.add(id);
      continue;
    }

    idsByGuild.set(item.guildId, new Set([id]));
  }

  return idsByGuild;
}

export function channelKey(guildId: string, channelId: string): string {
  return `${guildId}:${channelId}`;
}

export function roleKey(guildId: string, roleId: string): string {
  return `${guildId}:${roleId}`;
}

export function memberKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function hashString(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}

interface DiscordGuildSummary {
  id: string;
  name: string;
  iconUrl: string | null;
}

interface DiscordNamedResource {
  id: string;
  name: string;
}

interface DiscordMemberSummary {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface DiscordDirectory {
  lookup: DiscordLookupStatus;
  guilds: Map<string, DiscordGuildSummary>;
  channels: Map<string, DiscordNamedResource>;
  roles: Map<string, DiscordNamedResource>;
  members: Map<string, DiscordMemberSummary>;
}

interface DiscordGuildResponse {
  id: string;
  name: string;
  icon: string | null;
}

interface DiscordChannelResponse {
  id: string;
  name: string;
}

interface DiscordRoleResponse {
  id: string;
  name: string;
}

interface DiscordMemberResponse {
  nick: string | null;
  avatar: string | null;
  user?: {
    id: string;
    username: string;
    global_name?: string | null;
    avatar: string | null;
  };
}
