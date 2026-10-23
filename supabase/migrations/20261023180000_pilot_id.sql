-- 조종사 아이디: 사용자가 직접 정한 이름은 겹치지 않게
-- Supabase SQL Editor에 붙여넣고 Run (여러 번 실행해도 괜찮음)

alter table public.profiles add column if not exists nickname_set boolean not null default false;

-- 사용자가 닉네임을 바꾸면 "직접 정함"으로 표시 (경험치 지급 등 다른 수정에는 반응하지 않음)
create or replace function public.mark_nickname_set()
returns trigger language plpgsql as $$
begin
  new.nickname_set := true;
  new.nickname := btrim(new.nickname);
  return new;
end $$;

drop trigger if exists profiles_mark_nickname_set on public.profiles;
create trigger profiles_mark_nickname_set
  before update of nickname on public.profiles
  for each row execute function public.mark_nickname_set();

-- 형식: 한글·영문·숫자·밑줄 2~12자
alter table public.profiles drop constraint if exists nickname_format;
alter table public.profiles add constraint nickname_format
  check (not nickname_set or nickname ~ '^[가-힣A-Za-z0-9_]{2,12}$');

-- 직접 정한 아이디끼리는 대소문자 구분 없이 중복 불가
create unique index if not exists profiles_nickname_unique
  on public.profiles (lower(nickname)) where nickname_set;
