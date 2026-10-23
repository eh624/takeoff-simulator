// 네이버 로그인 콜백
// 1) 코드 → 토큰 → 네이버 프로필  2) Supabase 사용자 찾기/만들기
// 3) 일회용 로그인 토큰(token_hash)을 만들어 사이트로 돌려보냄 → 브라우저가 verifyOtp로 세션 생성
import { db, authAdmin } from '../../../lib/sb.js';

const back = (origin, params, clearCookie = true) => new Response(null, {
  status: 302,
  headers: {
    location: `${origin}/?${new URLSearchParams(params)}`,
    ...(clearCookie ? { 'set-cookie': 'naver_state=; Path=/auth/naver; HttpOnly; Secure; SameSite=Lax; Max-Age=0' } : {}),
  },
});
const fail = (origin, msg) => back(origin, { login_error: msg });

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookie = (request.headers.get('cookie') || '').match(/(?:^|;\s*)naver_state=([^;]+)/)?.[1];
  if (url.searchParams.get('error')) return fail(origin, '네이버 로그인이 취소되었습니다.');
  if (!code || !state || !cookie || cookie !== state) return fail(origin, '로그인 요청이 만료되었습니다. 다시 시도하세요.');

  // 1. 토큰 교환
  const tokenRes = await fetch('https://nid.naver.com/oauth2.0/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: env.NAVER_CLIENT_ID,
      client_secret: env.NAVER_CLIENT_SECRET,
      code, state,
    }),
  });
  const token = await tokenRes.json().catch(() => null);
  if (!token?.access_token) return fail(origin, '네이버 인증에 실패했습니다.');

  // 2. 프로필
  const meRes = await fetch('https://openapi.naver.com/v1/nid/me', { headers: { authorization: `Bearer ${token.access_token}` } });
  const me = (await meRes.json().catch(() => null))?.response;
  if (!me?.id) return fail(origin, '네이버 프로필을 가져오지 못했습니다.');
  if (!me.email) return fail(origin, '네이버 이메일 제공에 동의해야 로그인할 수 있습니다.');

  // 3. 연결된 사용자 찾기 → 없으면 새로 만들기
  let userId = (await db(env, `naver_links?select=user_id&naver_id=eq.${encodeURIComponent(me.id)}`))[0]?.user_id;
  if (!userId) {
    const created = await authAdmin(env, 'users', {
      method: 'POST',
      body: { email: me.email, email_confirm: true, user_metadata: { full_name: me.nickname || me.name || '', provider: 'naver' } },
    });
    if (!created.ok) {
      // 같은 이메일로 이미 Google/Apple 가입: 다른 계정 탈취를 막기 위해 자동 연결하지 않음
      if (created.status === 422 || created.data?.error_code === 'email_exists') {
        return fail(origin, '이 이메일은 이미 다른 방법(Google 또는 Apple)으로 가입되어 있습니다. 그 방법으로 로그인하세요.');
      }
      return fail(origin, '계정을 만들지 못했습니다.');
    }
    userId = created.data.id;
    await db(env, 'naver_links', { method: 'POST', body: { naver_id: me.id, user_id: userId } });
  }

  // 4. 현재 이메일로 일회용 로그인 토큰 발급
  const u = await authAdmin(env, `users/${userId}`);
  if (!u.ok || !u.data?.email) return fail(origin, '계정을 찾지 못했습니다.');
  const link = await authAdmin(env, 'generate_link', { method: 'POST', body: { type: 'magiclink', email: u.data.email } });
  const tokenHash = link.data?.hashed_token ?? link.data?.properties?.hashed_token;
  if (!link.ok || !tokenHash) return fail(origin, '로그인 토큰을 만들지 못했습니다.');

  return back(origin, { token_hash: tokenHash, type: 'magiclink' });
}
