import { engineLabel, bodyLabel, AIRCRAFT, AIRPORTS, RUNWAY, P, KT, compute, fmt, failIdxFor, pickFailVa, evaluateFlight, flightMarks, ACHIEVEMENTS, ACHIEVEMENT_SERIES, WIND_BANDS, windBand, TEMP_BANDS, tempBand, CLOSE_CALL_M } from './sim.js';

const $ = id => document.getElementById(id);
let progress = {};          // 업적 진행 기록 (key → 횟수)
let myAch = new Set();      // 달성한 업적
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// 기종 선택: 엔진 수·동체로 묶어서 보여 줌
[['쌍발 광동체', a => a.n === 2 && a.body === 'wide'], ['4발 광동체', a => a.n === 4], ['쌍발 협동체', a => a.n === 2 && a.body === 'narrow']].forEach(([label, f]) => {
  const g = document.createElement('optgroup'); g.label = label;
  AIRCRAFT.filter(f).forEach(a => g.append(new Option(`${a.name} · ${engineLabel(a)}`, a.id)));
  $('ac').append(g);
});
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
  const tw = (ac.thrust * ac.n) / (ac.mtow * 9.81);
  const left = Math.round((ac.n - 1) / ac.n * 100);
  $('acSpec').innerHTML = `<span class="tag">${engineLabel(ac)}</span><span class="tag">${bodyLabel(ac)}</span><span class="tag">${ac.role}</span><br>`
    + `MTOW ${fmt(ac.mtow / 1000, 1)} t · ${esc(ac.eng)} ×${ac.n} · 날개 ${fmt(ac.S, 1)} m²<br>`
    + `추력/무게 ${tw.toFixed(2)} (최대 중량) · 엔진 1개 고장 시 추력 ${left}%`;
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

// 이륙 방향과 바람: 왼쪽은 활주로와 바람 화살표, 오른쪽은 정풍·측풍 성분
function drawDial() {
  if (!R) return;
  const d = +$('wdir').value, spd = +$('wind').value;
  const bad = R.xwBlocked, windCol = bad ? 'var(--stop)' : 'var(--trace)';
  const cx = 92, cy = 84, Rr = 64;
  const rad = (d - 90) * Math.PI / 180;           // 0° = 위(기수 방향)
  const arrow = (x1, y1, x2, y2, col, w) => {
    const ang = Math.atan2(y2 - y1, x2 - x1), L = Math.hypot(x2 - x1, y2 - y1);
    if (L < 4) return '';
    const h = Math.min(9, L * 0.5);
    return `<line x1="${x1}" y1="${y1}" x2="${x2 - Math.cos(ang) * h * 0.6}" y2="${y2 - Math.sin(ang) * h * 0.6}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>
      <path d="M${x2} ${y2} L${x2 - Math.cos(ang - 0.45) * h} ${y2 - Math.sin(ang - 0.45) * h} L${x2 - Math.cos(ang + 0.45) * h} ${y2 - Math.sin(ang + 0.45) * h}Z" fill="${col}"/>`;
  };
  // 바람 화살표: 불어오는 쪽(원 둘레)에서 중심으로
  const tail = [cx + Math.cos(rad) * (Rr - 2), cy + Math.sin(rad) * (Rr - 2)];
  const head = [cx + Math.cos(rad) * 18, cy + Math.sin(rad) * 18];
  const ticks = [0, 90, 180, 270].map(t => {
    const a = (t - 90) * Math.PI / 180;
    return `<text x="${cx + Math.cos(a) * (Rr + 9)}" y="${cy + Math.sin(a) * (Rr + 9) + 3}" text-anchor="middle" font-size="8" fill="var(--muted)">${t}°</text>`;
  }).join('');
  // 성분 (kt)
  const head_kt = R.Vw * KT, cross_kt = R.xw * KT;
  const crossSide = Math.sin(d * Math.PI / 180) >= 0 ? '오른쪽' : '왼쪽';
  const hwLabel = Math.abs(head_kt) < 0.5 ? '정풍 0 kt' : head_kt > 0 ? `정풍 ${fmt(head_kt)} kt` : `배풍 ${fmt(-head_kt)} kt`;
  const hwCol = head_kt < -0.5 ? 'var(--warn)' : 'var(--go)';
  const xwRatio = Math.min(1, R.xw / R.rw.xw);
  // 오른쪽 성분 그림
  const bx = 220, by = 70, sc = 2.2;                  // 1 kt = 2.2 px (최대 25 kt 근처)
  const hLen = Math.max(-34, Math.min(34, head_kt * sc)), xLen = Math.max(-34, Math.min(34, cross_kt * sc * (crossSide === '오른쪽' ? 1 : -1)));
  $('dial').innerHTML = `
    <circle cx="${cx}" cy="${cy}" r="${Rr}" fill="var(--bg)" stroke="var(--line)" stroke-width="1.2"/>
    ${ticks}
    <rect x="${cx - 9}" y="${cy - 54}" width="18" height="108" rx="2" fill="var(--runway)"/>
    <line x1="${cx}" y1="${cy - 46}" x2="${cx}" y2="${cy + 48}" stroke="var(--plane)" stroke-width="1.2" stroke-dasharray="6 5"/>
    <g transform="translate(${cx} ${cy + 26})" fill="var(--plane)" stroke="var(--ink)" stroke-width="0.8">
      <path d="M0 -15 C2 -15 2.5 -11 2.5 -8 L2.5 -3 L13 3 L13 6 L2.5 3 L2 10 L6 13 L6 15 L0 13.5 L-6 15 L-6 13 L-2 10 L-2.5 3 L-13 6 L-13 3 L-2.5 -3 L-2.5 -8 C-2.5 -11 -2 -15 0 -15Z"/>
    </g>
    ${arrow(cx, cy - 2, cx, cy - 44, 'var(--sign)', 2.5)}
    <text x="${cx + 15}" y="${cy + 30}" font-size="9" class="lbl" font-weight="700" fill="var(--ink)">이륙 방향 ↑</text>
    ${spd > 0 ? arrow(tail[0], tail[1], head[0], head[1], windCol, 3.5) : ''}
    <text x="${bx}" y="14" text-anchor="middle" font-size="10" class="lbl" font-weight="700" fill="var(--ink)">바람 성분</text>
    <rect x="${bx - 38}" y="${by - 38}" width="76" height="76" rx="6" fill="none" stroke="var(--line)" stroke-dasharray="3 3"/>
    <line x1="${bx}" y1="${by - 36}" x2="${bx}" y2="${by + 36}" stroke="var(--line)"/>
    <line x1="${bx - 36}" y1="${by}" x2="${bx + 36}" y2="${by}" stroke="var(--line)"/>
    ${arrow(bx, by - hLen, bx, by, hwCol, 3)}
    ${arrow(bx + xLen, by, bx, by, xwRatio >= 1 ? 'var(--stop)' : 'var(--warn)', 3)}
    <circle cx="${bx}" cy="${by}" r="2.5" fill="var(--ink)"/>
    <text x="${bx}" y="${by + 54}" text-anchor="middle" font-size="10" fill="${hwCol}">${hwLabel}</text>
    <text x="${bx}" y="${by + 68}" text-anchor="middle" font-size="10" fill="${xwRatio >= 1 ? 'var(--stop)' : 'var(--ink)'}">측풍 ${fmt(cross_kt)} kt${cross_kt >= 0.5 ? ` (${crossSide})` : ''}</text>
    <text x="${bx}" y="${by + 82}" text-anchor="middle" font-size="9" fill="var(--muted)">측풍 한계의 ${Math.round(xwRatio * 100)}%</text>`;
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
  // 이전 비행 (비교 기준)
  if (baseR && baseR !== R && JSON.stringify(baseR.inp) !== JSON.stringify(R.inp)) {
    ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = colors.muted; ctx.lineWidth = 1.5; ctx.beginPath();
    let st0 = false;
    for (const q of baseR.path) { const px = X(q.x), py = Y(Math.max(0, q.V + baseR.Vw) * KT); st0 ? ctx.lineTo(px, py) : (ctx.moveTo(px, py), st0 = true); }
    ctx.stroke(); ctx.restore();
    const lq = baseR.path[baseR.path.length - 1];
    ctx.fillStyle = colors.muted; ctx.font = '500 10px ' + mono; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('이전 비행', Math.min(X(lq.x) + 6, w - PAD_R - 50), Y(Math.max(0, lq.V + baseR.Vw) * KT) + 6);
  }
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
// 이륙 전 미리보기: 이 조건으로 비행하면 어떤 업적이 진행되는지
function showXpPreview() {
  const box = $('xpPreview');
  const ap = R.ap.code, chips = [];
  const penalty = R.xwEffect && R.xwEffect.lofPlus != null
    ? `<span class="penalty">측풍 불이익: 활주 거리 +${fmt(R.xwEffect.lofPlus)} m, 이륙 중단 시 제동력 −${Math.round(R.xwEffect.brakeLoss * 100)}%</span>` : '';
  if (R.xwBlocked) {
    box.innerHTML = `<span class="total zero">이륙 금지</span><span class="lbl">${esc(R.text)}</span>`;
    return;
  }
  const ev = evaluateFlight(R);
  const marks = flightMarks(R, ev);
  const chip = (txt, isNew) => `<span class="chip${isNew ? ' new' : ''}">${isNew ? '★ ' : '✓ '}${esc(txt)}</span>`;
  const wkey = `wind:${ap}:${windBand(R.inp.wind)}`;
  if (marks.includes(wkey)) chips.push(chip(`윈드 마스터 · ${ap} ${windBand(R.inp.wind)} m/s 칸`, !progress[wkey]));
  const tokey = `type_to:${R.ac.id}`;
  if (marks.includes(tokey)) chips.push(chip(`형식 한정 · ${R.ac.short} 이륙`, !progress[tokey]));
  const tkey = `temp:${ap}:${tempBand(R.inp.oat)}`;
  if (marks.includes(tkey)) chips.push(chip(`기온 마스터 · ${ap} ${tempBand(R.inp.oat)} °C 칸`, !progress[tkey]));
  const rkey = `rwy:${ap}:${R.inp.rwy}`;
  if (marks.includes(rkey)) chips.push(chip(`전천후 · ${ap} ${R.rw.label}`, !progress[rkey]));
  if (marks.includes(`close:${ap}`)) chips.push(chip(`아슬아슬 · ${ap}`, !progress[`close:${ap}`]));
  if (marks.includes(`fail:${ap}`)) chips.push(chip(`실패는 성공의 어머니 · ${ap}`, !progress[`fail:${ap}`]));
  const rem = R.result === 'liftoff' ? R.ap.tora - R.xLof : null;
  const remLine = rem != null && rem >= 0
    ? `<span class="lbl">남는 활주로 <b class="${rem <= CLOSE_CALL_M ? 'hit' : ''}">${fmt(rem)} m</b> (아슬아슬은 ${CLOSE_CALL_M} m 이내)</span>` : '';
  const head = chips.some(c => c.includes(' new'))
    ? '<span class="total">새 진행!</span>' : '<span class="total zero">이번 조건</span>';
  const practice = $('failForce').checked
    ? `<span class="bonus">엔진 고장 연습: 정석대로 대처해서 무사히 끝내면 "변수 제거" +1${progress[`type_oei:${R.ac.id}`] ? '' : `, "형식 한정 · ${R.ac.short}" 엔진 고장 대처 완료`}</span>`
    : `<span class="bonus">엔진이 고장 나면 정석대로 대처할 때 "변수 제거" +1${progress[`type_oei:${R.ac.id}`] ? '' : `, "형식 한정 · ${R.ac.short}" 진행`}</span>`;
  box.innerHTML = head + (chips.join('') || '<span class="lbl">이 조건으로는 진행되는 업적이 없어요</span>') + remLine + penalty + practice;
}

// ===== 이전 비행과 비교: 조건을 바꾸면 무엇이 왜 달라지는지 =====
let baseR = null;   // 비교 기준 (마지막으로 이륙 버튼을 누른 조건)
const TIPS = [
  '기온을 바꾸어 보세요. 부양 속도와 활주 거리가 어떻게 바뀔까요?',
  '중량을 늘려 보세요. 부양 속도보다 활주 거리가 훨씬 많이 늘어나는 이유가 보입니다.',
  '같은 조건으로 공항을 바꿔 보세요. 공기가 희박하면 무엇이 달라질까요?',
  '풍향을 0°(정풍)에서 180°(배풍)로 돌려 보세요. 대기 속도는 같은데 지면 속도는 달라집니다.',
  '활주로 상태를 바꾸어 보세요. 이륙 거리와 이륙 중단 거리가 서로 반대로 움직입니다.',
  '기종을 바꿔 보세요. 무게와 추력의 비율이 이륙 거리를 정합니다.',
];
function renderCompare() {
  const box = $('compare');
  const same = baseR && JSON.stringify(baseR.inp) === JSON.stringify(R.inp);
  if (!baseR || same) {
    box.innerHTML = `<span class="ctitle">해볼 것</span><p>${TIPS[Math.floor(Date.now() / 60000) % TIPS.length]}</p>`;
    return;
  }
  const A = baseR, B = R, kt = v => Math.round(v * KT);
  // 바뀐 조건
  const ch = [];
  if (A.ac.id !== B.ac.id) ch.push(`기종 ${A.ac.name} → ${B.ac.name}`);
  if (A.ap.code !== B.ap.code) ch.push(`공항 ${A.ap.code} → ${B.ap.code}`);
  if (A.inp.mass !== B.inp.mass) ch.push(`중량 ${A.inp.mass} → ${B.inp.mass} t`);
  if (A.inp.oat !== B.inp.oat) ch.push(`기온 ${A.inp.oat} → ${B.inp.oat} °C`);
  if (A.inp.rwy !== B.inp.rwy) ch.push(`활주로 ${A.rw.label} → ${B.rw.label}`);
  if (Math.abs(A.Vw - B.Vw) > 0.05) ch.push(`정풍 성분 ${A.Vw.toFixed(1)} → ${B.Vw.toFixed(1)} m/s`);
  if (Math.abs(A.xw - B.xw) > 0.05) ch.push(`측풍 성분 ${A.xw.toFixed(1)} → ${B.xw.toFixed(1)} m/s`);
  // 결과 변화
  const both = A.result === 'liftoff' && B.result === 'liftoff';
  const delta = (a, b, unit, dec = 0) => {
    const d = b - a, sign = d > 0 ? '+' : d < 0 ? '−' : '±';
    const cls = Math.abs(d) < 0.5 ? 'same' : d > 0 ? 'up' : 'down';
    return `<b>${fmt(a, dec)} → ${fmt(b, dec)} ${unit}</b> <span class="${cls}">${sign}${fmt(Math.abs(d), dec)}${unit === 'm' && a > 0 ? ` (${sign}${Math.round(Math.abs(d) / a * 100)}%)` : ''}</span>`;
  };
  const out = [];
  if (both) {
    out.push(['부양 속도 (대기)', delta(kt(A.Vlof), kt(B.Vlof), 'kt')]);
    out.push(['부양 속도 (지면)', delta(kt(A.Vlof - A.Vw), kt(B.Vlof - B.Vw), 'kt')]);
    out.push(['부양까지 활주 거리', delta(Math.round(A.xLof), Math.round(B.xLof), 'm')]);
    if (A.V1 != null && B.V1 != null) out.push(['V1', delta(kt(A.V1), kt(B.V1), 'kt')]);
    if (A.tofl && B.tofl && Number.isFinite(A.tofl.x) && Number.isFinite(B.tofl.x)) out.push(['규정 이륙 거리', delta(Math.round(A.tofl.x), Math.round(B.tofl.x), 'm')]);
  } else {
    out.push(['결과', `${A.result === 'liftoff' ? '이륙' : '실패'} → ${B.result === 'liftoff' ? '이륙' : '실패'}`]);
  }
  // 왜?
  const why = [];
  const rhoPct = Math.round((B.rho / A.rho - 1) * 100);
  if ((A.inp.oat !== B.inp.oat || A.ap.alt !== B.ap.alt) && rhoPct !== 0)
    why.push(`공기 밀도가 ${rhoPct > 0 ? '+' : '−'}${Math.abs(rhoPct)}% 변했어요. 공기가 ${rhoPct < 0 ? '희박해지면' : '진해지면'} 같은 양력을 얻는 데 필요한 대기 속도가 ${rhoPct < 0 ? '빨라지고' : '느려지고'}(밀도의 제곱근에 반비례), 엔진 추력도 ${rhoPct < 0 ? '줄어요' : '늘어요'}.`);
  if (A.inp.mass !== B.inp.mass && A.ac.id === B.ac.id) {
    const m = B.inp.mass / A.inp.mass;
    why.push(`무게가 ${m > 1 ? '+' : '−'}${Math.round(Math.abs(m - 1) * 100)}%면 부양 속도는 무게의 제곱근만큼(약 ${m > 1 ? '+' : '−'}${Math.round(Math.abs(Math.sqrt(m) - 1) * 100)}%) 바뀌지만, 가속도 같이 ${m > 1 ? '느려져서' : '빨라져서'} 활주 거리는 무게의 거의 제곱으로(약 ${m > 1 ? '+' : '−'}${Math.round(Math.abs(m * m - 1) * 100)}%) 바뀝니다.`);
  }
  if (Math.abs(A.Vw - B.Vw) > 0.05)
    why.push(`정풍은 처음부터 날개에 바람을 불어 줍니다. 부양에 필요한 대기 속도는 그대로지만, 정풍이 ${B.Vw > A.Vw ? '세지면' : '약해지면'} 땅 위에서 달려야 할 속도가 ${B.Vw > A.Vw ? '줄어서' : '늘어서'} 활주 거리가 ${B.Vw > A.Vw ? '짧아져요' : '길어져요'}.`);
  if (Math.abs(A.xw - B.xw) > 0.05)
    why.push('측풍이 세면 방향을 잡느라 조종면과 타이어 저항이 늘어 활주 거리가 길어지고, 이륙 중단 때 제동력이 줄어요.');
  if (A.inp.rwy !== B.inp.rwy)
    why.push(`이륙 거리는 구름 저항(${A.rw.roll} → ${B.rw.roll}), 이륙 중단 거리와 V1은 제동 마찰(${A.rw.brake} → ${B.rw.brake})이 좌우합니다.`);
  if (A.ac.id !== B.ac.id) {
    const tw = X => (X.ac.thrust * X.ac.n) / (X.inp.mass * 1000 * 9.81);
    why.push(`추력 ÷ 무게가 ${tw(A).toFixed(2)} → ${tw(B).toFixed(2)}, 실속 속도가 ${kt(A.Vs)} → ${kt(B.Vs)} kt로 바뀌었어요. 추력 대비 무게가 가벼울수록, 날개가 넓을수록 짧게 뜹니다.`);
  }
  if (A.ap.code !== B.ap.code && A.ap.tora !== B.ap.tora)
    why.push(`활주로 길이가 ${fmt(A.ap.tora)} → ${fmt(B.ap.tora)} m로 바뀌면 이륙 거리는 그대로여도 V1과 규정 판정이 달라집니다.`);
  box.innerHTML = `<span class="ctitle">이전 비행과 비교</span>
    <p class="cchg">${ch.map(esc).join(' · ')}</p>
    <dl class="cout">${out.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${why.length ? `<ul class="cwhy">${why.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`;
}

function showResults() {
  const pill = $('pill');
  pill.className = 'pill ' + R.status;
  pill.textContent = R.xwBlocked ? '이륙 금지' : { go: '이륙 가능', warn: '여유 부족', reg: '규정 초과', no: '이륙 불가' }[R.status];
  $('verdictText').textContent = R.text;
  const kt = v => Math.round(v * KT) + ' kt';
  const lof = R.path[R.path.length - 1];
  const rows = [];
  if (R.result === 'liftoff') {
    rows.push(['부양까지 활주 거리', `${fmt(R.xLof)} m <small>/ 활주로 ${fmt(R.ap.tora)} m</small>`]);
    if (R.tofl) {
      const parts = R.tofl.parts.map(q => `${q.name} ${Number.isFinite(q.x) ? fmt(q.x) + ' m' : '상승 불가'}`).join(' · ');
      rows.push(['규정 이륙 거리', `${Number.isFinite(R.tofl.x) ? fmt(R.tofl.x) + ' m' : '상승 불가'} <small>${parts}</small>`]);
    }
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
  if (R.xwEffect) {
    const e = R.xwEffect, parts = [];
    if (e.lofPlus != null) parts.push(`활주 +${fmt(e.lofPlus)} m`);
    parts.push(`제동력 −${Math.round(e.brakeLoss * 100)}%`);
    if (e.v1Minus != null && e.v1Minus * KT >= 0.5) parts.push(`V1 −${Math.round(e.v1Minus * KT)} kt`);
    rows.push(['측풍 불이익', `${parts.join(' · ')} <small>한계의 ${Math.round(e.ratio * 100)}%</small>`]);
  }
  rows.push(['실속 속도', kt(R.Vs)]);
  rows.push(['공기 밀도', `${R.rho.toFixed(3)} kg/m³`]);
  rows.push(['정풍 / 측풍', `${R.Vw >= 0 ? '+' : ''}${R.Vw.toFixed(1)} / ${R.xw.toFixed(1)} m/s`]);
  $('facts').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('go').disabled = R.xwBlocked;
  $('v1test').disabled = R.xwBlocked || R.v1Idx == null;
  showXpPreview();
  renderCompare();
}

function syncLabels() {
  const inp = readInputs();
  const ac = AIRCRAFT.find(a => a.id === inp.ac), ap = AIRPORTS.find(a => a.code === inp.ap);
  // 숫자 칸은 직접 입력 중이 아닐 때만 슬라이더 값으로 맞춤
  for (const id of ['mass', 'oat', 'wind', 'wdir']) { const n = $(id + 'Num'); if (document.activeElement !== n) n.value = $(id).value; }
  $('windOut').textContent = `${Math.round(inp.wind * KT)} kt`;
  const d = inp.wdir;
  const rel = d === 0 ? '정풍' : d === 180 ? '배풍' : (d < 90 || d > 270) ? '정풍 성분' : d === 90 || d === 270 ? '측풍' : '배풍 성분';
  $('wdirOut').textContent = rel;
  $('apSpec').textContent = `활주로 ${fmt(ap.tora)} m · 표고 ${fmt(ap.alt)} ft`;
  const mw = $('massWarn');
  if (inp.mass * 1000 > ac.mtow) { mw.hidden = false; mw.textContent = `최대 이륙 중량보다 ${fmt(inp.mass - ac.mtow / 1000, 1)} t 무겁습니다.`; }
  else mw.hidden = true;
}

function recompute() {
  syncLabels();
  R = compute(readInputs());
  if (!baseR) baseR = R;
  drawDial();
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
  baseR = R;   // 이번 조건을 다음 비교의 기준으로
  const myR = R;
  const mode = autoAbortIdx != null ? 'v1test' : $('failForce').checked ? 'practice' : 'normal';
  const localFail = () => (mode === 'practice' || (mode === 'normal' && Math.random() < P.failProb)) ? pickFailVa(R, Math.random()) : null;
  let failVa = null, note = '';
  if (session) {
    // 로그인 상태: 서버가 엔진 고장 여부를 정하고 비행을 기록
    $('go').disabled = true;
    try {
      const res = await api('/api/flight/start', { inputs: R.inp, mode });
      if (R !== myR) return;               // 기다리는 사이 조건이 바뀜
      anim.flightId = res.flightId; failVa = res.failVa;
    } catch (e) {
      if (R !== myR) return;
      note = `${e.message} 이번 비행은 일지에 기록되지 않습니다.`;
      failVa = localFail();
    } finally { $('go').disabled = R.xwBlocked; }
  } else failVa = localFail();
  anim.failTarget = failVa;
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
  if (!anim.failed) anim.abortIdx = idx;
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
$('failForce').addEventListener('change', () => showXpPreview());
$('dStop').addEventListener('click', () => choose('stop'));
$('ac').addEventListener('change', () => { setAircraftRange(false); recompute(); });
['ap', 'mass', 'oat', 'wind', 'wdir'].forEach(id => $(id).addEventListener('input', recompute));
// 숫자 직접 입력: 범위 안으로 맞추고 슬라이더에 반영 (Enter 또는 칸을 벗어날 때)
['mass', 'oat', 'wind', 'wdir'].forEach(id => {
  const n = $(id + 'Num'), r = $(id);
  const apply = () => {
    let v = parseFloat(String(n.value).replace(',', '.'));
    if (!Number.isFinite(v)) { n.value = r.value; return; }
    if (id === 'wdir') v = ((Math.round(v) % 360) + 360) % 360;
    v = Math.min(+r.max, Math.max(+r.min, v));
    r.value = v; n.value = r.value;
    recompute();
  };
  n.addEventListener('change', apply);
  n.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); n.select(); } });
  n.addEventListener('focus', () => n.select());
});
$('rwy').addEventListener('change', recompute);
$('form').addEventListener('submit', e => e.preventDefault());

// 테마·크기 변화 대응
readColors();
const onTheme = () => { readColors(); drawDial(); render(); };
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
  const box = $('xpResult');
  const decision = anim.failed ? (anim.decision || 'go') : null;
  if (!anim.flightId) {
    if (sb && !session) {
      box.innerHTML = '<p class="muted">로그인하면 이번 비행이 업적 진행에 기록됩니다.</p>';
      box.hidden = false;
    }
    return;
  }
  try {
    const r = await api('/api/flight/finish', { flightId: anim.flightId, decision, abortIdx: anim.abortIdx ?? null });
    const before = { ...progress };
    const lines = [];
    if (r.tooFast) lines.push('<p class="muted">비행이 너무 빨리 끝나서 진행으로 치지 않았어요.</p>');
    for (const m of r.marks || []) {
      const [kind, ap, band] = m.split(':');
      const isNew = !before[m];
      const label = kind === 'wind' ? `윈드 마스터 · ${ap} ${band} m/s 칸`
        : kind === 'type_to' ? `형식 한정 · ${AIRCRAFT.find(a => a.id === ap)?.short ?? ap} 이륙`
        : kind === 'type_oei' ? `형식 한정 · ${AIRCRAFT.find(a => a.id === ap)?.short ?? ap} 엔진 고장 대처`
        : kind === 'temp' ? `기온 마스터 · ${ap} ${band} °C 칸`
        : kind === 'rwy' ? `전천후 · ${ap} ${RUNWAY[band]?.label ?? band} 활주로`
        : kind === 'close' ? `아슬아슬 · ${ap} (남은 활주로 ${fmt(r.remaining)} m)`
        : kind === 'fail' ? `실패는 성공의 어머니 · ${ap}`
        : `변수 제거 · ${(before.oei_ok || 0) + 1}회째`;
      lines.push(`<li><span>${isNew || kind === 'oei_ok' ? '★' : '✓'} ${esc(label)}</span><b>${isNew || kind === 'oei_ok' ? '진행' : '이미 채움'}</b></li>`);
    }
    const got = (r.newAchievements || []).map(a => `<p class="levelup">업적 달성! ${esc(a.name)} <small>${esc(a.desc)}</small></p>`).join('');
    const head = `<div class="xphead"><b class="gain${got ? '' : ' zero'}">${got ? '업적 달성!' : lines.length ? '업적 진행' : '진행 없음'}</b><span>업적 ${r.count} / ${r.totalCount}${r.remaining != null ? ` · 남은 활주로 ${fmt(r.remaining)} m` : ''}</span></div>`;
    box.innerHTML = head + got + (lines.length ? `<ul>${lines.filter(l => l.startsWith('<li')).join('')}</ul>` + lines.filter(l => !l.startsWith('<li')).join('') : '');
    box.hidden = false;
    await loadProfile();
    await loadAchievements();
    loadBoard();
  } catch (e) {
    box.innerHTML = `<p class="muted">기록하지 못했습니다: ${esc(e.message)}</p>`;
    box.hidden = false;
  }
}

async function loadProfile() {
  if (!session) { profile = null; return renderAccount(); }
  const { data } = await sb.from('profiles').select('nickname, nickname_set, xp, level, flights').eq('id', session.user.id).maybeSingle();
  profile = data;
  renderAccount();
  if (profile && !profile.nickname_set && !nickSkipped) openNick(true);   // 첫 로그인: 아이디 정하기
}

function renderAccount() {
  const inEl = $('authIn'), outEl = $('authOut');
  inEl.hidden = !session; outEl.hidden = !!session;
  if (session && $('loginBox').open) $('loginBox').close();
  $('guestHint').hidden = !!session;
  if (!session) return;
  const n = myAch.size, total = ACHIEVEMENTS.length;
  $('meName').textContent = profile?.nickname ?? '조종사';
  $('meRank').textContent = `업적 ${n} / ${total}`;
  $('meBar').style.width = `${Math.round((n / total) * 100)}%`;
  $('meXp').textContent = `비행 ${fmt(profile?.flights ?? 0)}회`;
}

// ===== 업적 =====
async function loadAchievements() {
  progress = {}; myAch = new Set();
  if (sb && session) {
    const [p, a] = await Promise.all([sb.from('progress').select('key, n'), sb.from('achievements').select('key')]);
    if (!p.error) for (const r of p.data || []) progress[r.key] = r.n;
    if (!a.error) myAch = new Set((a.data || []).map(r => r.key));
  }
  renderAchievements(); renderAccount(); showXpPreview();
}

function renderAchievements() {
  const total = ACHIEVEMENTS.length;
  $('achCount').textContent = `${myAch.size} / ${total}`;
  $('achBar').style.width = `${Math.round((myAch.size / total) * 100)}%`;
  $('achNote').hidden = !!session;
  const apChips = prefix => `<div class="apgrid">${AIRPORTS.map(a => `<span class="${progress[prefix + a.code] ? 'on' : ''}" title="${esc(a.name)}">${a.code}</span>`).join('')}</div>`;
  // 공항 × 칸 표 (윈드 마스터: 풍속 구간, 전천후: 활주로 상태)
  const grid = (prefix, cols, head, note) => `<div class="wgrid" role="table">
      <div class="wrow head" role="row" style="--n:${cols.length}"><span></span>${head.map(h => `<span>${esc(String(h))}</span>`).join('')}</div>
      ${AIRPORTS.map(a => {
        const has = c => progress[`${prefix}${a.code}:${c}`] > 0;
        const full = cols.every(has);
        return `<div class="wrow" role="row" style="--n:${cols.length}"><span class="ap${full ? ' full' : ''}">${a.code}</span>${cols.map(c => `<span class="${has(c) ? 'on' : ''}">${has(c) ? '✓' : ''}</span>`).join('')}</div>`;
      }).join('')}
      <p class="muted">${note}</p>
    </div>`;
  const tempGrid = grid('temp:', TEMP_BANDS, TEMP_BANDS.map(t => (t < 0 ? '−' + -t : t)), '한 공항의 6칸(기온 구간, °C: −30~−16, −15~−1, 0~14, 15~29, 30~44, 45)을 모두 채우면 1곳 완성');
  const rwyKeys = Object.keys(RUNWAY);
  const windGrid = grid('wind:', WIND_BANDS, WIND_BANDS, '한 공항의 6칸(풍속 구간, m/s)을 모두 채우면 1곳 완성');
  const rwyGrid = grid('rwy:', rwyKeys, rwyKeys.map(k => RUNWAY[k].label), '한 공항에서 4가지 활주로 상태를 모두 채우면 1곳 완성');
  const typeChips = `<div class="apgrid typegrid">${AIRCRAFT.map(a => {
      const t = progress[`type_to:${a.id}`] > 0, o = progress[`type_oei:${a.id}`] > 0;
      return `<span class="${t && o ? 'on' : t || o ? 'half' : ''}" title="${esc(a.name)} · 이륙 ${t ? '✓' : '—'} · 엔진 고장 대처 ${o ? '✓' : '—'}">${esc(a.short)} <small>${t ? '✈' : '·'}${o ? '⚙' : '·'}</small></span>`;
    }).join('')}</div><p class="muted">✈ 이륙 성공 · ⚙ 엔진 고장 정석 대처 · 둘 다 하면 자격 취득</p>`;
  const extraFor = { type: typeChips, wind: windGrid, temp: tempGrid, rwy: rwyGrid, close: apChips('close:'), fail: apChips('fail:') };
  $('achList').innerHTML = ACHIEVEMENT_SERIES.map(id => {
    const tiers = ACHIEVEMENTS.filter(a => a.series === id);
    const cur = tiers[0].current(progress);
    const next = tiers.find(t => !myAch.has(t.key));
    const pips = tiers.map(t => `<span class="pip${myAch.has(t.key) ? ' on' : ''}" title="${esc(t.name)}: ${esc(t.desc)}">${t.name.split(' ').pop()}</span>`).join('');
    const pct = next ? Math.min(100, Math.round((cur / next.goal) * 100)) : 100;
    return `<article class="ach${next ? '' : ' done'}">
      <div class="atop"><h3>${esc(tiers[0].seriesName)}</h3><span class="pips">${pips}</span></div>
      <p>${esc((next || tiers[tiers.length - 1]).desc)}</p>
      <div class="abar" aria-hidden="true"><i style="width:${pct}%"></i></div>
      ${extraFor[id] || ''}
    </article>`;
  }).join('');
}

async function loadBoard() {
  if (!sb) return;
  const { data, error } = await sb.from('profiles').select('nickname, achievements').order('achievements', { ascending: false }).order('achievements_at', { ascending: true, nullsFirst: false }).limit(20);
  if (error) return;
  $('board').innerHTML = data.length
    ? data.map((p, i) => `<li><span class="pos">${i + 1}</span><span class="nm">${esc(p.nickname)}</span><b>업적 ${p.achievements}</b></li>`).join('')
    : '<li class="muted">아직 기록이 없습니다.</li>';
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
    if (changed) { loadProfile().then(loadAchievements); if (s) $('pwPass').value = ''; }
  });
  await loadProfile();
  loadAchievements();
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
// ===== 조종사 아이디 =====
const NICK_RE = /^[가-힣A-Za-z0-9_]{2,12}$/;
let nickRequired = false, nickSkipped = false;
function openNick(required) {
  const d = $('nickDlg');
  nickRequired = required;
  $('nickTitle').textContent = required ? '조종사 아이디 정하기' : '아이디 바꾸기';
  $('nickCancel').textContent = required ? '나중에' : '취소';
  $('nick').value = profile?.nickname_set ? profile.nickname : '';
  $('nickErr').hidden = true;
  if (!d.open) d.showModal();
  $('nick').focus();
}
function nickError(msg) { $('nickErr').textContent = msg; $('nickErr').hidden = false; }
$('nickBtn').addEventListener('click', () => openNick(false));
$('nickCancel').addEventListener('click', () => { if (nickRequired) nickSkipped = true; $('nickDlg').close(); });
$('nickForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('nick').value.trim();
  if (!NICK_RE.test(name)) return nickError('한글·영문·숫자·밑줄(_)로 2~12자를 입력하세요.');
  $('nickSave').disabled = true;
  const { error } = await sb.from('profiles').update({ nickname: name }).eq('id', session.user.id);
  $('nickSave').disabled = false;
  if (error) {
    if (error.code === '23505') return nickError('이미 다른 조종사가 쓰는 아이디입니다.');
    if (error.code === '23514') return nickError('한글·영문·숫자·밑줄(_)로 2~12자를 입력하세요.');
    return nickError('저장하지 못했습니다. 다시 시도하세요.');
  }
  $('nickDlg').close();
  await loadProfile();
  loadBoard();
});

renderAchievements();
initAuth();
