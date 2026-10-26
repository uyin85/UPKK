// AGEN 8 — KEASLIAN & DUPLIKASI (Workers AI bge-m3 + Vectorize)
// Indeks QVEC menyimpan soalan bank (id = id soalan) dan item kertas lepas (id bermula "pp:").
// Kertas lepas hanya dijadikan penanda supaya soalan kita TIDAK menyalin soalan sebenar.
import { embed } from '../lib/llm.js';

export const DUP_THRESHOLD = 0.95;
export const PASTPAPER_THRESHOLD = 0.9;

export function questionText(q) {
  const opts = q.options || [q.opt_a, q.opt_b, q.opt_c, q.opt_d];
  return `${q.stem} | ${opts.join(' | ')}`;
}

export async function checkOriginality(env, q) {
  const [vector] = await embed(env, [questionText(q)]);
  let matches = [];
  try {
    const res = await env.QVEC.query(vector, { topK: 5 });
    matches = res.matches || [];
  } catch {
    matches = [];
  }
  const past = matches.filter((m) => m.id.startsWith('pp:'));
  const bank = matches.filter((m) => !m.id.startsWith('pp:'));
  const maxPast = past[0]?.score || 0;
  const maxDup = bank[0]?.score || 0;
  return {
    vector,
    max_pastpaper: round(maxPast),
    max_duplicate: round(maxDup),
    nearest: bank[0]?.id || null,
    copies_pastpaper: maxPast >= PASTPAPER_THRESHOLD,
    duplicate: maxDup >= DUP_THRESHOLD,
  };
}

export async function indexQuestion(env, id, q, vector) {
  const v = vector || (await embed(env, [questionText(q)]))[0];
  await env.QVEC.upsert([{ id, values: v, metadata: { subject: q.subject, topic: q.topic_id } }]);
}

export async function unindexQuestion(env, id) {
  try {
    await env.QVEC.deleteByIds([id]);
  } catch {}
}

const round = (x) => Math.round(x * 1000) / 1000;
