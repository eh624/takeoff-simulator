import { AIRCRAFT, AIRPORTS, RUNWAY, P, KT, compute, fmt, failIdxFor, pickFailVa, levelFor, xpForLevel, rankName, DAILY_XP_CAP } from './sim.js';

const $ = id => document.getElementById(id);
AIRCRAFT.forEach(a => $('ac').add(new Option(a.name, a.id)));
AIRPORTS.forEach(a => $('ap').add(new Option(`${a.code} · ${a.name}`, a.code)));
Object.entries(RUNWAY).forEach(([k, r], i) => {
  $('rwy').insertAdjacentHTML('beforeend',
    `<input type="radio" name="rwy" id="rwy-${k}" value="${k}"${i === 0 ? ' checked' : ''}><label for="rwy-${k}">${r.label}</label>`);
});

function setAircraftRange(keepValue) {
  const ac = AIRCRAFT.find(a => a.id === $('ac').value);
  const s = $('mass');
  s.min = Math.round(ac.mtow * 0.5 / 1000);
  s.max = Math.round(ac.mtow * 1.05 / 1000);
  if (!keepValue) s.value = Math.round(ac.mtow * 0.9 / 1000);
  $('acSpec').textContent = `MTOW ${fmt(ac.mtow / 1000, 1)} t · ${ac.eng} ×${ac.n} · 날개 ${fmt(ac.S, 1)} m²`;
}
$('ac').value = 'a350';
setAircraftRange(false);
$('mass').value = 250;

function readInputs() {
  return {
    ac: $('ac').value, ap: $('ap').value,
    mass: +$('mass').value, oat: +$('oat').value,
    wind: +$('wind').value, wdir: +$('wdir').value,
    rwy: document.querySelector('input[name=rwy]:checked').value,
  };
}

function drawDial(dirDeg, xwBad) {
  const r = (dirDeg - 90) * Math.PI / 180;
  // 바람이 불어오는 쪽(0° = 기수 정면)에 화살표 꼬리
  const cx = 42, cy = 42, R = 34;
  const tx = cx + Math.cos(r) * R, ty = cy + Math.sin(r) * R;
  const hx = cx + Math.cos(r) * 12, hy = cy + Math.sin(r) * 12;
  const ang = Math.atan2(hy - ty, hx - tx);
  const a1 = ang + 2.6, a2 = ang - 2.6;
  $('dial').innerHTML = `
    <circle cx="42" cy="42" r="38" fill="none" stroke="var(--line)" stroke-width="1.5"/>
    <rect x="37" y="14" width="10" height="56" rx="1" fill="var(--runway)"/>
    <line x1="42" y1="18" x2="42" y2="66" stroke="var(--plane)" stroke-width="1" stroke-dasharray="4 4"/>
    <path d="M42 8 l-4 6 h8z" fill="var(--muted)"/>
    <line x1="${tx}" y1="${ty}" x2="${hx}" y2="${hy}" stroke="${xwBad ? 'var(--stop)' : 'var(--trace)'}" stroke-width="3" stroke-linecap="round"/>
    <path d="M${hx} ${hy} L${hx + Math.cos(a1) * 8} ${hy + Math.sin(a1) * 8} L${hx + Math.cos(a2) * 8} ${hy + Math.sin(a2) * 8}Z" fill="${xwBad ? 'var(--stop)' : 'var(--trace)'}"/>`;
}

// ===== 캔버스 =====
let colors = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  ['bg','panel','ink','muted','line','sky','ground','runway','plane','trace','sign','sign-ink','stop','go','warn'].forEach(k => colors[k] = cs.getPropertyValue('--' + k).trim());
}
function fitCanvas(c) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

let R = null;            // 현재 계산 결과
let anim = {};
const CLIMB_T = 7;

function xRange() {
  const far = Math.max(R.ap.tora, R.xLof + (R.result === 'liftoff' ? R.Vlof * CLIMB_T : 0)) * 1.06;
  return Math.max(far, R.ap.tora + 450);
}
const PAD_L = 28, PAD_R = 22;
const tickStep = sx => [250, 500, 1000, 2000].find(s => s * sx >= 62) || 2000;

function stateAt() {
  const dt = P.dt, track = anim.track, last = track.length - 1;
  const tag = anim.failed ? ' · 엔진 1개' : '';
  if (anim.mode === 'abort' || (anim.mode === 'done' && anim.abort)) {
    const ab = anim.abort; const i = Math.min(ab.length - 1, Math.max(0, Math.floor((anim.t - ab[0].t) / dt)));
    const p = ab[i]; return { ...p, alt: 0, pitch: 0, phase: i < Math.round(P.react / dt) ? '중단 판단' : (p.V > 0 ? '제동 중' : '정지') };
  }
  if (anim.mode === 'idle') return { ...track[0], alt: 0, pitch: 0, phase: '대기' };
  const i = Math.min(last, Math.floor(anim.t / dt));
  if (anim.t <= track[last].t || anim.result !== 'liftoff') {
    const p = track[i];
    const Va = p.V + R.Vw;
    const pitch = Math.min(1, Math.max(0, (Va - R.Vr) / (R.Vlof - R.Vr))) * 8;
    let phase = '가속';
    if (R.V1 != null && Va >= R.V1) phase = 'V1 통과';
    if (Va >= R.Vr) phase = '회전';
    if (anim.mode === 'decide') phase = '엔진 고장!';
    else if (anim.result !== 'liftoff' && i === last) phase = anim.result === 'nothrust' ? '가속 불가' : '활주로 이탈';
    return { ...p, alt: 0, pitch, phase: phase + tag };
  }
  // 부양 후: 상승각을 유지하며 화면 밖으로 날아갈 때까지 상승
  const p = track[last]; const tc = anim.t - p.t;
  const acc = anim.failed ? 0.2 : 0.6;
  const dx = p.V * tc + 0.5 * acc * tc * tc;
  const tf = R.Vlof * P.flare;                     // 부양 직후 전환 구간
  const alt = Math.max(0, dx - tf) * Math.tan(anim.gamma) + Math.min(dx, tf) * Math.tan(anim.gamma) * 0.5;
  const pitch = anim.failed ? Math.min(9, 6 + tc) : Math.min(12, 8 + tc * 1.5);
  return { t: p.t + tc, V: p.V + acc * tc, x: p.x + dx, alt, pitch, phase: `상승 · ${fmt(alt / 0.3048)} ft${tag}` };
}

function drawScene(st) {
  const { ctx, w, h } = fitCanvas($('scene'));
  const gy = h - 44, maxX = xRange();
  const sx = (w - PAD_L - PAD_R) / maxX, X = x => PAD_L + x * sx;
  const sky = ctx.createLinearGradient(0, 0, 0, gy);
  sky.addColorStop(0, colors.sky); sky.addColorStop(1, colors.panel);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, gy);
  ctx.fillStyle = colors.ground; ctx.fillRect(0, gy, w, h - gy);
  // 활주로
  const tora = R.ap.tora;
  ctx.fillStyle = colors.runway; ctx.fillRect(X(0), gy - 2, tora * sx, 8);
  ctx.strokeStyle = colors.plane; ctx.lineWidth = 1; ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.moveTo(X(0) + 14, gy + 2); ctx.lineTo(X(tora) - 8, gy + 2); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = colors.plane; for (let i = 0; i < 4; i++) ctx.fillRect(X(0) + 3 + i * 2.5, gy - 1, 1.2, 6);
  ctx.fillStyle = colors.stop; ctx.fillRect(X(tora) - 3, gy - 4, 4, 12);
  // 거리 눈금
  ctx.fillStyle = colors.muted; ctx.font = '500 10px ' + getComputedStyle(document.body).getPropertyValue('--mono');
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const step = tickStep(sx);
  for (let d = 0; d <= maxX; d += step) {
    ctx.fillRect(X(d) - 0.5, gy + 8, 1, 5);
    ctx.fillText(d === 0 ? '0' : fmt(d) + 'm', X(d), gy + 16);
  }
  // 표지판
  const signs = [];
  if (R.v1Idx != null) {
    const v1kt = Math.round((R.path[R.v1Idx].V + R.Vw) * KT), vrkt = Math.round(R.Vr * KT);
    if (R.v1AtVr) signs.push({ x: R.path[R.vrIdx].x, text: `V1 = VR ${vrkt}`, bg: colors.sign, fg: colors['sign-ink'] });
    else {
      signs.push({ x: R.path[R.v1Idx].x, text: `V1 ${v1kt}`, bg: colors.sign, fg: colors['sign-ink'] });
      signs.push({ x: R.path[R.vrIdx].x, text: `VR ${vrkt}`, bg: colors.sign, fg: colors['sign-ink'] });
    }
  }
  const lofX = anim.track !== R.path && anim.result === 'liftoff' ? anim.track[anim.track.length - 1].x : R.xLof;
  if (anim.result === 'liftoff') signs.push({ x: lofX, text: `부양 ${fmt(lofX)}m`, bg: colors.ink, fg: colors.panel });
  signs.push({ x: tora, text: `END ${fmt(tora)}m`, bg: colors.stop, fg: '#FFFFFF' });
  if (anim.failed) signs.push({ x: R.path[anim.failIdx].x, text: `엔진 고장 ${Math.round(anim.failVa * KT)}`, bg: colors.warn, fg: '#FFFFFF' });
  if (anim.abort && (anim.mode === 'done' || anim.mode === 'abort')) {
    const s = anim.abort[anim.abort.length - 1];
    if (anim.mode === 'done') signs.push({ x: s.x, text: `정지 ${fmt(s.x)}m`, bg: s.x > tora ? colors.stop : colors.go, fg: '#FFFFFF', low: true });
  }
  ctx.font = '700 12px "Barlow Condensed", "Arial Narrow", sans-serif'; ctx.textBaseline = 'middle';
  let prevRight = -1e9, row = 0;
  signs.sort((a, b) => a.x - b.x).forEach(s => {
    const tw = ctx.measureText(s.text).width + 10;
    let left = X(s.x) - tw / 2; left = Math.max(2, Math.min(w - tw - 2, left));
    row = left < prevRight + 4 ? row + 1 : 0; prevRight = left + tw;
    const top = 12 + row * 22;
    ctx.strokeStyle = colors.muted; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(s.x), top + 16); ctx.lineTo(X(s.x), gy - 2); ctx.stroke();
    ctx.fillStyle = s.bg; ctx.fillRect(left, top, tw, 17);
    ctx.fillStyle = s.fg; ctx.textAlign = 'center'; ctx.fillText(s.text, left + tw / 2, top + 9);
  });
  // 비행기
  const len = Math.min(110, 34 + Math.sqrt(R.ac.S) * 2.2);
  const altPx = st.alt * sx * 3;
  const px = X(st.x), py = gy - 2 - altPx;
  anim.offscreen = px - len * 0.6 > w || py + len * 0.3 < 0;
  drawPlane(ctx, px, py, len, st.pitch * Math.PI / 180, st.alt < 3, anim.failed);
}

function drawPlane(ctx, nx, gy, len, pitch, gear, engOut) {
  // 기준점: 주 바퀴 접지점, 기수는 오른쪽
  const c = colors;
  ctx.save(); ctx.translate(nx, gy); ctx.rotate(-pitch);
  const s = len / 100;
  ctx.scale(s, s);
  const bodyY = -14;
  if (gear) {
    ctx.strokeStyle = c.ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-6, bodyY + 4); ctx.lineTo(-6, -3); ctx.moveTo(34, bodyY + 4); ctx.lineTo(34, -3); ctx.stroke();
    ctx.fillStyle = c.ink; [[-6, -2.5], [34, -2.5]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill(); });
  }
  // 수직 꼬리날개
  ctx.fillStyle = c.trace;
  ctx.beginPath(); ctx.moveTo(-50, bodyY - 4); ctx.lineTo(-62, bodyY - 26); ctx.lineTo(-54, bodyY - 26); ctx.lineTo(-36, bodyY - 5); ctx.closePath(); ctx.fill();
  // 동체
  ctx.fillStyle = c.plane; ctx.strokeStyle = c.ink; ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-58, bodyY - 5);
  ctx.lineTo(36, bodyY - 6);
  ctx.quadraticCurveTo(50, bodyY - 6, 52, bodyY + 1);
  ctx.quadraticCurveTo(50, bodyY + 6, 38, bodyY + 6);
  ctx.lineTo(-40, bodyY + 6);
  ctx.quadraticCurveTo(-52, bodyY + 4, -58, bodyY - 5);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // 창문 띠, 조종석
  ctx.fillStyle = c.trace; ctx.fillRect(-36, bodyY - 2.5, 66, 1.6);
  ctx.fillStyle = c.ink; ctx.beginPath(); ctx.moveTo(42, bodyY - 4); ctx.lineTo(48, bodyY - 2); ctx.lineTo(42, bodyY - 1.5); ctx.closePath(); ctx.fill();
  // 날개 + 엔진
  ctx.fillStyle = c.muted; ctx.beginPath(); ctx.moveTo(18, bodyY + 3); ctx.lineTo(-12, bodyY + 5); ctx.lineTo(-18, bodyY + 3); ctx.lineTo(6, bodyY + 1); ctx.closePath(); ctx.fill();
  ctx.fillStyle = engOut ? c.stop : c.ink; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(8, bodyY + 5, 16, 6, 3) : ctx.rect(8, bodyY + 5, 16, 6); ctx.fill();
  // 수평 꼬리날개
  ctx.fillStyle = c.muted; ctx.beginPath(); ctx.moveTo(-44, bodyY - 1); ctx.lineTo(-60, bodyY); ctx.lineTo(-56, bodyY - 3); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawChart(st) {
  const { ctx, w, h } = fitCanvas($('chart'));
  ctx.clearRect(0, 0, w, h);
  const top = 14, bot = h - 26, maxX = xRange();
  const sx = (w - PAD_L - PAD_R) / maxX, X = x => PAD_L + x * sx;
  const vmax = Math.ceil((R.Vlof * KT + 20) / 20) * 20;
  const Y = v => bot - (v / vmax) * (bot - top);
  const mono = getComputedStyle(document.body).getPropertyValue('--mono');
  ctx.font = '500 10px ' + mono; ctx.lineWidth = 1;
  // 격자
  ctx.strokeStyle = colors.line; ctx.fillStyle = colors.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  for (let v = 0; v <= vmax; v += 40) {
    ctx.beginPath(); ctx.moveTo(PAD_L, Y(v) + .5); ctx.lineTo(w - PAD_R, Y(v) + .5); ctx.stroke();
    if (v > 0) ctx.fillText(v + ' kt', 2, Y(v) - 2);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const step = tickStep(sx);
  for (let d = 0; d <= maxX; d += step) ctx.fillText(d === 0 ? '0' : fmt(d) + 'm', X(d), bot + 6);
  // 활주로 끝
  ctx.strokeStyle = colors.stop; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(X(R.ap.tora) + .5, top); ctx.lineTo(X(R.ap.tora) + .5, bot); ctx.stroke();
  // V1 / 부양 속도 기준선
  ctx.strokeStyle = colors.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillStyle = colors.muted;
  const vl = R.Vlof * KT; ctx.beginPath(); ctx.moveTo(PAD_L, Y(vl)); ctx.lineTo(w - PAD_R, Y(vl)); ctx.stroke();
  ctx.fillText('부양 ' + Math.round(vl) + ' kt', w - PAD_R, Y(vl) - 2);
  const vr = R.Vr * KT; ctx.beginPath(); ctx.moveTo(PAD_L, Y(vr)); ctx.lineTo(w - PAD_R, Y(vr)); ctx.stroke();
  ctx.textBaseline = 'top'; ctx.fillText('VR ' + Math.round(vr) + ' kt', w - PAD_R, Y(vr) + 2);
  ctx.setLineDash([]);
  // 가속 곡선 (대기 속도)
  const path = R.path, show = st ? st.t : 0, tr = anim.track;
  const curve = (pts, upto, color, width) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    let started = false;
    for (const p of pts) { if (p.t > upto) break; const px = X(p.x), py = Y(Math.max(0, (p.V + R.Vw)) * KT); started ? ctx.lineTo(px, py) : (ctx.moveTo(px, py), started = true); }
    ctx.stroke();
  };
  ctx.globalAlpha = 0.25; curve(path, Infinity, colors.trace, 2); ctx.globalAlpha = 1;
  const accelUpto = anim.abort ? anim.abort[0].t : (anim.mode === 'idle' ? 0 : show);
  if (anim.failed && tr !== R.path) { curve(tr.slice(0, anim.failIdx + 1), accelUpto, colors.trace, 2.5); curve(tr.slice(anim.failIdx), accelUpto, colors.warn, 2.5); }
  else curve(tr, accelUpto, colors.trace, 2.5);
  if (anim.abort) curve(anim.abort, show, colors.stop, 2.5);
  // V1 점
  if (R.v1Idx != null) {
    const p = path[R.v1Idx];
    ctx.fillStyle = colors.sign; ctx.strokeStyle = colors['sign-ink']; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(X(p.x), Y((p.V + R.Vw) * KT), 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = colors.ink; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.font = '700 12px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.fillText('V1', X(p.x) - 9, Y((p.V + R.Vw) * KT));
  }
}

function updateReadout(st) {
  $('rT').textContent = st.t.toFixed(1) + ' s';
  $('rV').textContent = Math.round(st.V * KT) + ' kt';
  $('rA').textContent = Math.round(Math.max(0, st.V + R.Vw) * KT) + ' kt';
  $('rX').textContent = fmt(st.x) + ' m';
  $('rP').textContent = st.phase;
}

function render() {
  const st = stateAt();
  drawScene(st); drawChart(st); updateReadout(st);
}

// ===== 결과 표시 =====
function showResults() {
  const pill = $('pill');
  pill.className = 'pill ' + R.status;
  pill.textContent = { go: '이륙 가능', warn: '주의', no: '이륙 불가' }[R.status];
  $('verdictText').textContent = R.text;
  const kt = v => Math.round(v * KT) + ' kt';
  const lof = R.path[R.path.length - 1];
  const rows = [];
  if (R.result === 'liftoff') {
    rows.push(['부양까지 활주 거리', `${fmt(R.xLof)} m <small>/ 활주로 ${fmt(R.ap.tora)} m</small>`]);
    rows.push(['35 ft 통과 거리', `${fmt(R.tod)} m <small>마진 15% 포함 ${fmt(R.tod * P.safety)} m</small>`]);
    rows.push(['부양 속도 (대기)', `${kt(R.Vlof)} <small>${lof.t.toFixed(1)} s</small>`]);
    const p1 = R.path[R.v1Idx];
    rows.push(['이륙결정속도 V1', `${kt(p1.V + R.Vw)} <small>${R.v1AtVr ? 'VR까지 정지 가능' : '활주로 길이로 제한'} · ${fmt(p1.x)} m</small>`]);
    rows.push(['회전 속도 VR', `${kt(R.Vr)} <small>${fmt(R.path[R.vrIdx].x)} m</small>`]);
    rows.push(['안전 이륙 속도 V2', `${kt(R.V2)} <small>고도 35 ft 통과 목표</small>`]);
    rows.push(['엔진 1개 고장 시 상승 기울기', `${R.gradOEI.toFixed(1)} % <small>최소 ${R.gradMin}%</small>`]);
  } else {
    const p = R.path[R.path.length - 1];
    rows.push(['도달 속도 (대기)', `${kt(p.V + R.Vw)} <small>부양 속도 ${kt(R.Vlof)}</small>`]);
  }
  rows.push(['실속 속도', kt(R.Vs)]);
  rows.push(['공기 밀도', `${R.rho.toFixed(3)} kg/m³`]);
  rows.push(['정풍 / 측풍', `${R.Vw >= 0 ? '+' : ''}${R.Vw.toFixed(1)} / ${R.xw.toFixed(1)} m/s`]);
  $('facts').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('go').disabled = R.xwBlocked;
  $('v1test').disabled = R.xwBlocked || R.v1Idx == null;
}

function syncLabels() {
  const inp = readInputs();
  const ac = AIRCRAFT.find(a => a.id === inp.ac), ap = AIRPORTS.find(a => a.code === inp.ap);
  $('massOut').textContent = `${inp.mass} t`;
  $('oatOut').textContent = `${inp.oat} °C`;
  $('windOut').textContent = `${inp.wind} m/s (${Math.round(inp.wind * KT)} kt)`;
  const d = inp.wdir;
  const rel = d === 0 ? '정풍' : d === 180 ? '배풍' : (d < 90 || d > 270) ? '정풍 성분' : d === 90 || d === 270 ? '측풍' : '배풍 성분';
  $('wdirOut').textContent = `${d}° · ${rel}`;
  $('apSpec').textContent = `활주로 ${fmt(ap.tora)} m · 표고 ${fmt(ap.alt)} ft`;
  const mw = $('massWarn');
  if (inp.mass * 1000 > ac.mtow) { mw.hidden = false; mw.textContent = `최대 이륙 중량보다 ${fmt(inp.mass - ac.mtow / 1000, 1)} t 무겁습니다.`; }
  else mw.hidden = true;
}

function recompute() {
  syncLabels();
  R = compute(readInputs());
  drawDial(+$('wdir').value, R.xwBlocked);
  stopAnim();
  showResults();
  $('msg').textContent = '';
  render();
}

// ===== 애니메이션 =====
let raf = 0;
function stopAnim() {
  cancelAnimationFrame(raf);
  anim = { mode: 'idle', t: 0, last: 0, abort: null, autoAbortIdx: null,
    track: R.path, result: R.result, gamma: R.gammaAEO,
    failIdx: null, failed: false, decision: null, failVa: null };
  $('abort').disabled = true;
  $('decide').hidden = true;
}
async function start(autoAbortIdx) {
  stopAnim();
  const myR = R;
  const practice = autoAbortIdx != null || $('failForce').checked;
  let failVa = null, note = '';
  if (session && !practice) {
    // 로그인 상태: 서버가 엔진 고장 여부를 정하고 비행을 기록
    $('go').disabled = true;
    try {
      const res = await api('/api/flight/start', { inputs: R.inp });
      if (R !== myR) return;               // 기다리는 사이 조건이 바뀜
      anim.flightId = res.flightId; failVa = res.failVa;
    } catch (e) {
      if (R !== myR) return;
      note = `${e.message} 이번 비행은 경험치 없이 진행합니다.`;
      failVa = Math.random() < P.failProb ? pickFailVa(R, Math.random()) : null;
    } finally { $('go').disabled = R.xwBlocked; }
  } else if (autoAbortIdx == null) {
    // 엔진 고장: 매 이륙 3% 확률(연습 모드는 항상)
    failVa = ($('failForce').checked || Math.random() < P.failProb) ? pickFailVa(R, Math.random()) : null;
    if (session) note = '연습 비행이라 경험치가 없습니다.';
  }
  anim.failIdx = failVa != null ? failIdxFor(R, failVa) : null;
  anim.mode = 'rolling'; anim.autoAbortIdx = autoAbortIdx;
  $('abort').disabled = false; $('msg').textContent = note;
  $('xpResult').hidden = true;
  anim.last = performance.now();
  raf = requestAnimationFrame(tick);
}
function engineFail() {
  const p = anim.track[anim.failIdx];
  anim.failed = true; anim.mode = 'decide'; anim.t = p.t; anim.decideLeft = P.decideTime;
  anim.failVa = p.V + R.Vw;
  const kt = Math.round(anim.failVa * KT);
  $('dInfo').textContent = `대기 속도 ${kt} kt` + (R.V1 != null ? ` · V1 ${Math.round(R.V1 * KT)} kt` : '');
  $('dCount').textContent = P.decideTime;
  $('decide').hidden = false;
  $('dGo').focus({ preventScroll: true });
}
function choose(dec) {
  if (anim.mode !== 'decide') return;
  $('decide').hidden = true;
  anim.decision = dec;
  if (dec === 'stop') { doAbort(anim.failIdx); return; }
  const cont = R.rollFrom(R.path[anim.failIdx], R.ac.n - 1);
  anim.track = R.path.slice(0, anim.failIdx).concat(cont.pts);
  anim.result = cont.result;
  anim.gamma = R.climbAngle(R.ac.n - 1, false);
  anim.mode = 'rolling';
  $('abort').disabled = true;            // 계속 이륙을 고른 뒤에는 중단하지 않음
  $('msg').textContent = `남은 엔진 ${R.ac.n - 1}개로 이륙을 계속합니다.`;
}
// 판단 평가: V1 전에는 중단, V1 이후에는 계속 이륙이 원칙
function judgement() {
  if (!anim.failed || R.V1 == null) return '';
  const beforeV1 = anim.failVa < R.V1;
  if (anim.decision === 'stop') return beforeV1 ? ' 판단: V1 전 이륙 중단, 정석입니다.' : ' 판단: V1 이후 중단, 활주로가 모자랄 수 있는 위험한 선택입니다.';
  return beforeV1 ? ' 판단: V1 전인데 계속 이륙했습니다. 원칙은 중단입니다.' : ' 판단: V1 이후 계속 이륙, 정석입니다.';
}
function doAbort(idx) {
  const p = anim.track[idx];
  anim.abort = R.stopFrom(p, anim.failed ? R.ac.n - 1 : R.ac.n); anim.t = p.t; anim.mode = 'abort';
  $('abort').disabled = true;
  const late = R.v1Idx != null && p.V + R.Vw > R.V1;
  $('msg').textContent = `${Math.round((p.V + R.Vw) * KT)} kt에서 이륙 중단${late ? ' (V1 초과)' : ''}. 2초 반응 후 브레이크·스포일러·역추진을 사용합니다.`;
}
function tick(now) {
  const dtReal = Math.max(0, Math.min(0.05, (now - anim.last) / 1000)); // rAF 시각이 start()보다 앞설 수 있음
  anim.last = now;
  if (anim.mode === 'decide') {
    anim.decideLeft -= dtReal;
    $('dCount').textContent = Math.max(0, Math.ceil(anim.decideLeft));
    if (anim.decideLeft <= 0) choose('go');   // 시간 안에 결정하지 않으면 계속 이륙
  } else anim.t += dtReal * +$('spd').value;
  const track = anim.track, last = track.length - 1;
  if (anim.mode === 'rolling') {
    const i = Math.min(last, Math.floor(anim.t / P.dt));
    if (anim.failIdx != null && !anim.failed && i >= anim.failIdx) engineFail();
    else if (anim.autoAbortIdx != null && i >= anim.autoAbortIdx) doAbort(anim.autoAbortIdx);
    else if (anim.t >= track[last].t) {
      $('abort').disabled = true;
      if (anim.result === 'liftoff') {
        anim.mode = 'climb';
        const x = track[last].x;
        if (anim.gamma <= 0) $('msg').textContent = `${fmt(x)} m에서 부양했지만 남은 추력으로는 상승하지 못합니다.` + judgement();
        else $('msg').textContent = `${fmt(x)} m 지점에서 부양했습니다.${x > R.ap.tora ? ' 활주로를 벗어난 뒤였습니다.' : ''}` + judgement();
      } else {
        anim.t = track[last].t; anim.mode = 'done';
        $('msg').textContent = (anim.result === 'nothrust' ? '추력이 저항을 이기지 못해 더 이상 가속하지 못합니다.' : '부양 속도에 닿기 전에 활주로를 벗어났습니다.') + judgement();
      }
    }
  }
  if (anim.mode === 'climb' && anim.gamma <= 0 && anim.t > track[last].t + 4) anim.mode = 'done';
  if (anim.mode === 'abort') {
    const ab = anim.abort, end = ab[ab.length - 1];
    if (anim.t >= end.t) {
      anim.t = end.t; anim.mode = 'done';
      const over = end.x - R.ap.tora;
      $('msg').textContent = (over > 0
        ? `정지 위치 ${fmt(end.x)} m. 활주로 끝을 ${fmt(over)} m 지나쳤습니다.`
        : `정지 위치 ${fmt(end.x)} m. 활주로가 ${fmt(-over)} m 남았습니다.`) + judgement();
    }
  }
  render();
  if (anim.mode === 'climb' && anim.offscreen) anim.mode = 'done';
  if (anim.mode === 'done' && !anim.reported) report();
  if (anim.mode !== 'done') raf = requestAnimationFrame(tick);
}

$('go').addEventListener('click', () => start(null));
$('v1test').addEventListener('click', () => start(R.v1Idx));
$('abort').addEventListener('click', () => {
  if (anim.mode === 'decide') return choose('stop');
  if (anim.mode !== 'rolling') return;
  const idx = Math.min(anim.track.length - 1, Math.floor(anim.t / P.dt));
  if (!anim.failed) anim.abortIdx = idx;
  doAbort(idx);
});
$('dGo').addEventListener('click', () => choose('go'));
$('dStop').addEventListener('click', () => choose('stop'));
$('ac').addEventListener('change', () => { setAircraftRange(false); recompute(); });
['ap', 'mass', 'oat', 'wind', 'wdir'].forEach(id => $(id).addEventListener('input', recompute));
$('rwy').addEventListener('change', recompute);
$('form').addEventListener('submit', e => e.preventDefault());

// 테마·크기 변화 대응
readColors();
const onTheme = () => { readColors(); drawDial(+$('wdir').value, R && R.xwBlocked); render(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
new ResizeObserver(() => R && render()).observe($('scene'));
if (document.fonts) document.fonts.ready.then(() => R && render());

recompute();

// ===== 로그인 · 경험치 (Supabase) =====
let sb = null, session = null, cfg = null, profile = null;

async function api(path, body) {
  const s = (await sb.auth.getSession()).data.session;
  if (!s) throw new Error('로그인이 필요합니다.');
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${s.access_token}` },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || '서버에 연결하지 못했습니다.');
  return data;
}

// 비행이 끝나면 서버에 결과를 보내 경험치를 받음
async function report() {
  anim.reported = true;
  if (!anim.flightId) return;
  const box = $('xpResult');
  const body = { flightId: anim.flightId, decision: anim.failed ? (anim.decision || 'go') : null, abortIdx: anim.abortIdx ?? null };
  const before = profile?.level ?? 1;
  try {
    const r = await api('/api/flight/finish', body);
    const items = r.items.map(([k, v]) => `<li><span>${esc(k)}</span><b>${v > 0 ? '+' + v : v}</b></li>`).join('');
    const up = r.level > before ? `<p class="levelup">레벨 ${r.level} · ${esc(r.rank)}(으)로 올랐습니다!</p>` : '';
    const cap = r.capped ? `<p class="muted">오늘 받을 수 있는 경험치(${DAILY_XP_CAP} XP)를 다 받아서 일부만 지급했습니다.</p>` : '';
    box.innerHTML = `<div class="xphead"><b class="gain">+${r.earned} XP</b><span>누적 ${fmt(r.total)} XP · Lv.${r.level}</span></div><ul>${items}</ul>${up}${cap}`;
    box.hidden = false;
    await loadProfile();
    loadBoard();
  } catch (e) {
    box.innerHTML = `<p class="muted">경험치를 기록하지 못했습니다: ${esc(e.message)}</p>`;
    box.hidden = false;
  }
}

const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function loadProfile() {
  if (!session) { profile = null; return renderAccount(); }
  const { data } = await sb.from('profiles').select('nickname, xp, level, flights').eq('id', session.user.id).maybeSingle();
  profile = data;
  renderAccount();
}

function renderAccount() {
  const inEl = $('authIn'), outEl = $('authOut');
  inEl.hidden = !session; outEl.hidden = !!session;
  if (session && $('loginBox').open) $('loginBox').close();
  $('guestHint').hidden = !!session;
  if (!session) return;
  const xp = profile?.xp ?? 0, L = levelFor(xp);
  const lo = xpForLevel(L), hi = xpForLevel(L + 1);
  $('meName').textContent = profile?.nickname ?? '조종사';
  $('meRank').textContent = `Lv.${L} ${rankName(L)}`;
  $('meBar').style.width = `${Math.round(((xp - lo) / (hi - lo)) * 100)}%`;
  $('meXp').textContent = `${fmt(xp)} / ${fmt(hi)} XP · 비행 ${fmt(profile?.flights ?? 0)}회`;
}

async function loadBoard() {
  const { data, error } = await sb.from('profiles').select('nickname, xp, level').order('xp', { ascending: false }).limit(10);
  if (error) return;
  $('board').innerHTML = data.length
    ? data.map((p, i) => `<li><span class="pos">${i + 1}</span><span class="nm">${esc(p.nickname)}</span><span class="rk">Lv.${p.level} ${rankName(p.level)}</span><b>${fmt(p.xp)} XP</b></li>`).join('')
    : '<li class="muted">아직 기록이 없습니다. 첫 이륙의 주인공이 되어 보세요.</li>';
  $('boardCard').hidden = false;
}

function loginError(msg) { const e = $('loginErr'); e.textContent = msg; e.hidden = false; $('loginInfo').hidden = true; openLogin(); }
function openLogin() { const d = $('loginBox'); if (!d.open) d.showModal(); }

async function initAuth() {
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    cfg = await r.json();
    if (!cfg.supabaseUrl || !cfg.anonKey || !window.supabase) throw new Error();
  } catch { return; }   // 서버 없이 열면 로그인 없이 시뮬레이터만 동작
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.anonKey);
  $('account').hidden = false;
  ['kakao', 'google', 'naver', 'apple'].forEach(p => { $('login-' + p).hidden = !cfg.providers?.[p]; });
  const anySocial = ['kakao', 'google', 'naver', 'apple'].some(p => cfg.providers?.[p]);
  $('social').hidden = $('loginOr').hidden = !anySocial;

  const q = new URLSearchParams(location.search);
  if (q.get('token_hash')) {        // 네이버 로그인에서 돌아옴
    const { error } = await sb.auth.verifyOtp({ token_hash: q.get('token_hash'), type: q.get('type') || 'magiclink' });
    if (error) loginError('로그인을 마치지 못했습니다. 다시 시도하세요.');
  }
  if (q.get('login_error')) loginError(q.get('login_error'));
  if (q.has('token_hash') || q.has('login_error')) history.replaceState(null, '', location.pathname);

  session = (await sb.auth.getSession()).data.session;
  sb.auth.onAuthStateChange((_e, s) => {
    const changed = (s?.user?.id) !== (session?.user?.id);
    session = s;
    if (changed) { loadProfile(); if (s) $('pwPass').value = ''; }
  });
  await loadProfile();
  loadBoard();
}

// 이메일 + 비밀번호
function loginInfo(msg) { const e = $('loginInfo'); e.textContent = msg; e.hidden = !msg; if (msg) $('loginErr').hidden = true; }
function pwValues() {
  const email = $('pwEmail').value.trim(), password = $('pwPass').value;
  if (!/^\S+@\S+\.\S+$/.test(email)) { loginError('이메일 주소를 확인해 주세요.'); return null; }
  if (password.length < 6) { loginError('비밀번호는 6자 이상이어야 합니다.'); return null; }
  return { email, password };
}
const authMsg = e => /invalid login/i.test(e.message) ? '이메일 또는 비밀번호가 맞지 않습니다.'
  : /not confirmed/i.test(e.message) ? '이메일 인증을 아직 마치지 않았습니다. 메일함을 확인하세요.'
  : /already registered|already been registered/i.test(e.message) ? '이미 가입된 이메일입니다. 아래 로그인을 눌러 주세요.'
  : /rate limit/i.test(e.message) ? '잠시 후 다시 시도해 주세요.'
  : e.message;
// 로그인 / 가입 전환
let pwMode = 'login';
function setPwMode(mode) {
  pwMode = mode;
  const signup = mode === 'signup';
  $('loginTitle').textContent = signup ? '조종사 등록' : '조종사 로그인';
  $('pwSubmit').textContent = signup ? '가입하기' : '로그인';
  $('pwSwitchText').textContent = signup ? '이미 계정이 있나요?' : '처음이신가요?';
  $('pwSwitch').textContent = signup ? '로그인' : '이메일로 가입하기';
  $('pwPass').autocomplete = signup ? 'new-password' : 'current-password';
  $('loginErr').hidden = true; $('loginInfo').hidden = true;
}
$('pwSwitch').addEventListener('click', () => setPwMode(pwMode === 'login' ? 'signup' : 'login'));
$('pwForm').addEventListener('submit', async e => {
  e.preventDefault();
  const v = pwValues(); if (!v) return;
  loginInfo(''); $('loginErr').hidden = true;
  const btn = $('pwSubmit'); btn.disabled = true;
  try {
    if (pwMode === 'login') {
      const { error } = await sb.auth.signInWithPassword(v);
      if (error) loginError(authMsg(error));
    } else {
      const { data, error } = await sb.auth.signUp({ ...v, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) loginError(authMsg(error));
      else if (!data.session) loginInfo('가입했습니다. 메일함의 인증 링크를 누른 뒤 로그인하세요.');
    }
  } finally { btn.disabled = false; }
});

const oauth = provider => sb.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin + location.pathname } });
$('loginBtn').addEventListener('click', () => { setPwMode('login'); openLogin(); });
$('loginClose').addEventListener('click', () => $('loginBox').close());
$('loginBox').addEventListener('click', e => { if (e.target === $('loginBox')) $('loginBox').close(); });   // 바깥 클릭 시 닫기
$('login-kakao').addEventListener('click', () => oauth('kakao'));
$('login-google').addEventListener('click', () => oauth('google'));
$('login-apple').addEventListener('click', () => oauth('apple'));
$('login-naver').addEventListener('click', () => { location.href = '/auth/naver/login'; });
$('logoutBtn').addEventListener('click', async () => { await sb.auth.signOut(); session = null; profile = null; renderAccount(); });
$('nickBtn').addEventListener('click', () => {
  $('nickForm').hidden = !$('nickForm').hidden;
  $('nick').value = profile?.nickname ?? '';
  if (!$('nickForm').hidden) $('nick').focus();
});
$('nickForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('nick').value.trim();
  if (!name || name.length > 20) { $('nickErr').textContent = '이름은 1~20자로 정해주세요.'; return; }
  const { error } = await sb.from('profiles').update({ nickname: name }).eq('id', session.user.id);
  if (error) { $('nickErr').textContent = '저장하지 못했습니다. 다시 시도하세요.'; return; }
  $('nickErr').textContent = ''; $('nickForm').hidden = true;
  await loadProfile(); loadBoard();
});

initAuth();
