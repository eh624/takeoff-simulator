// 비행 종료: 서버가 같은 물리 모델로 결과를 다시 계산해 경험치 지급
import { compute, evaluateFlight, flightXp, rankName } from '../../../public/sim.js';
import { getUser, db, json } from '../../../lib/sb.js';

const MAX_SPEEDUP = 8;   // 재생 배속 최댓값

export async function onRequestPost({ request, env }) {
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
  let { xp, items } = flightXp(R, ev);

  // 최고 배속으로 재생해도 걸리는 시간보다 빨리 끝났으면 무효
  const elapsed = (Date.now() - Date.parse(flight.started_at)) / 1000;
  if (elapsed < (ev.simTime / MAX_SPEEDUP) * 0.8) { xp = 0; items = [['재생 시간이 너무 짧아 무효', 0]]; }

  const outcome = { kind: ev.kind, safe: ev.safe, correct: ev.correct, endX: Math.round(ev.endX), items };
  const res = await db(env, 'rpc/award_xp', {
    method: 'POST',
    body: { p_flight: id, p_user: user.id, p_xp: xp, p_decision: flight.fail_va != null ? (decision || 'go') : null, p_outcome: outcome },
  });
  return json({ ...outcome, earned: res.given, capped: res.capped, total: res.total, level: res.level, rank: rankName(res.level) });
}
