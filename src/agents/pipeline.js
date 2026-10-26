// AGEN 10 — HAKIM (mengumpul keputusan semua agen) + simpan ke barisan semakan ustaz
// Tiada soalan AI terus LIVE. Semua yang lulus masuk status 'pending' untuk kelulusan manusia.
import { checkStructure } from './structure.js';
import { languageReview, syariahReview, itemCritique } from './reviewers.js';
import { solveWithGemini, solveWithHermes } from './solver.js';
import { checkOriginality, indexQuestion } from './originality.js';
import { balanceOptions } from './balancer.js';
import { uid } from '../lib/util.js';

export async function qaOne(env, draft, context = []) {
  const report = { agents: {}, flags: [], reasons: [] };
  let q = { ...draft };

  // 1. Struktur
  const s1 = checkStructure(q);
  report.agents.structure = s1;
  if (!s1.ok) return reject(q, report, s1.issues);

  // 2. Bahasa / Jawi / Arab (boleh membetulkan teks)
  try {
    const lang = await languageReview(env, q);
    report.agents.language = { ok: lang.ok, issues: lang.issues };
    if (lang.fixed) {
      const candidate = { ...q, stem: lang.fixed.stem, options: lang.fixed.options, explanation: lang.fixed.explanation };
      if (checkStructure(candidate).ok) q = candidate;
    }
    if (!lang.ok && lang.issues?.length) report.flags.push('Bahasa dibetulkan: ' + lang.issues.slice(0, 2).join('; '));
  } catch (e) {
    report.agents.language = { error: String(e.message || e) };
  }

  // 3. Semakan selari: syariah, kritik item, dua penyelesai buta, keaslian
  const [syariah, critic, gSolve, hSolve, orig] = await Promise.all([
    syariahReview(env, q, context).catch((e) => ({ error: String(e.message || e) })),
    itemCritique(env, q).catch((e) => ({ error: String(e.message || e) })),
    solveWithGemini(env, q).catch((e) => ({ model: 'gemini', answer: null, error: String(e.message || e) })),
    solveWithHermes(env, q),
    checkOriginality(env, q).catch((e) => ({ error: String(e.message || e) })),
  ]);
  const { vector, ...origReport } = orig;
  Object.assign(report.agents, { syariah, critic, solvers: [gSolve, hSolve], originality: origReport });

  // 4. Keputusan
  if (syariah.error || critic.error) report.flags.push('Sebahagian semakan AI gagal — semak manual dengan teliti');
  if (syariah.severity === 'tinggi') report.reasons.push('Syariah: kesilapan serius — ' + (syariah.issues || []).join('; '));
  if (syariah.key_is_correct === false) report.reasons.push('Syariah: skema jawapan salah');
  if (syariah.other_option_also_correct) report.reasons.push('Lebih daripada satu jawapan betul');
  if (syariah.khilaf_risk) report.flags.push('Menyentuh perkara khilaf');
  if (syariah.severity === 'rendah') report.flags.push('Syariah (rendah): ' + (syariah.issues || []).join('; '));

  const solved = [gSolve, hSolve].filter((s) => s && s.answer && !s.skipped);
  const agree = solved.filter((s) => s.answer === q.answer).length;
  if (solved.length && agree === 0) report.reasons.push(`Penyelesai buta tidak bersetuju dengan skema (${solved.map((s) => `${s.model}:${s.answer}`).join(', ')})`);
  else if (agree < solved.length) report.flags.push(`Satu penyelesai tidak setuju (${solved.map((s) => `${s.model}:${s.answer}`).join(', ')})`);
  if (hSolve?.skipped) report.flags.push('Hermes tidak tersedia — hanya satu penyelesai');

  if (!critic.error) {
    if (critic.distractor_quality <= 2) report.reasons.push('Distraktor lemah');
    if (critic.clarity <= 2) report.reasons.push('Soalan tidak jelas');
    if (critic.age_appropriate === false) report.reasons.push('Tidak sesuai untuk murid Tahun 5');
    if (critic.cue_to_answer) report.flags.push('Ada petunjuk kepada jawapan');
    if (critic.level_match === false) report.flags.push(`Aras tidak sepadan (${q.level})`);
  }
  if (orig.copies_pastpaper) report.reasons.push(`Terlalu mirip soalan kertas lepas (${orig.max_pastpaper})`);
  if (orig.duplicate) report.reasons.push(`Duplikasi soalan bank ${orig.nearest} (${orig.max_duplicate})`);
  if (!q.source_ref || q.source_ref === 'asas') report.flags.push('Tiada petikan sumber — sahkan fakta');
  for (const i of s1.issues) report.flags.push(i);

  const score = scoreOf({ syariah, critic, solved, agree, orig, lang: report.agents.language });
  report.score = score;
  if (report.reasons.length) return reject(q, report, report.reasons);

  // 5. Imbang kedudukan jawapan
  q = balanceOptions(q, draft.target || q.answer);
  return { decision: 'save', question: q, report, score, vector };
}

function scoreOf({ syariah, critic, solved, agree, orig, lang }) {
  const sy = syariah.error ? 0.5 : syariah.accurate && syariah.severity === 'tiada' ? 1 : 0.6;
  const so = solved.length ? agree / solved.length : 0.5;
  const cr = critic.error ? 0.5 : ((critic.distractor_quality || 3) + (critic.clarity || 3)) / 10;
  const la = lang?.ok === false ? 0.6 : 1;
  const og = orig.error ? 0.5 : 1 - Math.max(orig.max_duplicate || 0, orig.max_pastpaper || 0) * 0.5;
  return Math.round((sy * 0.3 + so * 0.25 + cr * 0.25 + la * 0.1 + og * 0.1) * 100) / 100;
}

function reject(q, report, reasons) {
  report.reasons = [...new Set(reasons)];
  return { decision: 'reject', question: q, report, score: report.score ?? 0 };
}

export async function saveQuestion(env, result, { batchId, origin = 'agent', stream = 'KAFA' } = {}) {
  const q = result.question;
  const id = uid('q-');
  await env.DB.prepare(
    `INSERT INTO questions (id,subject,topic_id,stream,level,stem,opt_a,opt_b,opt_c,opt_d,answer,explanation,source_ref,origin,status,qa_score,qa_report,batch_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)`
  )
    .bind(id, q.subject, q.topic_id, stream, q.level, q.stem, q.options[0], q.options[1], q.options[2], q.options[3], q.answer, q.explanation, q.source_ref || null, origin, result.score, JSON.stringify(result.report), batchId || null)
    .run();
  try {
    await indexQuestion(env, id, q, result.vector);
  } catch {}
  return id;
}
