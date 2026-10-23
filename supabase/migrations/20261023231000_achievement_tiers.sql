-- 업적 단계 개편 (공항 업적도 1·4·7·11곳 4단계)
-- 예전 이름의 업적(wind_master, close_call, fail_mother)을 지우고 개수를 다시 셈
-- 진행 기록은 그대로라서, 다음 비행 때 새 단계 업적이 자동으로 채워짐
delete from public.achievements where key in ('wind_master', 'close_call', 'fail_mother');
update public.profiles p
   set achievements = (select count(*) from public.achievements a where a.user_id = p.id);
