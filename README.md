# 여객기 이륙 시뮬레이터

기종·공항·날씨를 골라 이륙을 재생하고, 로그인한 사용자는 이륙 결과에 따라 경험치(XP)를 받아 레벨이 오른다.

## 폴더 구조

```
public/            정적 사이트 (Cloudflare Pages가 그대로 배포)
  index.html       화면
  app.js           화면 동작, 로그인, 경험치 표시
  sim.js           물리 모델 + 판정 + 경험치 규칙 (서버도 같은 파일을 import)
  _headers         보안 헤더
worker.js          Cloudflare Workers 진입점 (아래 functions를 주소별로 연결)
wrangler.jsonc     Workers 배포 설정
functions/         서버 기능 (Pages Functions 형식, Workers에서도 worker.js가 그대로 사용)
  api/config.js            브라우저에 Supabase 공개 설정 전달
  api/flight/start.js      비행 시작: 엔진 고장(3%)을 서버가 결정해 기록
  api/flight/finish.js     비행 종료: 서버가 결과를 다시 계산해 XP 지급
  auth/naver/login.js      네이버 로그인 시작
  auth/naver/callback.js   네이버 로그인 완료 → Supabase 세션 만들기
lib/sb.js          Supabase REST 호출 도우미 (외부 패키지 없음)
supabase/migrations/20261023000000_init.sql  테이블, 보안 규칙(RLS), XP 지급 함수
```

## 1. Supabase 준비

1. 프로젝트를 만들고 **SQL Editor**에 `supabase/migrations/20261023000000_init.sql` 전체를 붙여넣어 실행합니다.
2. **Authentication → URL Configuration**
   - Site URL: 배포된 사이트 주소 (`https://takeoff-simulator.<계정>.workers.dev` 등) (나중에 도메인을 연결하면 그 주소)
   - Redirect URLs: 위 주소와 로컬 개발용 `http://localhost:8787` 추가
3. **Authentication → Sign In / Providers**
   - **Email**: 켜진 상태로 두세요. 네이버 로그인이 내부적으로 일회용 이메일 로그인 토큰을 쓰기 때문입니다. (사용자에게 메일이 가지는 않습니다)
   - **Google**: Google Cloud Console에서 OAuth 클라이언트(웹)를 만들고, 승인된 리디렉션 URI에 `https://<프로젝트ref>.supabase.co/auth/v1/callback`을 넣은 뒤 Client ID/Secret을 Supabase에 입력
   - **Apple**: Apple Developer Program(연 $99) 가입이 필요합니다. Services ID와 키를 만든 뒤 Supabase에 입력하고, Cloudflare 환경변수 `ENABLE_APPLE=true`로 버튼을 켭니다.
4. **Project Settings → API Keys**에서 키 두 개를 복사합니다.
   - 공개용: `anon`(예전 형식) 또는 `publishable`(새 형식) 키
   - 서버용: `service_role`(예전 형식) 또는 `secret`(새 형식) 키. **절대 브라우저 코드에 넣지 마세요.**

## 2. 네이버 로그인 준비

Supabase에는 네이버가 기본 로그인 방식으로 없어서, `functions/auth/naver/`에서 직접 처리합니다.

1. [네이버 개발자센터](https://developers.naver.com) → 애플리케이션 등록
2. 사용 API: **네이버 로그인**, 제공 정보: **이메일 주소(필수)**, 별명
3. 서비스 URL: `https://<프로젝트>.pages.dev`
4. Callback URL: `https://<프로젝트>.pages.dev/auth/naver/callback` (로컬은 `http://localhost:8787/auth/naver/callback`)
5. Client ID / Client Secret을 Cloudflare 환경변수에 넣습니다.
6. 검수 전에는 개발자센터의 **멤버 관리**에 등록한 네이버 아이디만 로그인됩니다. 공개하려면 검수 요청이 필요합니다.

같은 이메일이 이미 Google/Apple로 가입되어 있으면 네이버 로그인을 막고 안내 문구를 보여줍니다. 다른 사람이 남의 이메일로 계정을 가로채는 것을 막기 위해서입니다.

## 3. Cloudflare 배포 (Workers, GitHub 연동)

1. Cloudflare 대시보드 → **Workers & Pages → Create → Import a repository** → GitHub 저장소 선택
2. 프로젝트 이름: `wrangler.jsonc`의 `"name"`과 같게 (기본 `takeoff-simulator`). 다르게 하려면 `wrangler.jsonc`도 같이 바꾸세요.
3. Build command: 비움 / Deploy command: `npx wrangler deploy` (기본값)
4. 배포가 끝나면 Worker → **Settings → Variables and Secrets**에 아래 값을 넣고 다시 배포합니다.

| 이름 | 값 | 종류 |
|---|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` | Text |
| `SUPABASE_ANON_KEY` | anon / publishable 키 | Text |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret 키 | **Secret** |
| `NAVER_CLIENT_ID` | 네이버 Client ID | Text |
| `NAVER_CLIENT_SECRET` | 네이버 Client Secret | **Secret** |
| `ENABLE_APPLE` | `true` 또는 비움 | Text |

이후에는 GitHub에 push하면 자동으로 다시 배포됩니다. 주소는 `https://takeoff-simulator.<계정>.workers.dev` 형태입니다.

Cloudflare **Pages**로 배포해도 됩니다(출력 폴더 `public`, 빌드 명령 없음). 이때는 `functions/` 폴더가 자동으로 서버 기능이 되고 `worker.js`는 쓰이지 않습니다.

로컬 개발: `npm install` → `.dev.vars.example`을 `.dev.vars`로 복사해 값을 채움 → `npm run dev` → `http://localhost:8787`

`public/index.html`을 서버 없이 그냥 열면 로그인 영역이 숨겨지고 시뮬레이터만 동작합니다.

## 경험치 규칙 (`public/sim.js`의 `flightXp`)

| 항목 | XP |
|---|---|
| 이륙 성공 / 엔진 고장 후 활주로 안에서 정지 | +10 |
| 무거운 중량 (MTOW의 50% 초과분에 비례) | 최대 +20 |
| 젖은 / 눈 / 결빙 활주로 | +5 / +10 / +15 |
| 측풍: 활주로 상태별 한계 대비 비율^1.5 × 30 (한계에 가까울수록 급증) | 최대 +30 |
| 배풍: 한계 15 kt 대비 비율 × 15 | 최대 +15 |
| 측풍·배풍 둘 다 한계의 50% 이상 | +10 |
| 정풍 | 0 (이륙을 돕는 바람) |
| 고지대 공항(3,000 ft 초과) | +10 |
| 여유 부족 조건("주의" 판정)에서 성공 | +10 |
| 엔진 고장 정석 대응 (V1 전 중단 / V1 이후 계속) | +30 |
| 엔진 고장 생존했지만 원칙과 다른 판단 | +5 |
| 이륙 실패, 활주로 이탈, 중량 초과, 측풍·배풍(15 kt) 한계 초과, 이상 없는데 중단 | 0 |

- 레벨: L레벨 누적 XP = 50 × L × (L − 1) → 2레벨 100, 3레벨 300, 4레벨 600, 10레벨 4,500
- 칭호: 훈련생 → 부기장 후보(3) → 부기장(5) → 기장(8) → 선임 기장(12) → 교관 기장(20)
- 하루(한국 시간) 최대 500 XP. "엔진 고장 연습"과 "V1에서 중단해 보기"는 XP 없음

규칙을 바꾸려면 `sim.js`의 `flightXp`를 고치면 됩니다. 레벨 공식을 바꿀 때는 `sim.js`의 `levelFor`/`xpForLevel`과 `20261023000000_init.sql`의 `award_xp` 안 공식을 같이 바꾸세요.

## 부정행위 방지

- 경험치는 브라우저가 아니라 서버가 계산합니다. 브라우저는 "어떤 비행에서 어떤 판단을 했는지"만 보내고, 서버가 같은 물리 모델로 결과를 다시 계산합니다.
- 엔진 고장 여부와 고장 속도는 비행 시작 때 서버가 정해 DB에 저장합니다.
- 한 비행은 한 번만 정산되고, 최고 배속(8×)으로도 불가능한 속도로 끝내면 무효입니다.
- 비행 시작은 3초에 한 번까지만 됩니다.
- 사용자는 DB에서 자기 닉네임만 바꿀 수 있고, 경험치·레벨은 서버 함수(`award_xp`)만 바꿉니다.
