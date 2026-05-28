import { describe, expect, test } from "vitest";
import { getOperatorUser, getOperatorUserId } from "@/bot/operator.ts";

describe("getOperatorUserId", () => {
  test("returns the configured operator user id", () => {
    expect(getOperatorUserId("123456789012345678")).toBe("123456789012345678");
    expect(getOperatorUserId(null)).toBeNull();
  });
});

describe("getOperatorUser", () => {
  test("fetches the configured Discord user", async () => {
    const user = { id: "123456789012345678", username: "operator" };
    const client = {
      users: {
        fetch: async (userId: string) => (userId === user.id ? user : null),
      },
    };

    await expect(getOperatorUser(client as never, user.id)).resolves.toEqual({
      id: user.id,
      user,
    });
  });

  test("returns null when no operator is configured or the user cannot be fetched", async () => {
    const client = {
      users: {
        fetch: async () => {
          throw new Error("missing");
        },
      },
    };

    await expect(getOperatorUser(client as never, null)).resolves.toBeNull();
    await expect(getOperatorUser(client as never, "123456789012345678")).resolves.toBeNull();
  });
});
