-- 비행 모드 기록: 연습 비행(엔진 고장 연습, V1에서 중단해 보기)은 업적에 넣지 않기 위해
-- Supabase SQL Editor에 붙여넣고 Run (여러 번 실행해도 괜찮음)
-- 기존 비행은 모두 'normal'로 채워짐
alter table public.flights add column if not exists mode text not null default 'normal';
alter table public.flights drop constraint if exists flights_mode_check;
alter table public.flights add constraint flights_mode_check check (mode in ('normal', 'practice', 'v1test'));
