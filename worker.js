// Cloudflare Workers로 배포할 때의 진입점
// (Pages로 배포하면 이 파일은 쓰이지 않고 functions/ 폴더가 그대로 동작)
import * as config from './functions/api/config.js';
import * as start from './functions/api/flight/start.js';
import * as finish from './functions/api/flight/finish.js';
import * as naverLogin from './functions/auth/naver/login.js';
import * as naverCallback from './functions/auth/naver/callback.js';

const routes = {
  'GET /api/config': config.onRequestGet,
  'POST /api/flight/start': start.onRequestPost,
  'POST /api/flight/finish': finish.onRequestPost,
  'GET /auth/naver/login': naverLogin.onRequestGet,
  'GET /auth/naver/callback': naverCallback.onRequestGet,
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const handler = routes[`${request.method} ${pathname}`];
    if (handler) return handler({ request, env, ctx });
    if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) {
      return new Response(JSON.stringify({ error: '없는 주소입니다.' }), { status: 404, headers: { 'content-type': 'application/json' } });
    }
    return env.ASSETS.fetch(request);   // 나머지는 public/ 의 정적 파일
  },
};
