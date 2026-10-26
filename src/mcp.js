// Pelayan MCP (Streamable HTTP, JSON sahaja) — membolehkan Claude, Hermes Agent atau agen lain
// mengurus bank soalan: lihat liputan, cari soalan, cetus penjanaan, hantar soalan untuk QA.
// Kelulusan LIVE kekal di tangan manusia kecuali MCP_CAN_APPROVE=true.
import { json, uid, LETTERS } from './lib/util.js';

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26'];

const TOOLS = [
  {
    name: 'list_topics',
    description: 'Senarai topik silibus UPKK (KAFA 2.0) dengan bilangan soalan approved/pending setiap topik.',
    inputSchema: { type: 'object', properties: { subject: { type: 'string', description: 'akidah|ibadah|sirah|adab|jawi|arab|quran' } } },
  },
  { name: 'bank_stats', description: 'Statistik bank soalan dan taburan jawapan A/B/C/D.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'weak_topics',
    description: 'Topik di mana pelajar paling banyak salah (sasaran utama untuk soalan tambahan & nota).',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'search_questions',
    description: 'Cari soalan dalam bank mengikut subjek, topik, status atau kata kunci.',
    inputSchema: {
      type: 'object',
      properties: { subject: { type: 'string' }, topic_id: { type: 'string' }, status: { type: 'string', enum: ['approved', 'pending', 'rejected'] }, q: { type: 'string' }, limit: { type: 'number' } },
    },
  },
  { name: 'get_question', description: 'Butiran penuh satu soalan termasuk laporan QA semua agen.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  {
    name: 'generate_questions',
    description: 'Cetus pipeline multi-agent untuk menjana dan menyemak soalan baru (masuk barisan semakan ustaz).',
    inputSchema: { type: 'object', properties: { subject: { type: 'string' }, topic_id: { type: 'string' }, count: { type: 'number', description: '1-10' } } },
  },
  {
    name: 'submit_question',
    description: 'Hantar satu soalan objektif (contoh: digubal oleh Hermes Agent) untuk melalui semua agen QA.',
    inputSchema: {
      type: 'object',
      properties: {
        topic_id: { type: 'string' },
        level: { type: 'string', enum: ['ingat', 'faham', 'aplikasi'] },
        stem: { type: 'string' },
        options: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
        answer: { type: 'string', enum: LETTERS },
        explanation: { type: 'string' },
        source_ref: { type: 'string' },
      },
      required: ['topic_id', 'stem', 'options', 'answer', 'explanation'],
    },
  },
  { name: 'batch_status', description: 'Status satu kelompok penjanaan.', inputSchema: { type: 'object', properties: { batch_id: { type: 'string' } }, required: ['batch_id'] } },
  {
    name: 'review_question',
    description: 'Tolak soalan dengan catatan (menjadi pengajaran kepada penjana). Lulus hanya jika pelayan membenarkan MCP_CAN_APPROVE.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, action: { type: 'string', enum: ['approve', 'reject'] }, note: { type: 'string' } }, required: ['id', 'action'] },
  },
];

export async function handleMcp(request, env) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
  let msg;
  try {
    msg = await request.json();
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 400);
  }
  if (Array.isArray(msg)) {
    const out = (await Promise.all(msg.map((m) => dispatch(env, m)))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const res = await dispatch(env, msg);
  return res ? json(res) : new Response(null, { status: 202 });
}

async function dispatch(env, m) {
  if (!m || m.jsonrpc !== '2.0') return rpcError(m?.id ?? null, -32600, 'Invalid Request');
  if (m.id === undefined || m.id === null) return null; // notifikasi
  try {
    switch (m.method) {
      case 'initialize': {
        const v = SUPPORTED.includes(m.params?.protocolVersion) ? m.params.protocolVersion : SUPPORTED[1];
        return ok(m.id, {
          protocolVersion: v,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'upkk-bank', version: '1.0.0' },
          instructions: 'Bank soalan UPKK. Gunakan weak_topics/list_topics untuk cari jurang, generate_questions atau submit_question untuk menambah. Semua soalan baru menunggu kelulusan ustaz.',
        });
      }
      case 'ping':
        return ok(m.id, {});
      case 'tools/list':
        return ok(m.id, { tools: TOOLS });
      case 'tools/call': {
        const data = await callTool(env, m.params?.name, m.params?.arguments || {});
        return ok(m.id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      }
      default:
        return rpcError(m.id, -32601, 'Method not found');
    }
  } catch (e) {
    return ok(m.id, { content: [{ type: 'text', text: String(e.message || e) }], isError: true });
  }
}

async function callTool(env, name, a) {
  const DB = env.DB;
  switch (name) {
    case 'list_topics': {
      const rows = await DB.prepare(
        `SELECT t.id, t.subject, t.title, t.is_basic, t.verified,
          (SELECT COUNT(*) FROM questions q WHERE q.topic_id=t.id AND q.status='approved') approved,
          (SELECT COUNT(*) FROM questions q WHERE q.topic_id=t.id AND q.status='pending') pending
         FROM topics t WHERE t.mcq=1 ${a.subject ? 'AND t.subject=?' : ''} ORDER BY t.subject, t.sort`
      ).bind(...(a.subject ? [a.subject] : [])).all();
      return rows.results;
    }
    case 'bank_stats': {
      const s = await DB.prepare("SELECT subject, SUM(status='approved') approved, SUM(status='pending') pending, SUM(status='rejected') rejected FROM questions GROUP BY subject").all();
      const d = await DB.prepare("SELECT answer, COUNT(*) n FROM questions WHERE status='approved' GROUP BY answer").all();
      return { by_subject: s.results, answer_distribution: d.results };
    }
    case 'weak_topics': {
      const rows = await DB.prepare(
        `SELECT a.topic_id, t.title, t.subject, COUNT(*) attempts, ROUND(AVG(a.is_correct)*100) accuracy
         FROM attempts a JOIN topics t ON t.id=a.topic_id GROUP BY a.topic_id HAVING attempts>=20 ORDER BY accuracy ASC LIMIT ?`
      ).bind(Math.min(a.limit || 10, 50)).all();
      return rows.results;
    }
    case 'search_questions': {
      const where = [];
      const binds = [];
      for (const k of ['subject', 'topic_id', 'status']) if (a[k]) where.push(`${k}=?`) && binds.push(a[k]);
      if (a.q) where.push('stem LIKE ?') && binds.push(`%${a.q}%`);
      const rows = await DB.prepare(
        `SELECT id, subject, topic_id, level, status, stem, opt_a, opt_b, opt_c, opt_d, answer, qa_score FROM questions
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`
      ).bind(...binds, Math.min(a.limit || 20, 100)).all();
      return rows.results;
    }
    case 'get_question': {
      const q = await DB.prepare('SELECT * FROM questions WHERE id=?').bind(a.id).first();
      if (!q) throw new Error('Soalan tidak dijumpai');
      return { ...q, qa_report: q.qa_report ? JSON.parse(q.qa_report) : null };
    }
    case 'generate_questions': {
      const batchId = uid('b-');
      await env.GENERATOR.create({ id: batchId, params: { batchId, subject: a.subject || null, topic_id: a.topic_id || null, count: Math.min(Number(a.count) || 5, 10), origin: 'mcp' } });
      return { batch_id: batchId, note: 'Semak status dengan batch_status. Soalan yang lulus QA masuk barisan semakan ustaz.' };
    }
    case 'submit_question': {
      const t = await DB.prepare('SELECT id, subject FROM topics WHERE id=?').bind(a.topic_id).first();
      if (!t) throw new Error('topic_id tidak wujud');
      if (!Array.isArray(a.options) || a.options.length !== 4) throw new Error('options mesti 4');
      const batchId = uid('b-');
      const question = { topic_id: t.id, subject: t.subject, level: a.level || 'faham', stem: a.stem, options: a.options, answer: String(a.answer).toUpperCase(), explanation: a.explanation, source_ref: a.source_ref || 'mcp' };
      await env.GENERATOR.create({ id: batchId, params: { batchId, mode: 'single', question, origin: 'mcp' } });
      return { batch_id: batchId, note: 'Soalan sedang melalui agen QA.' };
    }
    case 'batch_status': {
      const b = await DB.prepare('SELECT * FROM batches WHERE id=?').bind(a.batch_id).first();
      if (!b) return { status: 'queued_or_unknown' };
      return { ...b, log: b.log ? JSON.parse(b.log) : [] };
    }
    case 'review_question': {
      if (a.action === 'approve' && env.MCP_CAN_APPROVE !== 'true') throw new Error('Kelulusan LIVE memerlukan ustaz (MCP_CAN_APPROVE dimatikan).');
      const status = a.action === 'approve' ? 'approved' : 'rejected';
      const r = await DB.prepare("UPDATE questions SET status=?, review_note=?, reviewer='mcp-agent', reviewed_at=datetime('now') WHERE id=?").bind(status, String(a.note || '').slice(0, 300), a.id).run();
      return { updated: r.meta?.changes || 0, status };
    }
  }
  throw new Error(`Alat tidak dikenali: ${name}`);
}

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
