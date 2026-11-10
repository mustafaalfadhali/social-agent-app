// بناء مستندات PDF من بيانات أودو (قراءة فقط): نسخة فاتورة بتصميم أودو، وكشف حساب العميل.
// التحويل إلى PDF داخل Electron نفسه (نافذة مخفية معزولة، بدون جافاسكربت ولا شبكة).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const esc = (s) => String(s === false || s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 2) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const sr = (v) => num(v) + ' SR';
const dmy = (s) => (s ? String(s).split('-').reverse().join('/') : '');
const logoUri = (c) => (c && c.logo ? 'data:image/png;base64,' + c.logo : '');

function invoiceHtml({ m, taxes, partner, lines, company, bank, qr }) {
  const logo = logoUri(company);
  const rows = lines.map((l) => `<tr><td class="r">${esc(l.name)}</td><td>${num(l.quantity)}</td><td>${sr(l.price_unit)}</td>
    <td>${esc((l.tax_ids || []).map((t) => taxes[t] || '').join(', '))}</td><td>${sr(l.price_total - l.price_subtotal)}</td><td>${sr(l.price_subtotal)}</td><td>${sr(l.price_total)}</td></tr>`).join('');
  const addr = [partner.name, partner.street, partner.street2, partner.city, partner.zip].filter(Boolean).map(esc).join('<br>');
  const title = m.state === 'posted' ? 'فاتورة ضريبية' : 'مسودة فاتورة';
  return `<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><style>
@page{size:A4;margin:12mm 12mm 16mm}
body{font-family:Tahoma,Arial,sans-serif;color:#222;font-size:11px;margin:0}
.wm{position:fixed;top:12%;left:-25%;width:150%;opacity:.16;z-index:-1}
.hd{display:flex;justify-content:space-between;align-items:flex-start;direction:ltr}
.co{line-height:1.7;direction:rtl;text-align:right} .cu{margin-top:34px;line-height:1.7}
h1{font-size:21px;margin:26px 0 12px;font-weight:bold}
.dt{display:flex;margin:6px 0} .dt div{flex:1;text-align:center}
.dt b{display:block;background:rgba(208,224,224,.30);padding:5px} .dt span{display:block;padding:6px}
table{width:100%;border-collapse:collapse;margin-top:14px}
th{padding:7px 4px;background:rgba(48,80,112,.80);color:#fff;font-size:10px;-webkit-print-color-adjust:exact}
td{padding:8px 4px;text-align:center;border-bottom:1px solid #e0f0f0} .r{text-align:right}
.sm{display:flex;justify-content:space-between;align-items:flex-start;margin-top:22px}
.tt{width:100%;margin:0} .tt td{text-align:right;background:rgba(224,240,240,.25);border-bottom:1px solid #fff}
.tt .n{text-align:left} .tt .big td{background:rgba(48,80,112,.78);color:#fff;font-weight:bold}
.ft{position:fixed;bottom:0;left:0;right:0;border-top:1px solid #305070;padding-top:5px;text-align:center;font-size:9px;color:#444}
</style>
${logo ? `<img class="wm" src="${logo}">` : ''}
<div class="hd"><div class="co"><b>${esc(company.name)}</b><br>المملكة العربية السعودية<br>VAT Number: ${esc(company.vat)}</div>${logo ? `<img src="${logo}" style="height:60px">` : ''}</div>
<div class="cu">${addr}<br>VAT Number: ${esc(partner.vat)}</div>
<h1>${title} ${esc(m.name)}</h1>
<div class="dt"><div><b>تاريخ فاتورة العميل</b><span>${esc(m.invoice_date)}</span></div>
<div><b>تاريخ الاستحقاق</b><span>${esc(m.invoice_date_due)}</span></div><div><b>تاريخ التوريد</b><span>${esc(m.delivery_date)}</span></div></div>
<table><tr><th class="r">الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th>الضرائب</th><th>قيمة الضريبة</th><th>المبلغ (بدون ضريبة)</th><th>المبلغ (شامل الضريبة)</th></tr>${rows}</table>
<div class="sm"><div>${qr ? `<img src="${qr}" style="width:120px;height:120px">` : ''}</div><div style="width:52%"><table class="tt" style="margin:0">
<tr><td>المبلغ الخاضع للضريبة</td><td class="n">${sr(m.amount_untaxed)}</td></tr>
<tr><td>إجمالي ضريبة القيمة المضافة</td><td class="n">${sr(m.amount_tax)}</td></tr>
<tr class="big"><td>إجمالي قيمة الفاتورة (شامل ضريبة القيمة المضافة)</td><td class="n">${sr(m.amount_total)}</td></tr></table></div></div>
<p>التواصل بشأن الدفع: ${esc(m.payment_reference || m.name)}</p>${bank ? `<p>في هذا الحساب: ${esc(bank)}</p>` : ''}
<div class="ft"><span dir="ltr">${esc(company.website)}</span><br>VAT: ${esc(company.vat)}${company.company_registry ? ' · NU: ' + esc(company.company_registry) : ''}${company.email ? ' · ' : ''}<span dir="ltr">${esc(company.email)}</span></div></html>`;
}

function statementHtml({ partner, lines, company, journals }) {
  let bal = 0, tdeb = 0, tcre = 0;
  const rows = lines.map((l) => {
    bal += l.debit - l.credit; tdeb += l.debit; tcre += l.credit;
    return `<tr><td class="r">${esc(l.move_name)}</td><td>${esc(journals[l.journal_id && l.journal_id[0]] || '')}</td><td>${esc(String((l.account_id && l.account_id[1]) || '').split(' ')[0])}</td>
      <td>${dmy(l.date)}</td><td>${dmy(l.date_maturity)}</td><td>${esc(l.matching_number)}</td><td>${sr(l.debit)}</td><td class="g">${sr(l.credit)}</td><td>${sr(bal)}</td></tr>`;
  }).join('');
  const logo = logoUri(company), today = new Date().toISOString().slice(0, 10);
  return `<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><style>
@page{size:A4 landscape;margin:12mm 8mm}
body{font-family:Tahoma,Arial,sans-serif;color:#222;font-size:11px;margin:0}
.hd{display:flex;justify-content:space-between;align-items:flex-start} .co{font-size:11px;line-height:1.6} h1{font-size:20px;margin:0;font-weight:bold}
table{width:100%;border-collapse:collapse;margin-top:26px}
th{padding:6px 4px;border-bottom:1px solid #999;font-weight:bold} td{padding:6px 4px;text-align:center} .r{text-align:right} .g{color:#bbb}
.yr{background:#e9ecef;font-weight:bold;text-align:center;padding:5px;-webkit-print-color-adjust:exact}
.p td{font-weight:bold} .tot td{font-weight:bold;border-top:1px solid #999}
.ft{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:space-between;font-size:8px;color:#666}
</style>
<div class="hd"><div class="co"><b>${esc(company.name)}</b><br>المملكة العربية السعودية<br>VAT Number: ${esc(company.vat)}</div><div>${logo ? `<img src="${logo}" style="height:46px">` : ''}</div></div>
<h1>كشف حساب العميل</h1>
<table><tr><td class="yr" colspan="9">${esc(partner.name)} · حتى ${today}</td></tr>
<tr><th class="r">المستند</th><th>دفتر اليومية</th><th>الحساب</th><th>تاريخ الفاتورة</th><th>تاريخ الاستحقاق</th><th>مطابقة</th><th>المدين</th><th>الدائن</th><th>الرصيد</th></tr>
<tr class="p"><td class="r" colspan="6">${esc(partner.name)}</td><td>${sr(tdeb)}</td><td>${sr(tcre)}</td><td>${sr(bal)}</td></tr>${rows}
<tr class="tot"><td class="r" colspan="6">الإجمالي</td><td>${sr(tdeb)}</td><td>${sr(tcre)}</td><td>${sr(bal)}</td></tr></table>
<div class="ft"><span>${today}</span><span>${esc(company.name)}</span><span>${lines.length} حركة</span></div></html>`;
}

// تحويل HTML إلى PDF عبر نافذة مخفية معزولة (لا جافاسكربت ولا شبكة).
async function renderPdf(html, tmpDir, { png = false } = {}) {
  const { BrowserWindow } = require('electron');
  fs.mkdirSync(tmpDir, { recursive: true });
  const file = path.join(tmpDir, crypto.randomUUID() + '.html');
  fs.writeFileSync(file, html, { mode: 0o600 });
  const win = new BrowserWindow({ show: false, width: 1000, height: 1400, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, webSecurity: true, devTools: false } });
  try {
    await win.loadFile(file);
    const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true });
    const img = png ? (await win.webContents.capturePage()).toPNG() : null;
    return { pdf, png: img };
  } finally { win.destroy(); fs.rmSync(file, { force: true }); }
}

module.exports = { invoiceHtml, statementHtml, renderPdf };
