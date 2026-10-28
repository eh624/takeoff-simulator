-- 순위표 참여 여부: 사용자가 직접 켜고 끔
-- Supabase SQL Editor에 붙여넣고 Run (여러 번 실행해도 괜찮음)
-- 프로젝트 주소에 ojmrfifogkrbdkjjnoua 가 있는지 먼저 확인!

-- 기존 사용자는 지금처럼 순위표에 나옴 (켜짐)
alter table public.profiles add column if not exists on_board boolean not null default true;

-- 본인이 바꿀 수 있는 칸: 아이디 + 순위표 참여
grant update (nickname, on_board) on public.profiles to authenticated;

-- 순위표에서 빠진 사람의 아이디·업적 수는 다른 사람이 볼 수 없게 (본인은 볼 수 있음)
drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles for select using (on_board or auth.uid() = id);

notify pgrst, 'reload schema';

-- 기본 이름 '조종사' → '유저'
alter table public.profiles alter column nickname set default '유저';
update public.profiles set nickname = '유저' where nickname = '조종사' and not nickname_set;
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
      '유저'), 20)
  )
  on conflict (id) do nothing;
  return new;
end $$;
