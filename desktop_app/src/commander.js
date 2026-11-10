// شريط الأوامر: يفهم طلبك بالعربي، يختار الوكيل المناسب، ويجيب من بيانات حقيقية.
// لا ينفّذ أي تغيير: الطلبات التي تغيّر شيئاً تعود كـ «مقترح» فقط (تفعيل الموافقات لاحقاً).
const claude = require('./claude');
const contracts = require('./contracts');
const odoo = require('./odoo');

const AGENTS = ['النشر', 'العقود', 'المحاسبة', 'الزيارات', 'خدمة العملاء', 'عام'];
let odooCache = { at: 0, data: null };

async function odooData(cfg) {
  if (!cfg.apiKey) return { connected: false };
  if (Date.now() - odooCache.at < 120000 && odooCache.data) return odooCache.data;
  try { odooCache = { at: Date.now(), data: { connected: true, ...(await odoo.summary(cfg)) } }; }
  catch (e) { odooCache = { at: Date.now(), data: { connected: true, error: e.message } }; }
  return odooCache.data;
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
    '- الوكيل «الزيارات» و«خدمة العملاء» غير مربوطين بعد: قل ذلك إن سُئلت عنهما.',
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
