// 네이버 로그인 시작: state를 쿠키에 저장하고 네이버 로그인 화면으로 이동
export function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;
  const state = crypto.randomUUID();
  const url = new URL('https://nid.naver.com/oauth2.0/authorize');
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: env.NAVER_CLIENT_ID,
    redirect_uri: `${origin}/auth/naver/callback`,
    state,
  });
  return new Response(null, {
    status: 302,
    headers: {
      location: url.toString(),
      'set-cookie': `naver_state=${state}; Path=/auth/naver; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
