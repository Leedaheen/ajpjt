# 고소작업대 가동현황 v3.5 — Render.com 배포 가이드

> **이 가이드의 적용 범위**
> Supabase Auth + RLS 연동이 적용된 v3.5 이후 버전 기준.
> Express 서버(`server.js`)가 반드시 실행되어야 Google 로그인 및 AJ 계정 관리 API가 동작합니다.
> GitHub Pages는 서버 기능이 없으므로 이 버전에서는 **Render.com 필수**입니다.

---

## 사전 준비 체크리스트

배포 전 아래 항목을 모두 준비합니다:

- [ ] Supabase 프로젝트 생성 완료 (Project URL, anon key, service_role key 확보)
- [ ] Supabase Authentication → Providers → **Google** 활성화 완료
- [ ] Google Cloud Console 프로젝트 + OAuth 2.0 클라이언트 ID 생성 완료
- [ ] GitHub 레포에 최신 코드 푸시 완료 (`render-deploy/ajpjt/` 디렉토리 포함)
- [ ] Render.com 계정 생성 완료

---

## 1단계 — Supabase 설정

### 1-1. 스키마 패치 실행

Supabase 대시보드 → **SQL Editor**에서 아래 파일을 **순서대로** 실행합니다:

| 순서 | 파일 | 설명 |
|------|------|------|
| 1 | `supabase_schema_patch.sql` | transit, as_requests, aj_members 컬럼 추가 |
| 2 | `rls-policies.sql` | RLS 활성화 및 정책 설정 |

> **주의:** `rls-policies.sql` 실행 전 반드시 `supabase_schema_patch.sql` 먼저 실행해야 합니다.
> `aj_members.auth_id` 컬럼이 없으면 RLS 정책 생성이 실패합니다.

### 1-2. aj_members 컬럼 추가 확인

SQL Editor에서 아래 쿼리 실행 후 `auth_id`, `email` 컬럼이 표시되는지 확인합니다:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'aj_members'
ORDER BY ordinal_position;
```

### 1-3. RLS 활성화 확인

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('logs','transit','as_requests','equipment','members','app_settings','aj_members');
```

모든 행의 `rowsecurity`가 `true`여야 합니다.

### 1-4. Google OAuth Provider 설정 (Supabase)

Supabase 대시보드 → **Authentication** → **Providers** → **Google** 활성화:
- **Client ID:** Google Cloud Console OAuth 2.0 클라이언트 ID
- **Client Secret:** Google Cloud Console OAuth 2.0 클라이언트 시크릿

---

## 2단계 — Render.com 서비스 생성

### 2-1. New Web Service 생성

1. https://render.com 접속 → 로그인
2. **New → Web Service** 클릭
3. GitHub 레포 연결 (`Leedaheen/ajpjt` 선택)

### 2-2. 빌드 설정

| 항목 | 값 | 비고 |
|------|-----|------|
| **Name** | tl-operating-system | 변경 가능 |
| **Region** | Singapore | Asia 최근접 |
| **Branch** | main | |
| **Runtime** | Node | |
| **Root Directory** | `render-deploy/ajpjt` | ⚠️ 반드시 설정 |
| **Build Command** | `npm install` | |
| **Start Command** | `npm start` | |
| **Instance Type** | Free 또는 Starter | |

> **Root Directory 주의사항**
> `render-deploy/ajpjt`로 설정해야 `server.js`, `package.json`이 올바르게 인식됩니다.
> 비워두거나 레포 루트로 설정하면 `package.json`을 찾지 못해 빌드가 실패합니다.

### 2-3. 환경 변수 설정

**Environment** 탭에서 아래 변수를 모두 입력합니다:

| 환경 변수 | 값 | 필수 여부 | 설명 |
|-----------|-----|-----------|------|
| `NODE_ENV` | `production` | 필수 | 프로덕션 모드 (index.html 캐시 활성화) |
| `SB_URL` | `https://xxxx.supabase.co` | 필수 | Supabase Project URL |
| `SB_KEY` | `eyJ...` (anon key) | 필수 | Supabase anon/public key — 클라이언트에 주입됨 |
| `SB_SERVICE_KEY` | `eyJ...` (service_role key) | 필수 | 서버 내부 전용. **절대 외부 노출 금지** |
| `ADMIN_SECRET` | 임의의 긴 문자열 | 필수 | AJ 계정 생성/연결 API 인가 시크릿 |
| `KAKAO_JS_KEY` | 카카오 JS 앱 키 | 선택 | 카카오 로그인 사용 시 설정 |

> **ADMIN_SECRET 생성 예시 (터미널):**
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```
> 32자 이상 랜덤 문자열을 사용하세요.

### 2-4. 배포 실행

**Create Web Service** 클릭 → 배포 로그 확인

배포 완료 후 URL 예시: `https://tl-operating-system.onrender.com`

---

## 3단계 — Google Cloud Console OAuth 설정

배포 URL을 Google OAuth 허용 출처에 추가해야 Google 로그인이 작동합니다.

1. [Google Cloud Console](https://console.cloud.google.com) → **API 및 서비스** → **사용자 인증 정보**
2. 사용 중인 **OAuth 2.0 클라이언트 ID** 클릭
3. **승인된 JavaScript 출처**에 Render 배포 URL 추가:
   ```
   https://tl-operating-system.onrender.com
   ```
4. **승인된 리디렉션 URI** (Supabase Google OAuth 콜백):
   ```
   https://xxxx.supabase.co/auth/v1/callback
   ```
5. **저장** 클릭 → 반영까지 최대 5분 소요

---

## 4단계 — 배포 후 검증

### 4-1. 기본 접속 확인

브라우저에서 배포 URL 접속:
- [ ] 앱 화면이 정상 로드됨
- [ ] 브라우저 콘솔(F12)에 오류 없음

### 4-2. AJ 관리자 로그인 테스트

1. 사번(emp_no) + 비밀번호로 AJ 로그인 시도
2. 로그인 성공 확인
3. 데이터(운영일지, 장비현황 등) 정상 조회 확인

### 4-3. Sub/Tech Google 로그인 테스트

1. 기술인/협력사 탭에서 **Google 로그인** 버튼 클릭
2. Google 계정 선택 후 로그인 성공 확인
3. 현장 데이터 조회 정상 확인

### 4-4. RLS 동작 테스트 (선택)

| 동작 | 역할 | 기대 결과 |
|------|------|-----------|
| 운영일지 등록 | Sub/Tech | 성공 (logs INSERT 허용) |
| A/S 요청 등록 | Sub | 성공 (as_requests INSERT 허용) |
| A/S 처리 완료 | Tech | 성공 (as_requests UPDATE 허용) |
| 장비 현황 조회 | Sub/Tech | 성공 (equipment SELECT 허용) |
| 반입/반출 등록 | AJ | 성공 (transit INSERT 허용) |
| AJ 멤버 관리 | AJ | 성공 (aj_members CRUD 허용) |
| AJ 멤버 관리 시도 | Sub/Tech | 실패 (RLS 차단) |

---

## Free vs Starter 인스턴스 비교

| 항목 | Free | Starter ($7/월) |
|------|------|-----------------|
| 슬립 | 15분 비활성 시 슬립 | 없음 |
| 웨이크업 딜레이 | 첫 접속 시 30~60초 | 없음 |
| 월 사용량 | 750시간 무료 | 무제한 |
| 권장 | 개발/테스트 | 현장 상시 운영 |

현장 직원이 365일 상시 사용하는 경우 **Starter** 플랜 권장.

---

## 배포 파일 구성

```
render-deploy/ajpjt/          ← Render Root Directory
├── index.html                ← 앱 본체 (단일 HTML PWA)
├── server.js                 ← Express 서버 (Auth API 포함)
├── package.json              ← Node.js 설정
├── manifest.json             ← PWA 매니페스트
├── sw.js                     ← 서비스 워커
├── supabase_schema_patch.sql ← DB 스키마 패치 (Supabase에서 실행)
├── rls-policies.sql          ← RLS 정책 (Supabase에서 실행)
└── js/                       ← 클라이언트 모듈
    ├── api.js
    ├── app.js
    ├── db.js
    ├── state.js
    ├── ui.js
    └── event.js
```
