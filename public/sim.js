// 이륙 성능 물리 모델: 브라우저(app.js)와 서버(functions)가 같은 파일을 씀
export const fmt = (n, d = 0) => n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });

// ===== 데이터 =====
export const AIRCRAFT = [
  { id: 'a350', name: 'Airbus A350-900',  mtow: 280000, S: 443,   ar: 9.49, thrust: 374500, n: 2, eng: 'Trent XWB-84', clmax: 2.3, cd0: 0.024, e: 0.8 },
  { id: 'b77w', name: 'Boeing 777-300ER', mtow: 351535, S: 436.8, ar: 8.67, thrust: 513000, n: 2, eng: 'GE90-115B',   clmax: 2.3, cd0: 0.025, e: 0.8 },
  { id: 'b789', name: 'Boeing 787-9',     mtow: 254011, S: 377,   ar: 9.59, thrust: 340000, n: 2, eng: 'GEnx-1B / Trent 1000', clmax: 2.3, cd0: 0.024, e: 0.8 },
  { id: 'a388', name: 'Airbus A380-800',  mtow: 575000, S: 845,   ar: 7.53, thrust: 311000, n: 4, eng: 'Trent 970',   clmax: 2.3, cd0: 0.025, e: 0.8 },
  { id: 'b748', name: 'Boeing 747-8',     mtow: 447696, S: 554,   ar: 8.45, thrust: 296000, n: 4, eng: 'GEnx-2B',     clmax: 2.2, cd0: 0.025, e: 0.8 },
  { id: 'a21n', name: 'Airbus A321neo',   mtow: 97000,  S: 122.6, ar: 10.4, thrust: 147000, n: 2, eng: 'LEAP-1A',     clmax: 2.4, cd0: 0.023, e: 0.8 },
  { id: 'b38m', name: 'Boeing 737-8',     mtow: 82191,  S: 127,   ar: 10.2, thrust: 130000, n: 2, eng: 'LEAP-1B',     clmax: 2.4, cd0: 0.023, e: 0.8 },
];
export const AIRPORTS = [
  { code: 'ICN', name: '인천',      tora: 3700, alt: 23 },
  { code: 'GMP', name: '김포',      tora: 3600, alt: 58 },
  { code: 'CJU', name: '제주',      tora: 3180, alt: 118 },
  { code: 'PUS', name: '김해',      tora: 3200, alt: 6 },
  { code: 'TAE', name: '대구',      tora: 2740, alt: 116 },
  { code: 'CJJ', name: '청주',      tora: 2743, alt: 191 },
  { code: 'NRT', name: '도쿄 나리타', tora: 4000, alt: 141 },
  { code: 'HKG', name: '홍콩',      tora: 3800, alt: 28 },
  { code: 'LHR', name: '런던 히스로', tora: 3902, alt: 83 },
  { code: 'DEN', name: '덴버',      tora: 4877, alt: 5434 },
  { code: 'MEX', name: '멕시코시티',  tora: 3963, alt: 7316 },
];
export const RUNWAY = {
  dry:  { label: '건조',   roll: 0.02, brake: 0.60, xw: 17 },
  wet:  { label: '젖음',   roll: 0.04, brake: 0.30, xw: 8 },
  snow: { label: '눈',     roll: 0.07, brake: 0.20, xw: 6 },
  icy:  { label: '결빙',   roll: 0.01, brake: 0.07, xw: 5 },
};
export const P = { CLg: 0.6, CLb: 0.1, dCDsp: 0.03, vr: 1.10, lof: 1.17, v2: 1.20, vclimb: 1.25, react: 2.0, safety: 1.15, rev: 0.35, dCDoei: 0.005, flare: 2.0, failProb: 0.03, decideTime: 5, xwDrag: 0.03, xwRoll: 0.6, xwBrake: 0.35, lapse: 0.002, tf: 0.95, dt: 0.02 };
export const G = 9.81, KT = 1.943844;
export const TAILWIND_LIMIT_KT = 15;   // 대부분 여객기의 이륙 배풍 한계

// ===== 물리 모델 =====
export function density(altFt, oatC) {
  const h = altFt * 0.3048;
  const p = 101325 * Math.pow(1 - 2.25577e-5 * h, 5.25588);
  return p / (287.05 * (oatC + 273.15));
}

export function compute(inp, { ignoreCrosswind = false } = {}) {
  const ac = AIRCRAFT.find(a => a.id === inp.ac);
  const ap = AIRPORTS.find(a => a.code === inp.ap);
  const rw = RUNWAY[inp.rwy];
  const dt = P.dt;
  const m = inp.mass * 1000, W = m * G;
  const rho = density(ap.alt, inp.oat);
  const dir = inp.wdir * Math.PI / 180;
  const Vw = inp.wind * Math.cos(dir);
  const xw = Math.abs(inp.wind * Math.sin(dir));
  const T0 = ac.thrust * ac.n * P.tf * Math.pow(rho / 1.225, 0.75);
  // nOn: 작동 중인 엔진 수
  const thrust = (Va, nOn) => T0 * (nOn / ac.n) * Math.max(0.4, 1 - P.lapse * Va);
  const k = 1 / (Math.PI * ac.e * ac.ar);
  // 측풍 불이익: 한계 대비 비율 r (0~1)
  //  - 러더·에일러론을 바람 쪽으로 쓰고 기체가 옆으로 미끄러지며 항력 증가
  //  - 타이어가 옆으로 버티느라 구름 저항 증가, 제동에 쓸 마찰이 줄어듦
  const xr = ignoreCrosswind ? 0 : Math.min(1, xw / rw.xw);
  const dCDxw = P.xwDrag * xr * xr;
  const rollMu = rw.roll * (1 + P.xwRoll * xr);
  const brakeMu = rw.brake * (1 - P.xwBrake * xr * xr);
  const CDg = ac.cd0 + k * P.CLg ** 2 + dCDxw;
  const CDb = ac.cd0 + P.dCDsp + k * P.CLb ** 2 + dCDxw;
  const qS = Va => 0.5 * rho * ac.S * Va * Math.abs(Va); // 부호 있는 동압×면적
  const Vs = Math.sqrt(2 * W / (rho * ac.S * ac.clmax));
  const Vr = Vs * P.vr, Vlof = Vs * P.lof, V2 = Vs * P.v2;

  // 지상 가속: 시작점 p0에서 엔진 nOn개로 부양 속도까지
  function rollFrom(p0, nOn) {
    let { t, V, x } = p0;
    const pts = [{ t, V, x }];
    let result = 'liftoff';
    const cd = CDg + (nOn < ac.n ? P.dCDoei : 0);
    for (;;) {
      const Va = V + Vw;
      const L = 0.5 * rho * ac.S * P.CLg * Va * Va;
      const N = Math.max(W - L, 0);
      const a = (thrust(Va, nOn) - qS(Va) * cd - rollMu * N) / m;
      if (a <= 0.005) { result = 'nothrust'; break; }
      V += a * dt; x += V * dt; t += dt;
      pts.push({ t, V, x });
      if (V + Vw >= Vlof) break;
      if (x > ap.tora + 400 || t > 300) { result = 'overrun'; break; }
    }
    return { pts, result };
  }

  // 이륙 중단: 반응시간 동안 속도 유지 → 브레이크 + 스포일러 + 역추진
  function stopFrom(p0, nOn = ac.n) {
    let V = p0.V, x = p0.x, t = p0.t;
    const pts = [{ t, V, x }];
    const nR = Math.round(P.react / dt);
    for (let i = 0; i < nR; i++) { x += V * dt; t += dt; pts.push({ t, V, x }); }
    while (V > 0) {
      const Va = V + Vw;
      const L = 0.5 * rho * ac.S * P.CLb * Va * Va;
      const N = Math.max(W - L, 0);
      const dec = ((rollMu + brakeMu) * N + T0 * P.rev * (nOn / ac.n) + qS(Va) * CDb) / m;
      V = Math.max(0, V - dec * dt); x += V * dt; t += dt;
      pts.push({ t, V, x });
    }
    return pts;
  }

  // 부양 후 V2에서의 상승각(rad): sinγ = (추력 − 항력) / 무게
  // 상승 성능은 V2보다 조금 빠른 상승 속도(1.25 Vs)에서 계산 (실제로도 V2를 올려 상승 기울기를 확보)
  function climbAngle(nOn, gearDown) {
    const Vc = Vs * P.vclimb;
    const CL = 2 * W / (rho * ac.S * Vc * Vc);
    const cd = ac.cd0 + (gearDown ? 0.015 : 0) + k * CL * CL + (nOn < ac.n ? P.dCDoei : 0);
    const D = 0.5 * rho * ac.S * Vc * Vc * cd;
    return Math.asin(Math.max(-0.3, Math.min(0.3, (thrust(Vc, nOn) - D) / W)));
  }
  const SCREEN = 35 * 0.3048; // 35 ft
  const airTo35 = g => g > 0 ? Vlof * P.flare + SCREEN / Math.tan(g) : Infinity;

  const main = rollFrom({ t: 0, V: 0, x: 0 }, ac.n);
  const path = main.pts, result = main.result;
  const asd = i => { const s = stopFrom(path[i]); return s[s.length - 1].x; };

  const last = path.length - 1;
  const xLof = path[last].x;
  // V1은 VR을 넘을 수 없음 (V1 ≤ VR < VLOF)
  let v1Idx = null, v1AtVr = false, vrIdx = null;
  if (result === 'liftoff') {
    vrIdx = path.findIndex(p => p.V + Vw >= Vr);
    if (asd(vrIdx) <= ap.tora) { v1Idx = vrIdx; v1AtVr = true; }
    else {
      let lo = 0, hi = vrIdx;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (asd(mid) <= ap.tora) lo = mid; else hi = mid; }
      v1Idx = lo;
    }
  }
  const V1 = v1Idx != null ? path[v1Idx].V + Vw : null;
  const gammaAEO = climbAngle(ac.n, true);
  const tod = xLof + airTo35(gammaAEO);           // 엔진 정상, 35 ft 통과 거리
  const gradOEI = Math.tan(climbAngle(ac.n - 1, false)) * 100; // 엔진 1개 고장, 기어 올림 상승 기울기(%)
  const gradMin = ac.n === 2 ? 2.4 : 3.0;

  // 실제 규정의 이륙 필드 길이(TOFL): 아래 셋 중 가장 긴 값이 활주로 안에 들어와야 함
  //  1) 엔진 정상 35 ft 통과 거리 × 1.15
  //  2) V1에서 엔진 1개 고장 → 계속 이륙해서 35 ft 통과
  //  3) V1에서 엔진 1개 고장 → 이륙 중단해서 정지
  let tofl = null;
  if (result === 'liftoff') {
    const v1p = path[v1Idx];
    const cont = rollFrom(v1p, ac.n - 1);
    const gOei = climbAngle(ac.n - 1, true);
    const oei = cont.result === 'liftoff' && gOei > 0
      ? cont.pts[cont.pts.length - 1].x + Vlof * P.flare + SCREEN / Math.tan(gOei) : Infinity;
    const asd = stopFrom(v1p).slice(-1)[0].x;
    const parts = [
      { key: 'aeo', name: '엔진 정상 35 ft × 1.15', x: tod * P.safety },
      { key: 'oei', name: '엔진 고장 후 계속 이륙', x: oei },
      { key: 'asd', name: '엔진 고장 후 이륙 중단', x: asd },
    ];
    const gov = parts.reduce((m, q) => (q.x > m.x ? q : m));
    tofl = { x: gov.x, gov, parts };
  }

  // 판정
  let status, text;
  const tw = Math.max(0, -Vw);                                // 배풍 성분 m/s
  const twBlocked = tw * KT > TAILWIND_LIMIT_KT;
  const xwBlocked = xw > rw.xw || twBlocked;                    // 바람 때문에 이륙 금지
  const over = inp.mass * 1000 > ac.mtow;
  if (twBlocked) { status = 'no'; text = `배풍 ${fmt(tw * KT)} kt가 한계 ${TAILWIND_LIMIT_KT} kt를 넘습니다. 이륙 금지.`; }
  else if (xwBlocked) { status = 'no'; text = `측풍 ${xw.toFixed(1)} m/s가 ${rw.label} 활주로 한계 ${rw.xw} m/s를 넘습니다. 이륙 금지.`; }
  else if (result === 'nothrust') { status = 'no'; text = '순추력이 부족해 부양 속도까지 가속하지 못합니다. 중량을 줄이거나 다른 공항을 고르세요.'; }
  else if (result === 'overrun' || xLof > ap.tora) { status = 'no'; text = '부양 속도에 도달하기 전에 활주로가 끝납니다. 이륙 불가.'; }
  else if (over) { status = 'reg'; text = `최대 이륙 중량(${(ac.mtow / 1000).toFixed(1)} t)을 ${((inp.mass * 1000 - ac.mtow) / 1000).toFixed(1)} t 초과했습니다. 물리적으로는 뜨지만 규정상 이륙할 수 없는 중량입니다.`; }
  else if (!Number.isFinite(tofl.x)) { status = 'reg'; text = '규정상 이륙 불가: V1에서 엔진 1개가 고장 나면 남은 엔진으로 35 ft까지 올라가지 못합니다. 엔진이 모두 정상이면 뜨지만, 이 중량으로는 허가가 나지 않아요.'; }
  else if (tofl.x > ap.tora) { status = 'reg'; text = `규정상 이륙 불가: "${tofl.gov.name}"에 ${fmt(tofl.x)} m가 필요한데 활주로는 ${fmt(ap.tora)} m입니다. 엔진이 모두 정상이면 뜨지만 허가가 나지 않아요.`; }
  else if (gradOEI < gradMin) { status = 'reg'; text = `규정상 이륙 불가: 엔진 1개 고장 시 상승 기울기 ${gradOEI.toFixed(1)}%로 최소 ${gradMin}%보다 낮습니다.`; }
  else if (tofl.x > ap.tora * 0.95) { status = 'warn'; text = `규정 이륙 거리 ${fmt(tofl.x)} m로 활주로 여유가 ${fmt(ap.tora - tofl.x)} m뿐입니다. 정한 기준은 "${tofl.gov.name}".`; }
  else { status = 'go'; text = `규정 이륙 거리 ${fmt(tofl.x)} m, 활주로가 ${fmt(ap.tora - tofl.x)} m 남습니다. 가장 긴 경우는 "${tofl.gov.name}".`; }

  // 측풍이 없었을 때와 비교 (화면 표시용)
  let xwEffect = null;
  if (xr > 0.05 && !ignoreCrosswind) {
    const base = compute(inp, { ignoreCrosswind: true });
    xwEffect = {
      ratio: xr,
      lofPlus: result === 'liftoff' && base.result === 'liftoff' ? xLof - base.xLof : null,
      brakeLoss: P.xwBrake * xr * xr,
      v1Minus: V1 != null && base.V1 != null ? base.V1 - V1 : null,
    };
  }

  return { ac, ap, rw, inp, rho, xwEffect, tofl, Vw, xw, Vs, Vr, Vlof, V2, V1, path, result, xLof, tod, gammaAEO, gradOEI, gradMin,
    v1Idx, v1AtVr, vrIdx, rollFrom, stopFrom, climbAngle, status, text, xwBlocked, twBlocked };
}


// ===== 비행 결과 판정 · 경험치 (서버가 최종 판정, 브라우저는 같은 코드로 미리보기) =====

// 엔진 고장 지점: 대기 속도 targetVa(m/s)에 처음 도달하는 인덱스
export function failIdxFor(R, targetVa) {
  const i = R.path.findIndex(p => p.V + R.Vw >= targetVa);
  return i > 0 ? i : null;
}

// 엔진 고장 속도 뽑기: 40 kt ~ 부양 2 kt 전 사이 (rand: 0~1)
export function pickFailVa(R, rand) {
  const lo = 40 / KT;
  const hi = (R.result === 'liftoff' ? R.Vlof : R.path[R.path.length - 1].V + R.Vw) - 2 / KT;
  return hi > lo ? lo + rand * (hi - lo) : null;
}

// 서버로 들어온 입력값 검사. 이상하면 null
export function validateInputs(inp) {
  const ac = AIRCRAFT.find(a => a.id === inp?.ac);
  const ap = AIRPORTS.find(a => a.code === inp?.ap);
  if (!ac || !ap || !Object.hasOwn(RUNWAY, inp.rwy)) return null;
  const num = (v, lo, hi) => (Number.isFinite(+v) && +v >= lo && +v <= hi ? +v : NaN);
  const out = {
    ac: ac.id, ap: ap.code, rwy: inp.rwy,
    mass: num(inp.mass, Math.round(ac.mtow * 0.5 / 1000), Math.round(ac.mtow * 1.05 / 1000)),
    oat: num(inp.oat, -30, 45), wind: num(inp.wind, 0, 25), wdir: num(inp.wdir, 0, 355),
  };
  return Object.values(out).some(v => Number.isNaN(v)) ? null : out;
}

// 비행 결과. failVa: 엔진 고장 대기속도(m/s), decision: 'go' | 'stop', abortIdx: 고장 없이 수동 중단한 지점
export function evaluateFlight(R, { failVa = null, decision = null, abortIdx = null } = {}) {
  const tora = R.ap.tora, n = R.ac.n;
  const failIdx = failVa != null ? failIdxFor(R, failVa) : null;
  if (failIdx != null) {
    const beforeV1 = R.V1 != null && failVa < R.V1;
    const dec = decision === 'stop' ? 'stop' : 'go';      // 시간 초과는 계속 이륙
    const correct = R.V1 != null && (beforeV1 ? dec === 'stop' : dec === 'go');
    if (dec === 'stop') {
      const s = R.stopFrom(R.path[failIdx], n - 1), end = s[s.length - 1];
      return { kind: 'fail-stop', safe: end.x <= tora, correct, endX: end.x, simTime: end.t };
    }
    const c = R.rollFrom(R.path[failIdx], n - 1), last = c.pts[c.pts.length - 1];
    const climbs = R.climbAngle(n - 1, false) > 0;
    return { kind: 'fail-go', safe: c.result === 'liftoff' && last.x <= tora && climbs, correct, endX: last.x, simTime: last.t + 5 };
  }
  if (Number.isInteger(abortIdx) && abortIdx >= 0 && abortIdx < R.path.length) {
    const s = R.stopFrom(R.path[abortIdx]), end = s[s.length - 1];
    return { kind: 'abort', safe: end.x <= tora, correct: false, endX: end.x, simTime: end.t };
  }
  const last = R.path[R.path.length - 1];
  return { kind: 'normal', safe: R.result === 'liftoff' && R.xLof <= tora, correct: true, endX: last.x, simTime: last.t + 5 };
}

// ===== 업적 =====
// 비행이 끝나면 "진행 표시(mark)"를 남기고, 쌓인 진행도로 업적을 판정

export const WIND_BANDS = [0, 5, 10, 15, 20, 25];          // m/s 구간
export const windBand = w => (w >= 25 ? 25 : Math.floor(w / 5) * 5);
export const TEMP_BANDS = [-30, -15, 0, 15, 30, 45];      // °C 구간
export const tempBand = t => (t >= 45 ? 45 : Math.floor((t + 30) / 15) * 15 - 30);
export const CLOSE_CALL_M = 100;                            // 아슬아슬: 남는 활주로 기준

const legalMass = R => R.inp.mass * 1000 <= R.ac.mtow;
const tookOff = ev => ev.kind === 'normal' || ev.kind === 'fail-go';
export const liftoffX = (R, ev) => (ev.kind === 'normal' ? R.xLof : ev.endX);

// 이번 비행이 남기는 진행 표시
export function flightMarks(R, ev) {
  const marks = [], ap = R.ap.code;
  const success = tookOff(ev) && ev.safe && legalMass(R);
  if (success) {
    marks.push(`wind:${ap}:${windBand(R.inp.wind)}`);
    marks.push(`rwy:${ap}:${R.inp.rwy}`);
    marks.push(`temp:${ap}:${tempBand(R.inp.oat)}`);
    const rem = R.ap.tora - liftoffX(R, ev);
    if (rem >= 0 && rem <= CLOSE_CALL_M) marks.push(`close:${ap}`);
  }
  if (tookOff(ev) && !ev.safe) marks.push(`fail:${ap}`);
  if ((ev.kind === 'fail-go' || ev.kind === 'fail-stop') && ev.safe && ev.correct) marks.push('oei_ok');
  return marks;
}

// 진행도: progress = { key: 횟수 }
const countPrefix = (pr, prefix) => Object.keys(pr).filter(k => k.startsWith(prefix) && pr[k] > 0).length;
// 윈드 마스터: 6개 풍속 구간을 모두 채운 공항 수
export const windDoneAirports = pr => AIRPORTS.filter(a => WIND_BANDS.every(b => pr[`wind:${a.code}:${b}`] > 0)).length;
// 전천후: 4가지 활주로 상태에서 모두 이륙 성공한 공항 수
// 기온 마스터: 6개 기온 구간을 모두 채운 공항 수
export const tempDoneAirports = pr => AIRPORTS.filter(a => TEMP_BANDS.every(b => pr[`temp:${a.code}:${b}`] > 0)).length;
export const rwyDoneAirports = pr => AIRPORTS.filter(a => Object.keys(RUNWAY).every(k => pr[`rwy:${a.code}:${k}`] > 0)).length;

const ROMAN = ['I', 'II', 'III', 'IV'];
const AIRPORT_TIERS = [1, 4, 7, 11];
// 같은 종류의 업적을 4단계로 만들기
const series = (id, name, goals, current, unit, desc) => goals.map((g, i) => ({
  key: `${id}_${g}`, series: id, seriesName: name, tier: i + 1,
  name: `${name} ${ROMAN[i]}`, goal: g, current, unit, desc: desc(g),
}));

export const ACHIEVEMENTS = [
  ...series('wind', '윈드 마스터', AIRPORT_TIERS, windDoneAirports, '곳',
    g => `${g === 11 ? '모든 공항' : `공항 ${g}곳`}에서 풍속 ${WIND_BANDS.join('·')} m/s 구간마다 이륙 성공`),
  ...series('temp', '기온 마스터', AIRPORT_TIERS, tempDoneAirports, '곳',
    g => `${g === 11 ? '모든 공항' : `공항 ${g}곳`}에서 기온 ${TEMP_BANDS.map(t => String(t).replace('-', '−')).join('·')} °C 구간마다 이륙 성공`),
  ...series('rwy', '전천후', AIRPORT_TIERS, rwyDoneAirports, '곳',
    g => `${g === 11 ? '모든 공항' : `공항 ${g}곳`}에서 건조·젖음·눈·결빙 활주로 모두 이륙 성공`),
  ...series('oei', '변수 제거', [1, 10, 50, 100], pr => pr.oei_ok || 0, '회',
    g => `엔진 고장에 정석대로 대처해서 무사히 끝내기 ${g}회`),
  ...series('close', '아슬아슬', AIRPORT_TIERS, pr => countPrefix(pr, 'close:'), '곳',
    g => `${g === 11 ? '모든 공항' : `공항 ${g}곳`}에서 활주로를 ${CLOSE_CALL_M} m 이내로 남기고 이륙 성공`),
  ...series('fail', '실패는 성공의 어머니', AIRPORT_TIERS, pr => countPrefix(pr, 'fail:'), '곳',
    g => `${g === 11 ? '모든 공항' : `공항 ${g}곳`}에서 이륙 실패 겪어 보기`),
];
export const ACHIEVEMENT_SERIES = [...new Set(ACHIEVEMENTS.map(a => a.series))];
export const achieved = pr => ACHIEVEMENTS.filter(a => a.current(pr) >= a.goal).map(a => a.key);
