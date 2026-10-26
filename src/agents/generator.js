// AGEN 2 — PENJANA (Gemini Pro)
// Menjana soalan objektif asli berdasarkan petikan sumber (grounding) dari Vectorize.
import { gemini, embed } from '../lib/llm.js';
import { LETTERS } from '../lib/util.js';

export const HOUSE_RULES = `
PEGANGAN: Akidah Ahli Sunnah wal Jamaah (aliran Asya'irah), fiqh mazhab Syafie, selaras dengan amalan JAKIM dan sukatan KAFA 2.0 di Malaysia.
BAHASA: Bahasa Melayu baku, ayat pendek dan jelas untuk murid Tahun 5 (10-11 tahun). Istilah agama ikut ejaan lazim buku teks KAFA (contoh: wuduk, solat, rakaat, s.a.w., a.s.).
TULISAN ARAB: Wajib berbaris penuh. JANGAN menulis teks ayat al-Quran atau hadis kecuali ia ada dalam petikan sumber yang diberi.
`;

const WRITER_RULES = `
${HOUSE_RULES}
PERATURAN ITEM:
1. Tepat satu jawapan betul yang tidak boleh dipertikaikan. Tiga distraktor mesti salah dengan jelas tetapi munasabah (dari kategori yang sama).
2. Jangan guna "semua di atas", "tiada di atas", "A dan B", atau ayat negatif berganda.
3. Panjang dan gaya keempat-empat pilihan hampir sama. Jangan beri petunjuk tatabahasa kepada jawapan.
4. Huraian (explanation) 1-2 ayat: kenapa jawapan betul, dan jika berguna, kenapa distraktor utama salah. JANGAN sebut huruf pilihan (A/B/C/D) dalam huraian.
5. Soalan mesti ASLI. Jangan salin atau olah rapat soalan peperiksaan sebenar.
6. Aras: ingat = fakta asas; faham = maksud/perbezaan/contoh; aplikasi = situasi harian murid (contoh: "Ali terlupa ...").
7. Kekal dalam skop topik dan petikan sumber. Jika maklumat tiada dalam sumber, guna hanya fakta asas yang disepakati dan sangat masyhur.
`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          level: { type: 'STRING', enum: ['ingat', 'faham', 'aplikasi'] },
          stem: { type: 'STRING' },
          options: { type: 'ARRAY', items: { type: 'STRING' } },
          answer: { type: 'STRING', enum: LETTERS },
          explanation: { type: 'STRING' },
          source_ref: { type: 'STRING' },
        },
        required: ['level', 'stem', 'options', 'answer', 'explanation'],
      },
    },
  },
  required: ['questions'],
};

// Ambil petikan sumber (buku teks/nota yang di-ingest) yang paling berkaitan dengan topik
export async function retrieveContext(env, topic) {
  try {
    const [vec] = await embed(env, [`${topic.title}`]);
    const res = await env.SVEC.query(vec, { topK: 5, returnMetadata: 'all' });
    return (res.matches || [])
      .filter((m) => m.score >= 0.45 && m.metadata?.subject === topic.subject)
      .map((m) => ({ text: m.metadata.text, ref: m.metadata.title || m.id, score: m.score }));
  } catch (e) {
    return [];
  }
}

export async function generateQuestions(env, plan, context) {
  const sourceBlock = context.length
    ? context.map((c, i) => `[S${i + 1}] (${c.ref})\n${c.text}`).join('\n\n')
    : 'TIADA SUMBER DIBERI. Hadkan kepada fakta asas yang sangat masyhur sahaja.';

  const prompt = `
Topik: ${plan.topic.title}
Mata pelajaran: ${plan.topic.subject}
Bilangan soalan: ${plan.count}
Aras bagi setiap soalan (ikut urutan): ${plan.levels.join(', ')}

PETIKAN SUMBER:
${sourceBlock}

SOALAN SEDIA ADA DALAM BANK (jangan ulang idea yang sama):
${plan.existingStems.slice(0, 25).map((s) => '- ' + s).join('\n') || '- (tiada)'}

PENGAJARAN DARIPADA SEMAKAN USTAZ (elakkan kesilapan ini):
${plan.lessons.map((s) => '- ' + s).join('\n') || '- (tiada)'}

Hasilkan tepat ${plan.count} soalan objektif dengan 4 pilihan setiap satu. Isi source_ref dengan [S1]/[S2]... jika berdasarkan petikan, atau "asas" jika fakta asas.`;

  const out = await gemini(env, { system: 'Anda ialah panel penggubal soalan UPKK berpengalaman.\n' + WRITER_RULES, prompt, schema: SCHEMA, temperature: 0.8 });
  const list = Array.isArray(out?.questions) ? out.questions : [];
  return list.slice(0, plan.count).map((q, i) => ({
    topic_id: plan.topic.id,
    subject: plan.topic.subject,
    level: q.level || plan.levels[i] || 'faham',
    stem: String(q.stem || '').trim(),
    options: (q.options || []).map((o) => String(o).trim()),
    answer: String(q.answer || '').toUpperCase(),
    explanation: String(q.explanation || '').trim(),
    source_ref: mapRef(q.source_ref, context),
    target: plan.targets[i] || 'A',
  }));
}

function mapRef(ref, context) {
  const m = String(ref || '').match(/S(\d+)/);
  if (m && context[+m[1] - 1]) return context[+m[1] - 1].ref;
  return ref || 'asas';
}
