// Klien model: Gemini (penjana & penyemak), Hermes di Modal (penyelesai buta), Workers AI (embedding)

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const DEFAULT_CHAIN = 'gemini-flash-latest,gemini-flash-lite-latest';
const DEFAULT_WORKERS_AI = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Rantai model (lapisan sandaran). Ditetapkan melalui GEMINI_MODELS dalam wrangler.toml:
//   1..n  Model Gemini ikut urutan (contoh: pro → flash → flash-lite)
//   akhir Workers AI (Llama 3.3 70B) — tidak bergantung pada kuota Google
// Peraturan setiap model:
//   429 had per minit  → tunggu ikut retryDelay Google, cuba semula (maks 3 kali)
//   429 had harian / kuota 0, 403, 404, 5xx berterusan → terus ke model seterusnya
//   400 (permintaan rosak) → berhenti, kerana model lain akan gagal sama
export function modelChain(env, preferred) {
  const list = (env.GEMINI_MODELS || [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter(Boolean).join(',') || DEFAULT_CHAIN)
    .split(',').map((s) => s.trim()).filter(Boolean);
  const chain = preferred ? [preferred, ...list.filter((m) => m !== preferred)] : list;
  if (env.WORKERS_AI_FALLBACK !== 'false' && env.AI) chain.push('workers-ai:' + (env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI));
  return chain;
}

export async function gemini(env, { system, prompt, schema, temperature = 0.4, model }) {
  const chain = modelChain(env, model);
  const body = JSON.stringify({
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      ...(schema ? { responseSchema: schema } : {}),
    },
  });

  const errors = [];
  for (const m of chain) {
    if (m.startsWith('workers-ai:')) {
      try {
        return await workersAiJson(env, m.slice(11), { system, prompt, schema, temperature });
      } catch (e) {
        errors.push(`${m}: ${String(e.message || e).slice(0, 150)}`);
        continue;
      }
    }
    if (!env.GEMINI_API_KEY) { errors.push(`${m}: GEMINI_API_KEY belum ditetapkan`); continue; }
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
      const err = `${m} ${res.status}: ${errText.replace(/\s+/g, ' ').slice(0, 150)}`;
      if (res.status === 429 || res.status >= 500) {
        if (/PerDay|per day|limit: 0/i.test(errText) || attempt === 2) { errors.push(err); break; }
        const delay = Number((errText.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/) || [])[1] || 15);
        await sleep(Math.min(delay, 45) * 1000 + 500);
        continue;
      }
      if (res.status === 403 || res.status === 404) { errors.push(err); break; }
      throw new Error('Gemini ' + err);
    }
  }
  throw new Error('Semua model gagal → ' + errors.join(' | '));
}

// Lapisan terakhir: Workers AI (binding AI Cloudflare), mod JSON
async function workersAiJson(env, model, { system, prompt, schema, temperature }) {
  const res = await env.AI.run(model, {
    messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
    temperature,
    max_tokens: 4096,
    ...(schema ? { response_format: { type: 'json_schema', json_schema: toJsonSchema(schema) } } : {}),
  });
  const out = res?.response ?? res;
  return typeof out === 'string' ? parseJsonLoose(out) : out;
}

// Skema Gemini guna jenis huruf besar (OBJECT/STRING); JSON Schema standard guna huruf kecil
function toJsonSchema(s) {
  if (Array.isArray(s)) return s.map(toJsonSchema);
  if (!s || typeof s !== 'object') return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) o[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : toJsonSchema(v);
  return o;
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
