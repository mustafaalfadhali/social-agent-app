// اتصال أودو (JSON-RPC) — المرحلة 1: قراءة فقط. أي دالة غير مسموحة تُرفض قبل الإرسال.
const READ_ONLY = new Set(['search_read', 'read_group', 'search_count', 'read']);

async function rpc(url, service, method, args) {
  const res = await fetch(url.replace(/\/+$/, '') + '/jsonrpc', {
    method: 'POST',
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
  return { call, auth };
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

module.exports = { test, summary };
