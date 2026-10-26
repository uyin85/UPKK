// API pelajar: latihan adaptif, mock exam bermasa, skor kesediaan, laporan ibu bapa
import format from '../../data/format.json';
import { json, fail, readJson, uid, publicQuestion, questionOptions, weightedSample, bandFor, TODAY_MYT_SQL, LETTERS } from '../lib/util.js';

// Mod ujian: SHOW_PENDING=true membolehkan soalan 'pending' dipapar (untuk staging sahaja)
const statusFilter = (env) => (env.SHOW_PENDING === 'true' ? "status IN ('approved','pending')" : "status='approved'");

export async function handleApp(request, env, url) {
  const path = url.pathname.replace(/^\/api/, '');
  const userId = (request.headers.get('x-user-id') || '').slice(0, 64);

  if (path === '/config' && request.method === 'GET') return config(env);
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(userId)) return fail('x-user-id tidak sah', 401);

  const user = await ensureUser(env, userId);
  switch (`${request.method} ${path}`) {
    case 'POST /me': return updateMe(env, user, await readJson(request));
    case 'GET /me': return json({ ok: true, user, limits: await limits(env, user) });
    case 'POST /license': return activateLicense(env, user, await readJson(request));
    case 'GET /practice': return practice(env, user, url);
    case 'POST /answer': return answer(env, user, await readJson(request));
    case 'POST /exam/start': return examStart(env, user, await readJson(request));
    case 'POST /exam/submit': return examSubmit(env, user, await readJson(request));
    case 'GET /progress': return progress(env, user, url);
    case 'GET /report': return parentReport(env, user);
    case 'POST /flag': return flag(env, user, await readJson(request));
  }
  return fail('Tidak dijumpai', 404);
}

async function config(env) {
  const counts = await env.DB.prepare(`SELECT subject, COUNT(*) n FROM questions WHERE ${statusFilter(env)} GROUP BY subject`).all();
  const map = Object.fromEntries(counts.results.map((r) => [r.subject, r.n]));
  const subjects = format.subjects.filter((s) => s.mcq).map((s) => ({ ...s, questions: map[s.code] || 0 }));
  return json(
    { ok: true, subjects, exam: format.exam, mock: { items: format.mock_exam.items, duration_minutes: format.mock_exam.duration_minutes }, free_daily_limit: freeLimit(env) },
    200,
    { 'cache-control': 'public, max-age=300' }
  );
}

const freeLimit = (env) => Number(env.FREE_DAILY_LIMIT || 15);

async function ensureUser(env, id) {
  let u = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
  if (!u) {
    await env.DB.prepare('INSERT OR IGNORE INTO users (id) VALUES (?)').bind(id).run();
    u = { id, name: null, stream: 'KAFA', plan: 'free', parent_phone: null };
  }
  return u;
}

async function limits(env, user) {
  if (user.plan === 'pro') return { plan: 'pro', used_today: null, limit: null };
  const r = await env.DB.prepare(`SELECT COUNT(*) n FROM attempts WHERE user_id=? AND mode='practice' AND created_at >= ${TODAY_MYT_SQL}`).bind(user.id).first();
  return { plan: 'free', used_today: r.n, limit: freeLimit(env) };
}

async function updateMe(env, user, body) {
  const name = body.name !== undefined ? String(body.name).slice(0, 40) : user.name;
  const stream = ['KAFA', 'SRA'].includes(body.stream) ? body.stream : user.stream;
  const phone = body.parent_phone !== undefined ? String(body.parent_phone).replace(/[^\d+]/g, '').slice(0, 16) : user.parent_phone;
  await env.DB.prepare('UPDATE users SET name=?, stream=?, parent_phone=? WHERE id=?').bind(name, stream, phone, user.id).run();
  return json({ ok: true, user: { ...user, name, stream, parent_phone: phone } });
}

async function activateLicense(env, user, { code }) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return fail('Masukkan kod');
  const lic = await env.DB.prepare('SELECT * FROM licenses WHERE code=?').bind(c).first();
  if (!lic) return fail('Kod tidak sah', 404);
  if (lic.used_by && lic.used_by !== user.id) return fail('Kod ini telah digunakan pada peranti lain. Hubungi kami untuk pindah peranti.', 409);
  await env.DB.batch([
    env.DB.prepare("UPDATE licenses SET used_by=?, used_at=datetime('now') WHERE code=?").bind(user.id, c),
    env.DB.prepare('UPDATE users SET plan=? WHERE id=?').bind(lic.plan || 'pro', user.id),
  ]);
  return json({ ok: true, plan: lic.plan || 'pro' });
}

// ---------- Latihan adaptif ----------
// Berat pemilihan: soalan pernah salah (>1 hari) paling tinggi, topik lemah lebih kerap,
// soalan dijawab betul dalam 7 hari dilangkau (ulangkaji berselang ringkas).
async function practice(env, user, url) {
  const subject = url.searchParams.get('subject');
  const topic = url.searchParams.get('topic');
  const n = Math.min(Number(url.searchParams.get('n') || 10), 20);
  if (!subject) return fail('subject diperlukan');

  const lim = await limits(env, user);
  if (lim.plan === 'free' && lim.used_today >= lim.limit) return fail('Had latihan percuma hari ini telah dicapai', 402, { limits: lim });

  const candidates = (
    await env.DB.prepare(
      `SELECT q.*, t.is_basic,
         (SELECT a.is_correct FROM attempts a WHERE a.user_id=?1 AND a.question_id=q.id ORDER BY a.id DESC LIMIT 1) AS last_ok,
         (SELECT (julianday('now') - julianday(a.created_at)) FROM attempts a WHERE a.user_id=?1 AND a.question_id=q.id ORDER BY a.id DESC LIMIT 1) AS days_ago
       FROM questions q JOIN topics t ON t.id=q.topic_id
       WHERE q.subject=?2 AND q.${statusFilter(env)} AND q.stream IN ('KAFA', ?3) ${topic ? 'AND q.topic_id=?4' : ''}
       LIMIT 600`
    )
      .bind(...(topic ? [user.id, subject, user.stream, topic] : [user.id, subject, user.stream]))
      .all()
  ).results;

  const mastery = await topicMastery(env, user.id, subject);
  const picked = weightedSample(
    candidates,
    (q) => {
      const m = mastery[q.topic_id];
      const weak = m ? 1.5 - m.acc : 1.2; // topik belum dicuba dianggap sederhana lemah
      if (q.last_ok === null) return 1 * weak;
      if (q.last_ok === 0) return q.days_ago >= 1 ? 3 * weak : 0.3;
      return q.days_ago >= 7 ? 0.5 * weak : 0;
    },
    n
  );
  // Jika semua sudah dikuasai, benarkan ulangan rawak
  const result = picked.length ? picked : weightedSample(candidates, () => 1, n);
  return json({ ok: true, questions: result.map(publicQuestion), limits: lim });
}

async function topicMastery(env, userId, subject) {
  const rows = (
    await env.DB.prepare(
      `SELECT topic_id, COUNT(*) n, AVG(is_correct) acc FROM
         (SELECT topic_id, is_correct FROM attempts WHERE user_id=? AND subject=? ORDER BY id DESC LIMIT 400)
       GROUP BY topic_id`
    ).bind(userId, subject).all()
  ).results;
  return Object.fromEntries(rows.map((r) => [r.topic_id, { n: r.n, acc: r.acc }]));
}

async function answer(env, user, { question_id, chosen, ms }) {
  const q = await env.DB.prepare('SELECT * FROM questions WHERE id=?').bind(question_id).first();
  if (!q) return fail('Soalan tidak dijumpai', 404);
  const lim = await limits(env, user);
  if (lim.plan === 'free' && lim.used_today >= lim.limit) return fail('Had latihan percuma hari ini telah dicapai', 402, { limits: lim });
  const c = String(chosen || '').toUpperCase();
  const ok = c === q.answer ? 1 : 0;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO attempts (user_id,question_id,subject,topic_id,chosen,is_correct,ms,mode) VALUES (?,?,?,?,?,?,?,?)')
      .bind(user.id, q.id, q.subject, q.topic_id, c, ok, Math.min(Number(ms) || 0, 3600000), 'practice'),
    env.DB.prepare('UPDATE questions SET served=served+1, correct=correct+? WHERE id=?').bind(ok, q.id),
  ]);
  return json({ ok: true, correct: !!ok, answer: q.answer, explanation: q.explanation, source_ref: q.source_ref });
}

// ---------- Mock exam ----------
async function examStart(env, user, { subject }) {
  if (user.plan !== 'pro') return fail('Mock exam untuk pengguna Pro', 402);
  if (!subject) return fail('subject diperlukan');
  const { items, basic_ratio } = format.mock_exam;
  const rows = (
    await env.DB.prepare(
      `SELECT q.*, t.is_basic FROM questions q JOIN topics t ON t.id=q.topic_id
       WHERE q.subject=? AND q.${statusFilter(env)} AND q.stream IN ('KAFA', ?)`
    ).bind(subject, user.stream).all()
  ).results;
  if (rows.length < 10) return fail('Bank soalan subjek ini belum mencukupi untuk mock exam', 409);

  // Bahagian A (perkara asas) dahulu, kemudian taburan sekata merentas topik
  const basic = weightedSample(rows.filter((r) => r.is_basic), () => 1, Math.round(items * basic_ratio));
  const used = new Set(basic.map((r) => r.id));
  const byTopic = {};
  for (const r of rows) if (!used.has(r.id)) (byTopic[r.topic_id] ||= []).push(r);
  const rest = [];
  const topics = Object.values(byTopic);
  while (rest.length < items - basic.length && topics.some((t) => t.length)) {
    for (const t of topics) {
      if (t.length && rest.length < items - basic.length) rest.push(t.splice(Math.floor(Math.random() * t.length), 1)[0]);
    }
  }
  const paper = [...basic, ...rest];
  const id = uid('ex-');
  await env.DB.prepare('INSERT INTO exams (id,user_id,subject,question_ids,total) VALUES (?,?,?,?,?)')
    .bind(id, user.id, subject, JSON.stringify(paper.map((r) => r.id)), paper.length).run();
  return json({ ok: true, exam_id: id, duration_minutes: format.mock_exam.duration_minutes, basic_count: basic.length, questions: paper.map(publicQuestion) });
}

async function examSubmit(env, user, { exam_id, answers = {} }) {
  const ex = await env.DB.prepare('SELECT * FROM exams WHERE id=? AND user_id=?').bind(exam_id, user.id).first();
  if (!ex) return fail('Peperiksaan tidak dijumpai', 404);
  if (ex.finished_at) return fail('Peperiksaan ini telah dihantar', 409);
  const ids = JSON.parse(ex.question_ids);
  const qs = (await env.DB.prepare(`SELECT * FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results;
  const map = Object.fromEntries(qs.map((q) => [q.id, q]));
  let score = 0;
  const review = [];
  const stmts = [];
  for (const qid of ids) {
    const q = map[qid];
    if (!q) continue;
    const c = LETTERS.includes(String(answers[qid] || '').toUpperCase()) ? String(answers[qid]).toUpperCase() : null;
    const ok = c === q.answer ? 1 : 0;
    score += ok;
    review.push({ id: qid, stem: q.stem, options: questionOptions(q), chosen: c, answer: q.answer, correct: !!ok, explanation: q.explanation, topic_id: q.topic_id });
    stmts.push(
      env.DB.prepare('INSERT INTO attempts (user_id,question_id,subject,topic_id,chosen,is_correct,mode) VALUES (?,?,?,?,?,?,?)').bind(user.id, qid, q.subject, q.topic_id, c, ok, 'exam'),
      env.DB.prepare('UPDATE questions SET served=served+1, correct=correct+? WHERE id=?').bind(ok, qid)
    );
  }
  stmts.push(env.DB.prepare("UPDATE exams SET finished_at=datetime('now'), score=? WHERE id=?").bind(score, exam_id));
  await env.DB.batch(stmts);
  const ratio = ids.length ? score / ids.length : 0;
  return json({ ok: true, score, total: ids.length, percent: Math.round(ratio * 100), band: bandFor(ratio, format.readiness_bands), band_note: 'Anggaran app, bukan gred rasmi', review });
}

// ---------- Skor kesediaan & kemajuan ----------
async function progress(env, user, url) {
  const subject = url.searchParams.get('subject');
  const totals = (
    await env.DB.prepare(
      `SELECT s.code subject,
        (SELECT COUNT(*) FROM topics t WHERE t.subject=s.code AND t.mcq=1) topics_total
       FROM subjects s WHERE s.mcq=1 ORDER BY s.sort`
    ).all()
  ).results;
  // Ketepatan berdasarkan 100 cubaan terkini setiap subjek (lebih mencerminkan tahap semasa)
  const recent = (
    await env.DB.prepare(
      `SELECT subject, COUNT(*) n, AVG(is_correct) acc, COUNT(DISTINCT topic_id) topics_seen FROM (
         SELECT subject, topic_id, is_correct, ROW_NUMBER() OVER (PARTITION BY subject ORDER BY id DESC) rn
         FROM attempts WHERE user_id=?) WHERE rn<=100 GROUP BY subject`
    ).bind(user.id).all()
  ).results;
  const rmap = Object.fromEntries(recent.map((r) => [r.subject, r]));
  const subjects = totals.map((t) => {
    const r = rmap[t.subject];
    if (!r) return { subject: t.subject, attempts: 0, accuracy: null, coverage: 0, readiness: 0, band: null };
    const coverage = t.topics_total ? Math.min(1, r.topics_seen / t.topics_total) : 0;
    const confidence = Math.min(1, r.n / 60); // perlu cukup data sebelum ramalan stabil
    const readiness = r.acc * (0.6 + 0.4 * coverage) * (0.7 + 0.3 * confidence);
    return {
      subject: t.subject,
      attempts: r.n,
      accuracy: Math.round(r.acc * 100),
      coverage: Math.round(coverage * 100),
      readiness: Math.round(readiness * 100),
      band: r.n >= 20 ? bandFor(readiness, format.readiness_bands) : null,
    };
  });

  let topics = null;
  if (subject) {
    const m = await topicMastery(env, user.id, subject);
    const list = (await env.DB.prepare('SELECT id,title,is_basic FROM topics WHERE subject=? AND mcq=1 ORDER BY sort').bind(subject).all()).results;
    topics = list.map((t) => ({ ...t, attempts: m[t.id]?.n || 0, accuracy: m[t.id] ? Math.round(m[t.id].acc * 100) : null }));
  }
  const streak = await streakDays(env, user.id);
  return json({ ok: true, subjects, topics, streak, band_note: 'Skor Kesediaan ialah anggaran app, bukan gred rasmi UPKK' });
}

async function streakDays(env, userId) {
  const rows = (
    await env.DB.prepare(
      `SELECT DISTINCT date(created_at,'+8 hours') d FROM attempts WHERE user_id=? ORDER BY d DESC LIMIT 60`
    ).bind(userId).all()
  ).results.map((r) => r.d);
  let streak = 0;
  const day = new Date(Date.now() + 8 * 3600 * 1000);
  for (let i = 0; i < 60; i++) {
    const d = day.toISOString().slice(0, 10);
    if (rows.includes(d)) streak++;
    else if (i > 0) break;
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return streak;
}

async function parentReport(env, user) {
  const url = new URL('https://x/api/progress');
  const prog = await (await progress(env, user, url)).json();
  const names = Object.fromEntries(format.subjects.map((s) => [s.code, s.name]));
  const week = await env.DB.prepare(
    "SELECT COUNT(*) n, AVG(is_correct) acc FROM attempts WHERE user_id=? AND created_at >= datetime('now','-7 days')"
  ).bind(user.id).first();
  const lines = [
    `Laporan UPKK Pro — ${user.name || 'Anak anda'}`,
    `7 hari lepas: ${week.n} soalan dijawab, ketepatan ${week.n ? Math.round(week.acc * 100) : 0}%. Streak: ${prog.streak} hari.`,
    '',
    ...prog.subjects
      .filter((s) => s.attempts)
      .map((s) => `• ${names[s.subject]}: kesediaan ${s.readiness}%${s.band ? ` (anggaran ${s.band})` : ''}, liputan topik ${s.coverage}%`),
  ];
  const weakest = prog.subjects.filter((s) => s.attempts >= 10).sort((a, b) => a.readiness - b.readiness)[0];
  if (weakest) lines.push('', `Fokus minggu ini: ${names[weakest.subject]}.`);
  lines.push('', '*Skor Kesediaan ialah anggaran app, bukan gred rasmi UPKK.');
  const text = lines.join('\n');
  const wa = user.parent_phone ? `https://wa.me/${user.parent_phone.replace(/^\+/, '')}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
  return json({ ok: true, text, whatsapp: wa });
}

async function flag(env, user, { question_id, reason }) {
  if (!question_id) return fail('question_id diperlukan');
  const q = await env.DB.prepare('SELECT id FROM questions WHERE id=?').bind(question_id).first();
  if (!q) return fail('Soalan tidak dijumpai', 404);
  const dup = await env.DB.prepare('SELECT id FROM reports WHERE question_id=? AND user_id=?').bind(question_id, user.id).first();
  if (dup) return json({ ok: true, duplicate: true });
  await env.DB.batch([
    env.DB.prepare('INSERT INTO reports (question_id,user_id,reason) VALUES (?,?,?)').bind(question_id, user.id, String(reason || '').slice(0, 300)),
    env.DB.prepare('UPDATE questions SET user_flags=user_flags+1 WHERE id=?').bind(question_id),
  ]);
  return json({ ok: true });
}
