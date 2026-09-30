-- Local migration only: apply as part of a user-authorized version update.
-- First confirmed recall earns a distinct word; senses/repeated reviews count once.
create table if not exists public.vocabulary_learned_words (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  term_key text not null check (length(term_key) between 1 and 160),
  first_known_at timestamptz not null default now(),
  primary key (owner_id, term_key)
);
alter table public.vocabulary_learned_words enable row level security;
revoke all on public.vocabulary_learned_words from public, anon, authenticated;
grant all on public.vocabulary_learned_words to service_role;

-- Preserve verifiable earlier confirmed recalls, never infer them from imports/streaks.
insert into public.vocabulary_learned_words(owner_id, term_key, first_known_at)
select owner_id, lower(regexp_replace(btrim(result->>'term'), '\s+', ' ', 'g')), min(created_at)
from public.vocabulary_review_events
where known and length(btrim(result->>'term')) between 1 and 160
group by owner_id, lower(regexp_replace(btrim(result->>'term'), '\s+', ' ', 'g'))
on conflict (owner_id, term_key) do nothing;

create or replace function public.record_word_review(p_owner uuid,p_word uuid,p_event uuid,p_known boolean,p_revision integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare w public.vocabulary; e public.vocabulary_review_events; days integer; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_event::text,0));
 select * into e from vocabulary_review_events where owner_id=p_owner and event_id=p_event;
 if found then
   if e.word_id<>p_word or e.known<>p_known then raise exception 'review_event_mismatch'; end if;
   return e.result;
 end if;
 select * into w from vocabulary where id=p_word and owner_id=p_owner for update;
 if not found then raise exception 'word_unavailable'; end if;
 if w.content_revision<>p_revision then raise exception 'word_changed'; end if;
 days:=case when not p_known or w.interval_days<1 then 1 else least(60,w.interval_days*2) end;
 update vocabulary set interval_days=days, streak=case when p_known then streak+1 else 0 end,
   last_reviewed_at=now(),due_at=now()+make_interval(days=>days) where id=p_word returning * into w;
 result:=to_jsonb(w);
 insert into vocabulary_review_events(owner_id,event_id,word_id,known,result) values(p_owner,p_event,p_word,p_known,result);
 if p_known and length(btrim(w.term)) between 1 and 160 then
   insert into vocabulary_learned_words(owner_id,term_key)
   values(p_owner,lower(regexp_replace(btrim(w.term),'\s+',' ','g')))
   on conflict(owner_id,term_key) do nothing;
 end if;
 return result;
end $$;
revoke all on function public.record_word_review(uuid,uuid,uuid,boolean,integer) from public,anon,authenticated;
grant execute on function public.record_word_review(uuid,uuid,uuid,boolean,integer) to service_role;
