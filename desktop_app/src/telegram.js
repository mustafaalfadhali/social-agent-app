// بوت تيليجرام لسراج: تكلّم الفريق من الجوال خارج البيت (اتصال خارج فقط من جهازك، بدون فتح أي منفذ).
// الأمان: المفتاح مشفّر على القرص، والربط برمز مؤقت من البرنامج، ولا يُقبل إلا حساب المالك المرتبط،
// وكل تغيير في أودو يمر بزر موافقة ثم زر تأكيد. الأخطاء تُنقّى من المفتاح قبل عرضها.
const crypto = require('crypto');
const path = require('path');
const sec = require('./security');
const documents = require('./documents');

const API = 'https://api.telegram.org';
const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,50}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

const WA_PHONE_RE = /^\d{6,20}$/;

function create({ store, dataDir, commander, payments, whatsapp, log, api: apiOverride }) {
  let running = false, offset = 0, pairing = null, username = '', failures = 0, waEditing = null;
  const stamps = [], history = [];
  const cfg = () => store.get().telegram;
  const redact = (s) => { const t = cfg().token; let m = String(s); if (t) m = m.split(t).join('***'); return m.replace(/bot\d{6,12}:[A-Za-z0-9_-]+/g, 'bot***'); };

  async function api(method, params = {}, ms = 40000) {
    if (apiOverride) return apiOverride(method, params);
    const token = cfg().token;
    if (!TOKEN_RE.test(token)) throw new Error('مفتاح تيليجرام غير صالح');
    let res;
    try {
      res = await fetch(`${API}/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(ms), redirect: 'error' });
    } catch (e) { throw new Error(redact(e.message || 'تعذّر الاتصال بتيليجرام')); }
    const j = await res.json().catch(() => ({}));
    if (!j.ok) { const err = new Error(redact(j.description || 'خطأ من تيليجرام')); err.code = j.error_code; throw err; }
    return j.result;
  }

  async function download(fileId) {
    const f = await api('getFile', { file_id: fileId });
    if (f.file_size && f.file_size > 12 * 1024 * 1024) throw new Error('الملف أكبر من 12 ميجا');
    if (apiOverride) return apiOverride('download', { file_path: f.file_path });
    const res = await fetch(`${API}/file/bot${cfg().token}/${f.file_path}`, { signal: AbortSignal.timeout(60000), redirect: 'error' });
    if (!res.ok) throw new Error('تعذّر تنزيل الملف');
    return Buffer.from(await res.arrayBuffer());
  }

  async function sendDocument(chatId, buf, filename, caption) {
    if (apiOverride) return apiOverride('sendDocument', { chat_id: chatId, filename, size: buf.length, caption });
    const token = cfg().token;
    if (!TOKEN_RE.test(token)) throw new Error('مفتاح تيليجرام غير صالح');
    const fd = new FormData();
    fd.append('chat_id', String(chatId)); fd.append('caption', String(caption || '').slice(0, 900));
    fd.append('document', new Blob([buf], { type: 'application/pdf' }), filename);
    let res;
    try { res = await fetch(`${API}/bot${token}/sendDocument`, { method: 'POST', body: fd, signal: AbortSignal.timeout(90000), redirect: 'error' }); }
    catch (e) { throw new Error(redact(e.message || 'تعذّر إرسال الملف')); }
    const j = await res.json().catch(() => ({}));
    if (!j.ok) throw new Error(redact(j.description || 'تعذّر إرسال الملف'));
  }

  const send = (chatId, text, markup) => api('sendMessage', { chat_id: chatId, text: String(text).slice(0, 3800), ...(markup ? { reply_markup: markup } : {}) });
  const edit = (chatId, messageId, text, markup) => api('editMessageText', { chat_id: chatId, message_id: messageId, text: String(text).slice(0, 3800), reply_markup: markup || { inline_keyboard: [] } });

  // ---------- بطاقة رد العميل (واتساب): لا يُرسل شيء إلا بزر «إرسال» ----------
  function waCard(cv) {
    const v = whatsapp.view(cv), d = v.draft;
    const head = `${cv.draft && cv.draft.followUp ? '🔁 متابعة عميل متردد' : '💬 واتساب'} · ${v.name || '+' + v.phone}${d && d.urgent ? ' · 🔴 عاجل' : ''}${d && d.category ? ' · ' + d.category : ''}`;
    const lines = [head, '', 'العميل: ' + v.last.slice(0, 500)];
    if (d) { if (d.summary) lines.push('الخلاصة: ' + d.summary); lines.push('', 'المسودة:', d.text); if (d.needsHuman) lines.push('', '⚠ يحتاج نظرك (شكوى أو أمر حساس).'); }
    if (!v.windowOpen) lines.push('', `⏱ مرّت 24 ساعة: لا يرسل واتساب رداً حراً الآن. انسخ المسودة وأرسلها للعميل من جوالك (+${v.phone}) إن رغبت.`);
    const kb = d && v.status === 'draft' ? { inline_keyboard: [[{ text: '✅ إرسال', callback_data: `wok:${v.phone}` }], [{ text: '✏️ تعديل', callback_data: `wed:${v.phone}` }, { text: '❌ تجاهل', callback_data: `wno:${v.phone}` }], [{ text: '🙋 أتدخل أنا', callback_data: `wtk:${v.phone}` }]] } : { inline_keyboard: [] };
    return { text: lines.join('\n'), keyboard: kb };
  }
  async function notifyDraft(cv) {
    const c = cfg(); if (!c.chatId || !c.token) return;
    const cd = waCard(cv); await send(c.chatId, cd.text, cd.keyboard);
  }
  if (whatsapp) whatsapp.onDraft((cv) => notifyDraft(cv).catch((e) => log('تيليجرام: ' + redact(e.message))));
  // ---------- الحجز: طلب للمالك ثم ملخص التأكيد ----------
  async function bookingEvent(ev) {
    const c = cfg(); if (!c.chatId || !c.token) return;
    const cv = ev.cv, b = cv.booking || {}, d = b.data || {};
    const who = d.name || cv.name || 'العميل';
    if (ev.type === 'request' || ev.type === 'rejected') {
      const lines = [ev.type === 'request' ? '🗓 طلب حجز جديد' : '↩️ العميل لم يناسبه الموعد' + (ev.text ? ': ' + ev.text.slice(0, 200) : ''), `العميل: ${who}`, `الجوال: +${cv.phone}`, `الخدمة: ${d.service || '—'}`, `الموقع: ${d.location || '—'}`, `السعر: ${d.price || '—'}`];
      if (d.preferred) lines.push(`رغبة العميل: ${d.preferred}`);
      lines.push('', '✏️ اضغط «رد» على هذه الرسالة واكتب الموعد (اليوم والساعة).');
      const r = await send(c.chatId, lines.join('\n'));
      if (r && r.message_id) whatsapp.setBookingMsg(cv.phone, r.message_id);
    }
    if (ev.type === 'confirmed') {
      await send(c.chatId, ['✅ تم تأكيد الحجز', `الاسم: ${who}`, `التواصل: +${cv.phone}`, `الموقع: ${d.location || '—'}`, `الخدمة: ${d.service || '—'}`, `السعر: ${d.price || '—'}`, `الوقت: ${b.slot || '—'}`].join('\n'));
    }
  }
  if (whatsapp && whatsapp.onBooking) whatsapp.onBooking((ev) => bookingEvent(ev).catch((e) => log('تيليجرام: ' + redact(e.message))));
  async function takeoverEvent(cv) {
    const c = cfg(); if (!c.chatId || !c.token) return;
    const last = (cv.messages[cv.messages.length - 1] || {}).text || '';
    const r = await send(c.chatId, `🙋 تدخلك مفعّل · ${cv.name || '+' + cv.phone}\n\n${String(last).slice(0, 600)}\n\n✏️ اضغط «رد» على هذه الرسالة لترسل ردك للعميل.`, { inline_keyboard: [[{ text: '🤖 أرجّع المحادثة لسراج', callback_data: `wbk:${cv.phone}` }]] });
    if (r && r.message_id) whatsapp.noteTakeoverMsg(cv.phone, r.message_id);
  }
  if (whatsapp && whatsapp.onTakeover) whatsapp.onTakeover((cv) => takeoverEvent(cv).catch((e) => log('تيليجرام: ' + redact(e.message))));
  async function onWaCallback(q, act, phone) {
    const chatId = q.message.chat.id, mid = q.message.message_id;
    let note = '';
    try {
      if (!WA_PHONE_RE.test(phone || '')) throw new Error('محادثة غير صالحة');
      if (act === 'wok') { await whatsapp.send(phone); note = 'أُرسل الرد ✅'; }
      if (act === 'wno') { whatsapp.ignore(phone); note = 'تم التجاهل'; }
      if (act === 'wtk') { whatsapp.setTakeover(phone, true); note = 'تدخلك مفعّل'; await takeoverEvent(whatsapp.convs()[phone]); }
      if (act === 'wbk') { whatsapp.setTakeover(phone, false); note = 'رجعت المحادثة لسراج'; }
      if (act === 'wed') { waEditing = { phone, expires: Date.now() + 10 * 60 * 1000 }; note = 'أرسل نص الرد الجديد'; await send(chatId, '✏️ اكتب الآن نص الرد الذي تريد إرساله للعميل (خلال 10 دقائق).'); }
    } catch (e) { note = e.message; }
    const cv = whatsapp.convs()[phone];
    if (cv) { const cd = waCard(cv); await edit(chatId, mid, cd.text + (act === 'wok' && cv.status === 'answered' ? '\n\n✅ أُرسل الرد' : ''), cd.keyboard).catch(() => {}); }
    await api('answerCallbackQuery', { callback_query_id: q.id, ...(note ? { text: String(note).slice(0, 190) } : {}) }).catch(() => {});
  }

  // ---------- بطاقة الدفعة (نص + أزرار) ----------
  function invoiceCard(p, confirming) {
    const lines = [`🧾 فاتورة لـ ${p.partner}`].concat(p.lines.map((l) => `• ${l.name}: ${l.qty} × ${money(l.price)} = ${money(l.qty * l.price)}`),
      [`قبل الضريبة ${money(p.untaxed)} + ضريبة 15% ${money(p.vat)} = ${money(p.total)} ريال`], (p.warnings || []).map((w) => '⚠ ' + w));
    if (p.status === 'done') return { text: lines.concat(`✅ أُنشئت ورُحّلت: ${p.result.name} (${money(p.result.total)} ريال)`).join('\n') };
    if (p.status === 'rejected') return { text: lines.concat('تم الرفض، ولم يُنشأ شيء.').join('\n') };
    if (p.error) lines.push('⚠ ' + p.error);
    if (confirming) return { text: `تأكيد أخير: إنشاء وترحيل فاتورة ${money(p.total)} ريال لـ ${p.partner} من «شعلة الخدمات» في أودو؟\nهذا يغيّر سجلك المحاسبي.`,
      keyboard: { inline_keyboard: [[{ text: '✅ نعم، أنشئ', callback_data: `yes:${p.id}` }, { text: 'رجوع', callback_data: `back:${p.id}` }]] } };
    return { text: lines.join('\n'), keyboard: { inline_keyboard: [[{ text: '✅ موافقة', callback_data: `ok:${p.id}` }, { text: '❌ رفض', callback_data: `no:${p.id}` }]] } };
  }
  function card(p, confirming) {
    if (p.type === 'invoice') return invoiceCard(p, confirming);
    const e = p.extract || {};
    const lines = [`💰 حوالة ${money(p.amount)} ${e.currency || 'SAR'} · ${p.date}${p.dateAssumed ? ' (تاريخ اليوم)' : ''}`];
    if (e.payer || e.bank || e.reference) lines.push([e.payer && 'من: ' + e.payer, e.bank, e.reference && 'مرجع: ' + e.reference].filter(Boolean).join(' · '));
    (p.warnings || []).forEach((w) => lines.push('⚠ ' + w));
    if (p.status === 'done') return { text: lines.concat(`✅ سُجّلت الدفعة على ${p.result.name} (الحالة: ${p.result.paymentState}، المتبقي ${money(p.result.residual)})`).join('\n') };
    if (p.status === 'rejected') return { text: lines.concat('تم الرفض، ولم يُسجَّل شيء.').join('\n') };
    const sel = (p.candidates || []).find((c) => c.id === p.selected);
    if (confirming && sel) {
      return { text: `تأكيد أخير: تسجيل دفعة ${money(p.amount)} على ${sel.name} (${sel.partner}) بتاريخ ${p.date} في أودو؟\nهذا يغيّر سجلك المحاسبي.`,
        keyboard: { inline_keyboard: [[{ text: '✅ نعم، سجّل', callback_data: `yes:${p.id}` }, { text: 'رجوع', callback_data: `back:${p.id}` }]] } };
    }
    if (!(p.candidates || []).length) return { text: lines.concat('لا توجد فاتورة مفتوحة مطابقة. لم أسجّل شيئاً.').join('\n') };
    lines.push(sel ? 'الفاتورة المختارة:' : 'اختر الفاتورة الصحيحة:');
    p.candidates.forEach((c) => lines.push(`${c.id === p.selected ? '✓' : '•'} ${c.name} — ${c.partner} — متبقي ${money(c.residual)}${c.exact ? ' (مطابق)' : c.partial ? ' (جزئي)' : ''}`));
    if (p.error) lines.push('⚠ ' + p.error);
    const rows = p.candidates.filter((c) => c.id !== p.selected).map((c) => [{ text: `اختر ${c.name}`, callback_data: `sel:${p.id}:${c.id}` }]);
    const act = [];
    if (sel) act.push({ text: '✅ موافقة', callback_data: `ok:${p.id}` });
    act.push({ text: '❌ رفض', callback_data: `no:${p.id}` });
    return { text: lines.join('\n'), keyboard: { inline_keyboard: rows.concat([act]) } };
  }
  const findProposal = (id) => (store.get().proposals || []).find((x) => x.id === id && (x.type === 'payment' || x.type === 'invoice'));

  // ---------- معالجة الرسائل ----------
  function limited() {
    const now = Date.now(); while (stamps.length && now - stamps[0] > 60000) stamps.shift();
    stamps.push(now); return stamps.length > 20;
  }

  async function onMessage(m) {
    if (!m.chat || m.chat.type !== 'private' || !m.from || m.from.is_bot) return;
    const c = cfg();
    if (!c.chatId) { // وضع الربط
      const code = String(m.text || '').trim().replace(/^\/start\s*/, '');
      if (pairing && Date.now() < pairing.expires && /^\d{6}$/.test(code) && same(code, pairing.code)) {
        c.chatId = m.chat.id; pairing = null; store.save(); log('🔗 تم ربط تيليجرام بحسابك');
        await send(m.chat.id, 'تم الربط ✅\nأنا مكتب سراج. اكتب طلبك (مثل: كم المستحقات المفتوحة؟) أو أرسل صورة حوالة لأسجّلها بعد موافقتك.');
      } else await send(m.chat.id, 'هذا البوت خاص. للربط افتح برنامج سراج ← الحسابات ← تيليجرام ← «ربط»، ثم أرسل الرمز هنا.');
      return;
    }
    if (m.chat.id !== c.chatId) return; // أي حساب آخر يُتجاهل بصمت
    if (limited()) { await send(m.chat.id, 'مهلاً، رسائل كثيرة. حاول بعد دقيقة.'); return; }

    const text = String(m.text || m.caption || '').trim().slice(0, 2000);
    if (/^\/(start|help)\b/.test(text)) {
      await send(m.chat.id, 'اكتب طلبك مباشرة، مثل:\n• كم المستحقات المفتوحة؟\n• أي عقود تنتهي قريباً؟\nأو أرسل صورة حوالة لأسجّل الدفعة بعد موافقتك.');
      return;
    }
    const fileId = m.photo && m.photo.length ? m.photo[m.photo.length - 1].file_id
      : m.document && (/^image\//.test(m.document.mime_type || '') || m.document.mime_type === 'application/pdf') ? m.document.file_id : null;
    if (fileId) {
      await send(m.chat.id, 'جارِ قراءة الحوالة…');
      const buf = await download(fileId);
      const saved = payments.saveInbox(dataDir, (m.document && m.document.file_name) || 'حوالة', buf);
      const r = await payments.propose({ file: payments.resolveInbox(dataDir, saved.id), name: saved.name }, store.get(), store);
      const p = r.proposal && findProposal(r.proposal.id);
      if (!p) { await send(m.chat.id, r.reply); return; }
      const cd = card(p); await send(m.chat.id, r.reply + '\n\n' + cd.text, cd.keyboard);
      return;
    }
    if (!text) return;
    if (waEditing && whatsapp) { // نص رد معدّل لمحادثة واتساب
      const ed = waEditing; waEditing = null;
      if (Date.now() < ed.expires) {
        const cv = whatsapp.setDraft(ed.phone, text); const cd = waCard(cv);
        await send(m.chat.id, cd.text, cd.keyboard); return;
      }
    }
    if (m.reply_to_message && whatsapp && whatsapp.takeoverByMsg) { // رد المالك المباشر على عميل تدخّل فيه
      const tp = whatsapp.takeoverByMsg(m.reply_to_message.message_id);
      if (tp) { await whatsapp.ownerReply(tp, text); await send(m.chat.id, '✅ أُرسل ردك للعميل'); return; }
    }
    if (m.reply_to_message && whatsapp && whatsapp.bookingByMsg) { // رد المالك بموعد الحجز
      const ph = whatsapp.bookingByMsg(m.reply_to_message.message_id);
      if (ph) {
        await send(m.chat.id, 'جارِ صياغة رسالة الموعد للعميل…');
        const cv = await whatsapp.setSlot(ph, text); const cd = waCard(cv);
        await send(m.chat.id, cd.text, cd.keyboard); return;
      }
    }
    history.push({ role: 'user', text }); if (history.length > 8) history.shift();
    const r = await commander.ask({ text, history: history.slice(0, -1) }, store.get(), store);
    history.push({ role: 'office', text: r.reply }); if (history.length > 8) history.shift();
    if (r.action) { // طلب مستند: نرسل الملف بوصف مكتوب من بياناته الفعلية (لا من نص النموذج)
      try {
        const f = await documents.fulfill(r.action, store.get(), path.join(dataDir, 'tmp'));
        await sendDocument(m.chat.id, f.pdf, f.name, f.summary || f.title);
      } catch (e) { await send(m.chat.id, '⚠ ' + redact(e.message).slice(0, 600)); }
      return;
    }
    if (r.proposals && r.proposals.length) { // بطاقات موافقة لكل مقترح محاسبي
      await send(m.chat.id, `«المحاسبة»\n${r.reply}`);
      for (const id of r.proposals) { const p = findProposal(id); if (p) { const cd = card(p); await send(m.chat.id, cd.text, cd.keyboard); } }
      return;
    }
    await send(m.chat.id, `${r.agent === 'عام' ? '' : '«' + r.agent + '»\n'}${r.reply}${r.proposal ? '\n\n📝 مقترح (لم يُنفَّذ): ' + (r.proposal.summary || '') : ''}`);
  }

  async function onCallback(q) {
    const c = cfg();
    if (!q.message || !c.chatId || q.message.chat.id !== c.chatId || (q.from && q.from.id !== c.chatId)) return; // حسابك فقط
    const [act, id, inv] = String(q.data || '').split(':');
    if (whatsapp && ['wok', 'wed', 'wno', 'wtk', 'wbk'].includes(act)) return onWaCallback(q, act, id);
    const chatId = q.message.chat.id, mid = q.message.message_id;
    if (!['sel', 'ok', 'yes', 'back', 'no'].includes(act) || !UUID_RE.test(id || '')) { await api('answerCallbackQuery', { callback_query_id: q.id }); return; }
    let note = '';
    try {
      if (act === 'sel') payments.select(store, id, Number(inv));
      if (act === 'no') payments.reject(store, id);
      if (act === 'ok') { const p0 = findProposal(id); if (p0) p0.tgConfirmAt = Date.now(); }
      if (act === 'yes') { // التأكيد النهائي يُقبل فقط بعد ضغط «موافقة» خلال 10 دقائق، ولمرة واحدة
        const p0 = findProposal(id);
        if (!p0 || !p0.tgConfirmAt || Date.now() - p0.tgConfirmAt > 10 * 60 * 1000) throw new Error('اضغط «موافقة» أولاً ثم أكّد');
        delete p0.tgConfirmAt;
        const r = await payments.approve(store, id, dataDir); note = p0.type === 'invoice' ? `أُنشئت الفاتورة ${r.name}` : `سُجّلت الدفعة على ${r.name}`;
      }
    } catch (e) { note = e.message; }
    const p = findProposal(id);
    if (p) { const cd = card(p, act === 'ok'); await edit(chatId, mid, cd.text, cd.keyboard).catch(() => {}); }
    await api('answerCallbackQuery', { callback_query_id: q.id, ...(note ? { text: String(note).slice(0, 190) } : {}) }).catch(() => {});
  }

  async function onUpdate(u) {
    try { if (u.message) await onMessage(u.message); else if (u.callback_query) await onCallback(u.callback_query); }
    catch (e) {
      log('تيليجرام: ' + redact(e.message));
      const chat = (u.message && u.message.chat) || (u.callback_query && u.callback_query.message && u.callback_query.message.chat);
      if (chat && chat.id === cfg().chatId) await send(chat.id, '⚠ ' + redact(e.message).slice(0, 300)).catch(() => {});
    }
  }

  async function loop() {
    while (running) {
      try {
        const ups = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 45000);
        failures = 0;
        for (const u of ups) { offset = u.update_id + 1; await onUpdate(u); }
      } catch (e) {
        if (!running) break;
        if (e.code === 401) { log('تيليجرام: المفتاح غير صالح، أوقفت الاتصال'); running = false; break; }
        failures++; if (failures === 1 || failures % 10 === 0) log('تيليجرام: ' + redact(e.message));
        await sleep(Math.min(60000, 2000 * failures));
      }
    }
  }

  function start() { if (running || !TOKEN_RE.test(cfg().token || '')) return false; running = true; loop(); return true; }
  function stop() { running = false; }

  async function connect(token) {
    const t = sec.str(token, 200).trim();
    if (!TOKEN_RE.test(t)) throw new Error('شكل المفتاح غير صحيح (من BotFather)');
    stop(); const c = cfg(); c.token = t; c.chatId = 0; offset = 0;
    try { const me = await api('getMe'); username = me.username || ''; c.username = username; }
    catch (e) { c.token = ''; store.save(); throw e; }
    store.save(); start(); return { username };
  }
  function startPairing() {
    if (!cfg().token) throw new Error('أدخل مفتاح البوت أولاً');
    cfg().chatId = 0; store.save();
    pairing = { code: String(crypto.randomInt(100000, 1000000)), expires: Date.now() + 10 * 60 * 1000 };
    start(); return { code: pairing.code, username: cfg().username };
  }
  function disconnect() { stop(); pairing = null; Object.assign(cfg(), { token: '', chatId: 0, username: '' }); store.save(); }
  const status = () => ({ hasToken: !!cfg().token, paired: !!cfg().chatId, username: cfg().username || '', running, pairing: !!(pairing && Date.now() < pairing.expires) });

  return { start, stop, connect, startPairing, disconnect, status, _onUpdate: onUpdate };
}

module.exports = { create, TOKEN_RE };
