// 비행 시작: 입력값을 검사하고, 엔진 고장 여부를 서버가 정해 기록
import { compute, validateInputs, pickFailVa, P } from '../../../public/sim.js';
import { getUser, db, json } from '../../../lib/sb.js';

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
  const inp = validateInputs(body?.inputs);
  if (!inp) return json({ error: '입력값이 올바르지 않습니다.' }, 400);

  const R = compute(inp);
  if (R.xwBlocked) return json({ error: '바람이 한계를 넘어 이륙할 수 없습니다.' }, 400);

  // 너무 잦은 시작 방지: 직전 비행 시작 후 3초 이내면 거절
  const recent = await db(env, `flights?select=started_at&user_id=eq.${user.id}&order=started_at.desc&limit=1`);
  if (recent[0] && Date.now() - Date.parse(recent[0].started_at) < 3000) {
    return json({ error: '잠시 후 다시 시도하세요.' }, 429);
  }

  // mode: 'normal'(3% 고장) | 'practice'(항상 고장) | 'v1test'(고장 없음, V1에서 중단)
  const mode = ['practice', 'v1test'].includes(body?.mode) ? body.mode : 'normal';
  const fail = mode === 'practice' || (mode === 'normal' && Math.random() < P.failProb);
  const failVa = fail ? pickFailVa(R, Math.random()) : null;
  const [row] = await db(env, 'flights', {
    method: 'POST', prefer: 'return=representation',
    body: { user_id: user.id, inputs: inp, fail_va: failVa, mode },
  });
  return json({ flightId: row.id, failVa });
}
