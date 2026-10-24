import { neon } from "@neondatabase/serverless";

export function getDb() {
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    return null;
  }

  return neon(connectionString);
}

let isInitialized = false;

export async function initDb() {
  if (isInitialized) return;
  const sql = getDb();
  if (!sql) return;

  // 1. Drama History Table
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS drama_history (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100) DEFAULT 'default',
        anime_id VARCHAR(100) NOT NULL,
        anime_title VARCHAR(255) NOT NULL,
        anime_poster TEXT,
        episode_number INT NOT NULL,
        episode_title VARCHAR(255),
        watch_url TEXT NOT NULL,
        watch_time REAL DEFAULT 0.0,
        duration REAL DEFAULT 0.0,
        is_completed BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_user_drama_ep UNIQUE (user_id, anime_id, episode_number)
      )
    `;
  } catch (e: any) {
    if (e?.code !== "23505" && !e?.message?.includes("already exists")) {
      console.warn("[initDb drama_history warning]:", e?.message);
    }
  }

  // 2. Drama Favorites Table
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS drama_favorites (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100) DEFAULT 'default',
        anime_id VARCHAR(100) NOT NULL,
        anime_title VARCHAR(255) NOT NULL,
        anime_poster TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_user_drama_fav UNIQUE (user_id, anime_id)
      )
    `;
  } catch (e: any) {
    if (e?.code !== "23505" && !e?.message?.includes("already exists")) {
      console.warn("[initDb drama_favorites warning]:", e?.message);
    }
  }

  // 3. Drama Users Table (마스터 관리자 및 사용자 계정 - DramaSite 전용 독립 테이블)
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS drama_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(80) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        nickname VARCHAR(50),
        is_admin BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        is_first_login BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
  } catch (e: any) {
    if (e?.code !== "23505" && !e?.message?.includes("already exists")) {
      console.warn("[initDb drama_users warning]:", e?.message);
    }
  }

  // 4. Drama System Settings Table (동적 TVWIKI 베이스 URL 및 환경설정)
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS drama_system_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
  } catch (e: any) {
    if (e?.code !== "23505" && !e?.message?.includes("already exists")) {
      console.warn("[initDb drama_system_settings warning]:", e?.message);
    }
  }

  // 5. Drama User Settings Table (사용자 계정별 환경설정 및 플레이어 옵션)
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS drama_user_settings (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100) NOT NULL,
        settings TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_drama_user_settings UNIQUE (user_id)
      )
    `;
  } catch (e: any) {
    if (e?.code !== "23505" && !e?.message?.includes("already exists")) {
      console.warn("[initDb drama_user_settings warning]:", e?.message);
    }
  }

  // 6. Drama Login Attempts Table (로그인 브루트포스 방어용 시도 횟수 기록)
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS drama_login_attempts (
        user_key VARCHAR(100) PRIMARY KEY,
        attempts INT NOT NULL DEFAULT 1,
        window_start TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
  } catch (e: any) {
    if (e?.code !== "23505" && !e?.message?.includes("already exists")) {
      console.warn("[initDb drama_login_attempts warning]:", e?.message);
    }
  }

  isInitialized = true;
}

export async function getUserCount(): Promise<number> {
  const sql = getDb();
  if (!sql) return 0;
  await initDb();
  try {
    const rows = await sql`SELECT COUNT(*)::int as count FROM drama_users;`;
    return Number(rows[0]?.count || 0);
  } catch (e) {
    console.error("[db.getUserCount error]:", e);
    return 0;
  }
}

export async function findUserByUsername(username: string) {
  const sql = getDb();
  if (!sql) return null;
  await initDb();
  try {
    const rows = await sql`
      SELECT id, username, password, nickname, is_admin, is_active, is_first_login, created_at
      FROM drama_users
      WHERE LOWER(username) = LOWER(${username})
      LIMIT 1;
    `;
    return rows[0] || null;
  } catch (e) {
    console.error("[db.findUserByUsername error]:", e);
    return null;
  }
}

export async function createUser(data: {
  username: string;
  passwordHash: string;
  nickname?: string;
  isAdmin?: boolean;
  isFirstLogin?: boolean;
}) {
  const sql = getDb();
  if (!sql) throw new Error("Database not connected");
  await initDb();
  const rows = await sql`
    INSERT INTO drama_users (username, password, nickname, is_admin, is_active, is_first_login, created_at)
    VALUES (
      ${data.username},
      ${data.passwordHash},
      ${data.nickname || data.username},
      ${data.isAdmin ?? false},
      TRUE,
      ${data.isFirstLogin ?? false},
      CURRENT_TIMESTAMP
    )
    RETURNING id, username, nickname, is_admin, is_active, created_at;
  `;
  return rows[0];
}

export async function createFirstAdmin(data: {
  username: string;
  passwordHash: string;
  nickname?: string;
}) {
  const sql = getDb();
  if (!sql) throw new Error("Database not connected");
  await initDb();
  const rows = await sql`
    INSERT INTO drama_users (username, password, nickname, is_admin, is_active, is_first_login, created_at)
    SELECT
      ${data.username},
      ${data.passwordHash},
      ${data.nickname || data.username},
      TRUE,
      TRUE,
      FALSE,
      CURRENT_TIMESTAMP
    WHERE NOT EXISTS (SELECT 1 FROM drama_users)
    RETURNING id, username, nickname, is_admin, is_active, created_at;
  `;
  return rows[0] || null;
}

export interface EpisodeHistoryItem {
  watch_time: number;
  duration: number;
  is_completed: boolean;
}

export async function getDramaHistoryMap(
  userId: string,
  dramaId: string
): Promise<Record<number, EpisodeHistoryItem>> {
  const sql = getDb();
  if (!sql) return {};
  await initDb();
  try {
    const rows = await sql`
      SELECT episode_number, watch_time, duration, is_completed
      FROM drama_history
      WHERE user_id = ${userId} AND anime_id = ${dramaId}
      ORDER BY episode_number ASC;
    `;
    const map: Record<number, EpisodeHistoryItem> = {};
    for (const r of rows) {
      const epNum = Number(r.episode_number);
      if (epNum > 0) {
        map[epNum] = {
          watch_time: Number(r.watch_time || 0),
          duration: Number(r.duration || 0),
          is_completed: Boolean(r.is_completed),
        };
      }
    }
    return map;
  } catch (e) {
    console.error("[db.getDramaHistoryMap error]:", e);
    return {};
  }
}

export const getAnimeHistoryMap = getDramaHistoryMap;

// ----------------------------------------------------
// TVWIKI Dynamic Base URL Helpers
// ----------------------------------------------------

export const DEFAULT_TVWIKI_URL = "https://tvwiki54.net";
export const TELEGRAM_FALLBACK_URL = "https://t.me/s/tvwiki_url";
export const TELEGRAM_TVWIKI_URL = TELEGRAM_FALLBACK_URL;
export const TVWIKI_STORE_HUB_URL = "https://tvwiki.store";
export const TVWIKI_STORE_URL = TVWIKI_STORE_HUB_URL;
export const TVWIKI_URL_GUIDE = "https://tvwikiurl.net/";

let cachedTvwikiBaseUrl: { url: string; timestamp: number } | null = null;

export function clearTvwikiBaseUrlCache() {
  cachedTvwikiBaseUrl = null;
}

export async function getTvwikiBaseUrl(bypassCache = false): Promise<string> {
  if (!bypassCache && cachedTvwikiBaseUrl && Date.now() - cachedTvwikiBaseUrl.timestamp < 30_000) {
    return cachedTvwikiBaseUrl.url;
  }

  const sql = getDb();
  if (sql) {
    try {
      await initDb();
      const rows = await sql`
        SELECT value FROM drama_system_settings
        WHERE key = 'tvwiki_base_url'
        LIMIT 1;
      `;
      if (rows.length > 0 && rows[0].value) {
        const val = String(rows[0].value).trim().replace(/\/+$/, "");
        if (val) {
          cachedTvwikiBaseUrl = { url: val, timestamp: Date.now() };
          return val;
        }
      }
    } catch (e) {
      console.warn("[getTvwikiBaseUrl error]:", e);
    }
  }

  const envUrl = process.env.TVWIKI_BASE_URL?.trim().replace(/\/+$/, "");
  const finalUrl = envUrl || DEFAULT_TVWIKI_URL;
  cachedTvwikiBaseUrl = { url: finalUrl, timestamp: Date.now() };
  return finalUrl;
}

export async function setTvwikiBaseUrl(newUrl: string): Promise<boolean> {
  let formatted = newUrl.trim();
  if (!formatted.startsWith("http://") && !formatted.startsWith("https://")) {
    formatted = `https://${formatted}`;
  }
  formatted = formatted.replace(/\/+$/, "");

  const sql = getDb();
  if (!sql) return false;

  try {
    await initDb();
    await sql`
      INSERT INTO drama_system_settings (key, value, updated_at)
      VALUES ('tvwiki_base_url', ${formatted}, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = CURRENT_TIMESTAMP;
    `;
    cachedTvwikiBaseUrl = { url: formatted, timestamp: Date.now() };
    return true;
  } catch (e) {
    console.error("[setTvwikiBaseUrl error]:", e);
    return false;
  }
}

// ----------------------------------------------------
// User Settings Database Helpers
// ----------------------------------------------------

export async function getUserSettings(userId: string): Promise<Record<string, any> | null> {
  const sql = getDb();
  if (!sql) return null;
  await initDb();
  try {
    const rows = await sql`
      SELECT settings FROM drama_user_settings
      WHERE user_id = ${userId}
      LIMIT 1;
    `;
    if (rows.length === 0 || !rows[0].settings) return null;
    const raw = rows[0].settings;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    console.error("[db.getUserSettings error]:", e);
    return null;
  }
}

export async function saveUserSettings(
  userId: string,
  settings: Record<string, any>
): Promise<boolean> {
  const sql = getDb();
  if (!sql) return false;
  await initDb();
  try {
    const jsonStr = JSON.stringify(settings);
    await sql`
      INSERT INTO drama_user_settings (user_id, settings, updated_at)
      VALUES (${userId}, ${jsonStr}, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO UPDATE SET
        settings = EXCLUDED.settings,
        updated_at = CURRENT_TIMESTAMP;
    `;
    return true;
  } catch (e) {
    console.error("[db.saveUserSettings error]:", e);
    return false;
  }
}

// ----------------------------------------------------
// Login Rate Limiting Helpers (브루트포스 방어)
// ----------------------------------------------------

export const LOGIN_RATE_LIMIT = {
  maxAttempts: 5,
  windowMinutes: 15,
} as const;

export async function getLoginAttempts(userKey: string): Promise<number> {
  const sql = getDb();
  if (!sql) return 0;
  await initDb();
  try {
    const rows = await sql`
      SELECT attempts FROM drama_login_attempts
      WHERE user_key = ${userKey}
        AND window_start >= NOW() - ${LOGIN_RATE_LIMIT.windowMinutes} * INTERVAL '1 minute';
    `;
    return rows.length > 0 ? Number(rows[0].attempts) : 0;
  } catch (e) {
    console.error("[db.getLoginAttempts error]:", e);
    return 0;
  }
}

export async function recordLoginFailure(userKey: string): Promise<void> {
  const sql = getDb();
  if (!sql) return;
  await initDb();
  try {
    await sql`
      INSERT INTO drama_login_attempts (user_key, attempts, window_start)
      VALUES (${userKey}, 1, CURRENT_TIMESTAMP)
      ON CONFLICT (user_key) DO UPDATE SET
        attempts = CASE
          WHEN drama_login_attempts.window_start >= NOW() - ${LOGIN_RATE_LIMIT.windowMinutes} * INTERVAL '1 minute'
            THEN drama_login_attempts.attempts + 1
          ELSE 1
        END,
        window_start = CASE
          WHEN drama_login_attempts.window_start >= NOW() - ${LOGIN_RATE_LIMIT.windowMinutes} * INTERVAL '1 minute'
            THEN drama_login_attempts.window_start
          ELSE CURRENT_TIMESTAMP
        END;
    `;
  } catch (e) {
    console.error("[db.recordLoginFailure error]:", e);
  }
}

export async function clearLoginFailures(userKey: string): Promise<void> {
  const sql = getDb();
  if (!sql) return;
  await initDb();
  try {
    await sql`DELETE FROM drama_login_attempts WHERE user_key = ${userKey}`;
  } catch (e) {
    console.error("[db.clearLoginFailures error]:", e);
  }
}

export async function getAllUsers() {
  const sql = getDb();
  if (!sql) return [];
  await initDb();
  try {
    const rows = await sql`
      SELECT id, username, nickname, is_admin, is_active, is_first_login, created_at
      FROM drama_users
      ORDER BY created_at DESC;
    `;
    return rows;
  } catch (e) {
    console.error("[db.getAllUsers error]:", e);
    return [];
  }
}

export async function toggleUserActive(id: number, isActive: boolean): Promise<boolean> {
  const sql = getDb();
  if (!sql) return false;
  await initDb();
  try {
    await sql`UPDATE drama_users SET is_active = ${isActive} WHERE id = ${id}`;
    return true;
  } catch (e) {
    console.error("[db.toggleUserActive error]:", e);
    return false;
  }
}

export async function resetUserPassword(id: number, passwordHash: string): Promise<boolean> {
  const sql = getDb();
  if (!sql) return false;
  await initDb();
  try {
    await sql`UPDATE drama_users SET password = ${passwordHash}, is_first_login = TRUE WHERE id = ${id}`;
    return true;
  } catch (e) {
    console.error("[db.resetUserPassword error]:", e);
    return false;
  }
}

export async function updateUserProfile(
  id: number,
  data: { nickname?: string; passwordHash?: string }
): Promise<boolean> {
  const sql = getDb();
  if (!sql) return false;
  await initDb();
  try {
    if (data.passwordHash && data.nickname) {
      await sql`UPDATE drama_users SET nickname = ${data.nickname}, password = ${data.passwordHash}, is_first_login = FALSE WHERE id = ${id}`;
    } else if (data.passwordHash) {
      await sql`UPDATE drama_users SET password = ${data.passwordHash}, is_first_login = FALSE WHERE id = ${id}`;
    } else if (data.nickname) {
      await sql`UPDATE drama_users SET nickname = ${data.nickname} WHERE id = ${id}`;
    }
    return true;
  } catch (e) {
    console.error("[db.updateUserProfile error]:", e);
    return false;
  }
}

export async function deleteUser(id: number): Promise<boolean> {
  const sql = getDb();
  if (!sql) return false;
  await initDb();
  try {
    const rows = await sql`SELECT username FROM drama_users WHERE id = ${id} LIMIT 1`;
    if (rows.length === 0) return false;
    const username = rows[0].username;
    await sql`DELETE FROM drama_history WHERE user_id = ${username}`;
    await sql`DELETE FROM drama_favorites WHERE user_id = ${username}`;
    await sql`DELETE FROM drama_user_settings WHERE user_id = ${username}`;
    await sql`DELETE FROM drama_users WHERE id = ${id}`;
    return true;
  } catch (e) {
    console.error("[db.deleteUser error]:", e);
    return false;
  }
}
