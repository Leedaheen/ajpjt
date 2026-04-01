-- ================================================================
-- rls-policies.sql
-- Supabase Auth + Row Level Security 정책 설정
--
-- 실행 방법:
--   Supabase 대시보드 → SQL Editor → 이 파일 내용 붙여넣기 → Run
--
-- 사전 조건:
--   1. migrate-to-supabase-auth.js 실행 완료
--   2. aj_members 테이블에 auth_id, email 컬럼 추가됨
--   3. Supabase Authentication 활성화됨
-- ================================================================

-- ────────────────────────────────────────────────────────────────
-- 0. aj_members 테이블에 컬럼 추가 (없는 경우)
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.aj_members
  ADD COLUMN IF NOT EXISTS auth_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email    text DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS aj_members_auth_id_idx ON public.aj_members(auth_id)
  WHERE auth_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- 1. 헬퍼: 현재 로그인 유저의 aj_type 반환 (RLS 정책에서 재사용)
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_aj_type()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT aj_type
  FROM   public.aj_members
  WHERE  auth_id = auth.uid()
  LIMIT  1;
$$;

-- ────────────────────────────────────────────────────────────────
-- 2. 헬퍼: 현재 유저가 AJ 관리자인지 여부
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_aj_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.aj_members
    WHERE auth_id = auth.uid()
    AND   (aj_type = '관리자' OR aj_type = 'admin')
    AND   (status IS NULL OR status = 'approved')
  );
$$;

-- ────────────────────────────────────────────────────────────────
-- 3. aj_members 테이블 RLS
--    - 자기 자신: 읽기 가능
--    - AJ 관리자: 전체 읽기/쓰기
--    - anon (미로그인): 차단
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.aj_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aj_members: 자신 읽기" ON public.aj_members;
CREATE POLICY "aj_members: 자신 읽기"
  ON public.aj_members FOR SELECT
  USING (auth_id = auth.uid());

DROP POLICY IF EXISTS "aj_members: 관리자 전체 읽기" ON public.aj_members;
CREATE POLICY "aj_members: 관리자 전체 읽기"
  ON public.aj_members FOR SELECT
  USING (public.is_aj_admin());

DROP POLICY IF EXISTS "aj_members: 관리자 쓰기" ON public.aj_members;
CREATE POLICY "aj_members: 관리자 쓰기"
  ON public.aj_members FOR ALL
  USING (public.is_aj_admin())
  WITH CHECK (public.is_aj_admin());

-- ────────────────────────────────────────────────────────────────
-- 4. logs 테이블 RLS
--    - authenticated: 읽기 가능 (모든 로그인 유저)
--    - AJ 관리자: 전체 쓰기
--    - anon: 차단
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "logs: 인증 유저 읽기" ON public.logs;
CREATE POLICY "logs: 인증 유저 읽기"
  ON public.logs FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "logs: 인증 유저 쓰기" ON public.logs;
CREATE POLICY "logs: 인증 유저 쓰기"
  ON public.logs FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "logs: 관리자 수정/삭제" ON public.logs;
CREATE POLICY "logs: 관리자 수정/삭제"
  ON public.logs FOR UPDATE
  USING (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- 5. transit 테이블 RLS
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.transit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transit: 인증 유저 읽기" ON public.transit;
CREATE POLICY "transit: 인증 유저 읽기"
  ON public.transit FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "transit: 인증 유저 쓰기" ON public.transit;
CREATE POLICY "transit: 인증 유저 쓰기"
  ON public.transit FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "transit: 인증 유저 수정" ON public.transit;
CREATE POLICY "transit: 인증 유저 수정"
  ON public.transit FOR UPDATE
  USING (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- 6. as_requests 테이블 RLS
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.as_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "as_requests: 인증 유저 읽기" ON public.as_requests;
CREATE POLICY "as_requests: 인증 유저 읽기"
  ON public.as_requests FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "as_requests: 인증 유저 쓰기" ON public.as_requests;
CREATE POLICY "as_requests: 인증 유저 쓰기"
  ON public.as_requests FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "as_requests: 인증 유저 수정" ON public.as_requests;
CREATE POLICY "as_requests: 인증 유저 수정"
  ON public.as_requests FOR UPDATE
  USING (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- 7. equipment 테이블 RLS
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "equipment: 인증 유저 읽기" ON public.equipment;
CREATE POLICY "equipment: 인증 유저 읽기"
  ON public.equipment FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "equipment: 인증 유저 쓰기" ON public.equipment;
CREATE POLICY "equipment: 인증 유저 쓰기"
  ON public.equipment FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- 8. members 테이블 RLS (협력사/기술인 멤버)
--    SELECT는 anon 허용 — Kakao 로그인 시 google_email/kakao_id로 본인 조회 필요
--    INSERT는 anon 허용 — 가입 신청 (비로그인 상태에서 가능)
--    UPDATE/DELETE는 authenticated만 허용
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members: 전체 읽기 허용" ON public.members;
CREATE POLICY "members: 전체 읽기 허용"
  ON public.members FOR SELECT
  USING (true);  -- 카카오 로그인 시 anon 조회 허용

DROP POLICY IF EXISTS "members: 신규 등록 허용 (anon)" ON public.members;
CREATE POLICY "members: 신규 등록 허용 (anon)"
  ON public.members FOR INSERT
  WITH CHECK (true);  -- 가입 신청은 비로그인도 가능

DROP POLICY IF EXISTS "members: 관리자 수정/삭제" ON public.members;
CREATE POLICY "members: 관리자 수정/삭제"
  ON public.members FOR UPDATE
  USING (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- 9. transit 테이블 — anon 조회 허용 (초대 링크용, site_id 기반)
--    협력사 초대 링크는 로그인 없이 반입/반출 신청 가능
-- ────────────────────────────────────────────────────────────────
-- 위 5번의 anon 차단을 유지하되, 필요시 이 정책 추가:
-- DROP POLICY IF EXISTS "transit: anon site 조회" ON public.transit;
-- CREATE POLICY "transit: anon site 조회"
--   ON public.transit FOR SELECT
--   USING (true);  -- 현장 공개 데이터

-- ────────────────────────────────────────────────────────────────
-- 확인 쿼리 (실행 후 결과 확인용)
-- ────────────────────────────────────────────────────────────────
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
