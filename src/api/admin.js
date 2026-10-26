// API panel ustaz/admin (Bearer ADMIN_TOKEN): barisan semakan, kelulusan, jana kelompok, lesen, sumber
import { json, fail, readJson, uid, LETTERS } from '../lib/util.js';
import { ingestSource } from '../ingest.js';
import { indexQuestion, unindexQuestion } from '../agents/originality.js';

export async function handleAdmin(request, env, url) {
  const path = url.pathname.replace(/^\/admin\/api/, '');
  switch (`${request.method} ${path}`) {
    case 'GET /stats': return stats(env);
    case 'GET /queue': return queue(env, url);
    case 'POST /review': return review(env, await readJson(request));
    case 'POST /generate': return generate(env, await readJson(request));
    case 'GET /batches': return json({ ok: true, batches: (await env.DB.prepare('SELECT * FROM batches ORDER BY created_at DESC LIMIT 30').all()).results });
    case 'POST /licenses': return createLicenses(env, await readJson(request));
    case 'GET /licenses': return json({ ok: true, licenses: (await env.DB.prepare('SELECT * FROM licenses ORDER BY created_at DESC LIMIT 200').all()).results });
    case 'POST /ingest': return ingest(env, await readJson(request));
    case 'GET /sources': return json({ ok: true, sources: (await env.DB.prepare('SELECT * FROM sources ORDER BY created_at DESC LIMIT 100').all()).results });
    case 'GET /topics': return topics(env, url);
    case 'POST /topic': return updateTopic(env, await readJson(request));
    case 'GET /reports': return reports(env);
  }
  return fail('Tidak dijumpai', 404);
}

async function stats(env) {
  const bySubject = (
    await env.DB.prepare(
      `SELECT subject,
        SUM(status='approved') approved, SUM(status='pending') pending, SUM(status='rejected') rejected,
        ROUND(AVG(CASE WHEN status='approved' THEN qa_score END),2) avg_score
       FROM questions GROUP BY subject`
    ).all()
  ).results;
  const users = await env.DB.prepare("SELECT COUNT(*) total, SUM(plan='pro') pro FROM users").first();
  const today = await env.DB.prepare("SELECT COUNT(*) n FROM attempts WHERE created_at >= datetime('now','-1 day')").first();
  const openReports = await env.DB.prepare('SELECT COUNT(*) n FROM reports WHERE resolved=0').first();
  // Taburan kedudukan jawapan (agen pengimbang)
  const letters = (await env.DB.prepare("SELECT answer, COUNT(*) n FROM questions WHERE status='approved' GROUP BY answer").all()).results;
  return json({ ok: true, bySubject, users, attempts_24h: today.n, open_reports: openReports.n, answer_distribution: letters });
}

async function queue(env, url) {
  const status = url.searchParams.get('status') || 'pending';
  const subject = url.searchParams.get('subject');
  const limit = Math.min(Number(url.searchParams.get('limit') || 20), 100);
  const rows = (
    await env.DB.prepare(
      `SELECT q.*, t.title topic_title,
        (SELECT GROUP_CONCAT(reason, ' | ') FROM reports r WHERE r.question_id=q.id AND r.resolved=0) open_reports
       FROM questions q LEFT JOIN topics t ON t.id=q.topic_id
       WHERE q.status=? ${subject ? 'AND q.subject=?' : ''}
       ORDER BY (open_reports IS NOT NULL) DESC, q.qa_score DESC, q.created_at ASC LIMIT ?`
    )
      .bind(...(subject ? [status, subject, limit] : [status, limit]))
      .all()
  ).results;
  return json({ ok: true, questions: rows.map((r) => ({ ...r, qa_report: safeParse(r.qa_report) })) });
}

async function review(env, { id, action, edits = {}, note = '', reviewer = 'ustaz' }) {
  const q = await env.DB.prepare('SELECT * FROM questions WHERE id=?').bind(id).first();
  if (!q) return fail('Soalan tidak dijumpai', 404);
  if (!['approve', 'reject'].includes(action)) return fail('action mesti approve atau reject');

  const next = { ...q };
  for (const k of ['stem', 'opt_a', 'opt_b', 'opt_c', 'opt_d', 'explanation', 'level', 'topic_id']) {
    if (typeof edits[k] === 'string' && edits[k].trim()) next[k] = edits[k].trim();
  }
  if (edits.answer && LETTERS.includes(String(edits.answer).toUpperCase())) next.answer = String(edits.answer).toUpperCase();
  const edited = ['stem', 'opt_a', 'opt_b', 'opt_c', 'opt_d', 'explanation', 'answer'].some((k) => next[k] !== q[k]);

  // Catatan ustaz menjadi "pengajaran" untuk agen perancang/penjana (gelung penambahbaikan kendiri)
  const lesson = String(note || '').slice(0, 300);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE questions SET stem=?, opt_a=?, opt_b=?, opt_c=?, opt_d=?, answer=?, explanation=?, level=?, topic_id=?,
        status=?, reviewer=?, review_note=?, reviewed_at=datetime('now') WHERE id=?`
    ).bind(next.stem, next.opt_a, next.opt_b, next.opt_c, next.opt_d, next.answer, next.explanation, next.level, next.topic_id, action === 'approve' ? 'approved' : 'rejected', reviewer, lesson || null, id),
    env.DB.prepare('UPDATE reports SET resolved=1 WHERE question_id=?').bind(id),
  ]);

  try {
    if (action === 'reject') await unindexQuestion(env, id);
    else if (edited) await indexQuestion(env, id, { ...next, options: [next.opt_a, next.opt_b, next.opt_c, next.opt_d] });
  } catch {}
  return json({ ok: true, id, status: action === 'approve' ? 'approved' : 'rejected', edited });
}

async function generate(env, { subject = null, topic_id = null, count = 5 }) {
  const batchId = uid('b-');
  const inst = await env.GENERATOR.create({ id: batchId, params: { batchId, subject, topic_id, count: Math.min(Number(count) || 5, 10) } });
  return json({ ok: true, batch_id: batchId, instance: inst.id });
}

async function createLicenses(env, { count = 1, note = '', plan = 'pro' }) {
  const n = Math.min(Number(count) || 1, 200);
  const codes = [];
  const stmts = [];
  for (let i = 0; i < n; i++) {
    const code = 'UPKK-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    codes.push(code);
    stmts.push(env.DB.prepare('INSERT INTO licenses (code,plan,note) VALUES (?,?,?)').bind(code, plan, note));
  }
  await env.DB.batch(stmts);
  return json({ ok: true, codes });
}

async function ingest(env, body) {
  try {
    return json({ ok: true, ...(await ingestSource(env, body)) });
  } catch (e) {
    return fail(String(e.message || e));
  }
}

async function topics(env, url) {
  const subject = url.searchParams.get('subject');
  const rows = (
    await env.DB.prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM questions q WHERE q.topic_id=t.id AND q.status='approved') approved,
        (SELECT COUNT(*) FROM questions q WHERE q.topic_id=t.id AND q.status='pending') pending
       FROM topics t ${subject ? 'WHERE t.subject=?' : ''} ORDER BY t.subject, t.sort`
    ).bind(...(subject ? [subject] : [])).all()
  ).results;
  return json({ ok: true, topics: rows });
}

async function updateTopic(env, { id, title, sk, verified, is_basic, stream, subject }) {
  if (!id) return fail('id diperlukan');
  const t = await env.DB.prepare('SELECT * FROM topics WHERE id=?').bind(id).first();
  if (!t) {
    if (!subject || !title) return fail('Topik baru perlukan subject dan title');
    await env.DB.prepare('INSERT INTO topics (id,subject,title,stream,sk,is_basic,verified) VALUES (?,?,?,?,?,?,?)')
      .bind(id, subject, title, stream || 'KAFA', sk || null, is_basic ? 1 : 0, verified ? 1 : 0).run();
    return json({ ok: true, created: true });
  }
  await env.DB.prepare('UPDATE topics SET title=?, sk=?, verified=?, is_basic=?, stream=? WHERE id=?')
    .bind(title ?? t.title, sk ?? t.sk, verified === undefined ? t.verified : verified ? 1 : 0, is_basic === undefined ? t.is_basic : is_basic ? 1 : 0, stream || t.stream, id).run();
  return json({ ok: true });
}

async function reports(env) {
  const rows = (
    await env.DB.prepare(
      `SELECT r.*, q.stem, q.status FROM reports r JOIN questions q ON q.id=r.question_id WHERE r.resolved=0 ORDER BY r.created_at DESC LIMIT 100`
    ).all()
  ).results;
  return json({ ok: true, reports: rows });
}

function safeParse(s) {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
