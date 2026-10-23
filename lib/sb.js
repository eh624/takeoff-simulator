// Supabase REST/Auth 호출 도우미 (외부 패키지 없이 fetch만 사용)

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

// 예전 형식(JWT) service_role 키는 Authorization에도 넣고, 새 형식(sb_secret_...) 키는 apikey 헤더만 사용
const admin = env => {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return key.startsWith('sb_') ? { apikey: key } : { apikey: key, authorization: `Bearer ${key}` };
};

// 요청의 Bearer 토큰으로 로그인한 사용자 확인
export async function getUser(request, env) {
  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.id ? u : null;
}

// PostgREST (service_role 권한, RLS 우회)
export async function db(env, path, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { ...admin(env), 'content-type': 'application/json', ...(prefer ? { prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw Object.assign(new Error(data?.message || `db ${r.status}`), { status: r.status, data });
  return data;
}

// Auth 관리자 API
export async function authAdmin(env, path, { method = 'GET', body } = {}) {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/${path}`, {
    method,
    headers: { ...admin(env), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, data };
}
