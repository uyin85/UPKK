// UPKK Pro — PWA pelajar (vanilla JS, tanpa build)
const $app = document.getElementById('app');
const LETTERS = ['A', 'B', 'C', 'D'];
const state = { config: null, me: null, limits: null, progress: null };

// ---------- Utiliti ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
let memId = null;
function userId() {
  let id = store.get('upkk_uid') || memId;
  if (!id) { id = 'u' + crypto.randomUUID().replace(/-/g, '').slice(0, 20); store.set('upkk_uid', id); memId = id; }
  return id;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const AR = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]+(?:[\s،]+[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]+)*/g;
// Teks bercampur Melayu + Arab/Jawi: bahagian Arab dipapar dengan fon Naskh dan arah RTL
const rich = (s) => esc(s).replace(AR, (m) => `<span class="ar" dir="rtl" lang="ar">${m}</span>`);
const isMostlyArabic = (s) => (String(s).match(AR) || []).join('').length > String(s).replace(/\s/g, '').length * 0.6;

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', 'x-user-id': userId() },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'Tiada sambungan' }));
  if (!res.ok || data.ok === false) { const e = new Error(data.error || 'Ralat'); e.status = res.status; e.data = data; throw e; }
  return data;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.role = 'status'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function setTabs(tab) {
  document.body.classList.toggle('hide-tabs', !tab);
  document.querySelectorAll('.tabbar a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

const subjectOf = (code) => state.config?.subjects.find((s) => s.code === code);

function header() {
  const pro = state.me?.plan === 'pro';
  const streak = state.progress?.streak || 0;
  return `<header class="top">
    <div class="brand"><img src="/icon.svg" alt=""> UPKK Pro</div>
    <div class="row" style="flex:none;gap:8px">
      ${streak ? `<span class="pill streak" title="Hari berturut-turut berlatih"><b>★</b> ${streak} hari</span>` : ''}
      <span class="pill ${pro ? 'pro' : ''}">${pro ? 'Pro' : 'Percuma'}</span>
    </div>
  </header>`;
}

// ---------- Skrin: Utama ----------
async function home() {
  setTabs('home');
  const [cfg, me, prog] = await Promise.all([
    state.config ? state.config : api('/config'),
    api('/me'),
    api('/progress'),
  ]);
  state.config = cfg; state.me = me.user; state.limits = me.limits; state.progress = prog;
  const bySub = Object.fromEntries(prog.subjects.map((s) => [s.subject, s]));
  const scored = prog.subjects.filter((s) => s.attempts >= 20);
  const overall = scored.length ? Math.round(scored.reduce((a, s) => a + s.readiness, 0) / scored.length) : null;
  const name = state.me.name ? `Assalamualaikum, ${esc(state.me.name)}` : 'Assalamualaikum';
  const lim = state.limits;

  $app.innerHTML = `${header()}
    <h1>${name}</h1>
    <p class="muted" style="margin:0">Pilih subjek untuk mula berlatih hari ini.</p>
    <section class="ready" aria-label="Skor kesediaan">
      ${overall === null
        ? `<div class="big">Mula di sini</div><p>Jawab sekurang-kurangnya 20 soalan dalam satu subjek untuk melihat Skor Kesediaan UPKK anda.</p>`
        : `<div class="big">${overall}%</div><p>Skor Kesediaan purata merentas ${scored.length} subjek. Ini anggaran app, bukan gred rasmi UPKK.</p>`}
    </section>
    ${lim.plan === 'free' ? `<p class="small muted">Latihan percuma: ${lim.used_today}/${lim.limit} soalan hari ini. <button class="link" data-go="#/tetapan">Aktifkan Pro</button></p>` : ''}
    <h2>Subjek</h2>
    <div class="subjects">
      ${cfg.subjects.map((s) => {
        const p = bySub[s.code] || {};
        const empty = !s.questions;
        return `<button class="subject ${empty ? 'disabled' : ''}" data-sub="${s.code}" ${empty ? 'aria-disabled="true"' : ''}>
          <span class="jw" lang="ar">${esc(s.jawi || '')}</span>
          <span class="nm">${esc(s.name)}</span>
          <span class="meta">${empty ? 'Soalan sedang disemak ustaz' : p.attempts ? `Kesediaan ${p.readiness}%` : `${s.questions} soalan`}</span>
          <span class="meter" aria-hidden="true"><i style="width:${p.readiness || 0}%"></i></span>
        </button>`;
      }).join('')}
    </div>`;

  $app.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => {
    if (b.getAttribute('aria-disabled')) return toast('Subjek ini belum ada soalan yang diluluskan.');
    subjectSheet(b.dataset.sub);
  }));
  bindGo();
}

function subjectSheet(code) {
  const s = subjectOf(code);
  const pro = state.me?.plan === 'pro';
  $app.insertAdjacentHTML('beforeend', `
    <dialog id="sheet" style="border:0;border-radius:18px;padding:20px;max-width:420px;width:calc(100% - 32px);background:var(--surface);color:var(--ink)">
      <h2 style="margin-top:0">${esc(s.name)}</h2>
      ${s.nota ? `<p class="note">${esc(s.nota)}</p>` : ''}
      <div style="display:grid;gap:10px">
        <button class="btn primary block" data-go="#/latih/${code}">Latihan 10 soalan</button>
        <button class="btn ghost block" data-go="#/ujian/${code}">${pro ? `Mock exam (${state.config.mock.items} soalan, ${state.config.mock.duration_minutes} minit)` : 'Mock exam bermasa (Pro)'}</button>
        <button class="btn ghost block" data-go="#/kemajuan/${code}">Lihat topik lemah</button>
        <button class="link" id="closeSheet" style="justify-self:center;margin-top:4px">Tutup</button>
      </div>
    </dialog>`);
  const d = document.getElementById('sheet');
  d.addEventListener('close', () => d.remove());
  d.querySelector('#closeSheet').onclick = () => d.close();
  d.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { d.close(); location.hash = b.dataset.go; }));
  d.showModal();
}

// ---------- Skrin: Latihan ----------
async function practice(code, topic) {
  setTabs(null);
  if (!state.config) state.config = await api('/config');
  const s = subjectOf(code);
  let data;
  try {
    data = await api(`/practice?subject=${code}&n=10${topic ? `&topic=${topic}` : ''}`);
  } catch (e) {
    return e.status === 402 ? paywall('Anda telah menjawab semua soalan percuma hari ini. Sambung esok, atau aktifkan Pro untuk latihan tanpa had.') : errorScreen(e);
  }
  const qs = data.questions;
  if (!qs.length) return errorScreen(new Error('Tiada soalan untuk topik ini lagi.'));
  const results = [];
  let i = 0;

  const render = () => {
    const q = qs[i];
    const started = Date.now();
    $app.innerHTML = `
      <div class="qhead">
        <button class="back" aria-label="Kembali ke utama" data-go="#/">‹</button>
        <div class="dots" aria-label="Soalan ${i + 1} daripada ${qs.length}">
          ${qs.map((_, k) => `<i class="${k < results.length ? (results[k] ? 'ok' : 'no') : k === i ? 'now' : ''}"></i>`).join('')}
        </div>
      </div>
      <p class="topic">${esc(s.name)}, soalan ${i + 1} daripada ${qs.length}</p>
      <p class="stem">${rich(q.stem)}</p>
      <div class="opts" role="group" aria-label="Pilihan jawapan">
        ${q.options.map((o, k) => `<button class="opt" data-l="${LETTERS[k]}"><span class="l">${LETTERS[k]}</span><span class="t ${isMostlyArabic(o) ? 'ar' : ''}" ${isMostlyArabic(o) ? 'dir="rtl"' : ''}>${rich(o)}</span></button>`).join('')}
      </div>
      <div id="fb"></div>`;
    bindGo();
    $app.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', async () => {
      $app.querySelectorAll('.opt').forEach((x) => (x.disabled = true));
      b.classList.add('picked');
      let r;
      try {
        r = await api('/answer', { method: 'POST', body: { question_id: q.id, chosen: b.dataset.l, ms: Date.now() - started } });
      } catch (e) {
        if (e.status === 402) return paywall('Had latihan percuma hari ini telah dicapai.');
        $app.querySelectorAll('.opt').forEach((x) => (x.disabled = false));
        b.classList.remove('picked');
        return toast(e.message);
      }
      results.push(r.correct);
      $app.querySelectorAll('.opt').forEach((x) => {
        if (x.dataset.l === r.answer) x.classList.add('right');
        else if (x === b) x.classList.add('wrong');
      });
      const last = i === qs.length - 1;
      document.getElementById('fb').innerHTML = `
        <div class="feedback ${r.correct ? 'good' : 'bad'}">
          <h3>${r.correct ? 'Betul, syabas!' : `Jawapan betul ialah ${r.answer}`}</h3>
          <p>${rich(r.explanation || '')}</p>
          <p class="src"><button class="link" id="flag">Lapor soalan ini</button></p>
        </div>
        <div class="actions"><button class="btn primary block" id="next">${last ? 'Lihat keputusan' : 'Soalan seterusnya'}</button></div>`;
      document.getElementById('next').focus();
      document.getElementById('next').onclick = () => (last ? practiceDone(code, results) : (i++, render()));
      document.getElementById('flag').onclick = () => flagQuestion(q.id);
    }));
  };
  render();
}

function practiceDone(code, results) {
  const ok = results.filter(Boolean).length;
  $app.innerHTML = `
    <div class="score">
      <div class="num">${ok}/${results.length}</div>
      <p class="muted">${ok === results.length ? 'Sempurna! Teruskan istiqamah.' : ok >= results.length * 0.7 ? 'Bagus. Soalan yang salah akan muncul semula esok untuk ulangkaji.' : 'Tak mengapa. Soalan yang salah akan diulang supaya anda lebih ingat.'}</p>
    </div>
    <div style="display:grid;gap:10px;margin-top:16px">
      <button class="btn primary block" id="again">Latihan 10 soalan lagi</button>
      <button class="btn ghost block" data-go="#/kemajuan/${code}">Lihat topik lemah</button>
      <button class="btn ghost block" data-go="#/">Kembali ke utama</button>
    </div>`;
  document.getElementById('again').onclick = () => practice(code);
  bindGo();
}

async function flagQuestion(id) {
  const reason = prompt('Apa masalah soalan ini? (contoh: jawapan salah, ejaan, tidak jelas)');
  if (reason === null) return;
  try { await api('/flag', { method: 'POST', body: { question_id: id, reason } }); toast('Terima kasih. Ustaz akan menyemak soalan ini.'); }
  catch (e) { toast(e.message); }
}

// ---------- Skrin: Mock exam ----------
async function exam(code) {
  setTabs(null);
  if (!state.config) state.config = await api('/config');
  let data;
  try {
    data = await api('/exam/start', { method: 'POST', body: { subject: code } });
  } catch (e) {
    if (e.status === 402) return paywall('Mock exam bermasa ialah ciri Pro. Ia meniru masa sebenar kertas UPKK supaya anak biasa dengan tekanan masa.');
    return errorScreen(e);
  }
  const s = subjectOf(code);
  const qs = data.questions;
  const answers = {};
  let i = 0;
  const deadline = Date.now() + data.duration_minutes * 60000;
  let timerId;

  const fmt = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  const tick = () => {
    const left = deadline - Date.now();
    const el = document.getElementById('timer');
    if (el) { el.textContent = fmt(left); el.classList.toggle('low', left < 5 * 60000); }
    if (left <= 0) { clearInterval(timerId); submit(true); }
  };

  const render = () => {
    const q = qs[i];
    $app.innerHTML = `
      <div class="qhead">
        <span class="pill">${esc(s.name)}</span>
        <span style="flex:1"></span>
        <span class="timer" id="timer" role="timer" aria-label="Masa berbaki">${fmt(deadline - Date.now())}</span>
      </div>
      <p class="topic">${i < data.basic_count ? 'Bahagian A (perkara asas)' : 'Bahagian B'}, soalan ${i + 1} daripada ${qs.length}</p>
      <p class="stem">${rich(q.stem)}</p>
      <div class="opts">
        ${q.options.map((o, k) => `<button class="opt ${answers[q.id] === LETTERS[k] ? 'picked' : ''}" data-l="${LETTERS[k]}"><span class="l">${LETTERS[k]}</span><span class="t ${isMostlyArabic(o) ? 'ar' : ''}" ${isMostlyArabic(o) ? 'dir="rtl"' : ''}>${rich(o)}</span></button>`).join('')}
      </div>
      <div class="row" style="margin-top:16px">
        <button class="btn ghost" id="prev" ${i === 0 ? 'disabled' : ''}>Sebelum</button>
        <button class="btn primary" id="nxt">${i === qs.length - 1 ? 'Hantar kertas' : 'Seterusnya'}</button>
      </div>
      <div class="navgrid" aria-label="Lompat ke soalan">
        ${qs.map((x, k) => `<button class="${answers[x.id] ? 'done' : ''} ${k === i ? 'cur' : ''}" data-j="${k}" aria-label="Soalan ${k + 1}">${k + 1}</button>`).join('')}
      </div>`;
    $app.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => { answers[q.id] = b.dataset.l; render(); }));
    $app.querySelectorAll('[data-j]').forEach((b) => b.addEventListener('click', () => { i = +b.dataset.j; render(); }));
    document.getElementById('prev').onclick = () => { i--; render(); };
    document.getElementById('nxt').onclick = () => (i === qs.length - 1 ? submit(false) : (i++, render()));
  };

  const submit = async (auto) => {
    const blank = qs.length - Object.keys(answers).length;
    if (!auto && blank && !confirm(`${blank} soalan belum dijawab. Hantar juga?`)) return;
    clearInterval(timerId);
    $app.innerHTML = `<p class="empty">Menyemak jawapan…</p>`;
    try {
      const r = await api('/exam/submit', { method: 'POST', body: { exam_id: data.exam_id, answers } });
      examResult(code, r, auto);
    } catch (e) { errorScreen(e); }
  };

  render();
  timerId = setInterval(tick, 1000);
  window.addEventListener('hashchange', () => clearInterval(timerId), { once: true });
}

function examResult(code, r, auto) {
  const wrong = r.review.filter((x) => !x.correct);
  $app.innerHTML = `
    ${auto ? '<p class="small muted" style="margin-top:16px">Masa tamat. Kertas dihantar secara automatik.</p>' : ''}
    <div class="score">
      <div class="num">${r.percent}%</div>
      <p class="muted" style="margin:6px 0 0">${r.score} daripada ${r.total} betul</p>
      <span class="band">Anggaran gred ${r.band}</span>
      <p class="note" style="margin-top:10px">${esc(r.band_note)}</p>
    </div>
    <h2>${wrong.length ? `Semak ${wrong.length} jawapan yang salah` : 'Semua jawapan betul'}</h2>
    ${wrong.map((x) => `<div class="review no">
        <p><b>${rich(x.stem)}</b></p>
        <p class="small">Jawapan anda: ${x.chosen ? `${x.chosen}. ${rich(x.options[LETTERS.indexOf(x.chosen)])}` : 'tidak dijawab'}</p>
        <p class="small">Jawapan betul: ${x.answer}. ${rich(x.options[LETTERS.indexOf(x.answer)])}</p>
        <p class="small muted">${rich(x.explanation || '')}</p>
      </div>`).join('')}
    <div style="display:grid;gap:10px;margin-top:20px">
      <button class="btn primary block" data-go="#/latih/${code}">Latih topik yang lemah</button>
      <button class="btn ghost block" data-go="#/">Kembali ke utama</button>
    </div>`;
  bindGo();
}

// ---------- Skrin: Kemajuan ----------
async function progressScreen(code) {
  setTabs('progress');
  if (!state.config) state.config = await api('/config');
  const subs = state.config.subjects.filter((s) => s.questions);
  const active = code || subs[0]?.code;
  const prog = await api(`/progress${active ? `?subject=${active}` : ''}`);
  state.progress = prog;
  const sp = prog.subjects.find((x) => x.subject === active) || {};
  $app.innerHTML = `${header()}
    <h1>Kemajuan</h1>
    <div class="seg" role="group" aria-label="Pilih subjek">
      ${subs.map((s) => `<button aria-pressed="${s.code === active}" data-go="#/kemajuan/${s.code}">${esc(s.name)}</button>`).join('')}
    </div>
    ${!active ? '<p class="empty">Belum ada soalan yang diluluskan.</p>' : `
    <div class="box" style="margin-top:14px">
      <div class="row" style="align-items:baseline">
        <div><div class="small muted">Kesediaan</div><div style="font-size:32px;font-weight:600">${sp.attempts ? sp.readiness + '%' : '—'}</div></div>
        <div><div class="small muted">Ketepatan</div><div style="font-size:22px;font-weight:600">${sp.accuracy ?? '—'}${sp.accuracy != null ? '%' : ''}</div></div>
        <div><div class="small muted">Liputan topik</div><div style="font-size:22px;font-weight:600">${sp.coverage || 0}%</div></div>
      </div>
      ${sp.band ? `<p class="note" style="margin:8px 0 0">Anggaran gred ${sp.band}. ${esc(prog.band_note)}</p>` : `<p class="note" style="margin:8px 0 0">Jawab sekurang-kurangnya 20 soalan untuk anggaran gred.</p>`}
    </div>
    <h2>Topik</h2>
    <div class="tlist">
      ${(prog.topics || []).map((t) => `
        <div class="trow">
          <span>${esc(t.title)}${t.is_basic ? '<span class="tag">Asas</span>' : ''}</span>
          ${t.attempts ? `<b>${t.accuracy}%</b>` : `<button class="link" data-go="#/latih/${active}?topic=${t.id}">Cuba</button>`}
          <span class="meter" aria-hidden="true"><i style="width:${t.accuracy || 0}%;${t.accuracy !== null && t.accuracy < 60 ? 'background:var(--bad)' : ''}"></i></span>
        </div>`).join('')}
    </div>`}`;
  bindGo();
}

// ---------- Skrin: Profil / tetapan ----------
async function settings() {
  setTabs('settings');
  const me = await api('/me');
  state.me = me.user;
  const u = me.user;
  $app.innerHTML = `${header()}
    <h1>Profil</h1>
    <form id="prof" class="box">
      <label class="f">Nama murid<input class="in" name="name" value="${esc(u.name || '')}" maxlength="40" autocomplete="off"></label>
      <label class="f">Aliran sekolah
        <select class="in" name="stream">
          <option value="KAFA" ${u.stream === 'KAFA' ? 'selected' : ''}>KAFA (kebangsaan)</option>
          <option value="SRA" ${u.stream === 'SRA' ? 'selected' : ''}>SRA Selangor</option>
        </select>
      </label>
      <label class="f">No. WhatsApp ibu bapa<input class="in" name="parent_phone" value="${esc(u.parent_phone || '')}" inputmode="tel" placeholder="60123456789"></label>
      <button class="btn primary block">Simpan profil</button>
    </form>

    <h2>Laporan untuk ibu bapa</h2>
    <div class="box">
      <p class="small muted" style="margin-top:0">Ringkasan 7 hari dan subjek yang perlu diberi perhatian, dihantar melalui WhatsApp.</p>
      <button class="btn ghost block" id="report">Hantar laporan ke WhatsApp</button>
    </div>

    <h2>UPKK Pro</h2>
    <div class="box">
      ${u.plan === 'pro'
        ? '<p style="margin:0">Pro aktif pada peranti ini. Latihan tanpa had dan mock exam bermasa dibuka.</p>'
        : `<p class="small muted" style="margin-top:0">Pro membuka latihan tanpa had, mock exam bermasa ikut format UPKK, dan laporan kemajuan penuh.</p>
           <form id="lic" class="row"><input class="in" name="code" placeholder="UPKK-XXXXXXXX" autocapitalize="characters" aria-label="Kod Pro"><button class="btn primary" style="flex:none">Aktifkan</button></form>`}
    </div>
    <p class="note" style="margin-top:20px">Soalan dalam app ini asli, digubal berdasarkan silibus KAFA dan disemak ustaz sebelum dipaparkan. Ia bukan soalan peperiksaan sebenar. ID peranti: ${esc(userId().slice(0, 8))}</p>`;

  document.getElementById('prof').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await api('/me', { method: 'POST', body: f }); toast('Profil disimpan'); } catch (err) { toast(err.message); }
  };
  document.getElementById('report').onclick = async () => {
    try { const r = await api('/report'); window.open(r.whatsapp, '_blank', 'noopener'); } catch (err) { toast(err.message); }
  };
  const lic = document.getElementById('lic');
  if (lic) lic.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/license', { method: 'POST', body: { code: new FormData(lic).get('code') } }); toast('Pro diaktifkan'); settings(); }
    catch (err) { toast(err.message); }
  };
}

function paywall(msg) {
  setTabs(null);
  $app.innerHTML = `
    <div class="score" style="text-align:left">
      <h2 style="margin-top:0">Buka UPKK Pro</h2>
      <p>${esc(msg)}</p>
      <p class="small muted">Sudah ada kod? Masukkan di halaman Profil.</p>
    </div>
    <div style="display:grid;gap:10px;margin-top:16px">
      <button class="btn primary block" data-go="#/tetapan">Masukkan kod Pro</button>
      <button class="btn ghost block" data-go="#/">Kembali ke utama</button>
    </div>`;
  bindGo();
}

function errorScreen(e) {
  $app.innerHTML = `<div class="empty"><p>${esc(e.message || 'Tidak dapat memuatkan. Semak sambungan internet.')}</p><button class="btn ghost" data-go="#/">Kembali ke utama</button></div>`;
  bindGo();
}

function bindGo() {
  $app.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); location.hash = b.dataset.go; }));
}

// ---------- Penghala ----------
async function route() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  window.scrollTo(0, 0);
  try {
    if (parts[0] === 'latih') return await practice(parts[1], params.get('topic'));
    if (parts[0] === 'ujian') return await exam(parts[1]);
    if (parts[0] === 'kemajuan') return await progressScreen(parts[1]);
    if (parts[0] === 'tetapan') return await settings();
    return await home();
  } catch (e) {
    errorScreen(e);
  }
}
window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
