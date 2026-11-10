// شريط الأوامر: يفهم طلبك بالعربي، يختار الوكيل المناسب، ويجيب من بيانات حقيقية.
// لا ينفّذ أي تغيير: الطلبات التي تغيّر شيئاً تعود كـ «مقترح» فقط (تفعيل الموافقات لاحقاً).
const claude = require('./claude');
const contracts = require('./contracts');
const odoo = require('./odoo');
const visits = require('./visits');

const AGENTS = ['النشر', 'العقود', 'المحاسبة', 'الزيارات', 'خدمة العملاء', 'عام'];
let odooCache = { at: 0, data: null };
let visitsCache = { at: 0, data: null };

async function odooData(cfg) {
  if (!cfg.apiKey) return { connected: false };
  if (Date.now() - odooCache.at < 120000 && odooCache.data) return odooCache.data;
  try { odooCache = { at: Date.now(), data: { connected: true, ...(await odoo.summary(cfg)) } }; }
  catch (e) { odooCache = { at: Date.now(), data: { connected: true, error: e.message } }; }
  return odooCache.data;
}

async function visitsData(cfg) {
  if (!cfg.token) return { connected: false };
  if (Date.now() - visitsCache.at < 120000 && visitsCache.data) return visitsCache.data;
  try {
    const s = await visits.summary(cfg);
    visitsCache = { at: Date.now(), data: { connected: true, today: s.today, totals: s.totals, overdue_scheduled: s.overdue, latest_schedule_date: s.scheduleNewest,
      today_visits: s.today_list, tomorrow_visits: s.tomorrow_list,
      brands: s.brands.map((b) => ({ brand: b.label, sites: b.sites, visits_required: b.required, visits_done: b.done, visits_missing: b.missing, sites_remaining: b.remainingSites, report_numbers: b.reports,
        unvisited_sites: b.unvisited.slice(0, 40).map((u) => `${u.name} (${u.done}/${u.required})`) })) } };
  } catch (e) { visitsCache = { at: Date.now(), data: { connected: true, error: e.message } }; }
  return visitsCache.data;
}

async function buildContext(d) {
  const ct = contracts.list();
  return {
    today: ct.today,
    contracts: {
      summary: ct.summary,
      items: ct.items.map((i) => ({ client: i.client, entity: i.entity, no: i.no, start: i.start, end: i.end, days: i.days, status: i.status })),
    },
    accounting: await odooData(d.odoo),
    visits: await visitsData(d.visits),
    posts: { pending_review: d.posts.filter((p) => p.status === 'pending_review').length, recent_log: d.log.slice(0, 5).map((l) => l.msg) },
  };
}

async function ask({ text, history = [] }, d) {
  const ctx = await buildContext(d);
  const prompt = [
    'أنت «مكتب سِراج»: فريق من خمسة وكلاء لمؤسسة مكافحة حشرات في الرياض (النشر، العقود، المحاسبة، الزيارات، خدمة العملاء).',
    'مهمتك: افهم طلب المالك، اختر الوكيل المناسب، وأجب من البيانات المرفقة فقط.',
    'القواعد:',
    '- أجب بالعربية وباختصار شديد (حتى 4 أسطر)، بأرقام وأسماء من البيانات.',
    '- لا تخترع أي رقم أو اسم غير موجود. إن لم تكفِ البيانات فقل ذلك صراحة.',
    '- فواتير الشركة تصدر من «شعلة الخدمات» فقط. والعقود قد تكون باسم الخدمات أو الجزيرة.',
    '- التاريخ الماضي في العقود يعني «تم التجديد» وليس «منتهياً».',
    '- أنت لا تنفّذ أي تغيير. إذا طلب المالك ما يغيّر شيئاً (إصدار فاتورة، تسجيل دفعة، نشر منشور، تعديل عقد) فأعد proposal يلخّص ما سيُنفَّذ، وقل في الرد إنه مقترح ينتظر تفعيل الموافقات.',
    '- بيانات الزيارات في visits (إن كان connected=true): الأرقام شهرية وتُصفَّر آخر الشهر. «تمت X من Y زيارة» = visits_done من visits_required. جدول الزيارات المجدولة قد يكون قديماً (انظر latest_schedule_date)، فلا تتحدث عن زيارات اليوم إن كانت القائمة فارغة إلا بقولك إنه لا يوجد جدول لها. إن كان connected=false فقل إن وكيل الزيارات غير مربوط.',
    '- وكيل «خدمة العملاء» غير مربوط بعد: قل ذلك إن سُئلت عنه.',
    '- إذا طلب المالك نسخة PDF لفاتورة أو كشف حساب عميل فأعد action: {"type":"invoice_pdf","invoice":"INV/2026/00061"} لرقم محدد، أو {"type":"invoice_pdf","customer":"اسم العميل"} لآخر فاتورة له، أو {"type":"statement_pdf","customer":"اسم العميل"} للكشف، وقل في الرد «جارِ تجهيز الملف». لا تقل إنك عاجز عن ذلك.',
    '',
    'البيانات (JSON):',
    JSON.stringify(ctx),
    '',
    history.length ? 'المحادثة السابقة:\n' + history.slice(-6).map((m) => `${m.role === 'user' ? 'المالك' : 'المكتب'}: ${m.text}`).join('\n') : '',
    `طلب المالك الآن: ${text}`,
    '',
    `أعد فقط JSON بدون أي نص آخر: {"agent": "واحد من ${AGENTS.join(' | ')}", "reply": "...", "proposal": null أو {"type": "payment|invoice|post|contract", "summary": "..."}, "action": null أو {"type": "invoice_pdf|statement_pdf", ...}}`,
  ].filter((x) => x !== '').join('\n');
  const raw = await claude.askText(prompt, d.settings);
  const j = claude.extractJson(raw);
  let action = null;
  try { action = j.action ? require('./documents').validate(j.action) : null; } catch { action = null; }
  return { agent: AGENTS.includes(j.agent) ? j.agent : 'عام', reply: String(j.reply || '').trim() || 'لم أفهم الطلب.', proposal: j.proposal || null, action };
}

module.exports = { ask };
