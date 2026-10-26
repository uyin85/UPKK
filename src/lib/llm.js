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

// Model yang kuota hariannya habis diingat (per isolate) supaya panggilan seterusnya tidak membazir
const exhausted = new Map(); // model -> masa tamat (ms)
const isExhausted = (m) => (exhausted.get(m) || 0) > Date.now();

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
  // Pusingan 1: cuba setiap model sekali, langkau terus bila kena had.
  // Pusingan 2 (jika semua kena had per minit sahaja): tunggu retryDelay terpendek, cuba lagi.
  for (let round = 0; round < 2; round++) {
    let minDelay = Infinity;
    for (const m of chain) {
      if (m.startsWith('workers-ai:')) {
        // Utamakan Gemini: jika ada model Gemini yang cuma kena had per minit, tunggu dulu sebelum guna Llama
        if (round === 0 && minDelay !== Infinity) continue;
        try {
          return await workersAiJson(env, m.slice(11), { system, prompt, schema, temperature });
        } catch (e) {
          errors.push(`${m}: ${String(e.message || e).slice(0, 120)}`);
          continue;
        }
      }
      if (!env.GEMINI_API_KEY) { errors.push(`${m}: GEMINI_API_KEY belum ditetapkan`); continue; }
      if (isExhausted(m)) continue;

      const res = await fetch(`${GEMINI_BASE}/${m}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body,
      });
      if (res.ok) {
        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
        if (text) return parseJsonLoose(text);
        errors.push(`${m}: respons kosong (${data?.candidates?.[0]?.finishReason || 'tiada calon'})`);
        continue;
      }
      const errText = await res.text();
      errors.push(`${m} ${res.status}: ${errText.replace(/\s+/g, ' ').slice(0, 120)}`);
      if (res.status === 429 && /PerDay|per day|limit: 0/i.test(errText)) {
        exhausted.set(m, Date.now() + 60 * 60 * 1000); // langkau model ini selama 1 jam
      } else if (res.status === 429 || res.status >= 500) {
        const d = Number((errText.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/) || [])[1] || 15);
        minDelay = Math.min(minDelay, d);
      } else if (res.status === 404 || res.status === 403) {
        exhausted.set(m, Date.now() + 6 * 60 * 60 * 1000); // model tiada / tiada akses
      } else {
        throw new Error('Gemini ' + errors.at(-1)); // 400: permintaan rosak
      }
    }
    if (round === 0 && minDelay !== Infinity) await sleep(Math.min(minDelay, 45) * 1000 + 500);
    else break;
  }
  throw new Error('Semua model gagal → ' + errors.slice(-10).join(' | '));
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
