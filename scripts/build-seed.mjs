// Jana seed.sql daripada data/format.json, data/syllabus.json dan data/seed_questions.json
// Guna: node scripts/build-seed.mjs > seed.sql
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../data/', import.meta.url);
const format = JSON.parse(readFileSync(new URL('format.json', root), 'utf8'));
const syllabus = JSON.parse(readFileSync(new URL('syllabus.json', root), 'utf8'));
const seed = JSON.parse(readFileSync(new URL('seed_questions.json', root), 'utf8'));

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const out = [];

for (const s of format.subjects) {
  out.push(`INSERT OR REPLACE INTO subjects (code,name,jawi,upkk_code,assessment,mcq,sort) VALUES (${q(s.code)},${q(s.name)},${q(s.jawi)},${q(s.upkk_code)},${q(s.assessment)},${s.mcq ? 1 : 0},${s.sort});`);
}

const topicSubject = {};
for (const [subject, list] of Object.entries(syllabus.topics)) {
  list.forEach((t, i) => {
    topicSubject[t.id] = subject;
    out.push(`INSERT INTO topics (id,subject,title,stream,is_basic,mcq,verified,sort) VALUES (${q(t.id)},${q(subject)},${q(t.title)},'KAFA',${t.basic ? 1 : 0},${t.mcq === false ? 0 : 1},0,${i + 1}) ON CONFLICT(id) DO UPDATE SET title=excluded.title, is_basic=excluded.is_basic, mcq=excluded.mcq, sort=excluded.sort;`);
  });
}

for (const item of seed.questions) {
  const subject = topicSubject[item.topic];
  if (!subject) throw new Error(`Topik tidak wujud: ${item.topic}`);
  if (item.options.length !== 4) throw new Error(`Mesti 4 pilihan: ${item.stem}`);
  const id = 'seed-' + createHash('sha1').update(item.stem).digest('hex').slice(0, 12);
  const [a, b, c, d] = item.options;
  out.push(`INSERT OR IGNORE INTO questions (id,subject,topic_id,level,stem,opt_a,opt_b,opt_c,opt_d,answer,explanation,origin,status) VALUES (${q(id)},${q(subject)},${q(item.topic)},${q(item.level)},${q(item.stem)},${q(a)},${q(b)},${q(c)},${q(d)},${q(item.answer)},${q(item.explanation)},'seed','pending');`);
}

console.log(out.join('\n'));
