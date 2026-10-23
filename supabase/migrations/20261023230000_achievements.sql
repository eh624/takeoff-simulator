-- 업적 + 순위표 (업적 개수 순)
-- Supabase SQL Editor에 붙여넣고 Run (여러 번 실행해도 괜찮음)

-- 진행 기록: 예) wind:ICN:10 = 인천에서 10 m/s 구간 이륙 성공 횟수, oei_ok = 엔진 고장 대처 성공 횟수
create table if not exists public.progress (
  user_id  uuid not null references auth.users (id) on delete cascade,
  key      text not null,
  n        integer not null default 0,
  first_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- 달성한 업적
create table if not exists public.achievements (
  user_id     uuid not null references auth.users (id) on delete cascade,
  key         text not null,
  achieved_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.profiles add column if not exists achievements integer not null default 0;
alter table public.profiles add column if not exists achievements_at timestamptz;

alter table public.progress     enable row level security;
alter table public.achievements enable row level security;

drop policy if exists "read own progress" on public.progress;
create policy "read own progress" on public.progress for select using (auth.uid() = user_id);
drop policy if exists "read own achievements" on public.achievements;
create policy "read own achievements" on public.achievements for select using (auth.uid() = user_id);
grant select on public.progress, public.achievements to authenticated;

-- 순위표: 다시 모든 프로필(아이디·업적 수)을 볼 수 있게
drop policy if exists "read own profile" on public.profiles;
drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles for select using (true);
create index if not exists profiles_rank on public.profiles (achievements desc, achievements_at asc);

-- 1단계: 비행 정산 + 진행 기록. 내 진행 기록 전체를 돌려줌 (서버만 호출)
create or replace function public.record_flight(
  p_flight uuid, p_user uuid, p_marks text[], p_decision text, p_outcome jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_progress jsonb;
begin
  perform 1 from public.flights
    where id = p_flight and user_id = p_user and finished_at is null
    for update;
  if not found then
    raise exception 'flight_not_open';
  end if;

  update public.flights
     set finished_at = now(), decision = p_decision, outcome = coalesce(p_outcome, '{}'::jsonb)
   where id = p_flight;

  insert into public.progress (user_id, key, n)
  select p_user, m, 1 from unnest(coalesce(p_marks, '{}'::text[])) as m
  on conflict (user_id, key) do update set n = public.progress.n + 1;

  update public.profiles set flights = flights + 1 where id = p_user;

  select coalesce(jsonb_object_agg(key, n), '{}'::jsonb) into v_progress
    from public.progress where user_id = p_user;
  return v_progress;
end $$;

-- 2단계: 달성한 업적 저장, 새로 달성한 것만 돌려줌 (서버만 호출)
create or replace function public.grant_achievements(p_user uuid, p_keys text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_new   jsonb;
  v_count integer;
begin
  with ins as (
    insert into public.achievements (user_id, key)
    select p_user, k from unnest(coalesce(p_keys, '{}'::text[])) as k
    on conflict (user_id, key) do nothing
    returning key
  )
  select coalesce(jsonb_agg(key), '[]'::jsonb) into v_new from ins;

  select count(*) into v_count from public.achievements where user_id = p_user;
  update public.profiles
     set achievements = v_count,
         achievements_at = case when jsonb_array_length(v_new) > 0 then now() else achievements_at end
   where id = p_user;

  return jsonb_build_object('new', v_new, 'count', v_count);
end $$;

revoke all on function public.record_flight(uuid, uuid, text[], text, jsonb) from public, anon, authenticated;
revoke all on function public.grant_achievements(uuid, text[]) from public, anon, authenticated;
grant execute on function public.record_flight(uuid, uuid, text[], text, jsonb) to service_role;
grant execute on function public.grant_achievements(uuid, text[]) to service_role;
