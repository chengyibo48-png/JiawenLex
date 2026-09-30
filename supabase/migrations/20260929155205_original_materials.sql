-- Original document archive, resumable upload sessions, and MinerU review candidates.
-- Version matches the migration applied to the hosted JiawenLex project.
create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  original_name text not null check (char_length(original_name) between 1 and 500),
  object_key text not null unique,
  byte_size bigint not null check (byte_size between 1 and 536870912),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  page_count integer check (page_count is null or page_count between 1 and 100000),
  content_type text not null default 'application/pdf' check (content_type = 'application/pdf'),
  source_title text not null default '',
  author text not null default '',
  source_year integer check (source_year is null or source_year between 1900 and 2200),
  skill text check (skill is null or skill in ('reading','listening','writing','speaking')),
  content_kind text not null default 'reference' check (content_kind in ('reference','questions','vocabulary','plan','mixed','unknown')),
  source_url text not null default '',
  license_name text not null default '',
  status text not null default 'uploading' check (status in ('uploading','ready','failed')),
  parse_status text not null default 'not_started' check (parse_status in ('not_started','queued','parsing','review','complete','failed')),
  parsed_pages integer not null default 0 check (parsed_pages >= 0),
  created_at timestamptz not null default now(),
  unique (owner_id, sha256)
);
create index source_documents_owner_time on public.source_documents(owner_id, created_at desc);
create index source_documents_owner_kind on public.source_documents(owner_id, content_kind, parse_status);
alter table public.source_documents enable row level security;
create policy source_documents_owner on public.source_documents for all to authenticated
  using (owner_id = auth.uid() and private.is_active_member())
  with check (owner_id = auth.uid() and private.is_active_member());
revoke all on public.source_documents from public, anon, authenticated;
grant all on public.source_documents to service_role;

alter table public.materials
  add column source_document_id uuid references public.source_documents(id) on delete set null,
  add column source_physical_page integer check (source_physical_page is null or source_physical_page > 0),
  add column source_printed_page text not null default '';
alter table public.vocabulary
  add column source_document_id uuid references public.source_documents(id) on delete set null,
  add column source_physical_page integer check (source_physical_page is null or source_physical_page > 0),
  add column source_printed_page text not null default '',
  add column source_verified boolean not null default false;

create table public.source_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid not null references public.source_documents(id) on delete cascade,
  object_key text not null unique,
  upload_id text not null,
  expected_size bigint not null check (expected_size between 1 and 536870912),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  part_size integer not null check (part_size between 5242880 and 67108864),
  status text not null default 'uploading' check (status in ('uploading','complete','aborted','failed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);
create index source_upload_sessions_owner on public.source_upload_sessions(owner_id, created_at desc);
alter table public.source_upload_sessions enable row level security;
create policy source_upload_sessions_owner on public.source_upload_sessions for all to authenticated
  using (owner_id = auth.uid() and private.is_active_member())
  with check (owner_id = auth.uid() and private.is_active_member());
revoke all on public.source_upload_sessions from public, anon, authenticated;
grant all on public.source_upload_sessions to service_role;

create table public.source_parse_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid not null references public.source_documents(id) on delete cascade,
  parser text not null default 'MinerU',
  parser_version text not null default '',
  total_pages integer not null check (total_pages between 1 and 100000),
  parsed_pages integer not null default 0 check (parsed_pages between 0 and total_pages),
  status text not null default 'queued' check (status in ('queued','parsing','review','complete','failed')),
  idempotency_key uuid not null default gen_random_uuid(),
  error_message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index source_parse_batches_idempotency on public.source_parse_batches(owner_id, idempotency_key);
create index source_parse_batches_owner on public.source_parse_batches(owner_id, created_at desc);
alter table public.source_parse_batches enable row level security;
create policy source_parse_batches_owner on public.source_parse_batches for all to authenticated
  using (owner_id = auth.uid() and private.is_active_member())
  with check (owner_id = auth.uid() and private.is_active_member());
revoke all on public.source_parse_batches from public, anon, authenticated;
grant all on public.source_parse_batches to service_role;

create table public.source_review_candidates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid not null references public.source_documents(id) on delete cascade,
  batch_id uuid not null references public.source_parse_batches(id) on delete cascade,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  physical_page integer not null check (physical_page between 1 and 100000),
  printed_page text not null default '',
  section_title text not null default '',
  content_kind text not null check (content_kind in ('page_text','question','vocabulary','reference_answer','figure','note')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending','edited','rejected','published')),
  published_material_id uuid references public.materials(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, fingerprint)
);
create index source_review_candidates_owner_status on public.source_review_candidates(owner_id, status, physical_page);
alter table public.source_review_candidates enable row level security;
create policy source_review_candidates_owner on public.source_review_candidates for all to authenticated
  using (owner_id = auth.uid() and private.is_active_member())
  with check (owner_id = auth.uid() and private.is_active_member());
revoke all on public.source_review_candidates from public, anon, authenticated;
grant all on public.source_review_candidates to service_role;

create table public.source_import_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid not null references public.source_documents(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz
);
create index source_import_tokens_doc on public.source_import_tokens(document_id, owner_id, expires_at);
alter table public.source_import_tokens enable row level security;
revoke all on public.source_import_tokens from public, anon, authenticated;
grant all on public.source_import_tokens to service_role;

-- Exercise correction reports are visible only through authenticated API routes.
-- A learner can suggest corrections to a shared exercise; only its owner can apply them.
create table public.question_error_reports (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  question_id text not null check (char_length(question_id) between 1 and 160),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  error_kind text not null check (error_kind in ('answer','spelling','grammar','missing','other')),
  comment text not null default '' check (char_length(comment) <= 2000),
  original_question jsonb not null check (jsonb_typeof(original_question) = 'object'),
  suggested_prompt text check (suggested_prompt is null or char_length(suggested_prompt) between 1 and 4000),
  suggested_answers jsonb check (suggested_answers is null or (jsonb_typeof(suggested_answers) = 'array' and jsonb_array_length(suggested_answers) <= 100)),
  suggested_explanation text check (suggested_explanation is null or char_length(suggested_explanation) <= 4000),
  status text not null default 'pending' check (status in ('pending','applied','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz
);
create index question_error_reports_owner_status on public.question_error_reports(owner_id,status,created_at desc);
create index question_error_reports_reporter_time on public.question_error_reports(reporter_id,created_at desc);
alter table public.question_error_reports enable row level security;
revoke all on public.question_error_reports from public, anon, authenticated;
grant all on public.question_error_reports to service_role;

create or replace function public.submit_question_error_report(
  p_material_id uuid,
  p_question_id text,
  p_reporter_id uuid,
  p_error_kind text,
  p_comment text,
  p_expected_question jsonb,
  p_suggested_prompt text,
  p_suggested_answers jsonb,
  p_suggested_explanation text
) returns table(report_id uuid, direct_edit boolean)
language plpgsql security invoker set search_path = '' as $$
declare
  v_material record;
  v_question jsonb;
  v_updated_question jsonb;
  v_questions jsonb;
  v_question_index integer;
  v_report_id uuid := gen_random_uuid();
  v_direct boolean := false;
begin
  select id, owner_id, questions, prompt into v_material
  from public.materials where id = p_material_id for update;
  if not found then raise exception 'material_unavailable'; end if;
  if p_reporter_id is null or p_error_kind not in ('answer','spelling','grammar','missing','other') then
    raise exception 'invalid_report';
  end if;
  if p_question_id = '__material_prompt__' then
    v_question := jsonb_build_object('prompt',to_jsonb(v_material.prompt),'answers','[]'::jsonb,'explanation','');
  else
    select entry.value, entry.ordinality::integer into v_question, v_question_index
    from jsonb_array_elements(v_material.questions) with ordinality as entry(value, ordinality)
    where entry.value->>'id' = p_question_id limit 1;
    if v_question is null then raise exception 'question_unavailable'; end if;
  end if;
  if p_expected_question is distinct from jsonb_build_object('prompt',v_question->'prompt','answers',coalesce(v_question->'answers','[]'::jsonb),'explanation',coalesce(v_question->'explanation','""'::jsonb)) then
    raise exception 'question_changed_since_report';
  end if;

  insert into public.question_error_reports(
    id, material_id, question_id, owner_id, reporter_id, error_kind, comment,
    original_question, suggested_prompt, suggested_answers, suggested_explanation
  ) values (
    v_report_id, p_material_id, p_question_id, v_material.owner_id, p_reporter_id, p_error_kind,
    coalesce(p_comment,''),
    jsonb_build_object('prompt',v_question->'prompt','answers',coalesce(v_question->'answers','[]'::jsonb),'explanation',coalesce(v_question->'explanation','""'::jsonb)),
    p_suggested_prompt,p_suggested_answers,p_suggested_explanation
  );

  v_direct := p_reporter_id = v_material.owner_id and
    (p_suggested_prompt is not null or p_suggested_answers is not null or p_suggested_explanation is not null);
  if v_direct then
    v_updated_question := v_question;
    if p_suggested_prompt is not null then v_updated_question := jsonb_set(v_updated_question,'{prompt}',to_jsonb(p_suggested_prompt),true); end if;
    if p_suggested_answers is not null then v_updated_question := jsonb_set(v_updated_question,'{answers}',p_suggested_answers,true); end if;
    if p_suggested_explanation is not null then v_updated_question := jsonb_set(v_updated_question,'{explanation}',to_jsonb(p_suggested_explanation),true); end if;
    if p_question_id = '__material_prompt__' then
      update public.materials set prompt=p_suggested_prompt where id=p_material_id;
    else
      v_questions := jsonb_set(v_material.questions,array[(v_question_index-1)::text],v_updated_question,false);
      update public.materials set questions = v_questions where id = p_material_id;
    end if;
    update public.question_error_reports set status='applied', applied_at=now(), updated_at=now() where id=v_report_id;
  end if;
  return query select v_report_id,v_direct;
end;
$$;
revoke all on function public.submit_question_error_report(uuid,text,uuid,text,text,jsonb,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.submit_question_error_report(uuid,text,uuid,text,text,jsonb,text,jsonb,text) to service_role;

create or replace function public.apply_question_error_report(
  p_report_id uuid,
  p_reviewer_id uuid,
  p_suggested_prompt text default null,
  p_suggested_answers jsonb default null,
  p_suggested_explanation text default null
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_report record;
  v_material record;
  v_question jsonb;
  v_updated_question jsonb;
  v_questions jsonb;
  v_question_index integer;
  v_prompt text;
  v_answers jsonb;
  v_explanation text;
  v_current_question jsonb;
begin
  select * into v_report from public.question_error_reports where id=p_report_id for update;
  if not found or v_report.owner_id <> p_reviewer_id then raise exception 'report_unavailable'; end if;
  if v_report.status <> 'pending' then raise exception 'report_already_closed'; end if;
  select id, owner_id, questions, prompt into v_material from public.materials
  where id=v_report.material_id and owner_id=p_reviewer_id for update;
  if not found then raise exception 'material_unavailable'; end if;
  if v_report.question_id = '__material_prompt__' then
    v_question := jsonb_build_object('prompt',to_jsonb(v_material.prompt),'answers','[]'::jsonb,'explanation','');
  else
    select entry.value, entry.ordinality::integer into v_question, v_question_index
    from jsonb_array_elements(v_material.questions) with ordinality as entry(value, ordinality)
    where entry.value->>'id'=v_report.question_id limit 1;
    if v_question is null then raise exception 'question_unavailable'; end if;
  end if;
  v_current_question := jsonb_build_object('prompt',v_question->'prompt','answers',coalesce(v_question->'answers','[]'::jsonb),'explanation',coalesce(v_question->'explanation','""'::jsonb));
  if v_current_question <> v_report.original_question then raise exception 'question_changed_since_report'; end if;
  v_prompt := coalesce(p_suggested_prompt,v_report.suggested_prompt);
  v_answers := coalesce(p_suggested_answers,v_report.suggested_answers);
  v_explanation := coalesce(p_suggested_explanation,v_report.suggested_explanation);
  if v_prompt is null and v_answers is null and v_explanation is null then raise exception 'no_correction_provided'; end if;
  if v_report.question_id = '__material_prompt__' then
    if v_answers is not null or v_explanation is not null or v_prompt is null then raise exception 'invalid_report'; end if;
    update public.materials set prompt=v_prompt where id=v_report.material_id;
    update public.question_error_reports set status='applied', applied_at=now(), updated_at=now(), suggested_prompt=v_prompt
    where id=p_report_id;
    return;
  end if;
  v_updated_question := v_question;
  if v_prompt is not null then v_updated_question := jsonb_set(v_updated_question,'{prompt}',to_jsonb(v_prompt),true); end if;
  if v_answers is not null then v_updated_question := jsonb_set(v_updated_question,'{answers}',v_answers,true); end if;
  if v_explanation is not null then v_updated_question := jsonb_set(v_updated_question,'{explanation}',to_jsonb(v_explanation),true); end if;
  v_questions := jsonb_set(v_material.questions,array[(v_question_index-1)::text],v_updated_question,false);
  update public.materials set questions=v_questions where id=v_report.material_id;
  update public.question_error_reports set status='applied', applied_at=now(), updated_at=now(),
    suggested_prompt=v_prompt, suggested_answers=v_answers, suggested_explanation=v_explanation
  where id=p_report_id;
end;
$$;
revoke all on function public.apply_question_error_report(uuid,uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.apply_question_error_report(uuid,uuid,text,jsonb,text) to service_role;

-- Original PDFs live in a private external object store; do not raise Supabase
-- Storage limits for existing practice attachments.
