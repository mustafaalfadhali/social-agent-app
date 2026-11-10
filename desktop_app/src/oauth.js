// Local loopback server that catches the OAuth redirect (Meta / TikTok).
// تحصين: مربوط بالعنوان المحلي فقط، يتحقق من الـ Host (ضد DNS rebinding)، يهرّب أي نص معروض،
// ولا يُغلق بسبب طلب عابث: يستمر بالانتظار إلى أن يصل رد صحيح بالـ state المتوقع أو تنتهي المهلة.
const http = require('http');
const crypto = require('crypto');
const sec = require('./security');

const PORT = 53682;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function waitForCode(authUrl, expectedState, pathName) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); server.close(); fn(v); };
    const page = (res, status, html) => {
      res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      });
      res.end('<html dir="rtl"><body style="font-family:sans-serif;text-align:center;padding:60px">' + html + '</body></html>');
    };
    const server = http.createServer((req, res) => {
      const host = String(req.headers.host || '');
      if (req.method !== 'GET' || (host !== `localhost:${PORT}` && host !== `127.0.0.1:${PORT}`)) { res.writeHead(400); return res.end(); }
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname.replace(/\/$/, '') !== pathName.replace(/\/$/, '')) { res.writeHead(404); return res.end(); }
      const state = url.searchParams.get('state') || '';
      if (!same(state, expectedState)) { // طلب لا يخص جلسة الربط: نتجاهله ونبقى بانتظار الرد الصحيح
        return page(res, 400, '<h2>طلب غير صالح</h2>');
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error_description') || url.searchParams.get('error');
      if (!code) {
        page(res, 200, `<h2>فشل الربط</h2><p>${esc(error || '')}</p>`);
        return finish(reject, new Error(error || 'لم يتم استلام الكود'));
      }
      page(res, 200, '<h2>تم الربط ✅</h2><p>ارجع لبرنامج سراج.</p>');
      finish(resolve, code);
    });
    const timer = setTimeout(() => finish(reject, new Error('انتهت مهلة تسجيل الدخول')), 5 * 60 * 1000);
    server.on('error', (e) => finish(reject, e));
    server.listen(PORT, '127.0.0.1', () => { sec.safeOpenExternal(authUrl).catch((e) => finish(reject, e)); });
  });
}

module.exports = { PORT, waitForCode };
