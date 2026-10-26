// AGEN 4, 5, 6 — PENYEMAK (Gemini, setiap satu dengan peranan dan konteks berasingan)
//  4. Penyemak Bahasa, Jawi & Arab — membetulkan ejaan/baris, tidak mengubah makna
//  5. Penyemak Syariah — ketepatan akidah/fiqh/sirah, pegangan ASWJ & Syafie
//  6. Pengkritik Item — kualiti distraktor, kejelasan, satu jawapan betul, kesesuaian umur
import { gemini } from '../lib/llm.js';
import { HOUSE_RULES } from './generator.js';
import { LETTERS } from '../lib/util.js';

const fmt = (q) =>
  `SOALAN: ${q.stem}\n${q.options.map((o, i) => `${LETTERS[i]}. ${o}`).join('\n')}\nSKEMA: ${q.answer}\nHURAIAN: ${q.explanation}`;

export async function languageReview(env, q) {
  const schema = {
    type: 'OBJECT',
    properties: {
      ok: { type: 'BOOLEAN' },
      issues: { type: 'ARRAY', items: { type: 'STRING' } },
      fixed_stem: { type: 'STRING' },
      fixed_options: { type: 'ARRAY', items: { type: 'STRING' } },
      fixed_explanation: { type: 'STRING' },
    },
    required: ['ok', 'issues', 'fixed_stem', 'fixed_options', 'fixed_explanation'],
  };
  const out = await gemini(env, {
    system: `Anda editor bahasa buku teks KAFA. ${HOUSE_RULES}
Tugas: semak ejaan Bahasa Melayu baku, ejaan Jawi (Pedoman Umum Ejaan Jawi DBP) dan baris tulisan Arab.
Betulkan HANYA kesilapan bahasa/ejaan/baris. JANGAN ubah makna, fakta, susunan pilihan atau skema.
Jika tiada kesilapan, pulangkan teks asal tanpa perubahan dan ok=true.`,
    prompt: fmt(q),
    schema,
    temperature: 0,
  });
  const fixedOk = Array.isArray(out.fixed_options) && out.fixed_options.length === 4;
  return {
    ok: !!out.ok,
    issues: out.issues || [],
    fixed: fixedOk
      ? { stem: out.fixed_stem || q.stem, options: out.fixed_options, explanation: out.fixed_explanation || q.explanation }
      : null,
  };
}

export async function syariahReview(env, q, context) {
  const schema = {
    type: 'OBJECT',
    properties: {
      accurate: { type: 'BOOLEAN' },
      severity: { type: 'STRING', enum: ['tiada', 'rendah', 'tinggi'] },
      key_is_correct: { type: 'BOOLEAN' },
      other_option_also_correct: { type: 'BOOLEAN' },
      khilaf_risk: { type: 'BOOLEAN' },
      issues: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['accurate', 'severity', 'key_is_correct', 'other_option_also_correct', 'khilaf_risk', 'issues'],
  };
  return gemini(env, {
    system: `Anda ustaz penyemak kandungan Pendidikan Islam peringkat rendah (KAFA/SRA). ${HOUSE_RULES}
Semak ketepatan fakta akidah, fiqh, sirah, adab dan bahasa Arab dalam soalan.
- key_is_correct: adakah skema jawapan benar-benar betul?
- other_option_also_correct: adakah ada distraktor yang juga boleh dianggap betul?
- khilaf_risk: adakah soalan menyentuh perkara khilafiyah yang tidak sesuai untuk murid?
- severity tinggi = kesilapan fakta agama, nas tidak tepat, atau boleh mengelirukan akidah.
Jika ragu, nyatakan dalam issues. Jangan anggap — semak setiap pilihan satu demi satu.`,
    prompt: `${fmt(q)}\n\nRUJUKAN SUMBER:\n${context.map((c) => c.text).join('\n---\n') || '(tiada)'}`,
    schema,
    temperature: 0,
  });
}

export async function itemCritique(env, q) {
  const schema = {
    type: 'OBJECT',
    properties: {
      distractor_quality: { type: 'INTEGER' },
      clarity: { type: 'INTEGER' },
      age_appropriate: { type: 'BOOLEAN' },
      cue_to_answer: { type: 'BOOLEAN' },
      level_match: { type: 'BOOLEAN' },
      issues: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['distractor_quality', 'clarity', 'age_appropriate', 'cue_to_answer', 'level_match', 'issues'],
  };
  return gemini(env, {
    system: `Anda pakar pentaksiran (psikometrik) yang menilai item objektif untuk murid Tahun 5.
Beri skor 1-5:
- distractor_quality: 5 = semua distraktor munasabah dan menguji salah faham sebenar; 1 = distraktor mengarut/jelas salah.
- clarity: 5 = soalan jelas, satu tafsiran sahaja.
cue_to_answer = true jika ada petunjuk (panjang, tatabahasa, perkataan berulang dari soalan).
level_match = true jika soalan sepadan dengan aras "${q.level}" (ingat/faham/aplikasi).`,
    prompt: fmt(q),
    schema,
    temperature: 0,
  });
}
