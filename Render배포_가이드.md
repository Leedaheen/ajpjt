# 고소작업대 가동현황 v3.5 — Render.com 배포 가이드

## 📁 배포 파일 구성
```
render-deploy/
├── index.html      ← 앱 본체 (단일 HTML PWA)
├── manifest.json   ← PWA 매니페스트
├── sw.js           ← 서비스 워커
├── server.js       ← Express 서버
├── package.json    ← Node.js 설정
└── .gitignore
```

---

## 🚀 Render.com 배포 절차

### 1단계 — GitHub 레포에 파일 올리기

기존 `ajpjt` 레포 사용 또는 신규 레포 생성:

```bash
# 기존 레포 사용 시
git clone https://github.com/Leedaheen/ajpjt.git
cd ajpjt

# 이 폴더의 파일들을 모두 복사한 뒤
git add .
git commit -m "Render.com 배포용 서버 추가 v3.5"
git push origin main
```

### 2단계 — Render.com 설정

1. https://render.com 접속 → 로그인
2. **New → Web Service** 클릭
3. GitHub 레포 연결 (`ajpjt` 선택)
4. 설정 입력:

| 항목 | 값 |
|------|-----|
| **Name** | tl-operating-system |
| **Region** | Singapore (Asia 가장 가까움) |
| **Branch** | main |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | Free (0원, 슬립 후 자동 웨이크업) |

5. **Create Web Service** 클릭
6. 배포 완료 후 URL 확인: `https://tl-operating-system.onrender.com`

### 3단계 — 주의사항

**Free 인스턴스:**
- 15분 비활성 시 슬립 → 첫 접속 시 30~60초 웨이크업 딜레이
- 월 750시간 무료 (1대면 24시간 운영 가능)
- 업그레이드 시 $7/월 → 슬립 없음

**권장 업그레이드 조건:**
- 현장 직원이 365일 사용 → Starter ($7/월) 권장
- 또는 GitHub Pages (현재 `leedaheen.github.io/ajpjt`) 계속 사용

---

## 🗄 Supabase equipment 테이블 생성 (신규)

앱 내 `관리 탭 → Supabase 연동 설정 → SQL 보기` 에서 복사하거나
아래 SQL을 Supabase Dashboard → SQL Editor에서 실행:

```sql
create table if not exists equipment (
  id          bigint generated always as identity primary key,
  record_id   text unique not null,
  equip_no    text not null,
  site_id     text,
  site_name   text,
  company     text,
  spec        text,
  model       text,
  transit_id  text,
  status      text default 'active',
  in_date     text,
  out_date    text,
  created_at  timestamptz default now()
);
create index if not exists idx_equip_site    on equipment(site_id, status);
create index if not exists idx_equip_company on equipment(company, status);
create index if not exists idx_equip_no      on equipment(equip_no);
alter table equipment disable row level security;
```

---

## GitHub Pages vs Render.com 비교

| | GitHub Pages | Render.com (Free) |
|--|--|--|
| 비용 | 무료 | 무료 |
| 속도 | 빠름 (CDN) | 슬립 딜레이 있음 |
| 서버 | 정적만 가능 | Node.js 서버 가능 |
| 도메인 | `github.io` 서브도메인 | `onrender.com` 서브도메인 |
| 커스텀 도메인 | 가능 | 가능 |
| **권장** | ✅ 현재 운영 중 | 서버 기능 필요 시 |

> **결론:** 현재 앱은 Supabase를 백엔드로 직접 사용하므로 **GitHub Pages로도 충분**합니다.
> Render.com은 향후 API 서버나 알림 기능 추가 시 전환하세요.
