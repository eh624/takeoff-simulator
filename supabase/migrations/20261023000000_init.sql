-- 여객기 이륙 시뮬레이터: Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run

-- ===== 프로필 (닉네임 · 경험치 · 레벨) =====
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nickname    text not null default '조종사',
  xp          integer not null default 0 check (xp >= 0),
  level       integer not null default 1,
  flights     integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ===== 비행 기록 =====
create table if not exists public.flights (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  inputs       jsonb not null,               -- 기종·공항·중량·날씨
  fail_va      real,                         -- 서버가 정한 엔진 고장 대기속도(m/s), 없으면 null
  decision     text check (decision in ('go', 'stop')),
  outcome      jsonb,                        -- 판정 결과와 경험치 항목
  xp           integer not null default 0,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index if not exists flights_user_started on public.flights (user_id, started_at desc);

-- ===== 네이버 계정 연결 (네이버 고유 id → Supabase 사용자) =====
create table if not exists public.naver_links (
  naver_id  text primary key,
  user_id   uuid not null unique references auth.users (id) on delete cascade
);

-- ===== 가입 시 프로필 자동 생성 =====
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, nickname)
  values (
    new.id,
    left(coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(new.email, '@', 1),
      '조종사'), 20)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===== 경험치 지급 (서버 함수만 호출) =====
-- 같은 비행은 한 번만 지급, 하루(한국 시간) 최대 500 XP
create or replace function public.award_xp(
  p_flight uuid, p_user uuid, p_xp integer, p_decision text, p_outcome jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today   integer;
  v_give    integer;
  v_total   integer;
  v_level   integer;
  v_cap     constant integer := 500;
  v_day     timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  perform 1 from public.flights
    where id = p_flight and user_id = p_user and finished_at is null
    for update;
  if not found then
    raise exception 'flight_not_open';
  end if;

  select coalesce(sum(xp), 0) into v_today
    from public.flights
    where user_id = p_user and finished_at >= v_day;

  v_give := greatest(0, least(p_xp, v_cap - v_today));

  update public.flights
     set finished_at = now(), decision = p_decision, outcome = p_outcome, xp = v_give
   where id = p_flight;

  update public.profiles
     set xp = xp + v_give,
         flights = flights + 1,
         level = greatest(1, floor((1 + sqrt(1 + 8 * (xp + v_give) / 100.0)) / 2)::int)
   where id = p_user
  returning xp, level into v_total, v_level;

  return jsonb_build_object('given', v_give, 'capped', v_give < p_xp, 'total', v_total, 'level', v_level);
end $$;

revoke all on function public.award_xp(uuid, uuid, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.award_xp(uuid, uuid, integer, text, jsonb) to service_role;

-- ===== 보안 규칙 (RLS) =====
alter table public.profiles    enable row level security;
alter table public.flights     enable row level security;
alter table public.naver_links enable row level security;

-- 순위표: 누구나 닉네임·경험치·레벨을 볼 수 있음
drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles for select using (true);

-- 본인 닉네임만 수정 가능 (경험치·레벨은 서버만 변경)
drop policy if exists "update own nickname" on public.profiles;
create policy "update own nickname" on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);
revoke update on public.profiles from anon, authenticated;
grant update (nickname) on public.profiles to authenticated;
alter table public.profiles drop constraint if exists nickname_len;
alter table public.profiles add constraint nickname_len check (char_length(nickname) between 1 and 20);

-- 비행 기록: 본인 것만 조회. 쓰기는 서버(service_role)만
drop policy if exists "read own flights" on public.flights;
create policy "read own flights" on public.flights for select using (auth.uid() = user_id);

-- naver_links: 정책 없음 = 서버만 접근
