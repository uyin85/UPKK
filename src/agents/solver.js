// AGEN 7 — PENYELESAI BUTA (Gemini + Hermes)
// Dua model menjawab soalan TANPA melihat skema. Jika mereka tidak bersetuju dengan skema,
// kemungkinan besar soalan kabur, ada dua jawapan betul, atau skema salah.
import { gemini, hermes } from '../lib/llm.js';
import { LETTERS } from '../lib/util.js';

const SYSTEM = `Anda murid cemerlang KAFA Tahun 5 yang juga dibimbing ustaz (pegangan Ahli Sunnah wal Jamaah, mazhab Syafie).
Jawab soalan objektif. Pilih SATU huruf. Jika lebih daripada satu pilihan betul atau tiada yang betul, jawab "X".`;

const ask = (q) =>
  `${q.stem}\n${q.options.map((o, i) => `${LETTERS[i]}. ${o}`).join('\n')}\n\nBalas dalam JSON: {"answer":"A|B|C|D|X","confidence":0.0-1.0,"note":"ringkas"}`;

export async function solveWithGemini(env, q) {
  const out = await gemini(env, {
    system: SYSTEM,
    prompt: ask(q),
    temperature: 0,
    model: env.GEMINI_SOLVER_MODEL || undefined,
    schema: {
      type: 'OBJECT',
      properties: {
        answer: { type: 'STRING', enum: [...LETTERS, 'X'] },
        confidence: { type: 'NUMBER' },
        note: { type: 'STRING' },
      },
      required: ['answer', 'confidence'],
    },
  });
  return { model: 'gemini', answer: String(out.answer || 'X').toUpperCase(), confidence: Number(out.confidence) || 0, note: out.note || '' };
}

export async function solveWithHermes(env, q) {
  try {
    const text = await hermes(env, { system: SYSTEM, prompt: ask(q) });
    if (text === null) return { model: 'hermes', answer: null, skipped: true };
    let answer = 'X';
    let confidence = 0;
    try {
      const j = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
      answer = String(j.answer || 'X').toUpperCase();
      confidence = Number(j.confidence) || 0;
    } catch {
      answer = (text.match(/\b([ABCDX])\b/) || [])[1] || 'X';
    }
    return { model: 'hermes', answer, confidence, note: text.slice(0, 200) };
  } catch (e) {
    // Modal mungkin sedang "cold start" — jangan gagalkan pipeline
    return { model: 'hermes', answer: null, skipped: true, error: String(e.message || e).slice(0, 200) };
  }
}
