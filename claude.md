SQL data

-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.aj_members (
  emp_no text NOT NULL,
  name text NOT NULL,
  phone text DEFAULT ''::text,
  pw_hash text NOT NULL,
  aj_type text DEFAULT '관리자'::text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT aj_members_pkey PRIMARY KEY (emp_no)
);
CREATE TABLE public.as_requests (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  record_id text UNIQUE,
  date text,
  site_id text,
  site_name text,
  company text,
  equip text,
  location text,
  fault_type text,
  description text,
  reporter_name text,
  reporter_phone text,
  status text,
  tech_name text,
  resolved_at timestamp with time zone,
  resolve_note text,
  created_at timestamp with time zone DEFAULT now(),
  requested_at timestamp with time zone,
  material_at timestamp with time zone,
  tech_phone text,
  CONSTRAINT as_requests_pkey PRIMARY KEY (id)
);
CREATE TABLE public.equipment (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  record_id text NOT NULL UNIQUE,
  equip_no text NOT NULL,
  site_id text,
  site_name text,
  company text,
  spec text,
  model text,
  transit_id text,
  status text DEFAULT 'active'::text,
  in_date text,
  out_date text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT equipment_pkey PRIMARY KEY (id)
);
CREATE TABLE public.logs (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  record_id text UNIQUE,
  date text,
  site_id text,
  site_name text,
  company text,
  floor text,
  equip text,
  recorder text,
  status text,
  start_time text,
  end_time text,
  used_hours numeric DEFAULT 0,
  meter_start text,
  meter_end text,
  off_reason text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT logs_pkey PRIMARY KEY (id)
);
CREATE TABLE public.members (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  record_id text UNIQUE,
  name text,
  company text,
  site_id text,
  site_name text,
  phone text,
  title text,
  joined_at timestamp with time zone DEFAULT now(),
  CONSTRAINT members_pkey PRIMARY KEY (id)
);
CREATE TABLE public.transit (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  record_id text UNIQUE,
  date text,
  type text,
  site_id text,
  site_name text,
  company text,
  equip_specs text,
  aj_equip text,
  reporter_name text,
  reporter_phone text,
  manager_name text,
  manager_phone text,
  manager_location text,
  note text,
  status text,
  messages text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT transit_pkey PRIMARY KEY (id)
);
