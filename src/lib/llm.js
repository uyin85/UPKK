// Klien model: Gemini (penjana & penyemak), Hermes di Modal (penyelesai buta), Workers AI (embedding)

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const FALLBACK_MODEL = 'gemini-flash-latest';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Gemini dengan pengendalian kuota:
//  - 429 kerana had per minit → tunggu (ikut retryDelay Google) dan cuba semula
//  - model ditolak (kuota 0 / tiada akses) → beralih ke GEMINI_FALLBACK_MODEL (lalai Flash)
export async function gemini(env, { system, prompt, schema, temperature = 0.4, model }) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY belum ditetapkan');
  const primary = model || env.GEMINI_MODEL || FALLBACK_MODEL;
  const fallback = env.GEMINI_FALLBACK_MODEL || FALLBACK_MODEL;
  const chain = primary === fallback ? [primary] : [primary, fallback];
  const body = JSON.stringify({
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      ...(schema ? { responseSchema: schema } : {}),
    },
  });

  let lastErr;
  for (const m of chain) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${GEMINI_BASE}/${m}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body,
      });
      if (res.ok) {
        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
        return parseJsonLoose(text);
      }
      const errText = await res.text();
      lastErr = new Error(`Gemini ${res.status} (${m}): ${errText.slice(0, 300)}`);
      if (res.status === 429 || res.status === 503) {
        // Kuota harian / tiada kuota untuk model ini → terus ke model sandaran
        if (/PerDay|limit: 0|free_tier_requests.*limit: 0/i.test(errText)) break;
        const delay = Number((errText.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/) || [])[1] || 15);
        await sleep(Math.min(delay, 45) * 1000 + 500);
        continue;
      }
      if (res.status === 404 || res.status === 403) break; // model tiada / tiada akses → cuba sandaran
      throw lastErr; // 400 dsb: ralat permintaan, jangan ulang
    }
  }
  throw lastErr;
}

// Hermes 4 (Nous Research) dihoskan di Modal melalui vLLM — API serasi OpenAI
export async function hermes(env, { system, prompt, temperature = 0 }) {
  if (!env.HERMES_URL) return null; // pilihan: pipeline tetap berjalan tanpa Hermes
  const res = await fetch(`${env.HERMES_URL.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.HERMES_API_KEY || ''}` },
    body: JSON.stringify({
      model: env.HERMES_MODEL || 'hermes',
      temperature,
      max_tokens: 600,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Hermes ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || '';
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export async function embed(env, texts) {
  const res = await env.AI.run('@cf/baai/bge-m3', { text: texts });
  const vectors = res?.data || res?.response;
  if (!Array.isArray(vectors)) throw new Error('Embedding gagal');
  return vectors;
}

export function parseJsonLoose(text) {
  if (!text) throw new Error('Respons model kosong');
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/[\[{][\s\S]*[\]}]/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Respons model bukan JSON: ' + text.slice(0, 200));
  }
}
