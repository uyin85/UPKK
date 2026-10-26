// AGEN 3 — PEMERIKSA STRUKTUR (tanpa AI, pantas dan tegas)
import { LETTERS } from '../lib/util.js';

const BANNED = [/semua di atas/i, /tiada di atas/i, /semua jawapan/i, /\b[ABCD] dan [ABCD]\b/];

export function checkStructure(q) {
  const issues = [];
  if (!q.stem || q.stem.length < 8) issues.push('Soalan terlalu pendek');
  if (q.stem && q.stem.length > 400) issues.push('Soalan terlalu panjang untuk murid Tahun 5');
  if (!Array.isArray(q.options) || q.options.length !== 4) issues.push('Mesti tepat 4 pilihan');
  if (!LETTERS.includes(q.answer)) issues.push('Jawapan mesti A, B, C atau D');

  const opts = (q.options || []).map((o) => o.trim());
  if (opts.some((o) => !o)) issues.push('Ada pilihan kosong');
  const norm = opts.map((o) => o.toLowerCase().replace(/\s+/g, ' '));
  if (new Set(norm).size !== norm.length) issues.push('Ada pilihan berulang');
  if (opts.some((o) => BANNED.some((re) => re.test(o)))) issues.push('Guna pilihan terlarang (semua/tiada di atas)');

  // Petunjuk panjang: jawapan betul jauh lebih panjang daripada distraktor
  if (opts.length === 4 && LETTERS.includes(q.answer)) {
    const lens = opts.map((o) => o.length);
    const ans = lens[LETTERS.indexOf(q.answer)];
    const others = lens.filter((_, i) => i !== LETTERS.indexOf(q.answer));
    const avg = others.reduce((s, x) => s + x, 0) / others.length;
    if (avg > 0 && ans > avg * 1.8 && ans - avg > 15) issues.push('Jawapan betul jauh lebih panjang (petunjuk)');
  }
  if (/\b(pilihan|jawapan) [ABCD]\b/i.test(q.explanation || '')) issues.push('Huraian menyebut huruf pilihan');
  if (!q.explanation || q.explanation.length < 10) issues.push('Huraian tiada/terlalu pendek');

  const hard = issues.filter((i) => !i.startsWith('Huraian menyebut') && !i.startsWith('Jawapan betul jauh'));
  return { ok: hard.length === 0, issues };
}
