# DramaSite (TVWIKI 드라마 스트리밍 플랫폼) 설계 명세서

**작성일**: 2026-10-18
**대상 경로**: `D:\Antigravity\Homepage\DramaSite`
**참조 아키텍처**: `D:\Antigravity\Homepage\AnimeSite`

---

## 1. 프로젝트 개요 및 목적

`DramaSite`는 기존 `AnimeSite`와 동일한 수준의 보안 인증, 최초 마스터 관리자 셋업, 관리자 대시보드, 시청 기록/즐겨찾기, 반응형 UI 및 비디오 플레이어를 갖추면서, 외부 데이터 소스로 **티비위키(`https://tvwiki54.net/`)**의 **드라마(`/drama`)** 및 **추억의 드라마(`/old_drama`)** 카테고리를 전용으로 가져오는 독립 웹 애플리케이션입니다.

또한, 티비위키의 도메인이 차단되거나 변경될 경우 **텔레그램 공식 주소 안내 채널(`https://t.me/s/tvwiki_url`)** 및 고정 안내 도메인(`https://tvwiki.store`)에서 최신 접속 주소를 자동으로 탐색·복구하는 **자동 도메인 복구(Auto-Failover)** 시스템을 내장합니다.

---

## 2. 데이터베이스 및 인증 아키텍처 (`src/lib/db.ts`, `src/lib/auth.ts`)

### 2.1 완전 분리된 전용 테이블 스키마
Neon PostgreSQL 데이터베이스(`DATABASE_URL` 등)를 사용하며, 기존 테이블과 절대 충돌하지 않도록 모든 테이블에 `drama_` 접두사를 사용합니다.

1. **`drama_users`**:
   - `id SERIAL PRIMARY KEY`
   - `username VARCHAR(80) UNIQUE NOT NULL`
   - `password VARCHAR(255) NOT NULL` (`scrypt` + 16바이트 랜덤 솔트 해싱)
   - `nickname VARCHAR(50)`
   - `is_admin BOOLEAN DEFAULT FALSE`
   - `is_active BOOLEAN DEFAULT TRUE`
   - `is_first_login BOOLEAN DEFAULT FALSE`
   - `created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`
2. **`drama_login_attempts`**:
   - `user_key VARCHAR(100) PRIMARY KEY`
   - `attempts INT NOT NULL DEFAULT 1`
   - `window_start TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`
   - 15분 내 5회 로그인 실패 시 `429 Too Many Requests`로 브루트포스 공격 차단.
3. **`drama_history`**:
   - `id SERIAL PRIMARY KEY`
   - `user_id VARCHAR(100) DEFAULT 'default'`
   - `drama_id VARCHAR(100) NOT NULL` (예: `drama_4148`, `old_drama_1558`)
   - `drama_title VARCHAR(255) NOT NULL`
   - `drama_poster TEXT`
   - `episode_number INT NOT NULL`
   - `episode_title VARCHAR(255)`
   - `watch_url TEXT NOT NULL`
   - `watch_time REAL DEFAULT 0.0`
   - `duration REAL DEFAULT 0.0`
   - `is_completed BOOLEAN DEFAULT FALSE`
   - `updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`
   - `UNIQUE (user_id, drama_id, episode_number)`
4. **`drama_favorites`**:
   - `id SERIAL PRIMARY KEY`
   - `user_id VARCHAR(100) DEFAULT 'default'`
   - `drama_id VARCHAR(100) NOT NULL`
   - `drama_title VARCHAR(255) NOT NULL`
   - `drama_poster TEXT`
   - `created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`
   - `UNIQUE (user_id, drama_id)`
5. **`drama_system_settings`**:
   - `key VARCHAR(100) PRIMARY KEY` (예: `tvwiki_base_url`)
   - `value TEXT NOT NULL`
   - `updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`
6. **`drama_user_settings`**:
   - `id SERIAL PRIMARY KEY`
   - `user_id VARCHAR(100) UNIQUE NOT NULL`
   - `settings TEXT NOT NULL`
   - `updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`

### 2.2 인증 및 권한 흐름 (`src/lib/auth.ts`)
- **쿠키 이름**: `drama_auth_token` (`httpOnly`, `sameSite: "lax"`, 30일 유지)
- **서명 키**: `AUTH_SECRET` / `SECRET_KEY` 환경변수 우선, 없을 경우 `sha256("drama_auth_secret_seed:" + dbUrl)`로 파생.
- **최초 셋업 (`/setup`)**: `drama_users` 테이블의 계정 수가 `0`일 때만 접근 및 생성이 가능하며, 원자적 SQL(`INSERT INTO drama_users ... WHERE NOT EXISTS (SELECT 1 FROM drama_users)`)로 최초 마스터 관리자를 생성합니다.
- **첫 로그인 비밀번호 강제 변경**: 관리자가 생성한 계정(`is_first_login = TRUE`)이거나 비밀번호가 초기화된 계정은 로그인 시 `/profile?change_password=1`로 리다이렉트하여 비밀번호를 변경하도록 강제합니다.
- **관리자 대시보드 (`/admin`)**:
  - 전체 회원 목록 조회, 신규 계정 생성(랜덤 임시 비밀번호 생성 지원), 계정 활성/비활성 토글, 임시 비밀번호 초기화, 계정 삭제(연관 기록/즐겨찾기/설정 일괄 삭제).

---

## 3. TVWIKI 스크래핑 및 자동 도메인 복구 아키텍처 (`src/lib/providers/tvwiki.ts`)

### 3.1 대상 카테고리 및 ID 규격
- **지원 카테고리**:
  - `drama`: 최신/방영 드라마 (`/drama`)
  - `old_drama`: 추억의 드라마 (`/old_drama`)
- **작품 ID 규격**:
  - `${category}_${wrId}` 형태 (예: `drama_4148`, `old_drama_1558`).
  - 기존 숫자만 전달되거나 URL 경로(`/drama/4148/406786416`)가 전달되어도 파서가 정확히 `category`와 `wrId`, `epIdx`를 분리합니다.

### 3.2 정렬 및 검색 기능
- **목록 조회 (`getDramaList`)**:
  - 카테고리 탭: `최신 드라마 (drama)`, `추억의 드라마 (old_drama)`
  - 정렬 옵션(`sst`):
    - `subidx`: 최근 방영순 (기본값)
    - `wr_datetime`: 최근 등록순
    - `wr_hit`: 조회수 높은순
    - `wr_good`: 좋아요 높은순
    - `wr_6`: 개봉일 최신순 (`sod=desc`)
    - `wr_5`: 평점 높은순 (`sod=desc`)
  - HTML 파싱(`cheerio`): `#list_type ul li`에서 썸네일(`a.img img`), 제목(`a.title2`), UPDATE 배지(`.ud_new`), 국가(`.country`), 평점(`.value`), 좋아요 수(`.good`), 링크(`a.img[href]`)를 추출합니다.
- **검색 (`searchDramas`)**:
  - `${baseUrl}/search?stx=${encodeURIComponent(query)}` 및 `/bbs/search.php?stx=...&onetable=drama`, `/bbs/search.php?stx=...&onetable=old_drama`를 조회하여 **오직 `drama`와 `old_drama` 카테고리에 속하는 작품만** 필터링해 반환합니다.

### 3.3 작품 상세 및 에피소드 파싱 (`getDramaDetail`)
- 요청 경로: `${baseUrl}/${category}/${wrId}`
- **메타데이터 추출**:
  - 제목(`#bo_v_movinfo h3`), 원제(`.ori_title`), 포스터(`#bo_v_poster img`), 국가/언어/개봉년도(`dl.bo_v_info dd`), 장르 태그(`dl.tags dd`), 줄거리(`#bo_v_con` 또는 `#bo_v_movinfo p`).
  - 출연 배우 목록(`.slider_act .item` → 배우 이름 `.name`, 프로필 사진 `img`).
- **전체 회차 목록 추출 (`#other_list ul li`)**:
  - 각 `li`의 `data-ep-idx`, `a.ep-link[href]`, 썸네일(`img[data-src]` 또는 `img[src]`), 회차 제목(`a.title`), 회차 줄거리(`p`)를 파싱합니다.
  - 제목에서 회차 번호(`(\d+)\s*화|회`)를 정규식으로 추출하며, 중복되거나 특수 회차인 경우 역순 인덱스를 부여해 정확한 회차 번호(`number`)로 매핑합니다.

### 3.4 비디오 스트림 추출 (`getEpisodeStream`)
1. 회차 페이지(`${baseUrl}/${category}/${wrId}/${epIdx}`) HTML에서 `<iframe id="view_iframe" data-session1="...">` 속성을 파싱합니다.
2. `data-session1` JSON 페이로드를 가지고 `POST ${baseUrl}/api/create_session.php` (`Referer: ${watchUrl}`, `Content-Type: application/json`)를 호출합니다.
3. 응답 `{ success: true, player_url, t, sig }`를 조합하여 최종 임베드 URL `${player_url}?t=${t}&sig=${sig}`를 생성합니다.
4. 추가적으로 해당 임베드 플레이어 HTML 내에서 직접적인 `.m3u8` 주소가 노출되는지 확인하고, 존재하면 `m3u8` 스트림과 함께 반환하며 기본적으로는 안정적인 `iframe` 임베드 재생 및 `IframePlayer`(전체화면, PiP, 이어보기 기록, 단축키 지원)로 구동합니다.

### 3.5 텔레그램(`https://t.me/s/tvwiki_url`) 기반 자동 도메인 복구 (`resolveLatestTvwikiUrl`)
현재 설정된 도메인(`https://tvwiki54.net` 등)이 접속 불가(네트워크 에러, 타임아웃, 404/5xx, 도메인 파킹 등)일 때 자동으로 다음 순서로 최신 도메인을 탐색합니다:
1. **1단계 (Telegram Web Channel 직접 파싱)**:
   - `https://t.me/s/tvwiki_url` HTML을 가져와 메시지 본문(`.tgme_widget_message_text`)과 링크(`a[href]`)에서 `tvwiki`가 포함된 URL(`https://tvwiki*.net`, `https://tvwiki.store` 등)을 최신순(하단 메시지부터 역순)으로 추출합니다.
2. **2단계 (Jina Reader 우회 파싱)**:
   - 직접 호출에서 메시지 본문이 보이지 않거나 차단된 경우 `https://r.jina.ai/https://t.me/s/tvwiki_url`을 호출하여 마크다운 내 최신 URL을 추출합니다.
3. **3단계 (리다이렉트 허브 추적)**:
   - 추출된 URL(예: `https://tvwiki.store`)이나 후보 도메인에 접속했을 때 `<meta http-equiv="refresh" content="...;url=https://tvwikiXX.net/">` 또는 `<link rel="canonical" href="https://tvwikiXX.net/">` 또는 HTTP 301/302 리다이렉트가 있으면 최종 목적지 도메인(`https://tvwiki54.net` 등)을 추출합니다.
4. **4단계 (헬스체크 및 DB 자동 저장)**:
   - 추출된 새 도메인에 `/drama` 페이지가 정상 응답하는지 검증한 후, `drama_system_settings` 테이블의 `tvwiki_base_url` 값을 즉시 갱신하고 원래 요청을 자동으로 재시도합니다.

---

## 4. UI 및 라우트 구성

- `/` (`src/app/page.tsx`):
  - 상단 카테고리/탭: `최신 드라마`, `추억의 드라마`, `즐겨찾기`, `시청 기록`
  - 우측 정렬 드롭다운/버튼: `최근 방영순`, `최근 등록순`, `조회수순`, `좋아요순`, `개봉일순`, `평점순`
  - 드라마 카드 그리드 (`DramaCard.tsx`): 포스터, UPDATE 배지, 평점/좋아요 배지, 국가 표시
- `/drama/[id]` (`src/app/drama/[id]/page.tsx`):
  - 드라마 포스터, 제목/원제, 국가, 개봉일, 장르 태그, 줄거리, 출연진 슬라이더/목록, 즐겨찾기 버튼, 1화부터 보기 / 이어보기 버튼
  - 전체 회차 리스트 (`EpisodeListSection.tsx`): 회차별 썸네일, 회차 제목, 회차별 줄거리 미리보기, 시청 완료 체크, 회차 검색 및 구간 필터
- `/watch/[id]/[ep]` (`src/app/watch/[id]/[ep]/page.tsx`):
  - `Player.tsx` / `IframePlayer.tsx`를 통한 영상 재생, 이전화/다음화 이동, 전체 회차 드롭다운, 자동 시청 기록 저장
- `/login`, `/setup`, `/profile`, `/admin`:
  - `AnimeSite`와 동일한 UX 및 다크 테마 디자인(레드/로즈 포인트 컬러로 드라마 사이트 정체성 강조)
