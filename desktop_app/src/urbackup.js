// مراقبة النسخ الاحتياطي (UrBackup): قراءة حالة الأجهزة فقط بمستخدم محدود الصلاحية (status فقط).
// الاتصال من الشبكة المحلية. يرسل تنبيهاً واحداً لكل مشكلة في اليوم، ورسالة «تم الإصلاح» عند زوالها.
const crypto = require('crypto');

const DEFAULT_URL = 'http://192.168.100.200:55414';

function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('رابط UrBackup غير صالح'); }
  const lan = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && lan)) throw new Error('الرابط يجب أن يكون https، أو http لعنوان الشبكة المحلية فقط');
  if (u.username || u.password) throw new Error('لا تضع بيانات الدخول داخل الرابط');
  return u.origin;
}

async function call(origin, action, params) {
  let res;
  try {
    res = await fetch(`${origin}/x?a=${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(), signal: AbortSignal.timeout(20000), redirect: 'error',
    });
  } catch { throw new Error('تعذّر الوصول لـ UrBackup (تأكد أنك على الشبكة المحلية)'); }
  if (res.status === 429) throw new Error('محاولات كثيرة، حاول بعد قليل');
  if (!res.ok) throw new Error('UrBackup رد بخطأ ' + res.status);
  try { return await res.json(); } catch { throw new Error('رد غير مفهوم من UrBackup (هل الرابط صحيح؟)'); }
}

// تسجيل الدخول بطريقة UrBackup (md5 + pbkdf2 اختياري + رقم عشوائي من الخادم)
async function login(cfg) {
  if (!cfg.user || !cfg.pass) throw new Error('بيانات UrBackup غير مكتملة');
  const origin = checkUrl(cfg.url || DEFAULT_URL);
  const s = await call(origin, 'salt', { username: cfg.user });
  if (!s || !s.salt || !s.ses || !s.rnd) throw new Error('اسم المستخدم غير موجود في UrBackup');
  const md5Bin = crypto.createHash('md5').update(s.salt + cfg.pass).digest();
  let pw = md5Bin.toString('hex');
  const rounds = parseInt(s.pbkdf2_rounds, 10) || 0;
  if (rounds > 0) pw = crypto.pbkdf2Sync(md5Bin, Buffer.from(s.salt), rounds, 32, 'sha256').toString('hex');
  pw = crypto.createHash('md5').update(s.rnd + pw).digest('hex');
  const r = await call(origin, 'login', { username: cfg.user, password: pw, ses: s.ses });
  if (!r || !r.success) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
  return { origin, ses: r.session || s.ses };
}

async function fetchStatus(cfg) {
  const { origin, ses } = await login(cfg);
  const r = await call(origin, 'status', { ses });
  if (!r || !Array.isArray(r.status)) throw new Error('لا توجد صلاحية قراءة الحالة (تأكد من صلاحية status للمستخدم)');
  return r.status;
}

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const DAY = 86400;

// قواعد التنبيه (دالة نقية قابلة للاختبار)
function evaluate(clients, nowSec, days) {
  const issues = [];
  for (const c of clients || []) {
    const name = String(c.name || '?').slice(0, 60);
    if (c.delete_pending) continue;
    const last = n(c.lastbackup);
    if (!last) issues.push({ key: 'never:' + name, text: `🗄️ «${name}»: لا توجد أي نسخة ملفات حتى الآن` });
    else if (nowSec - last > days * DAY) {
      const d = Math.floor((nowSec - last) / DAY);
      issues.push({ key: 'stale:' + name, text: `🗄️ «${name}»: آخر نسخة ملفات قبل ${d} يوم (الحد ${days})` });
    } else if (c.file_ok === false) issues.push({ key: 'fail:' + name, text: `⚠️ «${name}»: آخر نسخة ملفات فيها مشاكل` });
    if (c.image_ok === false && n(c.lastbackup_image)) issues.push({ key: 'img:' + name, text: `⚠️ «${name}»: آخر نسخة صورة فيها مشاكل` });
  }
  return issues;
}

async function test(cfg) {
  const st = await fetchStatus(cfg);
  return { clients: st.length };
}
async function summary(cfg, days = 2) {
  const st = await fetchStatus(cfg);
  return { clients: st.map((c) => ({ name: c.name, online: !!c.online, lastbackup: n(c.lastbackup) })), issues: evaluate(st, Math.floor(Date.now() / 1000), days) };
}

// فحص دوري: تنبيه واحد لكل مشكلة في اليوم + «تم الإصلاح» عند زوالها + تنبيه عند انقطاع UrBackup 3 مرات متتالية
async function tick(store, notify, fetcher = fetchStatus) {
  const d = store.get().urbackup;
  if (!d || !d.enabled || !d.pass) return { skipped: true };
  let st;
  try { st = await fetcher(d); } catch (e) {
    d.fails = (d.fails || 0) + 1;
    if (d.fails === 3) await notify('⚠️ تعذّر الوصول لـ UrBackup 3 مرات متتالية (' + String(e.message).slice(0, 80) + '). قد يكون متوقفاً أو أن الجهاز خارج الشبكة المحلية.');
    store.save(); return { error: e.message };
  }
  if (d.fails >= 3) await notify('✅ عاد الاتصال بـ UrBackup');
  d.fails = 0;
  const today = new Date().toISOString().slice(0, 10);
  const state = d.state || (d.state = {});
  const issues = evaluate(st, Math.floor(Date.now() / 1000), d.days || 2);
  const seen = new Set();
  for (const i of issues) {
    seen.add(i.key);
    if (!state[i.key] || state[i.key].day !== today) { await notify('🛡️ تنبيه النسخ الاحتياطي' + String.fromCharCode(10) + i.text); }
    state[i.key] = { day: today, text: i.text };
  }
  for (const k of Object.keys(state)) {
    if (!seen.has(k)) { await notify('✅ تم حل المشكلة:' + String.fromCharCode(10) + state[k].text); delete state[k]; }
  }
  store.save();
  return { issues: issues.length };
}

module.exports = { checkUrl, login, fetchStatus, evaluate, test, summary, tick, DEFAULT_URL };
