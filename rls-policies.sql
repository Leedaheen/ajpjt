-- ============================================================
-- AJ network 고소작업대 — RLS (Row Level Security) 정책
-- Supabase SQL Editor에서 실행하세요.
--
-- ⚠️  실행 순서:
--   1. supabase_schema_patch.sql 먼저 실행 (PART 3 포함)
--      → aj_members.auth_id 컬럼이 없으면 PART 9 정책 생성 실패
--   2. 이 파일 실행
-- ============================================================

-- ================================================================
-- PART 1: 헬퍼 함수 — is_aj()
--
-- AJ 관리자 여부 판별: Supabase Auth JWT의 user_metadata.role = 'aj'
-- AJ 계정은 /api/auth/create-aj-user 로 생성 시
--   user_metadata: { role: 'aj', aj_type: ..., name: ..., emp_no: ... } 가 설정됨.
-- Sub/Tech 사용자는 Google OAuth signInWithIdToken 경유 → user_metadata에 role 없음.
-- service_role 은 RLS 를 자동 우회하므로 이 함수 불필요.
-- ================================================================

CREATE OR REPLACE FUNCTION public.is_aj()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'aj',
    false
  )
$$;

COMMENT ON FUNCTION public.is_aj() IS
  'AJ 관리자 여부 반환. JWT user_metadata.role = ''aj'' 인 경우 true.';

-- ================================================================
-- PART 2: RLS 활성화
-- ================================================================

ALTER TABLE public.logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transit      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aj_members   ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- PART 3: logs 테이블
-- AJ: 전체 CRUD
-- authenticated(Sub/Tech): SELECT + INSERT(운영일지 기록) + UPDATE(sbBatchUpsert upsert 대응)
-- anon: 거부
-- ================================================================

DROP POLICY IF EXISTS "logs: AJ 전체접근"        ON public.logs;
DROP POLICY IF EXISTS "logs: 인증사용자 조회"      ON public.logs;
DROP POLICY IF EXISTS "logs: 인증사용자 등록"      ON public.logs;
DROP POLICY IF EXISTS "logs: 인증사용자 수정"      ON public.logs;

CREATE POLICY "logs: AJ 전체접근"
  ON public.logs FOR ALL
  TO authenticated
  USING (public.is_aj())
  WITH CHECK (public.is_aj());

CREATE POLICY "logs: 인증사용자 조회"
  ON public.logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "logs: 인증사용자 등록"
  ON public.logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- sbBatchUpsert 가 upsert(on_conflict) 사용 시 UPDATE 도 발생할 수 있음
CREATE POLICY "logs: 인증사용자 수정"
  ON public.logs FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ================================================================
-- PART 4: transit 테이블
-- AJ: 전체 CRUD
-- authenticated(Sub/Tech): SELECT 전용 (반입/반출은 AJ만 생성)
-- anon: 거부
-- ================================================================

DROP POLICY IF EXISTS "transit: AJ 전체접근"    ON public.transit;
DROP POLICY IF EXISTS "transit: 인증사용자 조회" ON public.transit;

CREATE POLICY "transit: AJ 전체접근"
  ON public.transit FOR ALL
  TO authenticated
  USING (public.is_aj())
  WITH CHECK (public.is_aj());

CREATE POLICY "transit: 인증사용자 조회"
  ON public.transit FOR SELECT
  TO authenticated
  USING (true);

-- ================================================================
-- PART 5: as_requests (A/S 요청) 테이블
-- AJ: 전체 CRUD
-- authenticated: SELECT + INSERT(신규 요청) + UPDATE(기술인 처리/완료)
-- anon: 거부
-- ================================================================

DROP POLICY IF EXISTS "as_requests: AJ 전체접근"    ON public.as_requests;
DROP POLICY IF EXISTS "as_requests: 인증사용자 조회" ON public.as_requests;
DROP POLICY IF EXISTS "as_requests: 인증사용자 등록" ON public.as_requests;
DROP POLICY IF EXISTS "as_requests: 인증사용자 수정" ON public.as_requests;

CREATE POLICY "as_requests: AJ 전체접근"
  ON public.as_requests FOR ALL
  TO authenticated
  USING (public.is_aj())
  WITH CHECK (public.is_aj());

CREATE POLICY "as_requests: 인증사용자 조회"
  ON public.as_requests FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "as_requests: 인증사용자 등록"
  ON public.as_requests FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 기술인/협력사가 처리 결과(status, tech_name, tech_phone, resolved_at 등) 업데이트
CREATE POLICY "as_requests: 인증사용자 수정"
  ON public.as_requests FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ================================================================
-- PART 6: equipment 테이블
-- AJ: 전체 CRUD
-- authenticated: SELECT 전용 (장비 등록/수정은 AJ만)
-- anon: 거부
-- ================================================================

DROP POLICY IF EXISTS "equipment: AJ 전체접근"    ON public.equipment;
DROP POLICY IF EXISTS "equipment: 인증사용자 조회" ON public.equipment;

CREATE POLICY "equipment: AJ 전체접근"
  ON public.equipment FOR ALL
  TO authenticated
  USING (public.is_aj())
  WITH CHECK (public.is_aj());

CREATE POLICY "equipment: 인증사용자 조회"
  ON public.equipment FOR SELECT
  TO authenticated
  USING (true);

-- ================================================================
-- PART 7: members (Sub/Tech 계정) 테이블
-- AJ: 전체 CRUD (승인/거절/삭제)
-- authenticated: INSERT(가입신청) + SELECT(자신 행 또는 전체*) + UPDATE(자신 행)
-- *협력사/기술인은 현장 멤버 목록 전체를 조회할 수 있음 (앱 UI 필요)
-- anon: 거부
-- ================================================================

DROP POLICY IF EXISTS "members: AJ 전체접근"    ON public.members;
DROP POLICY IF EXISTS "members: 인증사용자 조회" ON public.members;
DROP POLICY IF EXISTS "members: 인증사용자 가입" ON public.members;
DROP POLICY IF EXISTS "members: 인증사용자 수정" ON public.members;

CREATE POLICY "members: AJ 전체접근"
  ON public.members FOR ALL
  TO authenticated
  USING (public.is_aj())
  WITH CHECK (public.is_aj());

-- 인증된 사용자는 members 전체 조회 가능 (현장 멤버 확인용)
-- 더 엄격한 정책이 필요하면 google_email = (auth.jwt() ->> 'email') 로 자신 행만 허용
CREATE POLICY "members: 인증사용자 조회"
  ON public.members FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "members: 인증사용자 가입"
  ON public.members FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 자신의 google_email 이 일치하는 행만 수정 가능
CREATE POLICY "members: 인증사용자 수정"
  ON public.members FOR UPDATE
  TO authenticated
  USING (
    google_email IS NOT NULL
    AND google_email = (auth.jwt() ->> 'email')
  )
  WITH CHECK (
    google_email IS NOT NULL
    AND google_email = (auth.jwt() ->> 'email')
  );

-- ================================================================
-- PART 8: app_settings 테이블
-- AJ: 전체 CRUD (설정 저장/갱신)
-- authenticated: SELECT 전용 (초대코드, 알림시간 조회)
-- anon: 거부
-- ================================================================

DROP POLICY IF EXISTS "app_settings: AJ 전체접근"    ON public.app_settings;
DROP POLICY IF EXISTS "app_settings: 인증사용자 조회" ON public.app_settings;

CREATE POLICY "app_settings: AJ 전체접근"
  ON public.app_settings FOR ALL
  TO authenticated
  USING (public.is_aj())
  WITH CHECK (public.is_aj());

CREATE POLICY "app_settings: 인증사용자 조회"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (true);

-- ================================================================
-- PART 9: aj_members 테이블 — 보안 강화 필요 테이블
--
-- ⚠️  보안 참고사항:
-- 앱 로그인 플로우는 로그인 전(anon) 상태에서 ?phone=eq.X 로 aj_members 를 조회합니다.
-- 이 정책은 anon 에게 status='approved' 행만 SELECT 허용합니다.
-- pw_hash 등 민감 컬럼이 anon 에게 노출됩니다.
-- 완전한 보안을 위해서는 해당 phone 조회를 서버 API(/api/auth/lookup-aj)로 이전하세요.
--
-- AJ(authenticated + is_aj()): 전체 CRUD
-- 본인 행(auth_id = auth.uid()): SELECT + UPDATE (auth_id/email 링크 폴백용)
--   ※ 정상 경로는 /api/auth/link-auth-id (service_role 경유)
-- anon: status='approved' 행만 SELECT (로그인 전 phone 조회 지원)
-- ================================================================

DROP POLICY IF EXISTS "aj_members: AJ 전체접근"     ON public.aj_members;
DROP POLICY IF EXISTS "aj_members: 본인행 조회"      ON public.aj_members;
DROP POLICY IF EXISTS "aj_members: 본인행 수정"      ON public.aj_members;
DROP POLICY IF EXISTS "aj_members: anon 승인행 조회" ON public.aj_members;

-- AJ 관리자 전체 접근
CREATE POLICY "aj_members: AJ 전체접근"
  ON public.aj_members FOR ALL
  TO authenticated
  USING (public.is_aj())
  WITH CHECK (public.is_aj());

-- 본인 행 조회 (auth_id 연결 후 자신의 row를 읽을 수 있음)
CREATE POLICY "aj_members: 본인행 조회"
  ON public.aj_members FOR SELECT
  TO authenticated
  USING (auth_id = auth.uid()::text);

-- 본인 행 수정 (/api/auth/link-auth-id 실패 시 직접 PATCH 폴백)
CREATE POLICY "aj_members: 본인행 수정"
  ON public.aj_members FOR UPDATE
  TO authenticated
  USING (auth_id = auth.uid()::text)
  WITH CHECK (auth_id = auth.uid()::text);

-- anon: 로그인 전 phone 조회 지원 (approved 행만)
-- ⚠️  pw_hash 등 민감 컬럼 노출 위험. 장기적으로 서버 API 이전 권장.
CREATE POLICY "aj_members: anon 승인행 조회"
  ON public.aj_members FOR SELECT
  TO anon
  USING (status = 'approved');

-- ================================================================
-- PART 10: 정책 및 RLS 활성화 확인 쿼리
-- ================================================================

-- RLS 활성화 상태 확인 (모든 행 rowsecurity = true 여야 함)
SELECT tablename, rowsecurity, forcerowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('logs','transit','as_requests','equipment','members','app_settings','aj_members')
ORDER BY tablename;

-- 생성된 정책 목록 확인
SELECT
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('logs','transit','as_requests','equipment','members','app_settings','aj_members')
ORDER BY tablename, policyname;
