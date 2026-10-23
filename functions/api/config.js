// 브라우저가 쓰는 공개 설정 (anon 키는 공개해도 되는 값)
import { json } from '../../lib/sb.js';

export function onRequestGet({ env }) {
  return json({
    supabaseUrl: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    providers: {
      google: env.ENABLE_GOOGLE === 'true',   // Supabase에서 Google을 켠 뒤 true로
      apple: env.ENABLE_APPLE === 'true',
      naver: Boolean(env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET),
    },
  }, 200, { 'cache-control': 'no-store' });
}
