// Orkestra multi-agent (Cloudflare Workflows): setiap langkah tahan lasak & dicuba semula sendiri.
// Mod:
//  - generate : Perancang → Penjana → QA setiap soalan → barisan semakan ustaz
//  - single   : QA satu soalan yang dihantar manual / melalui MCP
//  - jadual (cron) : sentinel kualiti + jana untuk topik paling memerlukan
import { WorkflowEntrypoint } from 'cloudflare:workers';
import { planBatch } from './agents/planner.js';
import { retrieveContext, generateQuestions } from './agents/generator.js';
import { qaOne, saveQuestion } from './agents/pipeline.js';

const RETRY = { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }, timeout: '1 minute' };
// Panggilan model: cuba semula sekali sahaja supaya ralat (kunci API/model salah) cepat dipaparkan di panel
const LLM_RETRY = { retries: { limit: 1, delay: '10 seconds', backoff: 'constant' }, timeout: '4 minutes' };

export class GenerateWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const env = this.env;
    const scheduled = !!event.schedule;
    const p = event.payload || {};
    const batchId = p.batchId || event.instanceId;

    if (scheduled) {
      await step.do('sentinel', RETRY, () => qualitySentinel(env));
    }

    const mode = p.mode || 'generate';
    const count = Number(p.count || (scheduled ? env.DAILY_GEN_COUNT || 8 : 5));

    await step.do('batch-open', RETRY, async () => {
      await env.DB.prepare('INSERT OR IGNORE INTO batches (id,subject,topic_id,requested,status) VALUES (?,?,?,?,?)')
        .bind(batchId, p.subject || null, p.topic_id || null, mode === 'single' ? 1 : count, 'running')
        .run();
      return true;
    });

    let drafts = [];
    let context = [];
    let log = [];

    if (mode === 'single') {
      const q = p.question;
      drafts = [{ ...q, target: q.answer, source_ref: q.source_ref || 'manual' }];
      const topic = await step.do('topic', RETRY, () => env.DB.prepare('SELECT * FROM topics WHERE id=?').bind(q.topic_id).first());
      if (!topic) return this.close(step, batchId, { error: 'Topik tidak wujud' });
      context = await step.do('retrieve', RETRY, () => retrieveContext(env, topic));
    } else {
      try {
        const plan = await step.do('plan', RETRY, () => planBatch(env, { subject: p.subject, topicId: p.topic_id, count }));
        log.push(`Topik: ${plan.topic.id} ${plan.topic.title}`);
        await step.do('batch-topic', RETRY, () =>
          env.DB.prepare('UPDATE batches SET subject=?, topic_id=?, log=? WHERE id=?').bind(plan.topic.subject, plan.topic.id, JSON.stringify([...log, 'Menjana soalan…']), batchId).run().then(() => true)
        );
        context = await step.do('retrieve', RETRY, () => retrieveContext(env, plan.topic));
        log.push(`Sumber: ${context.length} petikan`);
        drafts = await step.do('generate', LLM_RETRY, () => generateQuestions(env, plan, context));
        log.push(`Draf: ${drafts.length}`);
        await step.do('batch-progress', RETRY, () =>
          env.DB.prepare('UPDATE batches SET generated=?, log=? WHERE id=?').bind(drafts.length, JSON.stringify([...log, 'Semakan QA…']), batchId).run().then(() => true)
        );
      } catch (e) {
        return this.close(step, batchId, { log, error: 'Gagal: ' + String(e?.message || e).slice(0, 400) });
      }
    }

    let passed = 0;
    let rejected = 0;
    for (let i = 0; i < drafts.length; i++) {
      let r;
      try {
        r = await step.do(`qa-${i}`, LLM_RETRY, async () => {
          const result = await qaOne(env, drafts[i], context);
          if (result.decision !== 'save') return { saved: false, reasons: result.report.reasons, stem: drafts[i].stem.slice(0, 80) };
          const id = await saveQuestion(env, result, { batchId, origin: p.origin || (mode === 'single' ? 'manual' : 'agent'), stream: p.stream || 'KAFA' });
          return { saved: true, id, score: result.score };
        });
      } catch (e) {
        r = { saved: false, reasons: ['Ralat QA: ' + String(e?.message || e).slice(0, 200)], stem: String(drafts[i].stem || '').slice(0, 80) };
      }
      if (r.saved) passed++;
      else {
        rejected++;
        log.push(`Ditolak: "${r.stem}" — ${r.reasons.join('; ')}`);
      }
    }

    return this.close(step, batchId, { generated: drafts.length, passed, rejected, log });
  }

  async close(step, batchId, { generated = 0, passed = 0, rejected = 0, log = [], error }) {
    await step.do('batch-close', RETRY, () =>
      this.env.DB.prepare("UPDATE batches SET generated=?, passed=?, rejected=?, status=?, log=?, finished_at=datetime('now') WHERE id=?")
        .bind(generated, passed, rejected, error ? 'error' : 'done', JSON.stringify(error ? [error, ...log] : log), batchId)
        .run()
        .then(() => true)
    );
    return { batchId, generated, passed, rejected };
  }
}

// Sentinel kualiti: soalan LIVE yang menunjukkan tanda skema salah dikembalikan ke barisan semakan.
//  - ramai pelajar lapor soalan (>=3 laporan), atau
//  - kadar betul sangat rendah selepas cukup data (kemungkinan skema salah / soalan mengelirukan)
async function qualitySentinel(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, user_flags, served, correct FROM questions
     WHERE status='approved' AND (user_flags>=3 OR (served>=40 AND CAST(correct AS REAL)/served < 0.15))`
  ).all();
  for (const r of results) {
    const why = r.user_flags >= 3 ? `Sentinel: ${r.user_flags} laporan pelajar` : `Sentinel: kadar betul ${Math.round((r.correct / r.served) * 100)}% (${r.served} cubaan)`;
    await env.DB.batch([
      env.DB.prepare("UPDATE questions SET status='pending' WHERE id=?").bind(r.id),
      env.DB.prepare('INSERT INTO reports (question_id,user_id,reason) VALUES (?,?,?)').bind(r.id, 'sentinel', why),
    ]);
  }
  return { requeued: results.length };
}
