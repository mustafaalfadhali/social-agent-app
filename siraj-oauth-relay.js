// وسيط OAuth لسراج: يحوّل رد ميتا/تيك توك (https) إلى سراج على جهازك. لا يخزّن شيئاً.
const TARGETS = { '/meta': '/meta/callback', '/tiktok': '/tiktok/callback/' };
const KEYS = ['code', 'state', 'error', 'error_description', 'error_reason'];

export default {
  fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');
    if (request.method !== 'GET' || !Object.hasOwn(TARGETS, path)) return new Response('Not found', { status: 404 });
    const q = new URLSearchParams();
    for (const k of KEYS) { const v = url.searchParams.get(k); if (v && v.length <= 2048) q.set(k, v); }
    return new Response(null, {
      status: 302,
      headers: { Location: 'http://127.0.0.1:53682' + TARGETS[path] + '?' + q, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
  },
};
