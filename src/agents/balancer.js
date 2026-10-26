// AGEN 9 — PENGIMBANG
// Susun semula pilihan supaya jawapan betul jatuh pada huruf sasaran.
// Ini memastikan taburan A/B/C/D sekata dalam bank (model AI suka meletak jawapan di B/C).
import { LETTERS, shuffle } from '../lib/util.js';

// Pilihan yang mesti kekal berurutan (nombor, susunan masa) tidak dikocok rawak
const ORDERED = /^(satu|dua|tiga|empat|lima|enam|tujuh|lapan|sembilan|sepuluh|\d+)\b/i;

export function balanceOptions(q, target) {
  const correctIdx = LETTERS.indexOf(q.answer);
  if (correctIdx < 0 || !LETTERS.includes(target)) return q;
  const correct = q.options[correctIdx];
  const distractors = q.options.filter((_, i) => i !== correctIdx);

  if (q.options.every((o) => ORDERED.test(o.trim()))) return q; // biar urutan nombor kekal

  const shuffled = shuffle(distractors);
  const t = LETTERS.indexOf(target);
  const options = [...shuffled.slice(0, t), correct, ...shuffled.slice(t)];
  return { ...q, options, answer: target };
}
