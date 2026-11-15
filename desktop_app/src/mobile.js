// خادم الجوال: يعرض واجهة «نواة سراج» للمتصفح على نفس بيانات التطبيق (لا نسخة ثانية من البيانات، فالتزامن تلقائي).
// الأمان: مُطفأ افتراضياً، ربط برمز لمرة واحدة ثم كوكي جلسة HttpOnly، قائمة قنوات محدودة، ولا تُعرض أي أسرار.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const RDIR = path.join(__dirname, 'renderer');
const STATIC = {
  '/': ['mobile.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/map.js': ['map.js', 'text/javascript; charset=utf-8'],
  '/center-art.webp': ['center-art.webp', 'image/webp'],
  '/logo-approved.jpg': ['logo-approved.jpg', 'image/jpeg'],
};
const PAIR_HTML = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ربط سراج</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090d26;color:#eaf1ff;font-family:'Segoe UI',Tahoma,sans-serif}
form{width:min(320px,86vw);padding:22px;border:1px solid rgba(120,160,255,.4);border-radius:14px;background:rgba(30,44,110,.3);text-align:center}
input{width:100%;box-sizing:border-box;margin:14px 0;padding:12px;font-size:22px;letter-spacing:4px;text-align:center;text-transform:uppercase;border-radius:8px;border:1px solid rgba(120,160,255,.5);background:#0a1030;color:#fff}
button{width:100%;padding:11px;font-size:16px;border-radius:8px;border:1px solid #7aa2ff;background:rgba(80,120,255,.35);color:#fff}p{color:#9fb2e0;font-size:13px;margin:0}#e{color:#fca5a5;min-height:18px;margin-top:10px}</style></head>
<body><form id="f"><h2>نواة سراج</h2><p>اكتب رمز الربط الظاهر في سراج على الكمبيوتر<br>(أيقونة سراج بجانب الساعة ← وصول الجوال)</p>
<input id="c" maxlength="8" autocomplete="off" autocapitalize="characters" required><button>ربط</button><p id="e"></p></form>
<script>document.getElementById('f').onsubmit=async(e)=>{e.preventDefault();const r=await fetch('/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:document.getElementById('c').value})});const j=await r.json().catch(()=>({}));if(j.ok)location.href='/';else document.getElementById('e').textContent=j.error||'رمز غير صحيح';};</script></body></html>`;

function create({ store, handlers, publicState, log }) {
  let server = null, fails = 0, lockedUntil = 0, timer = null;
  const clients = new Set();
  const cfg = () => { const d = store.get(); if (!d.mobile || typeof d.mobile !== 'object') d.mobile = {}; if (!d.mobile.port) d.mobile.port = 8765; return d.mobile; };
  const eq = (a, b) => { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };
  const newCode = () => Array.from(crypto.randomBytes(8), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  const ensureSecrets = () => { const m = cfg(); if (!m.code) m.code = newCode(); if (!/^[a-f0-9]{64}$/.test(m.session || '')) m.session = crypto.randomBytes(32).toString('hex'); };

  // أي حفظ أو سجل في التطبيق يوقظ الجوال ليحدّث نفسه
  const bump = () => { if (!clients.size || timer) return; timer = setTimeout(() => { timer = null; for (const c of clients) { try { c.write('data: change\n\n'); } catch { clients.delete(c); } } }, 400); };
  for (const k of ['save', 'log']) { const orig = store[k]; store[k] = function (...a) { const r = orig.apply(this, a); bump(); return r; }; }

  // ما يراه الجوال من الحالة: ما تحتاجه الواجهة فقط، بلا مسارات ملفات ولا إعدادات داخلية
  function mobileState() {
    const s = publicState(), pr = s.wa.profile || {};
    return {
      settings: { reviewBeforePublish: s.settings.reviewBeforePublish },
      meta: { pages: s.meta.pages.map((p) => ({ id: p.id, name: p.name, igId: p.igId ? '1' : '' })), selectedPageId: s.meta.selectedPageId },
      odoo: { hasKey: s.odoo.hasKey }, visits: { hasToken: s.visits.hasToken },
      wa: { hasBridgeToken: s.wa.hasBridgeToken, hasToken: s.wa.hasToken, phoneId: s.wa.phoneId ? '1' : '', waiting: s.wa.waiting, profile: { autoReply: pr.autoReply, followFirstHours: pr.followFirstHours, followDays: pr.followDays } },
      telegram: { paired: s.telegram.paired },
      proposals: s.proposals.map((p) => ({ id: p.id, type: p.type, status: p.status, amount: p.amount, date: p.date })),
      posts: s.posts.slice(0, 40).map((p) => ({ id: p.id, status: p.status, caption: String(p.caption || '').slice(0, 900), createdAt: p.createdAt })),
      log: s.log.slice(0, 30), agentBusy: s.agentBusy,
    };
  }
  const API = {
    'state': () => mobileState(),
    'contracts:list': () => handlers['contracts:list'](),
    'odoo:summary': () => handlers['odoo:summary'](),
    'visits:summary': () => handlers['visits:summary'](),
    'assistant:ask': (p) => handlers['assistant:ask']({ text: String((p && p.text) || '').slice(0, 2000), attachments: [], history: Array.isArray(p && p.history) ? p.history.slice(-8) : [] }),
    'wa:save': (f) => handlers['wa:save']({ profile: { ...publicState().wa.profile, autoReply: f && f.profile && f.profile.autoReply === 'off' ? 'off' : 'on' } }),
    'settings:save': (s) => { if (!s || typeof s.reviewBeforePublish !== 'boolean') throw new Error('مدخل غير صالح'); return handlers['settings:save']({ reviewBeforePublish: s.reviewBeforePublish }); },
  };

  const readJson = (req) => new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    req.on('data', (c) => { n += c.length; if (n > 32768) { reject(new Error('طلب كبير')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { reject(new Error('JSON غير صالح')); } });
    req.on('error', reject);
  });
  const sameOrigin = (req) => { const o = req.headers.origin; if (!o) return true; try { return new URL(o).host === req.headers.host; } catch { return false; } };
  const isJson = (req) => /^application\/json\b/i.test(req.headers['content-type'] || '');

  async function onReq(req, res) {
    const p = new URL(req.url, 'http://x').pathname;
    const head = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" };
    const json = (code, obj, extra) => { res.writeHead(code, { ...head, 'Content-Type': 'application/json; charset=utf-8', ...(extra || {}) }); res.end(JSON.stringify(obj)); };
    const ck = /(?:^|;\s*)sk=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
    const authed = !!(ck && cfg().session && eq(ck[1], cfg().session));

    if (p === '/pair' && req.method === 'GET') { res.writeHead(200, { ...head, 'Content-Type': 'text/html; charset=utf-8' }); return res.end(PAIR_HTML); }
    if (p === '/pair' && req.method === 'POST') {
      if (!sameOrigin(req) || !isJson(req)) return json(403, { ok: false, error: 'مرفوض' });
      if (Date.now() < lockedUntil) return json(429, { ok: false, error: 'محاولات كثيرة. انتظر 10 دقائق.' });
      const b = await readJson(req).catch(() => ({}));
      if (!eq(String(b.code || '').trim().toUpperCase(), cfg().code || newCode())) {
        if (++fails >= 6) { fails = 0; lockedUntil = Date.now() + 10 * 60 * 1000; log('📱 الجوال: أُوقف الربط 10 دقائق بعد محاولات خاطئة'); }
        return json(401, { ok: false, error: 'رمز غير صحيح' });
      }
      fails = 0; cfg().code = newCode(); store.save(); // الرمز لمرة واحدة
      log('📱 رُبط جهاز جديد بواجهة الجوال');
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return json(200, { ok: true }, { 'Set-Cookie': `sk=${cfg().session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure}` });
    }
    if (!authed) {
      if (req.method === 'GET' && p === '/') { res.writeHead(302, { ...head, Location: '/pair' }); return res.end(); }
      return json(401, { ok: false, error: 'غير مصرّح' });
    }
    if (req.method === 'GET' && STATIC[p]) {
      const [f, type] = STATIC[p];
      try { const buf = fs.readFileSync(path.join(RDIR, f)); res.writeHead(200, { ...head, 'Content-Type': type }); return res.end(buf); }
      catch { res.writeHead(404, head); return res.end(); }
    }
    if (req.method === 'GET' && p === '/events') {
      if (clients.size >= 20) { res.writeHead(503, head); return res.end(); }
      res.writeHead(200, { ...head, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 5000\n\n'); clients.add(res);
      const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch { /* مغلق */ } }, 25000);
      req.on('close', () => { clearInterval(ka); clients.delete(res); });
      return;
    }
    if (req.method === 'POST' && p === '/api') {
      if (!sameOrigin(req) || !isJson(req)) return json(403, { ok: false, error: 'مرفوض' });
      try {
        const b = await readJson(req), fn = API[String(b.ch)];
        if (!fn) return json(404, { ok: false, error: 'قناة غير متاحة للجوال' });
        return json(200, { ok: true, data: await fn(...(Array.isArray(b.args) ? b.args.slice(0, 2) : [])) });
      } catch (e) { return json(200, { ok: false, error: String(e.message || e).slice(0, 300) }); }
    }
    res.writeHead(404, head); res.end();
  }

  function start() {
    if (server || !cfg().enabled) return false;
    ensureSecrets(); store.save();
    server = http.createServer((req, res) => { onReq(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch { /* مغلق */ } }); });
    server.on('error', (e) => { log('📱 تعذّر تشغيل خادم الجوال: ' + String(e.message).slice(0, 120)); server = null; });
    server.listen(cfg().port, '0.0.0.0');
    return true;
  }
  function stop() { for (const c of clients) { try { c.end(); } catch { /* مغلق */ } } clients.clear(); if (server) { server.close(); if (server.closeAllConnections) server.closeAllConnections(); server = null; } }
  function setEnabled(on) { cfg().enabled = !!on; store.save(); if (on) start(); else stop(); }
  function reset() { const m = cfg(); m.code = newCode(); m.session = crypto.randomBytes(32).toString('hex'); store.save(); for (const c of clients) { try { c.end(); } catch { /* مغلق */ } } clients.clear(); }
  function info() {
    const m = cfg(), ips = [];
    for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
    return { enabled: !!m.enabled, running: !!server, port: m.port, code: m.code || '', urls: ips.map((ip) => `http://${ip}:${m.port}`) };
  }
  return { start, stop, setEnabled, reset, info };
}

module.exports = { create };
