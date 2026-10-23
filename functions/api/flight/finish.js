// 비행 종료: 서버가 같은 물리 모델로 결과를 다시 계산하고, 진행 기록과 업적을 저장
import { compute, evaluateFlight, flightMarks, ACHIEVEMENTS, achieved, liftoffX } from '../../../public/sim.js';
import { getUser, db, json } from '../../../lib/sb.js';

const MAX_SPEEDUP = 8;   // 재생 배속 최댓값

export async function onRequestPost(ctx) {
  try {
    return await handle(ctx);
  } catch (e) {
    // 원인을 화면에 보여 주기 (DB 함수가 없을 때 등)
    const msg = String(e?.data?.message || e?.message || e);
    const hint = /record_flight|grant_achievements|achievements|progress/.test(msg)
      ? ' Supabase SQL Editor에서 업적 SQL(20261023230000_achievements.sql)을 실행했는지 확인하세요.' : '';
    return json({ error: `서버 오류: ${msg}.${hint}` }, 500);
  }
}

async function handle({ request, env }) {
  const user = await getUser(request, env);
  if (!user) return json({ error: '로그인이 필요합니다.' }, 401);

  const body = await request.json().catch(() => null);
  const id = String(body?.flightId || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: '비행 기록이 없습니다.' }, 400);

  const [flight] = await db(env, `flights?select=*&id=eq.${id}&user_id=eq.${user.id}`);
  if (!flight) return json({ error: '비행 기록이 없습니다.' }, 404);
  if (flight.finished_at) return json({ error: '이미 끝난 비행입니다.' }, 409);

  const decision = body.decision === 'stop' ? 'stop' : body.decision === 'go' ? 'go' : null;
  const abortIdx = Number.isInteger(body.abortIdx) ? body.abortIdx : null;

  const R = compute(flight.inputs);
  const ev = evaluateFlight(R, { failVa: flight.fail_va, decision, abortIdx });

  // 최고 배속으로 재생해도 걸리는 시간보다 빨리 끝났으면 진행으로 치지 않음
  const elapsed = (Date.now() - Date.parse(flight.started_at)) / 1000;
  const tooFast = elapsed < (ev.simTime / MAX_SPEEDUP) * 0.8;
  const marks = tooFast ? [] : flightMarks(R, ev);

  const remaining = (ev.kind === 'normal' || ev.kind === 'fail-go') && ev.safe ? Math.round(R.ap.tora - liftoffX(R, ev)) : null;
  const outcome = { kind: ev.kind, safe: ev.safe, correct: ev.correct, endX: Math.round(ev.endX), remaining, tooFast, marks };

  const progress = await db(env, 'rpc/record_flight', {
    method: 'POST',
    body: { p_flight: id, p_user: user.id, p_marks: marks, p_decision: flight.fail_va != null ? (decision || 'go') : null, p_outcome: outcome },
  });
  const granted = await db(env, 'rpc/grant_achievements', {
    method: 'POST',
    body: { p_user: user.id, p_keys: achieved(progress) },
  });

  const newAchievements = (granted.new || []).map(key => {
    const a = ACHIEVEMENTS.find(x => x.key === key);
    return { key, name: a?.name ?? key, desc: a?.desc ?? '' };
  });
  return json({ ...outcome, newAchievements, count: granted.count, totalCount: ACHIEVEMENTS.length });
}
