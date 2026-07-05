import type { DiscordLookupStatus } from "@/lib/api-types";
import { readableError } from "@/lib/errors";
import { getEnv } from "@/server/env";

const DISCORD_DIRECTORY_CACHE_TTL_MS = 45_000;
const discordDirectoryCache = new Map<
  string,
  { expiresAtMs: number; directory: DiscordDirectory }
>();
const discordDirectoryInflight = new Map<string, Promise<DiscordDirectory>>();

export async function getDiscordDirectory(
  guildIds: readonly string[],
  activeMutes: readonly { guildId: string; userId: string; muteRoleId: string }[],
): Promise<DiscordDirectory> {
  const token = getEnv("TOKEN")?.trim();
  const cacheKey = discordDirectoryCacheKey(token, guildIds, activeMutes);
  const cached = discordDirectoryCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.directory;
  }

  const inflight = discordDirectoryInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const promise = fetchDiscordDirectory(token, guildIds, activeMutes).then((directory) => {
    discordDirectoryCache.set(cacheKey, {
      expiresAtMs: Date.now() + DISCORD_DIRECTORY_CACHE_TTL_MS,
      directory,
    });
    return directory;
  });
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
    await Promise.all(
      guildIds.map(async (guildId) => {
        const [guild, channels, roles] = await Promise.all([
          discordGet<DiscordGuildResponse>(`/guilds/${guildId}`, token),
          discordGet<DiscordChannelResponse[]>(`/guilds/${guildId}/channels`, token).catch(
            () => [],
          ),
          discordGet<DiscordRoleResponse[]>(`/guilds/${guildId}/roles`, token).catch(() => []),
        ]);

        output.guilds.set(guildId, {
          id: guild.id,
          name: guild.name,
          iconUrl: guild.icon
            ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`
            : null,
        });

        for (const channel of channels) {
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
): string {
  const guildKey = [...guildIds].sort().join(",");
  const muteKey = activeMutes
    .map((mute) => `${mute.guildId}:${mute.userId}:${mute.muteRoleId}`)
    .sort()
    .join(",");

  return `${token ? hashString(token) : "no-token"}|${guildKey}|${muteKey}`;
}

async function discordGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: {
      Authorization: `Bot ${token}`,
      "User-Agent": "aripa-dashboard",
    },
  });

  if (!response.ok) {
    throw new Error(`Discord lookup failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
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
