-- ============================================================
-- AJ network 고소작업대 — 스키마 패치 (서버우선연동 대응)
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- ================================================================
-- PART 1: transit 테이블 — updated_at / dispatch 컬럼 추가
-- ================================================================

-- 1-1. updated_at: 다른 기기 변경사항 pull 시 기준 컬럼
ALTER TABLE public.transit
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 1-2. dispatch: 배차정보 JSON 문자열 ('{"driver":"..","carNo":"..","phone":".."}')
ALTER TABLE public.transit
  ADD COLUMN IF NOT EXISTS dispatch text DEFAULT '';

-- 1-3. 기존 행의 updated_at 을 created_at 으로 채우기
UPDATE public.transit
SET updated_at = created_at
WHERE updated_at IS NULL;

-- 1-4. updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transit_updated_at ON public.transit;
CREATE TRIGGER trg_transit_updated_at
  BEFORE UPDATE ON public.transit
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 1-5. updated_at 인덱스 (pull 쿼리 성능)
CREATE INDEX IF NOT EXISTS idx_transit_updated_at
  ON public.transit(updated_at DESC);

-- ================================================================
-- PART 2: as_requests 테이블 — updated_at 컬럼 추가
-- ================================================================

-- 2-1. updated_at 컬럼 추가
ALTER TABLE public.as_requests
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 2-2. 기존 행 채우기
UPDATE public.as_requests
SET updated_at = COALESCE(resolved_at, created_at)
WHERE updated_at IS NULL;

-- 2-3. 자동 갱신 트리거
DROP TRIGGER IF EXISTS trg_as_requests_updated_at ON public.as_requests;
CREATE TRIGGER trg_as_requests_updated_at
  BEFORE UPDATE ON public.as_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2-4. updated_at 인덱스
CREATE INDEX IF NOT EXISTS idx_as_requests_updated_at
  ON public.as_requests(updated_at DESC);

-- ================================================================
-- PART 3: aj_members 테이블 — auth_id / email 컬럼 추가
-- ================================================================

-- 3-1. auth_id: Supabase Auth UUID (첫 로그인 시 /api/auth/link-auth-id 로 채워짐)
--      nullable — 연결 전까지 NULL 유지
ALTER TABLE public.aj_members
  ADD COLUMN IF NOT EXISTS auth_id text;

-- 3-2. email: 로그인에 사용된 이메일 (empNo@aj.internal 또는 Google 이메일)
ALTER TABLE public.aj_members
  ADD COLUMN IF NOT EXISTS email text;

-- 3-3. auth_id 유니크 인덱스 (NULL 행은 제외 → 중복 NULL 허용, 연결된 계정은 유일)
CREATE UNIQUE INDEX IF NOT EXISTS idx_aj_members_auth_id
  ON public.aj_members(auth_id)
  WHERE auth_id IS NOT NULL;

-- 3-4. email 인덱스
CREATE INDEX IF NOT EXISTS idx_aj_members_email
  ON public.aj_members(email);

-- 3-5. phone 인덱스 (로그인 전 anon phone 조회 성능)
CREATE INDEX IF NOT EXISTS idx_aj_members_phone
  ON public.aj_members(phone);

-- ================================================================
-- PART 4: 확인 쿼리
-- ================================================================

-- 컬럼 목록 확인 (transit, as_requests, aj_members)
SELECT table_name, column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('transit', 'as_requests', 'aj_members')
  AND column_name IN ('updated_at', 'dispatch', 'auth_id', 'email')
ORDER BY table_name, column_name;

-- 트리거 확인
SELECT trigger_name, event_object_table, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN ('transit', 'as_requests')
ORDER BY event_object_table;

-- aj_members 인덱스 확인
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'aj_members'
  AND indexname IN ('idx_aj_members_auth_id', 'idx_aj_members_email', 'idx_aj_members_phone')
ORDER BY indexname;
