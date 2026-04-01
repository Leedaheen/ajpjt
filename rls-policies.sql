-- ================================================================
-- rls-policies.sql  (QA P0/P1/P2 전체 수정본)
-- Supabase Auth + Row Level Security 정책 설정
--
-- 실행 방법:
--   Supabase 대시보드 → SQL Editor → 이 파일 내용 붙여넣기 → Run
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
-- 1. 헬퍼: 현재 유저의 aj_type 반환
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
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.aj_members ENABLE ROW LEVEL SECURITY;

-- [P0-2] 빈 문자열 우회 차단: google_email IS NOT NULL AND google_email != ''
DROP POLICY IF EXISTS "aj_members: 자신 읽기" ON public.aj_members;
CREATE POLICY "aj_members: 자신 읽기"
  ON public.aj_members FOR SELECT
  USING (
    auth_id = auth.uid()
    OR (
      google_email IS NOT NULL
      AND google_email != ''
      AND google_email = auth.email()
    )
  );

DROP POLICY IF EXISTS "aj_members: 관리자 전체 읽기" ON public.aj_members;
CREATE POLICY "aj_members: 관리자 전체 읽기"
  ON public.aj_members FOR SELECT
  USING (public.is_aj_admin());

DROP POLICY IF EXISTS "aj_members: 관리자 쓰기" ON public.aj_members;
CREATE POLICY "aj_members: 관리자 쓰기"
  ON public.aj_members FOR ALL
  USING (public.is_aj_admin())
  WITH CHECK (public.is_aj_admin());

-- [P0-1] auth_id 자동 연결 정책
-- Google 로그인 후 최초 1회: auth_id가 NULL인 자신의 레코드에만 UPDATE 허용
DROP POLICY IF EXISTS "aj_members: auth_id 자동 연결" ON public.aj_members;
CREATE POLICY "aj_members: auth_id 자동 연결"
  ON public.aj_members FOR UPDATE
  USING (
    auth_id IS NULL
    AND google_email IS NOT NULL
    AND google_email != ''
    AND google_email = auth.email()
  )
  WITH CHECK (
    auth_id = auth.uid()
  );

-- ────────────────────────────────────────────────────────────────
-- 4. logs 테이블 RLS
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

DROP POLICY IF EXISTS "logs: 인증 유저 수정" ON public.logs;
CREATE POLICY "logs: 인증 유저 수정"
  ON public.logs FOR UPDATE
  USING (auth.role() = 'authenticated');

-- [P1-3] DELETE 명시적 허용
DROP POLICY IF EXISTS "logs: 인증 유저 삭제" ON public.logs;
CREATE POLICY "logs: 인증 유저 삭제"
  ON public.logs FOR DELETE
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

-- [P1-3] DELETE 명시적 허용
DROP POLICY IF EXISTS "transit: 인증 유저 삭제" ON public.transit;
CREATE POLICY "transit: 인증 유저 삭제"
  ON public.transit FOR DELETE
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

-- [P1-3] DELETE 명시적 허용
DROP POLICY IF EXISTS "as_requests: 인증 유저 삭제" ON public.as_requests;
CREATE POLICY "as_requests: 인증 유저 삭제"
  ON public.as_requests FOR DELETE
  USING (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- 7. equipment 테이블 RLS
-- [P1-2] FOR ALL → 개별 정책 분리 (DELETE 의도치 않은 허용 방지)
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "equipment: 인증 유저 읽기" ON public.equipment;
CREATE POLICY "equipment: 인증 유저 읽기"
  ON public.equipment FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "equipment: 인증 유저 쓰기" ON public.equipment;  -- 구 FOR ALL 제거
DROP POLICY IF EXISTS "equipment: 인증 유저 생성" ON public.equipment;
CREATE POLICY "equipment: 인증 유저 생성"
  ON public.equipment FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "equipment: 인증 유저 수정" ON public.equipment;
CREATE POLICY "equipment: 인증 유저 수정"
  ON public.equipment FOR UPDATE
  USING (auth.role() = 'authenticated');

-- equipment DELETE는 관리자만 허용
DROP POLICY IF EXISTS "equipment: 관리자 삭제" ON public.equipment;
CREATE POLICY "equipment: 관리자 삭제"
  ON public.equipment FOR DELETE
  USING (public.is_aj_admin());

-- ────────────────────────────────────────────────────────────────
-- 8. members 테이블 RLS (협력사/기술인 멤버)
-- [P1-4] SELECT USING(true) — 카카오 로그인 본인 조회에 필요 (내부 업무 앱 의도적 허용)
--        주의: 모든 사용자 연락처/소속이 비인증 상태에서 조회 가능
--        Kakao OAuth 리다이렉트 방식 전환 시 인증 필요로 변경 권장
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members: 전체 읽기 허용" ON public.members;
CREATE POLICY "members: 전체 읽기 허용"
  ON public.members FOR SELECT
  USING (true);  -- [의도적 허용] 카카오 로그인 시 anon 상태에서 본인 조회 필요

DROP POLICY IF EXISTS "members: 신규 등록 허용 (anon)" ON public.members;
CREATE POLICY "members: 신규 등록 허용 (anon)"
  ON public.members FOR INSERT
  WITH CHECK (true);  -- 가입 신청은 비로그인도 가능

DROP POLICY IF EXISTS "members: 관리자 수정/삭제" ON public.members;
CREATE POLICY "members: 인증 유저 수정"
  ON public.members FOR UPDATE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "members: 인증 유저 삭제" ON public.members;
CREATE POLICY "members: 인증 유저 삭제"
  ON public.members FOR DELETE
  USING (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- 확인 쿼리 (실행 후 결과 확인용)
-- ────────────────────────────────────────────────────────────────
SELECT
  tablename,
  policyname,
  cmd,
  permissive
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;
