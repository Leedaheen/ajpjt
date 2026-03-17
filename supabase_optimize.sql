-- ============================================================
-- AJ network 고소작업대 — Supabase PostgreSQL 성능 최적화 스크립트
-- Supabase SQL Editor에서 순서대로 실행하세요.
-- ============================================================

-- ================================================================
-- PART 1: logs 테이블 인덱스 생성
-- ================================================================

-- 1-1. 날짜 범위 쿼리 (가장 빈번한 쿼리 패턴)
--   → getLogsByRange: date=gte.from&date=lte.to
CREATE INDEX IF NOT EXISTS idx_logs_date
  ON public.logs(date);

-- 1-2. created_at DESC 정렬 (최신순 조회)
--   → order=created_at.desc
CREATE INDEX IF NOT EXISTS idx_logs_created_at_desc
  ON public.logs(created_at DESC);

-- 1-3. 현장별 + 날짜 범위 복합 인덱스 (가장 선택성 높은 인덱스)
--   → site_id=eq.X&date=gte.from&date=lte.to
CREATE INDEX IF NOT EXISTS idx_logs_site_date
  ON public.logs(site_id, date DESC);

-- 1-4. 현장별 + created_at DESC (동기화 쿼리용)
--   → site_id=eq.X&order=created_at.desc
CREATE INDEX IF NOT EXISTS idx_logs_site_created
  ON public.logs(site_id, created_at DESC);

-- 1-5. transit 테이블 인덱스
CREATE INDEX IF NOT EXISTS idx_transit_site_date
  ON public.transit(site_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transit_status
  ON public.transit(status);
CREATE INDEX IF NOT EXISTS idx_transit_created
  ON public.transit(created_at DESC);

-- 1-6. as_requests 테이블 인덱스
CREATE INDEX IF NOT EXISTS idx_as_requests_site_date
  ON public.as_requests(site_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_as_requests_status
  ON public.as_requests(status);
CREATE INDEX IF NOT EXISTS idx_as_requests_created
  ON public.as_requests(created_at DESC);

-- ================================================================
-- PART 2: Full Table Scan 방지 — 현재 앱 쿼리 패턴 확인
-- ================================================================
-- 앱 코드(index.html)에서 이미 아래 최적화가 적용되어 있습니다:
--   · SELECT 시 특정 컬럼만 지정 (LOG_COLS, TR_COLS, AS_COLS)
--   · date 범위 필터 항상 포함 (?date=gte.X&date=lte.Y)
--   · site_id 필터 포함 (?site_id=eq.X)
--   · limit 항상 지정 (?limit=200)
--
-- 아래 쿼리는 실행 계획을 확인용입니다:
EXPLAIN (ANALYZE, BUFFERS)
SELECT record_id, id, date, site_id, company, floor, equip, recorder,
       status, start_time, end_time, used_hours, meter_start, meter_end,
       off_reason, created_at
FROM public.logs
WHERE site_id = 'your-site-id'
  AND date >= '2026-03-01'
  AND date <= '2026-03-17'
ORDER BY created_at DESC
LIMIT 200;

-- ================================================================
-- PART 3: logs 테이블 월별 파티션 마이그레이션 (2026–2028)
-- ================================================================
-- ⚠️  주의: 기존 테이블을 파티션 테이블로 변경하는 작업입니다.
--     데이터 백업 후 진행하세요.
--     UNIQUE 제약조건(record_id)은 파티션 키(date) 포함이 필요합니다.
-- ================================================================

-- STEP 1: 기존 테이블 백업
ALTER TABLE public.logs RENAME TO logs_legacy_bak;

-- STEP 2: 파티션 테이블 생성
CREATE TABLE public.logs (
  id          bigint        NOT NULL,
  record_id   text,
  date        text          NOT NULL,
  site_id     text,
  site_name   text,
  company     text,
  floor       text,
  equip       text,
  recorder    text,
  status      text,
  start_time  text,
  end_time    text,
  used_hours  numeric       DEFAULT 0,
  meter_start text,
  meter_end   text,
  off_reason  text,
  created_at  timestamptz   DEFAULT now(),
  CONSTRAINT logs_pkey PRIMARY KEY (id, date)
) PARTITION BY RANGE (date);

-- UNIQUE 인덱스 (record_id + date — 파티션 키 포함 필요)
CREATE UNIQUE INDEX IF NOT EXISTS idx_logs_record_id_date
  ON public.logs(record_id, date);

-- STEP 3: 시퀀스 재연결
CREATE SEQUENCE IF NOT EXISTS logs_id_seq;
ALTER TABLE public.logs ALTER COLUMN id SET DEFAULT nextval('logs_id_seq');
SELECT setval('logs_id_seq', (SELECT COALESCE(MAX(id), 0) FROM public.logs_legacy_bak));

-- STEP 4: 2026–2028 월별 파티션 36개 생성
CREATE TABLE IF NOT EXISTS public.logs_2026_01 PARTITION OF public.logs FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE IF NOT EXISTS public.logs_2026_02 PARTITION OF public.logs FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE IF NOT EXISTS public.logs_2026_03 PARTITION OF public.logs FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS public.logs_2026_04 PARTITION OF public.logs FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE IF NOT EXISTS public.logs_2026_05 PARTITION OF public.logs FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS public.logs_2026_06 PARTITION OF public.logs FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS public.logs_2026_07 PARTITION OF public.logs FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS public.logs_2026_08 PARTITION OF public.logs FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS public.logs_2026_09 PARTITION OF public.logs FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS public.logs_2026_10 PARTITION OF public.logs FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS public.logs_2026_11 PARTITION OF public.logs FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS public.logs_2026_12 PARTITION OF public.logs FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

CREATE TABLE IF NOT EXISTS public.logs_2027_01 PARTITION OF public.logs FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE IF NOT EXISTS public.logs_2027_02 PARTITION OF public.logs FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE IF NOT EXISTS public.logs_2027_03 PARTITION OF public.logs FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE IF NOT EXISTS public.logs_2027_04 PARTITION OF public.logs FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE IF NOT EXISTS public.logs_2027_05 PARTITION OF public.logs FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE IF NOT EXISTS public.logs_2027_06 PARTITION OF public.logs FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE IF NOT EXISTS public.logs_2027_07 PARTITION OF public.logs FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE IF NOT EXISTS public.logs_2027_08 PARTITION OF public.logs FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE IF NOT EXISTS public.logs_2027_09 PARTITION OF public.logs FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');
CREATE TABLE IF NOT EXISTS public.logs_2027_10 PARTITION OF public.logs FOR VALUES FROM ('2027-10-01') TO ('2027-11-01');
CREATE TABLE IF NOT EXISTS public.logs_2027_11 PARTITION OF public.logs FOR VALUES FROM ('2027-11-01') TO ('2027-12-01');
CREATE TABLE IF NOT EXISTS public.logs_2027_12 PARTITION OF public.logs FOR VALUES FROM ('2027-12-01') TO ('2028-01-01');

CREATE TABLE IF NOT EXISTS public.logs_2028_01 PARTITION OF public.logs FOR VALUES FROM ('2028-01-01') TO ('2028-02-01');
CREATE TABLE IF NOT EXISTS public.logs_2028_02 PARTITION OF public.logs FOR VALUES FROM ('2028-02-01') TO ('2028-03-01');
CREATE TABLE IF NOT EXISTS public.logs_2028_03 PARTITION OF public.logs FOR VALUES FROM ('2028-03-01') TO ('2028-04-01');
CREATE TABLE IF NOT EXISTS public.logs_2028_04 PARTITION OF public.logs FOR VALUES FROM ('2028-04-01') TO ('2028-05-01');
CREATE TABLE IF NOT EXISTS public.logs_2028_05 PARTITION OF public.logs FOR VALUES FROM ('2028-05-01') TO ('2028-06-01');
CREATE TABLE IF NOT EXISTS public.logs_2028_06 PARTITION OF public.logs FOR VALUES FROM ('2028-06-01') TO ('2028-07-01');
CREATE TABLE IF NOT EXISTS public.logs_2028_07 PARTITION OF public.logs FOR VALUES FROM ('2028-07-01') TO ('2028-08-01');
CREATE TABLE IF NOT EXISTS public.logs_2028_08 PARTITION OF public.logs FOR VALUES FROM ('2028-08-01') TO ('2028-09-01');
CREATE TABLE IF NOT EXISTS public.logs_2028_09 PARTITION OF public.logs FOR VALUES FROM ('2028-09-01') TO ('2028-10-01');
CREATE TABLE IF NOT EXISTS public.logs_2028_10 PARTITION OF public.logs FOR VALUES FROM ('2028-10-01') TO ('2028-11-01');
CREATE TABLE IF NOT EXISTS public.logs_2028_11 PARTITION OF public.logs FOR VALUES FROM ('2028-11-01') TO ('2028-12-01');
CREATE TABLE IF NOT EXISTS public.logs_2028_12 PARTITION OF public.logs FOR VALUES FROM ('2028-12-01') TO ('2029-01-01');

-- STEP 5: 기존 데이터 마이그레이션 (날짜 있는 것만)
INSERT INTO public.logs
  (id, record_id, date, site_id, site_name, company, floor, equip,
   recorder, status, start_time, end_time, used_hours,
   meter_start, meter_end, off_reason, created_at)
SELECT id, record_id, date, site_id, site_name, company, floor, equip,
       recorder, status, start_time, end_time, used_hours,
       meter_start, meter_end, off_reason, created_at
FROM public.logs_legacy_bak
WHERE date IS NOT NULL
  AND date >= '2026-01-01'
  AND date <  '2029-01-01';

-- STEP 6: 파티션 범위 밖 데이터 처리 (기본 파티션 — 안전장치)
CREATE TABLE IF NOT EXISTS public.logs_default PARTITION OF public.logs DEFAULT;

-- STEP 7: 각 파티션에 인덱스 자동 생성 확인 후 필요시 추가
-- (파티션 테이블은 상위 인덱스가 각 파티션에 자동 전파됨)
CREATE INDEX IF NOT EXISTS idx_logs_site_date_part
  ON public.logs(site_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_logs_created_part
  ON public.logs(created_at DESC);

-- STEP 8: 기존 백업 테이블 삭제 (데이터 확인 후)
-- DROP TABLE public.logs_legacy_bak;  ← 데이터 이상 없는지 확인 후 주석 해제

-- ================================================================
-- PART 4: 자동 파티션 생성 함수 + pg_cron 스케줄
-- ================================================================

-- 4-1. 다음 달 파티션 자동 생성 함수
CREATE OR REPLACE FUNCTION public.create_next_partition()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  _next_month     date;
  _partition_name text;
  _from_val       text;
  _to_val         text;
BEGIN
  -- 다음 달 1일 계산
  _next_month := date_trunc('month', CURRENT_DATE + interval '1 month')::date;

  _partition_name := 'logs_' || to_char(_next_month, 'YYYY_MM');
  _from_val       := to_char(_next_month,                          'YYYY-MM-DD');
  _to_val         := to_char(_next_month + interval '1 month',     'YYYY-MM-DD');

  -- 이미 존재하면 스킵
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN   pg_namespace n ON n.oid = c.relnamespace
    WHERE  n.nspname = 'public'
    AND    c.relname = _partition_name
  ) THEN
    RAISE NOTICE 'Partition % already exists — skipped.', _partition_name;
    RETURN;
  END IF;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.logs '
    'FOR VALUES FROM (%L) TO (%L)',
    _partition_name, _from_val, _to_val
  );

  RAISE NOTICE 'Created partition: % (% ~ %)',
    _partition_name, _from_val, _to_val;
END;
$$;

-- 4-2. pg_cron으로 매월 25일 자정에 다음 달 파티션 자동 생성
--   (Supabase는 pg_cron 기본 활성화)
SELECT cron.schedule(
  'create_next_partition_monthly',  -- 작업 이름
  '0 0 25 * *',                     -- cron 표현식: 매월 25일 00:00 UTC
  'SELECT public.create_next_partition()'
);

-- 스케줄 확인
SELECT * FROM cron.job WHERE jobname = 'create_next_partition_monthly';

-- 즉시 테스트 실행
-- SELECT public.create_next_partition();

-- ================================================================
-- PART 5: Supabase RLS 정책 — 인덱스가 실제로 사용되려면
--         site_id 필터가 WHERE절에 포함되어야 함
--         (앱 코드에서 이미 site_id=eq.${S.siteId} 적용 중)
-- ================================================================
-- RLS 활성화 확인
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('logs', 'transit', 'as_requests');

-- RLS 활성화 (미설정 시)
-- ALTER TABLE public.logs        ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.transit     ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.as_requests ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- PART 6: 인덱스 사용 현황 확인 (운영 중 모니터링)
-- ================================================================
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan   AS "인덱스 스캔 횟수",
  idx_tup_read AS "인덱스로 읽은 행수",
  idx_tup_fetch AS "실제 가져온 행수"
FROM pg_stat_user_indexes
WHERE tablename IN ('logs', 'transit', 'as_requests')
ORDER BY idx_scan DESC;

-- 테이블 크기 확인
SELECT
  relname AS 테이블명,
  pg_size_pretty(pg_total_relation_size(relid)) AS 전체크기,
  pg_size_pretty(pg_relation_size(relid))       AS 데이터크기,
  n_live_tup AS 실제행수
FROM pg_stat_user_tables
WHERE relname IN ('logs', 'transit', 'as_requests')
ORDER BY pg_total_relation_size(relid) DESC;
