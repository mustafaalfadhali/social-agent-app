// تنفيذ طلبات المستندات من المساعد: نسخة فاتورة PDF أو كشف حساب عميل (قراءة فقط من أودو).
const path = require('path');
const odoo = require('./odoo');
const pdfdocs = require('./pdfdocs');

const INVOICE_RE = /^INV\/\d{4}\/\d{1,7}$/;
const money = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PAY = { paid: 'مدفوعة', in_payment: 'مدفوعة', not_paid: 'غير مدفوعة', partial: 'مدفوعة جزئياً', reversed: 'ملغاة بإشعار دائن' };
const clean = (s) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);

function validate(a) {
  if (!a || typeof a !== 'object') throw new Error('طلب مستند غير صالح');
  if (a.type === 'invoice_pdf') {
    if (a.invoice && !INVOICE_RE.test(String(a.invoice))) throw new Error('رقم الفاتورة غير صالح (مثال: INV/2026/00061)');
    if (!a.invoice && !clean(a.customer)) throw new Error('حدّد رقم الفاتورة أو اسم العميل');
    return { type: 'invoice_pdf', invoice: a.invoice ? String(a.invoice) : '', customer: clean(a.customer) };
  }
  if (a.type === 'statement_pdf') {
    if (!clean(a.customer)) throw new Error('حدّد اسم العميل');
    return { type: 'statement_pdf', customer: clean(a.customer) };
  }
  throw new Error('نوع المستند غير مدعوم');
}

async function onePartner(cfg, name) {
  const ps = await odoo.findPartners(cfg, name);
  if (!ps.length) throw new Error('لا يوجد عميل باسم «' + name + '»');
  if (ps.length > 1) throw new Error('عدة عملاء بهذا الاسم، حدّد أكثر:\n' + ps.map((p) => '• ' + p.name).join('\n'));
  return ps[0];
}

// يُرجع { name, pdf: Buffer, title, png? }
async function fulfill(action, d, tmpDir, opts = {}) {
  const a = validate(action);
  const cfg = d.odoo;
  if (!cfg.apiKey) throw new Error('اربط أودو أولاً من تبويب الحسابات');
  if (a.type === 'invoice_pdf') {
    let name = a.invoice;
    if (!name) { const p = await onePartner(cfg, a.customer); name = await odoo.lastInvoiceName(cfg, p.id); if (!name) throw new Error('لا توجد فواتير مرحّلة للعميل ' + p.name); }
    const doc = await odoo.invoiceDoc(cfg, name);
    const r = await pdfdocs.renderPdf(pdfdocs.invoiceHtml(doc), tmpDir, opts);
    const m = doc.m;
    const summary = `📄 فاتورة ${name}\nالعميل: ${doc.partner.name}\nالتاريخ: ${m.invoice_date}\nالإجمالي: ${money(m.amount_total)} SR (شامل الضريبة)\nالحالة: ${PAY[m.payment_state] || m.payment_state}`;
    return { name: 'invoice_' + name.replace(/\//g, '-') + '.pdf', pdf: r.pdf, png: r.png, title: `فاتورة ${name} — ${doc.partner.name}`, summary };
  }
  const p = await onePartner(cfg, a.customer);
  const data = await odoo.statementData(cfg, p.id);
  const r = await pdfdocs.renderPdf(pdfdocs.statementHtml(data), tmpDir, opts);
  const bal = data.lines.reduce((s, l) => s + l.debit - l.credit, 0);
  const summary = `📄 كشف حساب ${p.name}\nعدد الحركات: ${data.lines.length}\nالرصيد المستحق: ${money(bal)} SR${Math.abs(bal) < 0.005 ? ' (لا يوجد مستحق)' : ''}`;
  return { name: 'statement_' + p.id + '.pdf', pdf: r.pdf, png: r.png, title: `كشف حساب ${p.name}`, summary };
}

module.exports = { fulfill, validate };
