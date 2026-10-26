// Masukkan bahan sumber ke dalam "otak" penjana:
//  kind=textbook|notes → dipecah, di-embed, disimpan dalam SVEC (grounding untuk penjana & penyemak)
//  kind=pastpaper      → setiap item disimpan dalam QVEC dengan id "pp:" (penanda keaslian sahaja,
//                        TIDAK digunakan sebagai bahan untuk dijana semula)
import { embed } from './lib/llm.js';
import { uid } from './lib/util.js';

export async function ingestSource(env, { subject, topic_id = null, kind = 'notes', title = 'Tanpa tajuk', text }) {
  if (!subject || !text || text.length < 50) throw new Error('subject dan text (>=50 aksara) diperlukan');
  const id = uid('src-');
  const key = `sources/${subject}/${id}.txt`;
  await env.BUCKET.put(key, text, { customMetadata: { subject, kind, title } });

  const pieces = kind === 'pastpaper' ? splitItems(text) : chunk(text, 700, 120);
  let stored = 0;
  for (let i = 0; i < pieces.length; i += 20) {
    const group = pieces.slice(i, i + 20);
    const vectors = await embed(env, group);
    if (kind === 'pastpaper') {
      await env.QVEC.upsert(vectors.map((v, j) => ({ id: `pp:${id}:${i + j}`, values: v, metadata: { subject, title } })));
    } else {
      await env.SVEC.upsert(
        vectors.map((v, j) => ({ id: `${id}:${i + j}`, values: v, metadata: { subject, topic: topic_id || '', title, text: group[j] } }))
      );
    }
    stored += group.length;
  }
  await env.DB.prepare('INSERT INTO sources (id,subject,topic_id,kind,title,r2_key,chunks) VALUES (?,?,?,?,?,?,?)')
    .bind(id, subject, topic_id, kind, title, key, stored)
    .run();
  return { id, chunks: stored };
}

function chunk(text, size, overlap) {
  const clean = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const paras = clean.split(/\n\n+/);
  const out = [];
  let buf = '';
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > size && buf) {
      out.push(buf.trim());
      buf = buf.slice(-overlap) + '\n\n' + p;
    } else {
      buf = buf ? buf + '\n\n' + p : p;
    }
    while (buf.length > size * 1.5) {
      out.push(buf.slice(0, size).trim());
      buf = buf.slice(size - overlap);
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// Pecah kertas soalan mengikut nombor soalan: "1.", "2)", dll.
function splitItems(text) {
  const parts = text.replace(/\r/g, '').split(/\n\s*(?=\d{1,2}\s*[\.\)]\s)/);
  return parts.map((p) => p.trim()).filter((p) => p.length > 15);
}
