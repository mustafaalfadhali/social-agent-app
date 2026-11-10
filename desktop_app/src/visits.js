// وكيل الزيارات: يقرأ ملخص برنامج زيارات الفروع (قراءة فقط) ويحسب التقدم لكل براند.
// المصدر: مسار /api/siraj/overview على سيرفر البرنامج برمز قراءة خاص (لا حساب مستخدم ولا كتابة).
const BRANDS = [ // نفس تعريف البراندات في برنامج الزيارات
  { key: 'برجر هنش', label: 'برجر هنش', extra: ['تريبلس'] },
  { key: 'اسطا عاصم', label: 'اسطا عاصم', extra: [] },
  { key: 'حالي ومالح', label: 'حالي ومالح', extra: [] },
  { key: 'مولت', label: 'مولت', extra: [] },
  { key: 'حكمت', label: 'حكمت', extra: ['شاورما بشير', 'شاورما عزون'] },
  { key: 'كنافة علي', label: 'كنافة علي أبو الهوس', extra: [] },
  { key: 'شاورما حواري', label: 'شاورما حواري', extra: ['شاي شبرا'] },
];
const DONE = 'تمت الزيارة';

function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('رابط برنامج الزيارات غير صالح'); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) throw new Error('الرابط يجب أن يبدأ بـ https://');
  if (u.username || u.password) throw new Error('لا تضع بيانات الدخول داخل الرابط');
  return u.origin;
}

async function fetchOverview(cfg) {
  if (!cfg.url || !cfg.token) throw new Error('بيانات برنامج الزيارات غير مكتملة');
  let res;
  try {
    res = await fetch(checkUrl(cfg.url) + '/api/siraj/overview', { headers: { Authorization: 'Bearer ' + cfg.token }, signal: AbortSignal.timeout(20000), redirect: 'error' });
  } catch (e) { throw new Error('تعذّر الوصول لبرنامج الزيارات'); }
  if (res.status === 404) throw new Error('الواجهة غير مفعّلة على السيرفر بعد (يلزم تحديث برنامج الزيارات)');
  if (res.status === 401) throw new Error('رمز الزيارات غير صحيح');
  if (res.status === 429) throw new Error('محاولات كثيرة، حاول بعد قليل');
  if (!res.ok) throw new Error('خطأ من برنامج الزيارات (' + res.status + ')');
  const j = await res.json();
  if (!j || !Array.isArray(j.branches)) throw new Error('رد غير متوقع من برنامج الزيارات');
  return j;
}

const reportCount = (s) => new Set(String(s || '').split(/[^0-9]+/).filter(Boolean)).size;
const req = (b) => b.visits_required || 1;
const doneOf = (b) => Math.min(b.visits_done || 0, req(b));
const isFull = (b) => doneOf(b) >= req(b);

function brandOf(name) {
  return BRANDS.find((b) => name.includes(b.key) || b.extra.some((x) => name.includes(x))) || null;
}

function summarize(ov) {
  const rows = ov.branches;
  const groups = new Map(BRANDS.map((b) => [b.label, []])); groups.set('أخرى', []);
  for (const r of rows) { const b = brandOf(r.name); groups.get(b ? b.label : 'أخرى').push(r); }
  const brands = [...groups.entries()].filter(([, v]) => v.length).map(([label, v]) => {
    const required = v.reduce((n, b) => n + req(b), 0), done = v.reduce((n, b) => n + doneOf(b), 0);
    return {
      label, sites: v.length, required, done, missing: required - done,
      remainingSites: v.filter((b) => !isFull(b)).length,
      reports: v.reduce((n, b) => n + reportCount(b.report_no), 0),
      unvisited: v.filter((b) => !isFull(b)).map((b) => ({ name: b.name, region: b.region, done: b.visits_done || 0, required: req(b) })),
    };
  });
  const sched = ov.schedule || [];
  const tomorrow = new Date(new Date(ov.today + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
  const byName = new Map(rows.map((r) => [r.name, r]));
  return {
    fetchedAt: ov.generated, today: ov.today,
    totals: { branches: rows.length, fullyVisited: rows.filter(isFull).length, remaining: rows.filter((b) => !isFull(b)).length },
    brands,
    today_list: sched.filter((s) => s.date === ov.today).map((s) => ({ brand: s.brand, branch: s.branch, type: s.type })),
    tomorrow_list: sched.filter((s) => s.date === tomorrow).map((s) => ({ brand: s.brand, branch: s.branch, type: s.type })),
    overdue: sched.filter((s) => s.date < ov.today && byName.get(s.branch) && !isFull(byName.get(s.branch))).length,
    scheduleNewest: sched.length ? sched[sched.length - 1].date : null,
  };
}

async function summary(cfg) { return summarize(await fetchOverview(cfg)); }
async function test(cfg) { const s = await summary(cfg); return { branches: s.totals.branches }; }

module.exports = { summary, test, summarize, checkUrl, BRANDS };
