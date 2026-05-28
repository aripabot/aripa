import type { Client, User } from "discord.js";
import { config } from "@/config/config.ts";

export interface OperatorUser {
  id: string;
  user: User;
}

export function getOperatorUserId(
  operatorUserId: string | null = config.operatorUserId,
): string | null {
  return operatorUserId;
}

export async function getOperatorUser(
  client: Pick<Client, "users">,
  operatorUserId: string | null = getOperatorUserId(),
): Promise<OperatorUser | null> {
  if (!operatorUserId) {
    return null;
  }

  const user = await client.users.fetch(operatorUserId).catch(() => null);
  return user ? { id: operatorUserId, user } : null;
}
