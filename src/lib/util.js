export const LETTERS = ['A', 'B', 'C', 'D'];

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function fail(message, status = 400, extra = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function uid(prefix = '') {
  return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export function bearer(request) {
  const h = request.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

// Perbandingan rentetan masa-tetap untuk token
export function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function weightedSample(items, weightFn, n) {
  const pool = items.map((it) => ({ it, w: Math.max(0, weightFn(it)) })).filter((x) => x.w > 0);
  const picked = [];
  while (picked.length < n && pool.length) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= pool[idx].w;
      if (r <= 0) break;
    }
    idx = Math.min(idx, pool.length - 1);
    picked.push(pool[idx].it);
    pool.splice(idx, 1);
  }
  return picked;
}

export function questionOptions(q) {
  return [q.opt_a, q.opt_b, q.opt_c, q.opt_d];
}

// Soalan tanpa skema jawapan (untuk dihantar ke pelajar)
export function publicQuestion(q) {
  return {
    id: q.id,
    subject: q.subject,
    topic_id: q.topic_id,
    level: q.level,
    stem: q.stem,
    options: questionOptions(q),
  };
}

export function bandFor(ratio, bands) {
  if (ratio >= bands.A) return 'A';
  if (ratio >= bands.B) return 'B';
  if (ratio >= bands.C) return 'C';
  if (ratio >= bands.D) return 'D';
  return 'E';
}

// Permulaan hari ini waktu Malaysia (UTC+8), dalam format datetime UTC SQLite
export const TODAY_MYT_SQL = "datetime('now','+8 hours','start of day','-8 hours')";
