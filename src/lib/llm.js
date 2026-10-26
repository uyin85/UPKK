// Klien model: Gemini (penjana & penyemak), Hermes di Modal (penyelesai buta), Workers AI (embedding)

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export async function gemini(env, { system, prompt, schema, temperature = 0.4, model }) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY belum ditetapkan');
  const m = model || env.GEMINI_MODEL || 'gemini-pro-latest';
  const body = {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      ...(schema ? { responseSchema: schema } : {}),
    },
  };
  const res = await fetch(`${GEMINI_BASE}/${m}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  return parseJsonLoose(text);
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
