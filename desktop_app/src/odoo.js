// اتصال أودو (JSON-RPC) — المرحلة 1: قراءة فقط. أي دالة غير مسموحة تُرفض قبل الإرسال.
const READ_ONLY = new Set(['search_read', 'read_group', 'search_count', 'read', 'fields_get']);
// الكتابة الوحيدة المسموحة في البرنامج كله: معالج تسجيل الدفعات (إنشاء المعالج ثم تنفيذه).
// + إنشاء فاتورة مبيعات وترحيلها (بعد موافقة المالك فقط).
const WRITE_ALLOWED = { 'account.payment.register': new Set(['create', 'action_create_payments']), 'account.move': new Set(['create', 'action_post']) };

// يقبل https فقط (و http للجهاز المحلي)، بدون بيانات دخول داخل الرابط، ويُرجع الأصل (origin) فقط.
function checkUrl(raw) {
  if (!raw) return '';
  let u;
  try { u = new URL(raw); } catch { throw new Error('رابط أودو غير صالح'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('رابط أودو يجب أن يبدأ بـ https://');
  if (u.username || u.password) throw new Error('لا تضع بيانات الدخول داخل الرابط');
  return u.origin;
}

async function rpc(url, service, method, args) {
  const res = await fetch(checkUrl(url) + '/jsonrpc', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: Date.now() }),
  });
  if (!res.ok) throw new Error('تعذّر الوصول لأودو (HTTP ' + res.status + ')');
  const j = await res.json();
  if (j.error) throw new Error(j.error.data?.message || j.error.message || 'خطأ من أودو');
  return j.result;
}

function client(cfg) {
  if (!cfg.url || !cfg.db || !cfg.login || !cfg.apiKey) throw new Error('بيانات أودو غير مكتملة');
  let uidP = null;
  const auth = () => (uidP ||= rpc(cfg.url, 'common', 'authenticate', [cfg.db, cfg.login, cfg.apiKey, {}]).then((u) => {
    if (!u) throw new Error('بيانات الدخول إلى أودو غير صحيحة');
    return u;
  }).catch((e) => { uidP = null; throw e; }));
  const call = async (model, method, args, kwargs = {}) => {
    if (!READ_ONLY.has(method)) throw new Error('عملية غير مسموحة (قراءة فقط): ' + method);
    return rpc(cfg.url, 'object', 'execute_kw', [cfg.db, await auth(), cfg.apiKey, model, method, args, kwargs]);
  };
  const callWrite = async (model, method, args, kwargs = {}) => {
    if (!(WRITE_ALLOWED[model] && WRITE_ALLOWED[model].has(method))) throw new Error('عملية كتابة غير مسموحة: ' + model + '.' + method);
    return rpc(cfg.url, 'object', 'execute_kw', [cfg.db, await auth(), cfg.apiKey, model, method, args, kwargs]);
  };
  return { call, callWrite, auth };
}

async function test(cfg) {
  const c = client(cfg);
  await c.auth();
  const comp = await c.call('res.company', 'search_read', [[]], { fields: ['name'], limit: 1 });
  return { company: comp[0]?.name || '' };
}

const r2 = (n) => Math.round((n || 0) * 100) / 100;

async function summary(cfg, now = new Date()) {
  const c = client(cfg);
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
  const monthStart = `${y}-${m}-01`, yearStart = `${y}-01-01`;
  const base = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']];
  const sum = (domain, field) => c.call('account.move', 'read_group', [domain], { fields: [field + ':sum'], groupby: [], lazy: false });
  // طلبات متتالية (أودو أونلاين يرفض الطلبات المتوازية بـ 429)
  const seq = async (fns) => { const out = []; for (const f of fns) out.push(await f()); return out; };
  const [month, year, open, byCustomer, recent] = await seq([
    () => sum([...base, ['invoice_date', '>=', monthStart]], 'amount_total'),
    () => sum([...base, ['invoice_date', '>=', yearStart]], 'amount_total'),
    () => sum([...base, ['amount_residual', '>', 0]], 'amount_residual'),
    () => c.call('account.move', 'read_group', [[...base, ['amount_residual', '>', 0]]], { fields: ['amount_residual:sum'], groupby: ['partner_id'], lazy: false }),
    () => c.call('account.move', 'search_read', [base], { fields: ['name', 'partner_id', 'invoice_date', 'amount_total', 'payment_state'], order: 'invoice_date desc, id desc', limit: 8 }),
  ]);
  const g = (r, f) => (r[0] ? r2(r[0][f]) : 0), n = (r) => (r[0] ? r[0].__count : 0);
  return {
    fetchedAt: now.toISOString(),
    month: { count: n(month), total: g(month, 'amount_total') },
    year: { count: n(year), total: g(year, 'amount_total') },
    open: { count: n(open), total: g(open, 'amount_residual') },
    customers: byCustomer.map((r) => ({ name: r.partner_id ? r.partner_id[1] : '—', residual: r2(r.amount_residual) })).sort((a, b) => b.residual - a.residual).slice(0, 8),
    recent: recent.map((i) => ({ name: i.name, partner: i.partner_id ? i.partner_id[1] : '—', date: i.invoice_date, total: r2(i.amount_total), paid: i.payment_state === 'paid' || i.payment_state === 'in_payment' })),
  };
}

// ---------- قراءة: الفواتير المفتوحة ودفاتر البنك ----------
async function openInvoices(cfg) {
  const c = client(cfg);
  const rows = await c.call('account.move', 'search_read', [[['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['amount_residual', '>', 0]]],
    { fields: ['name', 'partner_id', 'invoice_date', 'amount_total', 'amount_residual', 'payment_state'], order: 'invoice_date asc, id asc', limit: 300 });
  return rows.map((i) => ({ id: i.id, name: i.name, partnerId: i.partner_id ? i.partner_id[0] : 0, partner: i.partner_id ? i.partner_id[1] : '—',
    date: i.invoice_date, total: r2(i.amount_total), residual: r2(i.amount_residual) }));
}

async function bankJournal(cfg, type = 'bank') {
  if (!['bank', 'cash'].includes(type)) throw new Error('نوع دفتر غير صالح');
  const c = client(cfg);
  const j = await c.call('account.journal', 'search_read', [[['type', '=', type]]], { fields: ['name'], order: 'id asc', limit: 1 });
  if (!j.length) throw new Error(type === 'cash' ? 'لا يوجد دفتر نقدي في أودو' : 'لا يوجد دفتر بنك في أودو');
  return { id: j[0].id, name: j[0].name };
}

// ---------- كتابة: إنشاء فاتورة مبيعات وترحيلها (بعد موافقة المالك فقط) ----------
async function createInvoice(cfg, { partnerId, lines, date }) {
  if (!Number.isInteger(partnerId)) throw new Error('عميل غير صالح');
  if (!Array.isArray(lines) || !lines.length || lines.length > 20) throw new Error('بنود الفاتورة غير صالحة');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('تاريخ غير صالح');
  let total = 0;
  for (const l of lines) {
    if (!(l.qty > 0) || !(l.price > 0) || l.qty > 100000 || l.price > 1000000 || !String(l.name || '').trim()) throw new Error('بند غير صالح');
    total += l.qty * l.price;
  }
  if (total > 1000000) throw new Error('إجمالي الفاتورة كبير جداً، أنشئها من أودو مباشرة');
  const c = client(cfg);
  const taxes = await c.call('account.tax', 'search_read', [[['type_tax_use', '=', 'sale'], ['amount_type', '=', 'percent'], ['amount', '=', 15]]], { fields: ['name'], order: 'id asc', limit: 1 });
  if (!taxes.length) throw new Error('لم أجد ضريبة مبيعات 15% في أودو');
  const vals = { move_type: 'out_invoice', partner_id: partnerId, invoice_date: date,
    invoice_line_ids: lines.map((l) => [0, 0, { name: String(l.name).slice(0, 300), quantity: l.qty, price_unit: l.price, tax_ids: [[6, 0, [taxes[0].id]]] }]) };
  const id = await c.callWrite('account.move', 'create', [vals]);
  if (!Number.isInteger(id)) throw new Error('تعذّر إنشاء الفاتورة');
  await c.callWrite('account.move', 'action_post', [[id]]);
  const after = await c.call('account.move', 'read', [[id]], { fields: ['name', 'state', 'amount_untaxed', 'amount_total'] });
  return { id, name: after[0].name, state: after[0].state, untaxed: r2(after[0].amount_untaxed), total: r2(after[0].amount_total) };
}

// بحث عميل متساهل: الاسم كاملاً ثم كل كلماته (حتى 3)
async function findPartnersLoose(cfg, name) {
  const c = client(cfg);
  const clean = String(name || '').replace(/[%_]/g, ' ').trim().slice(0, 80);
  if (!clean) return [];
  const q = async (domain) => (await c.call('res.partner', 'search_read', [[...domain, ['customer_rank', '>', 0]]], { fields: ['name'], limit: 6 })).map((p) => ({ id: p.id, name: p.name }));
  let rows = await q([['name', 'ilike', clean]]);
  if (!rows.length) {
    const words = clean.split(/\s+/).filter((w) => w.length >= 3 && !['شركة', 'مصنع', 'مؤسسة', 'فرع'].includes(w)).slice(0, 3);
    if (words.length) rows = await q(words.map((w) => ['name', 'ilike', w]));
  }
  return rows;
}

async function invoiceInfo(cfg, id) {
  const c = client(cfg);
  const r = await c.call('account.move', 'read', [[id]], { fields: ['name', 'state', 'move_type', 'payment_state', 'amount_residual', 'invoice_date', 'partner_id'] });
  if (!r.length) throw new Error('الفاتورة غير موجودة في أودو');
  return r[0];
}

// ---------- كتابة: تسجيل دفعة على فاتورة (بعد موافقة المالك فقط) ----------
async function registerPayment(cfg, { invoiceId, amount, date, journalId }) {
  if (!Number.isInteger(invoiceId) || !Number.isInteger(journalId)) throw new Error('معرّفات غير صالحة');
  if (!(amount > 0) || amount > 10000000) throw new Error('مبلغ غير صالح');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('تاريخ غير صالح');
  const c = client(cfg);
  const ctx = { context: { active_model: 'account.move', active_ids: [invoiceId] } };
  const wizard = await c.callWrite('account.payment.register', 'create', [{ payment_date: date, journal_id: journalId, amount }], ctx);
  await c.callWrite('account.payment.register', 'action_create_payments', [[wizard]], ctx);
  const after = await c.call('account.move', 'read', [[invoiceId]], { fields: ['name', 'payment_state', 'amount_residual'] });
  return { name: after[0].name, paymentState: after[0].payment_state, residual: r2(after[0].amount_residual) };
}

// ---------- قراءة: بيانات المستندات (فاتورة / كشف حساب) ----------
async function findPartners(cfg, name) {
  const c = client(cfg);
  const rows = await c.call('res.partner', 'search_read', [[['name', 'ilike', String(name).slice(0, 80)], ['customer_rank', '>', 0]]], { fields: ['name'], limit: 6 });
  return rows.map((p) => ({ id: p.id, name: p.name }));
}

async function lastInvoiceName(cfg, partnerId) {
  const c = client(cfg);
  const r = await c.call('account.move', 'search_read', [[['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['partner_id', '=', partnerId]]],
    { fields: ['name'], order: 'invoice_date desc, id desc', limit: 1 });
  return r.length ? r[0].name : null;
}

async function qrDataUri(cfg, text) { // صورة QR من أودو نفسه (نقطة عامة للباركود)
  const res = await fetch(checkUrl(cfg.url) + '/report/barcode/?barcode_type=QR&width=170&height=170&value=' + encodeURIComponent(text),
    { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!res.ok || !/^image\/png/.test(res.headers.get('content-type') || '')) return '';
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length < 300000 ? 'data:image/png;base64,' + buf.toString('base64') : '';
}

async function invoiceDoc(cfg, name) {
  const c = client(cfg);
  const have = await c.call('account.move', 'fields_get', [], { attributes: ['type'] });
  const fields = ['id', 'name', 'partner_id', 'invoice_date', 'invoice_date_due', 'invoice_line_ids', 'payment_reference', 'amount_untaxed', 'amount_tax',
    'amount_total', 'state', 'payment_state', 'partner_bank_id', ...['delivery_date', 'l10n_sa_qr_code_str'].filter((f) => f in have)];
  const ms = await c.call('account.move', 'search_read', [[['move_type', '=', 'out_invoice'], ['name', '=', name]]], { fields, limit: 1 });
  if (!ms.length) throw new Error('لا توجد فاتورة بالرقم ' + name);
  const m = ms[0];
  const taxes = {};
  for (const t of await c.call('account.tax', 'search_read', [[]], { fields: ['name'] })) taxes[t.id] = t.name;
  const partner = (await c.call('res.partner', 'read', [[m.partner_id[0]]], { fields: ['name', 'street', 'street2', 'city', 'zip', 'vat'] }))[0];
  const lines = await c.call('account.move.line', 'read', [m.invoice_line_ids], { fields: ['name', 'quantity', 'price_unit', 'tax_ids', 'price_subtotal', 'price_total', 'display_type'] });
  const company = (await c.call('res.company', 'search_read', [[]], { fields: ['name', 'vat', 'email', 'company_registry', 'logo', 'website'], limit: 1 }))[0];
  let bank = '';
  if (m.partner_bank_id) bank = ((await c.call('res.partner.bank', 'read', [[m.partner_bank_id[0]]], { fields: ['acc_number'] }))[0] || {}).acc_number || '';
  const qr = m.l10n_sa_qr_code_str ? await qrDataUri(cfg, m.l10n_sa_qr_code_str).catch(() => '') : '';
  return { m, taxes, partner, lines: lines.filter((l) => l.display_type === 'product'), company, bank, qr };
}

async function statementData(cfg, partnerId) {
  const c = client(cfg);
  const partner = (await c.call('res.partner', 'read', [[partnerId]], { fields: ['name'] }))[0];
  const lines = await c.call('account.move.line', 'search_read', [[['partner_id', '=', partnerId], ['account_type', '=', 'asset_receivable'], ['parent_state', '=', 'posted']]],
    { fields: ['date', 'date_maturity', 'move_name', 'journal_id', 'account_id', 'matching_number', 'debit', 'credit'], order: 'date, id' });
  const company = (await c.call('res.company', 'search_read', [[]], { fields: ['name', 'vat', 'logo'], limit: 1 }))[0];
  const journals = {};
  for (const j of await c.call('account.journal', 'search_read', [[]], { fields: ['code'] })) journals[j.id] = j.code;
  return { partner, lines, company, journals };
}

module.exports = { test, summary, checkUrl, openInvoices, bankJournal, createInvoice, findPartnersLoose, invoiceInfo, registerPayment, findPartners, lastInvoiceName, invoiceDoc, statementData };
