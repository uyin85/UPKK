// Panel ustaz/admin: semak & lulus soalan, cetus agen, urus topik, sumber, lesen
const $app = document.getElementById('app');
const L = ['A', 'B', 'C', 'D'];
const SUBJECTS = [['akidah', 'Akidah'], ['ibadah', 'Ibadah'], ['sirah', 'Sirah'], ['adab', 'Adab'], ['jawi', 'Jawi dan Khat'], ['arab', 'Bahasa Arab'], ['quran', 'Al-Quran (teori)']];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
let token = ss.get('upkk_admin');
let reviewer = ss.get('upkk_reviewer') || '';
let tab = 'queue';
let filterSubject = '';

async function api(path, body) {
  const res = await fetch('/admin/api' + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { token = null; ss.set('upkk_admin', ''); login('Token tidak sah.'); throw new Error('401'); }
  const d = await res.json();
  if (!d.ok) throw new Error(d.error || 'Ralat');
  return d;
}

function login(msg = '') {
  $app.innerHTML = `
    <header class="top"><div class="brand"><img src="/icon.svg" alt=""> Panel Ustaz</div></header>
    <form id="lg" class="card" style="max-width:420px">
      ${msg ? `<p class="warn">${esc(msg)}</p>` : ''}
      <label class="f">Nama penyemak<input class="in" name="who" value="${esc(reviewer)}" required></label>
      <label class="f">Token admin<input class="in" name="t" type="password" required></label>
      <button class="btn primary block">Masuk</button>
    </form>`;
  document.getElementById('lg').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    token = f.get('t'); reviewer = f.get('who');
    ss.set('upkk_admin', token); ss.set('upkk_reviewer', reviewer);
    render();
  };
}

function shell(inner) {
  const tabs = [['queue', 'Semakan'], ['generate', 'Jana soalan'], ['topics', 'Topik'], ['sources', 'Sumber'], ['licenses', 'Lesen'], ['stats', 'Statistik']];
  $app.innerHTML = `
    <header class="top"><div class="brand"><img src="/icon.svg" alt=""> Panel Ustaz</div><span class="pill">${esc(reviewer)}</span></header>
    <div class="tabs seg">${tabs.map(([k, n]) => `<button aria-pressed="${tab === k}" data-tab="${k}">${n}</button>`).join('')}</div>
    <div id="body">${inner}</div>`;
  $app.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(); }));
}

const subjectSelect = (name, val, all = true) =>
  `<select class="in" name="${name}">${all ? '<option value="">Semua subjek</option>' : ''}${SUBJECTS.map(([k, n]) => `<option value="${k}" ${val === k ? 'selected' : ''}>${n}</option>`).join('')}</select>`;

async function render() {
  if (!token) return login();
  try {
    if (tab === 'queue') return await queue();
    if (tab === 'generate') return await generate();
    if (tab === 'topics') return await topics();
    if (tab === 'sources') return await sources();
    if (tab === 'licenses') return await licenses();
    if (tab === 'stats') return await stats();
  } catch (e) {
    if (e.message !== '401') shell(`<p class="warn">${esc(e.message)}</p>`);
  }
}

// ---------- Barisan semakan ----------
async function queue() {
  const d = await api(`/queue?status=pending&limit=15${filterSubject ? `&subject=${filterSubject}` : ''}`);
  shell(`
    <div class="row" style="margin-bottom:12px;align-items:center">
      <div>${subjectSelect('fs', filterSubject)}</div>
      <p class="small muted" style="margin:0">${d.questions.length} soalan menunggu (dipapar 15 pertama). Soalan yang dilapor pelajar dipapar dahulu.</p>
    </div>
    ${d.questions.length ? d.questions.map(card).join('') : '<p class="empty">Tiada soalan menunggu semakan.</p>'}`);
  document.querySelector('[name=fs]').onchange = (e) => { filterSubject = e.target.value; render(); };
  document.querySelectorAll('form.rv').forEach((f) => (f.onsubmit = (e) => submitReview(e, f)));
}

function card(q) {
  const r = q.qa_report || {};
  const a = r.agents || {};
  const solvers = (a.solvers || []).map((s) => `${s.model}: ${s.skipped ? 'tiada' : s.answer || 'ralat'}`).join(', ');
  const sy = a.syariah || {};
  return `
  <form class="card rv" data-id="${q.id}">
    <div class="row" style="align-items:center;margin-bottom:8px">
      <span class="small muted">${esc(q.subject)} / ${esc(q.topic_title || q.topic_id)} / aras ${esc(q.level)} / ${esc(q.origin)}</span>
      <span style="flex:none">${q.qa_score != null ? `<span class="score-chip ${q.qa_score < 0.75 ? 'low' : ''}">QA ${q.qa_score}</span>` : ''}</span>
    </div>
    ${q.open_reports ? `<p class="warn small">Laporan: ${esc(q.open_reports)}</p>` : ''}
    <label class="f">Soalan<textarea class="in" name="stem" dir="auto">${esc(q.stem)}</textarea></label>
    <div class="grid2">
      ${L.map((l) => `<label class="f">Pilihan ${l}<input class="in" name="opt_${l.toLowerCase()}" value="${esc(q['opt_' + l.toLowerCase()])}" dir="auto"></label>`).join('')}
    </div>
    <div class="grid2">
      <label class="f">Skema jawapan<select class="in" name="answer">${L.map((l) => `<option ${q.answer === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Aras<select class="in" name="level">${['ingat', 'faham', 'aplikasi'].map((l) => `<option ${q.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <label class="f">Huraian<textarea class="in" name="explanation" dir="auto">${esc(q.explanation)}</textarea></label>
    ${q.qa_report ? `<div class="qa">
      <div>Penyelesai buta: ${esc(solvers || '-')}</div>
      <div>Syariah: ${sy.error ? 'ralat' : `${sy.accurate ? 'tepat' : 'ragu'} (${esc(sy.severity || '-')})`}${(sy.issues || []).length ? ` — ${esc(sy.issues.join('; '))}` : ''}</div>
      <div>Kritik item: distraktor ${a.critic?.distractor_quality ?? '-'}/5, kejelasan ${a.critic?.clarity ?? '-'}/5</div>
      <div>Keaslian: mirip bank ${a.originality?.max_duplicate ?? '-'}, mirip kertas lepas ${a.originality?.max_pastpaper ?? '-'}</div>
      ${(r.flags || []).length ? `<ul>${r.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      <div class="muted">Sumber: ${esc(q.source_ref || 'tiada')}</div>
    </div>` : '<p class="qa">Soalan contoh (tiada laporan agen). Semak dengan teliti.</p>'}
    <label class="f">Catatan untuk penjana (pilihan, contoh: "jangan guna istilah X untuk murid Tahun 5")<input class="in" name="note"></label>
    <div class="row">
      <button class="btn ghost" name="act" value="reject">Tolak</button>
      <button class="btn primary" name="act" value="approve">Lulus dan terbitkan</button>
    </div>
  </form>`;
}

async function submitReview(e, f) {
  e.preventDefault();
  const action = e.submitter?.value || 'approve';
  const fd = Object.fromEntries(new FormData(f));
  if (action === 'reject' && !fd.note && !confirm('Tolak tanpa catatan? Catatan membantu agen belajar.')) return;
  const edits = { stem: fd.stem, opt_a: fd.opt_a, opt_b: fd.opt_b, opt_c: fd.opt_c, opt_d: fd.opt_d, answer: fd.answer, explanation: fd.explanation, level: fd.level };
  try {
    await api('/review', { id: f.dataset.id, action, edits, note: fd.note, reviewer });
    f.outerHTML = `<p class="card small">${action === 'approve' ? 'Diluluskan dan diterbitkan.' : 'Ditolak.'}</p>`;
  } catch (err) { alert(err.message); }
}

// ---------- Jana ----------
async function generate() {
  const d = await api('/batches');
  shell(`
    <form id="gen" class="card">
      <p class="small muted" style="margin-top:0">Agen akan pilih topik paling memerlukan jika topik dikosongkan. Soalan yang lulus semua agen masuk tab Semakan.</p>
      <div class="grid2">
        <label class="f">Subjek${subjectSelect('subject', '', true)}</label>
        <label class="f">ID topik (pilihan)<input class="in" name="topic_id" placeholder="contoh: ibd-05"></label>
      </div>
      <label class="f">Bilangan soalan (1-10)<input class="in" name="count" type="number" min="1" max="10" value="5"></label>
      <button class="btn primary">Jalankan agen</button>
    </form>
    <h2>Kelompok terkini</h2>
    <table><tr><th>Kelompok</th><th>Topik</th><th>Status</th><th>Lulus/Tolak</th><th>Log</th></tr>
    ${d.batches.map((b) => `<tr><td>${esc(b.id)}<br><span class="muted small">${esc(b.created_at)}</span></td><td>${esc(b.topic_id || '-')}</td><td>${esc(b.status)}</td><td>${b.passed}/${b.rejected}</td><td class="small">${esc((JSON.parse(b.log || '[]') || []).join(' | ')).slice(0, 400)}</td></tr>`).join('')}
    </table>`);
  document.getElementById('gen').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { const r = await api('/generate', { subject: f.subject || null, topic_id: f.topic_id || null, count: +f.count }); alert(`Kelompok ${r.batch_id} dimulakan.`); render(); }
    catch (err) { alert(err.message); }
  };
}

// ---------- Topik ----------
async function topics() {
  const d = await api(`/topics${filterSubject ? `?subject=${filterSubject}` : ''}`);
  shell(`
    <div style="margin-bottom:12px">${subjectSelect('fs', filterSubject)}</div>
    <p class="small muted">Tandakan "disahkan" selepas topik dipadankan dengan DSKP / buku teks KAFA. Isi kod standard kandungan (SK) jika ada.</p>
    <table><tr><th>ID</th><th>Topik</th><th>SK</th><th>Asas</th><th>Disahkan</th><th>Soalan</th><th></th></tr>
    ${d.topics.map((t) => `<tr data-id="${t.id}">
      <td>${esc(t.id)}</td>
      <td><input class="in" name="title" value="${esc(t.title)}"></td>
      <td><input class="in" name="sk" value="${esc(t.sk || '')}" style="width:80px"></td>
      <td><input type="checkbox" name="is_basic" ${t.is_basic ? 'checked' : ''}></td>
      <td><input type="checkbox" name="verified" ${t.verified ? 'checked' : ''}></td>
      <td>${t.approved} / ${t.pending}</td>
      <td><button class="btn ghost" style="min-height:40px" data-save>Simpan</button></td>
    </tr>`).join('')}</table>`);
  document.querySelector('[name=fs]').onchange = (e) => { filterSubject = e.target.value; render(); };
  document.querySelectorAll('[data-save]').forEach((b) => (b.onclick = async () => {
    const tr = b.closest('tr');
    const v = (n) => tr.querySelector(`[name=${n}]`);
    try { await api('/topic', { id: tr.dataset.id, title: v('title').value, sk: v('sk').value, is_basic: v('is_basic').checked, verified: v('verified').checked }); b.textContent = 'Disimpan'; }
    catch (err) { alert(err.message); }
  }));
}

// ---------- Sumber ----------
async function sources() {
  const d = await api('/sources');
  shell(`
    <form id="src" class="card">
      <p class="small muted" style="margin-top:0">Tampal teks nota atau buku teks yang anda ada hak untuk gunakan. Agen menjana dan menyemak soalan berdasarkan sumber ini. Kertas lepas hanya digunakan untuk memastikan soalan kita tidak menyalin soalan sebenar.</p>
      <div class="grid2">
        <label class="f">Subjek${subjectSelect('subject', 'akidah', false)}</label>
        <label class="f">Jenis<select class="in" name="kind"><option value="notes">Nota guru</option><option value="textbook">Buku teks</option><option value="pastpaper">Kertas lepas (penanda keaslian)</option></select></label>
      </div>
      <label class="f">Tajuk sumber<input class="in" name="title" required placeholder="contoh: Nota Ibadah Tahun 4 Ustazah Aminah"></label>
      <label class="f">ID topik (pilihan)<input class="in" name="topic_id"></label>
      <label class="f">Teks<textarea class="in" name="text" style="min-height:200px" dir="auto" required></textarea></label>
      <button class="btn primary">Masukkan sumber</button>
    </form>
    <table><tr><th>Tajuk</th><th>Subjek</th><th>Jenis</th><th>Cebisan</th></tr>
    ${d.sources.map((s) => `<tr><td>${esc(s.title)}</td><td>${esc(s.subject)}</td><td>${esc(s.kind)}</td><td>${s.chunks}</td></tr>`).join('')}</table>`);
  document.getElementById('src').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { const r = await api('/ingest', { ...f, topic_id: f.topic_id || null }); alert(`Disimpan: ${r.chunks} cebisan`); render(); }
    catch (err) { alert(err.message); }
  };
}

// ---------- Lesen ----------
async function licenses() {
  const d = await api('/licenses');
  shell(`
    <form id="lc" class="card row" style="align-items:end">
      <label class="f" style="margin:0">Bilangan kod<input class="in" name="count" type="number" min="1" max="200" value="10"></label>
      <label class="f" style="margin:0">Catatan<input class="in" name="note" placeholder="contoh: pembeli Shopee Nov"></label>
      <button class="btn primary" style="flex:none">Jana kod Pro</button>
    </form>
    <table><tr><th>Kod</th><th>Catatan</th><th>Digunakan</th></tr>
    ${d.licenses.map((l) => `<tr><td><code>${esc(l.code)}</code></td><td>${esc(l.note || '')}</td><td>${l.used_by ? esc(l.used_at) : '-'}</td></tr>`).join('')}</table>`);
  document.getElementById('lc').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { const r = await api('/licenses', { count: +f.count, note: f.note }); prompt('Salin kod baru:', r.codes.join(' ')); render(); }
    catch (err) { alert(err.message); }
  };
}

// ---------- Statistik ----------
async function stats() {
  const d = await api('/stats');
  const total = d.answer_distribution.reduce((s, x) => s + x.n, 0) || 1;
  shell(`
    <div class="grid2">
      <div class="card"><div class="small muted">Pengguna</div><div style="font-size:28px;font-weight:600">${d.users.total || 0}</div><div class="small">${d.users.pro || 0} Pro</div></div>
      <div class="card"><div class="small muted">Jawapan 24 jam</div><div style="font-size:28px;font-weight:600">${d.attempts_24h}</div><div class="small">${d.open_reports} laporan terbuka</div></div>
    </div>
    <h2>Bank soalan</h2>
    <table><tr><th>Subjek</th><th>Lulus</th><th>Menunggu</th><th>Ditolak</th><th>Purata QA</th></tr>
    ${d.bySubject.map((s) => `<tr><td>${esc(s.subject)}</td><td>${s.approved}</td><td>${s.pending}</td><td>${s.rejected}</td><td>${s.avg_score ?? '-'}</td></tr>`).join('')}</table>
    <h2>Taburan skema jawapan</h2>
    <p class="small muted">Sasaran sekitar 25% setiap huruf.</p>
    <table><tr>${d.answer_distribution.map((x) => `<td><b>${x.answer}</b> ${Math.round((x.n / total) * 100)}%</td>`).join('')}</tr></table>`);
}

render();
