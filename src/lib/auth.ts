import crypto from "crypto";
import { cookies } from "next/headers";
import { getUserCount } from "./db";
import { redirect } from "next/navigation";

function resolveSecretKey(): string | undefined {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.SECRET_KEY) return process.env.SECRET_KEY;
  const dbUrl =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL;
  if (dbUrl) {
    return crypto
      .createHash("sha256")
      .update(`drama_auth_secret_seed:${dbUrl}`)
      .digest("hex");
  }
  return undefined;
}

const SECRET_KEY = resolveSecretKey();

export const AUTH_COOKIE_NAME = "drama_auth_token";

export interface AuthUser {
  id: number;
  username: string;
  nickname: string;
  isAdmin: boolean;
  isFirstLogin?: boolean;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, combinedHash: string): boolean {
  if (!password || !combinedHash || !combinedHash.includes(":")) return false;
  try {
    const [salt, originalHash] = combinedHash.split(":");
    const testHash = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(
      Buffer.from(originalHash, "hex"),
      Buffer.from(testHash, "hex")
    );
  } catch (error) {
    console.error("[verifyPassword error]:", error);
    return false;
  }
}

export function createAuthToken(user: AuthUser, expiresInDays = 30): string {
  if (!SECRET_KEY) {
    throw new Error(
      "AUTH_SECRET or DATABASE_URL environment variable is not set. Please set DATABASE_URL or AUTH_SECRET in .env.local."
    );
  }
  const exp = Math.floor(Date.now() / 1000) + expiresInDays * 86400;
  const payload = JSON.stringify({
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    isAdmin: user.isAdmin,
    isFirstLogin: Boolean(user.isFirstLogin),
    exp,
  });
  const payloadBase64 = Buffer.from(payload).toString("base64url");
  const signature = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(payloadBase64)
    .digest("base64url");
  return `${payloadBase64}.${signature}`;
}

export function verifyAuthToken(token: string): AuthUser | null {
  if (!token || !token.includes(".")) return null;
  if (!SECRET_KEY) return null;
  try {
    const [payloadBase64, signature] = token.split(".");
    const expectedSig = crypto
      .createHmac("sha256", SECRET_KEY)
      .update(payloadBase64)
      .digest("base64url");

    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const json = Buffer.from(payloadBase64, "base64url").toString("utf-8");
    const data = JSON.parse(json);

    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      id: data.id,
      username: data.username,
      nickname: data.nickname,
      isAdmin: Boolean(data.isAdmin),
      isFirstLogin: Boolean(data.isFirstLogin),
    };
  } catch {
    return null;
  }
}

export async function getSessionUser(): Promise<AuthUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    if (!token) return null;
    return verifyAuthToken(token);
  } catch {
    return null;
  }
}

export async function getCurrentUserId(): Promise<string> {
  const user = await getSessionUser();
  return user?.username || "default";
}

export async function requireAuth(): Promise<AuthUser> {
  const user = await getSessionUser();
  if (user) {
    if (user.isFirstLogin) {
      redirect("/profile?change_password=1");
    }
    return user;
  }

  const count = await getUserCount();
  if (count === 0) {
    redirect("/setup");
  }

  redirect("/login");
}
