const T = { '/meta': '/meta/callback', '/tiktok': '/tiktok/callback/' };
const K = ['code', 'state', 'error', 'error_description', 'error_reason'];
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const eq = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const sign = async (body, secret) => { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return hex(await crypto.subtle.sign('HMAC', k, body)); };
const authed = (r, env) => { const t = (r.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''); return !!env.PULL_TOKEN && env.PULL_TOKEN.length >= 24 && eq(t, env.PULL_TOKEN); };
const KEY_RE = /^m:\d{12}:[A-Za-z0-9._=+-]{1,200}$/;
export default {
  async fetch(r, env) {
    const u = new URL(r.url);
    const p = u.pathname.replace(/\/$/, '');
    if (p === '/wa/webhook') {
      if (r.method === 'GET') {
        const ok = u.searchParams.get('hub.mode') === 'subscribe' && env.WA_VERIFY && eq(u.searchParams.get('hub.verify_token') || '', env.WA_VERIFY);
        return ok ? new Response(u.searchParams.get('hub.challenge') || '') : new Response('forbidden', { status: 403 });
      }
      if (r.method === 'POST') {
        const raw = await r.arrayBuffer();
        if (raw.byteLength > 262144) return new Response('too large', { status: 413 });
        const s = (r.headers.get('x-hub-signature-256') || '').replace(/^sha256=/, '');
        if (!env.APP_SECRET || !eq(s, await sign(raw, env.APP_SECRET))) return new Response('unauthorized', { status: 401 });
        let j;
        try { j = JSON.parse(new TextDecoder().decode(raw)); } catch { return new Response('ok'); }
        let stored = false;
        for (const e of j.entry || []) for (const c of e.changes || []) {
          const v = c.value || {};
          const names = {};
          for (const x of v.contacts || []) names[x.wa_id] = (x.profile || {}).name || '';
          for (const m of v.messages || []) {
            if (!m || !m.id || !/^\d{6,20}$/.test(String(m.from))) continue;
            const rec = { id: String(m.id), from: String(m.from), name: String(names[m.from] || '').slice(0, 80), type: String(m.type || ''), ts: Number(m.timestamp) || 0, text: m.type === 'text' ? String((m.text || {}).body || '').slice(0, 2000) : '[' + String(m.type || '') + ']', phone_id: String((v.metadata || {}).phone_number_id || '') };
            await env.WA.put('m:' + String(rec.ts).padStart(12, '0') + ':' + rec.id, JSON.stringify(rec), { expirationTtl: 604800 }); stored = true;
          }
        }
        if (stored) await env.WA.put('flag', '1', { expirationTtl: 604800 });
        return new Response('ok');
      }
    }
    if (p === '/wa/pull' && r.method === 'GET') {
      if (!authed(r, env)) return new Response('unauthorized', { status: 401 });
      const flag = await env.WA.get('flag');
      if (!flag) {
        const last = Number(await env.WA.get('scan')) || 0, now = Date.now();
        if (now - last < 600000) return new Response(JSON.stringify({ messages: [] }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
        await env.WA.put('scan', String(now), { expirationTtl: 86400 });
      }
      const l = await env.WA.list({ prefix: 'm:', limit: 50 });
      const out = [];
      for (const k of l.keys) { const v = await env.WA.get(k.name); if (v) { try { out.push({ key: k.name, ...JSON.parse(v) }); } catch {} } }
      return new Response(JSON.stringify({ messages: out }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    if (p === '/wa/ack' && r.method === 'POST') {
      if (!authed(r, env)) return new Response('unauthorized', { status: 401 });
      let b;
      try { b = await r.json(); } catch { return new Response('bad', { status: 400 }); }
      let n = 0;
      for (const k of Array.isArray(b.keys) ? b.keys.slice(0, 50) : []) if (KEY_RE.test(String(k))) { await env.WA.delete(k); n++; }
      if (n && !(await env.WA.list({ prefix: 'm:', limit: 1 })).keys.length) await env.WA.delete('flag');
      return new Response(JSON.stringify({ deleted: n }), { headers: { 'content-type': 'application/json' } });
    }
    const t = Object.hasOwn(T, p) ? T[p] : null;
    if (r.method !== 'GET' || !t) return new Response('Not found', { status: 404 });
    const q = new URLSearchParams();
    for (const k of K) { const v = u.searchParams.get(k); if (v && v.length <= 2048) q.set(k, v); }
    return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1:53682' + t + '?' + q, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  },
};
