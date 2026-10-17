# DramaSite (TVWIKI 드라마 스트리밍 플랫폼) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `D:\Antigravity\Homepage\DramaSite` with full user/admin authentication (`drama_*` isolated Neon DB tables), TVWIKI (`/drama` & `/old_drama`) scraping, video session playback (`/api/create_session.php`), and automatic domain failover via `https://t.me/s/tvwiki_url` and `https://tvwiki.store`.

**Architecture:** Next.js 15 App Router (React 19, TypeScript, Tailwind CSS) modeling the proven authentication, admin dashboard, and player architecture from `AnimeSite`, while replacing the data layer with an isolated `drama_*` schema and a dedicated TVWIKI provider with automatic Telegram domain recovery.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, `@neondatabase/serverless`, `cheerio`, `lucide-react`, Node.js built-in test runner (`node --test`).

---

### Task 1: Project Configuration & Environment Setup

**Files:**
- Create: `D:\Antigravity\Homepage\DramaSite\package.json`
- Create: `D:\Antigravity\Homepage\DramaSite\tsconfig.json`
- Create: `D:\Antigravity\Homepage\DramaSite\next.config.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\tailwind.config.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\postcss.config.mjs`
- Create: `D:\Antigravity\Homepage\DramaSite\.gitignore`
- Create: `D:\Antigravity\Homepage\DramaSite\next-env.d.ts`

- [ ] **Step 1: Create `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`**
- [ ] **Step 2: Copy `.env*` files (if present in `AnimeSite`) and static assets (`public/js/artplayer.js`, `public/js/hls.min.js`, icons) to `DramaSite`**

---

### Task 2: Database (`drama_*` Isolated Schema) & Authentication / Admin System

**Files:**
- Create: `D:\Antigravity\Homepage\DramaSite\src\lib\db.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\lib\auth.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\lib\proxyGuard.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\lib\historyPromotion.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\api\auth\setup\route.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\api\auth\setup-status\route.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\api\auth\login\route.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\api\auth\logout\route.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\api\auth\me\route.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\api\auth\profile\route.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\api\admin\users\route.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\api\admin\users\[id]\route.ts`

- [ ] **Step 1: Implement `src/lib/db.ts` with `drama_users`, `drama_login_attempts`, `drama_history`, `drama_favorites`, `drama_system_settings`, `drama_user_settings`**
- [ ] **Step 2: Implement `src/lib/auth.ts` with `drama_auth_token` cookie, `scrypt` hashing, and `requireAuth()`**
- [ ] **Step 3: Implement `/api/auth/*` and `/api/admin/*` routes**

---

### Task 3: TVWIKI Provider & Telegram Auto-Failover Resolver

**Files:**
- Create: `D:\Antigravity\Homepage\DramaSite\src\lib\providers\types.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\lib\providers\tvwiki.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\lib\providers\index.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\tests\tvwiki.test.cjs`

- [ ] **Step 1: Write unit tests in `tests/tvwiki.test.cjs` for Telegram URL extraction, redirect hub parsing, drama list/detail HTML parsing, and session stream parsing**
- [ ] **Step 2: Implement `src/lib/providers/tvwiki.ts` with `resolveLatestTvwikiUrl`, `fetchTvwikiHtmlWithFailover`, `getDramaList`, `searchDramas`, `getDramaDetail`, and `getEpisodeStream`**
- [ ] **Step 3: Run `node --test tests/tvwiki.test.cjs` to verify all provider and failover logic passes**

---

### Task 4: Drama & Settings API Routes

**Files:**
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\api\drama\list\route.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\api\drama\detail\route.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\api\drama\episode_info\route.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\api\drama\favorite\route.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\api\drama\history\route.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\api\drama\stream\m3u8\route.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\api\drama\stream\segment\route.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\api\drama\stream\vtt\route.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\api\settings\base-url\route.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\api\settings\player\route.ts`

- [ ] **Step 1: Implement `/api/settings/base-url` (GET health check, POST manual update & Telegram auto-discover action)**
- [ ] **Step 2: Implement `/api/drama/*` routes for list, detail, episode_info, favorite, history, and stream proxies**

---

### Task 5: Frontend Pages, Components & Build Verification

**Files:**
- Create: `D:\Antigravity\Homepage\DramaSite\src\components\Navbar.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\components\NavbarSearch.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\components\BaseUrlSettingsModal.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\components\DramaCard.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\components\EpisodeListSection.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\components\FavoriteButton.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\components\HistoryList.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\components\Player.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\components\IframePlayer.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\components\PlayerSettingsModal.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\components\AuthGuard.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\components\PullToRefresh.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\components\PwaRegister.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\layout.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\globals.css`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\manifest.ts`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\page.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\drama\[id]\page.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\watch\[id]\[ep]\page.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\login\page.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\login\LoginForm.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\setup\page.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\setup\SetupForm.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\profile\page.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\profile\ProfileForm.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\admin\page.tsx`
- Create: `D:\Antigravity\Homepage\DramaSite\src\app\admin\AdminDashboard.tsx`

- [ ] **Step 1: Create all UI components and pages**
- [ ] **Step 2: Install dependencies / link `node_modules` and run `npm test` and `npm run build` to verify zero TypeScript/build errors**
