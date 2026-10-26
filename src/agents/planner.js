// AGEN 1 — PERANCANG
// Pilih topik yang paling perlukan soalan (jurang liputan + topik yang pelajar lemah),
// tetapkan campuran aras kognitif, dan kumpul pengajaran daripada soalan yang ditolak ustaz.
import format from '../../data/format.json';
import { LETTERS, shuffle } from '../lib/util.js';

export async function planBatch(env, { subject, topicId, count }) {
  const n = Math.max(1, Math.min(count || 5, format.generation.max_per_batch));
  const topic = topicId ? await getTopic(env, topicId) : await pickNeediestTopic(env, subject);
  if (!topic) throw new Error('Tiada topik sesuai untuk dijana');

  // Campuran aras ikut format.json
  const levels = [];
  for (const [lvl, ratio] of Object.entries(format.generation.level_mix)) {
    for (let i = 0; i < Math.round(ratio * n); i++) levels.push(lvl);
  }
  while (levels.length < n) levels.push('faham');
  levels.length = n;

  // Taburan jawapan A/B/C/D sekata (agen pengimbang guna ini kemudian)
  const targets = [];
  while (targets.length < n) targets.push(...shuffle(LETTERS));
  targets.length = n;

  // Soalan sedia ada dalam topik — supaya penjana tidak ulang
  const existing = await env.DB.prepare(
    "SELECT stem FROM questions WHERE topic_id=? AND status!='rejected' ORDER BY created_at DESC LIMIT 25"
  ).bind(topic.id).all();

  // Pengajaran kendiri: sebab ustaz tolak/edit soalan baru-baru ini
  const lessons = await env.DB.prepare(
    "SELECT review_note FROM questions WHERE subject=? AND review_note IS NOT NULL AND review_note!='' ORDER BY reviewed_at DESC LIMIT 12"
  ).bind(topic.subject).all();

  return {
    topic,
    count: n,
    levels: shuffle(levels),
    targets,
    existingStems: existing.results.map((r) => r.stem),
    lessons: [...new Set(lessons.results.map((r) => r.review_note))],
  };
}

async function getTopic(env, id) {
  return env.DB.prepare('SELECT * FROM topics WHERE id=? AND mcq=1').bind(id).first();
}

async function pickNeediestTopic(env, subject) {
  const target = format.generation.target_per_topic;
  const where = subject ? 'AND t.subject=?' : '';
  const stmt = env.DB.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM questions q WHERE q.topic_id=t.id AND q.status!='rejected') AS bank,
      (SELECT AVG(a.is_correct) FROM attempts a WHERE a.topic_id=t.id) AS acc,
      (SELECT COUNT(*) FROM attempts a WHERE a.topic_id=t.id) AS tries
    FROM topics t JOIN subjects s ON s.code=t.subject
    WHERE t.mcq=1 AND s.mcq=1 ${where}`);
  const rows = (subject ? await stmt.bind(subject).all() : await stmt.all()).results;
  if (!rows.length) return null;
  // Skor keperluan: jurang bank soalan + bonus jika pelajar lemah dalam topik ini
  const scored = rows
    .filter((r) => r.bank < target)
    .map((r) => {
      const gap = (target - r.bank) / target;
      const weak = r.tries >= 30 && r.acc !== null ? Math.max(0, 0.7 - r.acc) : 0;
      const basic = r.is_basic ? 0.15 : 0;
      return { r, score: gap + weak + basic + Math.random() * 0.05 };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.r || null;
}
