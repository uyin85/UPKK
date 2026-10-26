// UPKK Pro — Worker utama
// /api/*        → API pelajar (PWA)
// /admin/api/*  → panel ustaz/admin (Bearer ADMIN_TOKEN)
// /mcp          → pelayan MCP untuk agen (Bearer MCP_TOKEN)
// selain itu    → fail statik PWA (public/)
import { handleApp } from './api/app.js';
import { handleAdmin } from './api/admin.js';
import { handleMcp } from './mcp.js';
import { fail, bearer, safeEqual } from './lib/util.js';

export { GenerateWorkflow } from './workflow.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return withCors(await handleApp(request, env, url));
      if (url.pathname.startsWith('/admin/api/')) {
        if (!env.ADMIN_TOKEN || !safeEqual(bearer(request), env.ADMIN_TOKEN)) return fail('Tidak dibenarkan', 401);
        return await handleAdmin(request, env, url);
      }
      if (url.pathname === '/mcp') {
        if (!env.MCP_TOKEN || !safeEqual(bearer(request), env.MCP_TOKEN)) return fail('Tidak dibenarkan', 401);
        return await handleMcp(request, env);
      }
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      return fail('Ralat pelayan: ' + String(e.message || e).slice(0, 200), 500);
    }
  },
};

function withCors(res) {
  // PWA dihidang dari origin yang sama; CORS hanya untuk ujian tempatan
  res.headers.set('cache-control', res.headers.get('cache-control') || 'no-store');
  return res;
}
