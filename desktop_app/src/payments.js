// المحاسبة: قراءة صورة حوالة، مطابقتها مع فاتورة مفتوحة في أودو، وتسجيل الدفعة بعد موافقة المالك.
// لا يُكتب شيء في أودو إلا من approve() وبعد التحقق من الفاتورة والمبلغ والتاريخ، ثم يُقرأ للتأكد.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const claude = require('./claude');
const odoo = require('./odoo');

const MAX_BYTES = 12 * 1024 * 1024;
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ---------- صندوق الوارد (ملفات الحوالات) ----------
function sniff(buf) { // نحدد النوع من محتوى الملف لا من اسمه
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8) return '.jpg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  if (buf.length > 5 && buf.toString('ascii', 0, 5) === '%PDF-') return '.pdf';
  return null;
}
const inboxDir = (userData) => { const d = path.join(userData, 'inbox'); fs.mkdirSync(d, { recursive: true }); return d; };

function saveInbox(userData, name, buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0 || buf.length > MAX_BYTES) throw new Error('الملف فارغ أو أكبر من 12 ميجا');
  const ext = sniff(buf);
  if (!ext) throw new Error('نوع الملف غير مدعوم (صورة أو PDF فقط)');
  const id = crypto.randomUUID();
  fs.writeFileSync(path.join(inboxDir(userData), id + ext), buf, { mode: 0o600 });
  return { id, name: path.basename(String(name || 'حوالة')).slice(0, 80) };
}

function resolveInbox(userData, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new Error('مرفق غير صالح');
  for (const ext of ['.jpg', '.png', '.webp', '.pdf']) {
    const p = path.join(inboxDir(userData), id + ext);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('المرفق غير موجود');
}

function cleanup(userData) { // حذف مرفقات أقدم من 7 أيام
  try {
    const dir = inboxDir(userData), now = Date.now();
    for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (now - fs.statSync(p).mtimeMs > 7 * 86400000) fs.rmSync(p, { force: true }); }
  } catch { /* اختياري */ }
}

// ---------- أدوات التطبيع والمطابقة ----------
const IND = '٠١٢٣٤٥٦٧٨٩', PERS = '۰۱۲۳۴۵۶۷۸۹';
const westernDigits = (s) => String(s ?? '').replace(/[٠-٩]/g, (c) => IND.indexOf(c)).replace(/[۰-۹]/g, (c) => PERS.indexOf(c));
const norm = (s) => String(s || '').replace(/[ً-ٰٟـ]/g, '').replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ').toLowerCase();
const STOP = new Set(['شركه', 'مطاعم', 'مطعم', 'مصنع', 'موسسه', 'مؤسسه', 'لتقديم', 'الوجبات', 'المحدوده', 'للتجاره', 'لخدمات', 'ال', 'مقهي', 'للحلويات']);
const tokens = (s) => new Set(norm(s).split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)));
function nameScore(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let common = 0; for (const w of A) if (B.has(w)) common++;
  return common / Math.min(A.size, B.size);
}

function cleanExtract(j) {
  // الفاصلة العشرية العربية ٫ تصبح نقطة، وفاصل الآلاف ٬ والفاصلة العادية يُحذفان
  const num = Number(westernDigits(j && j.amount).replace(/٫/g, '.').replace(/[,٬\s]/g, '').replace(/[^\d.]/g, ''));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(j && j.date)) && !Number.isNaN(Date.parse(j.date)) ? String(j.date) : null;
  const s = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  return {
    isTransfer: !!(j && j.is_transfer), amount: Number.isFinite(num) && num > 0 && num < 10000000 ? Math.round(num * 100) / 100 : null,
    currency: s(j && j.currency, 8) || 'SAR', date, payer: s(j && j.payer_name, 120), receiver: s(j && j.receiver_name, 120),
    bank: s(j && j.bank, 80), reference: s(j && j.reference, 80), confidence: ['high', 'medium', 'low'].includes(j && j.confidence) ? j.confidence : 'low', notes: s(j && j.notes, 300),
  };
}

const PROMPT = [
  'أنت محاسب. الملف إيصال أو لقطة شاشة لحوالة بنكية.',
  'استخرج: {"is_transfer": true أو false, "amount": رقم المبلغ المحوَّل فقط, "currency": "SAR" أو غيره,',
  '"date": "YYYY-MM-DD" تاريخ التحويل الميلادي (حوّل الأرقام الهندية إلى عادية، وإن كان التاريخ هجرياً فحوّله إن أمكن وإلا null),',
  '"payer_name": اسم المحوِّل (الدافع), "receiver_name": اسم المستلم, "bank": اسم البنك, "reference": رقم المرجع أو العملية,',
  '"confidence": "high" أو "medium" أو "low", "notes": ملاحظة قصيرة إن وجد غموض}.',
  'لا تخمّن: ضع null لأي حقل لا يظهر بوضوح.',
].join(' ');

// ---------- المقترحات ----------
const list = (store) => { const d = store.get(); if (!Array.isArray(d.proposals)) d.proposals = []; return d.proposals; };

async function propose({ file, name }, d, store) {
  if (!d.odoo.apiKey) return { reply: 'اربط أودو أولاً من تبويب الحسابات حتى أطابق الحوالة مع الفواتير.', proposal: null };
  const ex = cleanExtract(await claude.readImageJson({ imagePath: file, prompt: PROMPT, settings: d.settings }));
  if (!ex.isTransfer || !ex.amount) {
    return { reply: 'لم أجد مبلغ حوالة واضحاً في هذا الملف' + (ex.notes ? ` (${ex.notes})` : '') + '. أرسل صورة أوضح لإيصال الحوالة.', proposal: null };
  }
  const invoices = await odoo.openInvoices(d.odoo);
  const journal = await odoo.bankJournal(d.odoo);
  const cands = invoices.map((i) => {
    const exact = Math.abs(i.residual - ex.amount) < 0.01, partial = !exact && ex.amount < i.residual;
    const ns = nameScore(ex.payer, i.partner);
    return { id: i.id, name: i.name, partner: i.partner, residual: i.residual, date: i.date, exact, partial, nameScore: Math.round(ns * 100) / 100,
      score: (exact ? 3 : 0) + (partial ? 0.5 : 0) + ns * 2 + (ex.amount > i.residual ? -5 : 0) };
  }).filter((c) => c.score >= 2 || (c.partial && c.nameScore >= 0.5)).sort((a, b) => b.score - a.score || String(a.date).localeCompare(String(b.date))).slice(0, 5);

  const warnings = [];
  if (!ex.date) warnings.push('لم يظهر تاريخ التحويل في الصورة؛ سأستخدم تاريخ اليوم إن وافقت');
  if (ex.confidence === 'low') warnings.push('ثقة القراءة منخفضة، راجع المبلغ والتاريخ');
  const dup = list(store).find((p) => p.type === 'payment' && p.status !== 'rejected' && p.amount === ex.amount && (p.extract.reference && p.extract.reference === ex.reference || p.date === ex.date && p.extract.payer === ex.payer));
  if (dup) warnings.push('تبدو حوالة مكررة لمقترح سابق، تأكد قبل الموافقة');

  const exacts = cands.filter((c) => c.exact);
  const best = cands[0];
  const selected = best && best.exact && (exacts.length === 1 || best.nameScore >= 0.5) ? best.id : null;
  const proposal = {
    id: crypto.randomUUID(), type: 'payment', status: 'pending', createdAt: new Date().toISOString(), file: name,
    extract: ex, amount: ex.amount, date: ex.date || todayISO(), dateAssumed: !ex.date, journal, candidates: cands, selected, warnings,
  };
  list(store).unshift(proposal); d.proposals = list(store).slice(0, 50); store.save();
  const reply = !cands.length
    ? `قرأت حوالة بمبلغ ${ex.amount} ${ex.currency}${ex.payer ? ' من ' + ex.payer : ''}، لكن لا توجد فاتورة مفتوحة مطابقة في أودو. لم أسجّل شيئاً.`
    : selected ? `قرأت حوالة ${ex.amount} ${ex.currency} بتاريخ ${proposal.date}. المطابقة الأقرب: ${best.name} (${best.partner}). راجع التفاصيل ووافق ليُسجَّل الدفع.`
      : `قرأت حوالة ${ex.amount} ${ex.currency} بتاريخ ${proposal.date}. وجدت أكثر من فاتورة محتملة، اختر الصحيحة ثم وافق.`;
  return { reply, proposal: { id: proposal.id, type: 'payment', summary: reply } };
}

function find(store, id) {
  const p = list(store).find((x) => x.id === id);
  if (!p || p.type !== 'payment') throw new Error('المقترح غير موجود');
  return p;
}

function select(store, id, invoiceId) {
  const p = find(store, id);
  if (p.status !== 'pending') throw new Error('تم التعامل مع هذا المقترح');
  if (!p.candidates.some((c) => c.id === invoiceId)) throw new Error('فاتورة غير ضمن المرشحين');
  p.selected = invoiceId; store.save();
}

function reject(store, id) {
  const p = find(store, id);
  if (p.status !== 'pending') throw new Error('تم التعامل مع هذا المقترح');
  p.status = 'rejected'; store.save();
}

async function approve(store, id, userData) {
  const d = store.get(), p = find(store, id);
  if (p.status !== 'pending') throw new Error('تم التعامل مع هذا المقترح');
  if (!p.selected) throw new Error('اختر الفاتورة أولاً');
  p.status = 'executing'; store.save();
  try {
    const info = await odoo.invoiceInfo(d.odoo, p.selected);
    if (info.state !== 'posted' || info.move_type !== 'out_invoice') throw new Error('الفاتورة ليست فاتورة مبيعات مرحّلة');
    if (!['not_paid', 'partial'].includes(info.payment_state)) throw new Error('الفاتورة غير مفتوحة (مدفوعة أو ملغاة)');
    if (p.amount > info.amount_residual + 0.005) throw new Error('المبلغ أكبر من المتبقي على الفاتورة (' + info.amount_residual + ')');
    if (p.date > todayISO()) throw new Error('تاريخ الدفعة في المستقبل');
    const res = await odoo.registerPayment(d.odoo, { invoiceId: p.selected, amount: p.amount, date: p.date, journalId: p.journal.id });
    p.status = 'done'; p.doneAt = new Date().toISOString(); p.result = res; p.error = '';
    store.save();
    const line = { t: p.doneAt, action: 'register_payment', proposal: p.id, invoice: res.name, amount: p.amount, date: p.date, journal: p.journal.name, state: res.paymentState, residual: res.residual };
    try { fs.appendFileSync(path.join(userData, 'audit.jsonl'), JSON.stringify(line) + '\n', { mode: 0o600 }); } catch { /* السجل اختياري */ }
    store.log(`💰 دفعة ${p.amount} على ${res.name} بتاريخ ${p.date} → ${res.paymentState}`);
    return res;
  } catch (e) {
    p.status = 'pending'; p.error = e.message; store.save();
    throw e;
  }
}

module.exports = { saveInbox, resolveInbox, cleanup, propose, select, reject, approve, _cleanExtract: cleanExtract, _nameScore: nameScore };
