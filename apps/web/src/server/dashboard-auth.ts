import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type BinaryLike,
  type ScryptOptions,
} from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, normalize } from "node:path";
import { promisify } from "node:util";

export const DASHBOARD_SESSION_COOKIE = "aripa_dashboard_session";

const defaultAuthPath = normalize(`${process.cwd()}/../../.aripa-dashboard-auth.json`);
const passwordByteLength = 32;
const sessionSecretByteLength = 32;
const sessionTtlSeconds = 7 * 24 * 60 * 60;
const scryptParameters = {
  N: 32768,
  r: 8,
  p: 1,
  keyLength: 64,
} as const;
const scryptAsync: (
  password: BinaryLike,
  salt: BinaryLike,
  keyLength: number,
  options: ScryptOptions,
) => Promise<Buffer> = promisify(scryptCallback);

export type DashboardAuthState =
  | { status: "not_configured"; authPath: string }
  | { status: "locked"; authPath: string }
  | { status: "authenticated"; authPath: string };

interface DashboardAuthFile {
  version: 1;
  passwordHash: DashboardPasswordHash;
  sessionSecret: string;
  createdAt: string;
  updatedAt: string;
}

interface DashboardPasswordHash {
  algorithm: "scrypt";
  parameters: typeof scryptParameters;
  salt: string;
  hash: string;
}

export interface CreateDashboardPasswordResult {
  authPath: string;
  password: string;
  createdAt: string;
  replacedExisting: boolean;
}

export function resolveDashboardAuthPath(): string {
  return process.env.DASHBOARD_AUTH_PATH?.trim() || defaultAuthPath;
}

export async function hasDashboardPassword(): Promise<boolean> {
  return (await readAuthFile()) !== null;
}

export async function getDashboardAuthState(
  cookieValue?: string | null,
): Promise<DashboardAuthState> {
  const authFile = await readAuthFile();
  const authPath = resolveDashboardAuthPath();

  if (!authFile) {
    return { status: "not_configured", authPath };
  }

  if (cookieValue && verifySessionCookie(cookieValue, authFile)) {
    return { status: "authenticated", authPath };
  }

  return { status: "locked", authPath };
}

export async function createDashboardPassword(
  options: {
    force?: boolean;
  } = {},
): Promise<CreateDashboardPasswordResult> {
  const authPath = resolveDashboardAuthPath();
  const existing = await readAuthFile();

  if (existing && !options.force) {
    throw new Error(
      `Dashboard password already exists at ${authPath}. Run with --force to replace it.`,
    );
  }

  const password = randomBytes(passwordByteLength).toString("base64url");
  const passwordHash = await hashDashboardPassword(password);
  const now = new Date().toISOString();
  const authFile: DashboardAuthFile = {
    version: 1,
    passwordHash,
    sessionSecret: randomBytes(sessionSecretByteLength).toString("base64url"),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await writeAuthFile(authPath, authFile);

  return {
    authPath,
    password,
    createdAt: now,
    replacedExisting: Boolean(existing),
  };
}

export async function verifyDashboardPassword(password: string): Promise<boolean> {
  const authFile = await readAuthFile();

  if (!authFile) {
    return false;
  }

  return verifyPassword(password, authFile.passwordHash);
}

export async function createDashboardSessionCookie(request: Request): Promise<string> {
  const authFile = await requireAuthFile();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + sessionTtlSeconds;
  const payload = {
    v: 1,
    iat: issuedAt,
    exp: expiresAt,
    nonce: randomBytes(16).toString("base64url"),
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signSessionPayload(encodedPayload, authFile.sessionSecret);

  return serializeCookie(DASHBOARD_SESSION_COOKIE, `${encodedPayload}.${signature}`, {
    maxAge: sessionTtlSeconds,
    secure: isSecureRequest(request),
  });
}

export function createDashboardLogoutCookie(request: Request): string {
  return serializeCookie(DASHBOARD_SESSION_COOKIE, "", {
    maxAge: 0,
    secure: isSecureRequest(request),
  });
}

export function getDashboardSessionCookieFromHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const segment of cookieHeader.split(";")) {
    const [name, ...valueParts] = segment.trim().split("=");

    if (name === DASHBOARD_SESSION_COOKIE) {
      return valueParts.join("=") || null;
    }
  }

  return null;
}

async function hashDashboardPassword(password: string): Promise<DashboardPasswordHash> {
  const salt = new Uint8Array(randomBytes(16));
  const hash = await deriveScryptKey(password, salt, scryptParameters.keyLength);

  return {
    algorithm: "scrypt",
    parameters: scryptParameters,
    salt: encodeBytes(salt),
    hash: encodeBytes(hash),
  };
}

async function verifyPassword(password: string, stored: DashboardPasswordHash): Promise<boolean> {
  const expected = decodeBytes(stored.hash);
  const salt = decodeBytes(stored.salt);
  const actual = await deriveScryptKey(password, salt, stored.parameters.keyLength);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function deriveScryptKey(
  password: string,
  salt: Uint8Array,
  keyLength: number,
): Promise<Uint8Array> {
  const key = await scryptAsync(password, salt, keyLength, {
    N: scryptParameters.N,
    r: scryptParameters.r,
    p: scryptParameters.p,
    maxmem: 64 * 1024 * 1024,
  });

  return new Uint8Array(key);
}

async function readAuthFile(): Promise<DashboardAuthFile | null> {
  try {
    return parseAuthFile(await readFile(resolveDashboardAuthPath(), "utf8"));
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

async function requireAuthFile(): Promise<DashboardAuthFile> {
  const authFile = await readAuthFile();

  if (!authFile) {
    throw new Error("Dashboard password has not been created.");
  }

  return authFile;
}

function parseAuthFile(text: string): DashboardAuthFile {
  const parsed = JSON.parse(text) as Partial<DashboardAuthFile>;

  if (
    parsed.version !== 1 ||
    !parsed.passwordHash ||
    parsed.passwordHash.algorithm !== "scrypt" ||
    parsed.passwordHash.parameters?.N !== scryptParameters.N ||
    parsed.passwordHash.parameters.r !== scryptParameters.r ||
    parsed.passwordHash.parameters.p !== scryptParameters.p ||
    parsed.passwordHash.parameters.keyLength !== scryptParameters.keyLength ||
    typeof parsed.passwordHash.salt !== "string" ||
    typeof parsed.passwordHash.hash !== "string" ||
    typeof parsed.sessionSecret !== "string" ||
    typeof parsed.createdAt !== "string" ||
    typeof parsed.updatedAt !== "string"
  ) {
    throw new Error(
      "Dashboard auth file is invalid. Regenerate it with the dashboard password CLI.",
    );
  }

  return parsed as DashboardAuthFile;
}

async function writeAuthFile(authPath: string, authFile: DashboardAuthFile): Promise<void> {
  await mkdir(dirname(authPath), { recursive: true });

  const temporaryPath = `${authPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(authFile, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, authPath);
  await chmod(authPath, 0o600);
}

function verifySessionCookie(cookieValue: string, authFile: DashboardAuthFile): boolean {
  const [encodedPayload, signature, extra] = cookieValue.split(".");

  if (!encodedPayload || !signature || extra !== undefined) {
    return false;
  }

  const expectedSignature = signSessionPayload(encodedPayload, authFile.sessionSecret);

  if (!constantTimeEqual(signature, expectedSignature)) {
    return false;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as {
      v?: unknown;
      exp?: unknown;
    };

    return payload.v === 1 && typeof payload.exp === "number" && payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

function signSessionPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = new Uint8Array(Buffer.from(left));
  const rightBuffer = new Uint8Array(Buffer.from(right));

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function encodeBytes(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function serializeCookie(
  name: string,
  value: string,
  options: { maxAge: number; secure: boolean },
): string {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.maxAge}`,
  ];

  if (options.secure) {
    parts.push("Secure");
  }

  parts.push("Priority=High");

  return parts.join("; ");
}

function isSecureRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");

  if (forwardedProto) {
    return forwardedProto.split(",")[0]?.trim().toLowerCase() === "https";
  }

  return new URL(request.url).protocol === "https:";
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
