const $ = (id) => document.getElementById(id);
let state = null;
let createMediaId = null;
let rejectId = null;

const PL = { facebook: 'فيسبوك', instagram: 'إنستغرام', tiktok: 'تيك توك' };
const ST = { draft: 'مسودة', pending_review: 'بانتظار المراجعة', published: 'منشور', failed: 'فشل', rejected: 'مرفوض' };

function toast(msg, err = false) {
  const t = $('toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(() => (t.style.display = 'none'), 5000);
}

async function call(ch, ...args) {
  const r = await window.api.call(ch, ...args);
  if (!r.ok) { toast(r.error, true); throw new Error(r.error); }
  return r.data;
}

async function withBusy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch {} finally { btn.disabled = false; }
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Tabs
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === b.dataset.tab));
}));

async function refresh() {
  state = await call('state');
  renderHome(); renderLibrary(); renderAccounts(); renderTg();
  if (typeof Office !== 'undefined') Office.update(state, ctData, typeof odooData !== 'undefined' ? odooData : null, typeof visitsData !== 'undefined' ? visitsData : null);
  if (!document.activeElement?.dataset?.cap) renderPosts();
}

function renderHome() {
  const m = state.meta, page = m.pages.find((p) => p.id === m.selectedPageId);
  $('accSummary').innerHTML = [
    `فيسبوك: ${page ? esc(page.name) : 'غير مربوط'}`,
    `إنستغرام: ${page?.igUsername ? '@' + esc(page.igUsername) : 'غير مربوط'}`,
    `تيك توك: ${state.tiktok.connected ? esc(state.tiktok.displayName || 'مربوط') : 'غير مربوط'}`,
  ].join('<br>');
  const s = state.settings;
  const unused = state.media.filter((x) => !x.usedAt).length;
  const pls = Object.entries(s.autoPlatforms).filter(([, v]) => v).map(([k]) => PL[k]).join('، ') || 'لا شيء';
  $('scheduleSummary').innerHTML = `الأوقات: ${esc(s.dailyTimes)}<br>المنصات: ${pls}<br>صور جاهزة: ${unused}` +
    (s.reviewBeforePublish ? '<br>مع مراجعة قبل النشر' : '');
  $('log').innerHTML = state.log.map((l) =>
    `<li><time>${new Date(l.at).toLocaleString('ar')}</time>${esc(l.msg)}</li>`).join('') || '<li class="muted">لا يوجد</li>';
}

function renderLibrary() {
  $('mediaGrid').innerHTML = state.media.slice().reverse().map((m) => `
    <div class="tile">
      <img src="${esc(m.url)}" loading="lazy">
      <div class="meta">${esc(m.name)}<br><span class="muted">${m.usedAt ? 'مستخدمة' : 'جديدة'}</span>
        <div class="row"><button data-create="${esc(m.id)}">إنشاء منشور</button><button class="ghost" data-del="${esc(m.id)}">حذف</button></div>
      </div>
    </div>`).join('') || '<p class="muted">لا توجد صور بعد.</p>';
}

function renderPosts() {
  const media = Object.fromEntries(state.media.map((m) => [m.id, m]));
  $('postList').innerHTML = state.posts.map((p) => {
    const res = Object.entries(p.results || {}).map(([k, v]) =>
      `${PL[k]}: ${v.ok ? '✅' : '❌ ' + esc(v.error)}`).join('<br>');
    const stats = p.stats ? `<p class="muted">التفاعل: ${esc(JSON.stringify(p.stats))}</p>` : '';
    const editable = ['draft', 'pending_review', 'failed'].includes(p.status);
    return `<div class="post">
      ${media[p.mediaId] ? `<img src="${esc(media[p.mediaId].url)}">` : ''}
      <div class="body">
        <span class="status ${esc(p.status)}">${ST[p.status] || p.status}</span>
        <span class="muted"> ${p.platforms.map((x) => PL[x]).join('، ')} · ${new Date(p.createdAt).toLocaleString('ar')}</span>
        <textarea data-cap="${esc(p.id)}" ${editable ? '' : 'readonly'}>${esc(p.caption)}</textarea>
        ${res ? `<p class="muted">${res}</p>` : ''}${stats}
        ${p.feedback ? `<p class="muted">ملاحظتك: ${esc(p.feedback)}</p>` : ''}
        <div class="row">
          ${editable ? `<button data-pub="${esc(p.id)}">${p.status === 'failed' ? 'إعادة المحاولة' : 'نشر الآن'}</button>
          <button class="ghost" data-rej="${esc(p.id)}">رفض</button>` : ''}
          <button class="ghost" data-delpost="${esc(p.id)}">حذف</button>
        </div>
      </div></div>`;
  }).join('') || '<p class="muted">لا توجد منشورات بعد.</p>';
}

function renderAccounts() {
  const m = state.meta;
  $('metaRedirect').textContent = m.redirect;
  $('metaAppId').value = m.appId; $('metaConfigId').value = m.configId;
  $('metaPage').innerHTML = m.pages.map((p) =>
    `<option value="${esc(p.id)}" ${p.id === m.selectedPageId ? 'selected' : ''}>${esc(p.name)}${p.igUsername ? ' + @' + esc(p.igUsername) : ' (بدون إنستغرام)'}</option>`).join('')
    || '<option>غير مربوط</option>';
  const t = state.tiktok;
  $('ttRedirect').textContent = t.redirect;
  $('ttKey').value = t.clientKey;
  $('ttStatus').textContent = t.connected ? `مربوط: ${t.displayName}` : 'غير مربوط';
}

function fillSettings() {
  const s = state.settings;
  $('sName').value = s.businessName; $('sDesc').value = s.businessDescription;
  $('sTone').value = s.tone; $('sLang').value = s.language; $('sTimes').value = s.dailyTimes;
  $('pFacebook').checked = s.autoPlatforms.facebook; $('pInstagram').checked = s.autoPlatforms.instagram;
  $('pTiktok').checked = s.autoPlatforms.tiktok; $('sReview').checked = s.reviewBeforePublish;
  $('sAutoStart').checked = s.autoStart; $('sClaudePath').value = s.claudePath; $('sTtPrivacy').value = s.tiktokPrivacy;
}

$('btnClaudeCheck').onclick = async (e) => {
  e.target.disabled = true; $('claudeCheck').textContent = 'جارِ الفحص…';
  const r = await window.api.call('claude:check');
  $('claudeCheck').textContent = r.ok ? `✅ الدخول سليم (رد: ${r.data.reply}، ${r.data.seconds} ث)` : '❌ ' + r.error;
  e.target.disabled = false;
};

async function checkClaude() {
  const r = await window.api.call('claude:status');
  const st = r.ok ? r.data : { ok: false, msg: r.error };
  if (!st.ok) { $('claudeStatus').textContent = `غير متاح ❌ ${st.msg || ''}`; $('claudeBadge').textContent = 'Claude Code: غير متصل'; return false; }
  $('claudeStatus').textContent = st.loggedIn ? `مسجّل الدخول ✅ (${st.version})` : `مثبّت (${st.version}) لكن غير مسجّل الدخول ❌ اضغط «تسجيل الدخول»`;
  $('claudeBadge').textContent = `Claude Code: ${st.loggedIn ? 'متصل' : 'غير مسجّل الدخول'}`;
  document.getElementById('claudeBadge').classList.toggle('off', !st.loggedIn);
  return st.loggedIn;
}

// Events
$('btnClaudeLogin').onclick = async () => {
  await call('claude:login');
  toast('أكمل تسجيل الدخول في النافذة السوداء والمتصفح…');
  const t0 = Date.now();
  const timer = setInterval(async () => { // نتابع تلقائياً حتى يكتمل الدخول (3 دقائق كحد أقصى)
    if (await checkClaude()) { clearInterval(timer); toast('تم تسجيل الدخول ✅'); }
    else if (Date.now() - t0 > 3 * 60 * 1000) clearInterval(timer);
  }, 3000);
};
$('btnClaudeInstall').onclick = () => call('claude:install');
$('btnRunNow').onclick = (e) => withBusy(e.target, async () => { toast('جارِ التوليد…'); await call('agent:runNow'); await refresh(); });
$('btnAddMedia').onclick = (e) => withBusy(e.target, async () => { const n = await call('media:add'); if (n) toast(`تمت إضافة ${n} صورة`); await refresh(); });

$('mediaGrid').onclick = async (e) => {
  const c = e.target.dataset.create, d = e.target.dataset.del;
  if (d && confirm('حذف الصورة؟')) { await call('media:remove', d); await refresh(); }
  if (c) {
    createMediaId = c;
    $('createImg').src = state.media.find((m) => m.id === c).url;
    $('cHint').value = '';
    $('createDlg').showModal();
  }
};
$('btnCreateCancel').onclick = () => $('createDlg').close();
$('btnCreateGo').onclick = (e) => withBusy(e.target, async () => {
  const platforms = [['cFacebook', 'facebook'], ['cInstagram', 'instagram'], ['cTiktok', 'tiktok']]
    .filter(([id]) => $(id).checked).map(([, k]) => k);
  if (!platforms.length) return toast('اختر منصة واحدة على الأقل', true);
  toast('Claude يكتب المنشور…');
  await call('post:create', createMediaId, platforms, $('cHint').value);
  $('createDlg').close();
  await refresh();
  document.querySelector('nav button[data-tab=posts]').click();
});

$('postList').onclick = async (e) => {
  const { pub, rej, delpost } = e.target.dataset;
  if (pub) await withBusy(e.target, async () => {
    const cap = document.querySelector(`textarea[data-cap="${pub}"]`).value;
    await call('post:update', pub, { caption: cap });
    toast('جارِ النشر…');
    const p = await call('post:publish', pub);
    toast(p.status === 'published' ? 'تم النشر ✅' : 'بعض المنصات فشلت - راجع التفاصيل', p.status !== 'published');
    await refresh();
  });
  if (rej) { rejectId = rej; $('rejReason').value = ''; $('rejectDlg').showModal(); }
  if (delpost && confirm('حذف المنشور من القائمة؟')) { await call('post:delete', delpost); await refresh(); }
};

$('btnRejCancel').onclick = () => $('rejectDlg').close();
$('btnRejGo').onclick = async () => { await call('post:reject', rejectId, $('rejReason').value); $('rejectDlg').close(); await refresh(); };

$('btnMetaSave').onclick = async () => {
  await call('meta:saveApp', { appId: $('metaAppId').value, appSecret: $('metaAppSecret').value, configId: $('metaConfigId').value });
  $('metaAppSecret').value = ''; toast('تم الحفظ'); await refresh();
};
$('btnMetaConnect').onclick = (e) => withBusy(e.target, async () => {
  await call('meta:saveApp', { appId: $('metaAppId').value, appSecret: $('metaAppSecret').value, configId: $('metaConfigId').value });
  toast('أكمل تسجيل الدخول في المتصفح…'); await call('meta:connect'); toast('تم ربط Meta ✅'); await refresh();
});
$('btnMetaToken').onclick = (e) => withBusy(e.target, async () => { await call('meta:connectToken', $('metaToken').value); $('metaToken').value = ''; toast('تم ربط Meta ✅'); await refresh(); });
$('metaPage').onchange = async (e) => { await call('meta:selectPage', e.target.value); await refresh(); };

$('btnTtSave').onclick = async () => { await call('tiktok:saveApp', { clientKey: $('ttKey').value, clientSecret: $('ttSecret').value }); $('ttSecret').value = ''; toast('تم الحفظ'); await refresh(); };
$('btnTtConnect').onclick = (e) => withBusy(e.target, async () => {
  await call('tiktok:saveApp', { clientKey: $('ttKey').value, clientSecret: $('ttSecret').value });
  toast('أكمل تسجيل الدخول في المتصفح…'); await call('tiktok:connect'); toast('تم ربط تيك توك ✅'); await refresh();
});
$('btnTtDisconnect').onclick = async () => { await call('tiktok:disconnect'); await refresh(); };

$('btnSaveSettings').onclick = async () => {
  await call('settings:save', {
    businessName: $('sName').value, businessDescription: $('sDesc').value, tone: $('sTone').value,
    language: $('sLang').value, dailyTimes: $('sTimes').value,
    autoPlatforms: { facebook: $('pFacebook').checked, instagram: $('pInstagram').checked, tiktok: $('pTiktok').checked },
    reviewBeforePublish: $('sReview').checked, autoStart: $('sAutoStart').checked,
    claudePath: $('sClaudePath').value.trim(), tiktokPrivacy: $('sTtPrivacy').value,
  });
  toast('تم حفظ الإعدادات ✅'); await refresh(); checkClaude();
};

const CT = { renewed: 'تم التجديد', soon30: 'ينتهي خلال 30 يوماً', soon90: 'ينتهي خلال 90 يوماً', active: 'ساري' };
let ctData = null;
async function loadContracts() { ctData = await call('contracts:list'); renderContracts(); if (state) Office.update(state, ctData); }
function renderContracts() {
  if (!ctData) return;
  const s = ctData.summary;
  $('ctDate').textContent = `بتاريخ ${ctData.today}`;
  $('ctSource').textContent = ctData.live ? `متصل بمجلدي شعلة الجزيرة وشعلة الجديدة على سطح المكتب — ${ctData.filesSeen} ملف Word، آخر فحص ${new Date(ctData.lastScan).toLocaleTimeString('ar')}. أي عقد تحفظه أو تعدّله يُضاف تلقائياً.` : 'يعرض آخر نسخة محفوظة، وجارِ الاتصال بمجلدات سطح المكتب…';
  $('ctSummary').innerHTML = ['soon30', 'soon90', 'active', 'renewed'].map((k) =>
    `<div class="card"><div class="muted">${CT[k]}</div><div class="big ct-${k}">${s[k]}</div></div>`).join('');
  const q = $('ctSearch').value.trim(), f = $('ctFilter').value;
  const items = ctData.items.filter((i) => (!f || i.status === f) && (!q || i.client.includes(q)));
  $('ctList').innerHTML = items.map((i) => `
    <div class="post ct-row ct-${i.status}">
      <div class="body"><b>${esc(i.client)}</b> <span class="status">${CT[i.status]}</span>
        <div class="muted">${esc(i.entity)} · ${esc(i.no || 'بدون رقم')} · ${esc(i.start)} ← ${esc(i.end)} · ${i.days < 0 ? 'جُدِّد بعد ' + (-i.days) + ' يوم من نهايته' : 'باقي ' + i.days + ' يوم'}</div>
        ${i.visits ? `<div class="muted">${esc(i.visits)}</div>` : ''}
        ${i.flags.length ? `<div class="muted">⚠ ${esc(i.flags.join('، '))}</div>` : ''}
      </div>
    </div>`).join('') || '<p class="muted">لا نتائج</p>';
}
$('btnCtScan').onclick = (e) => withBusy(e.target, async () => { const r = await call('contracts:rescan'); await loadContracts(); toast(`تم الفحص: ${r.contracts} عقد من ${r.filesSeen} ملف`); });
setInterval(loadContracts, 60000);
$('ctSearch').oninput = renderContracts; $('ctFilter').onchange = renderContracts;



// ---- زيارات الفروع (قراءة فقط) ----
let visitsData = null, visitsFetching = false;
function fillVisits() { const v = state.visits; $('vsUrl').value = v.url; $('vsStatus').textContent = v.hasToken ? 'الرمز محفوظ' : ''; }
async function loadVisits() {
  if (!state?.visits?.hasToken || visitsFetching) { if (!state?.visits?.hasToken) { visitsData = null; Office.update(state, ctData, undefined, null); } return; }
  visitsFetching = true;
  try { const r = await window.api.call('visits:summary'); visitsData = r.ok ? r.data : { error: r.error }; } finally { visitsFetching = false; }
  Office.update(state, ctData, undefined, visitsData);
}
$('btnVsSave').onclick = async () => { await call('visits:save', { url: $('vsUrl').value, token: $('vsToken').value }); $('vsToken').value = ''; toast('تم الحفظ'); await refresh(); loadVisits(); };
$('btnVsTest').onclick = (e) => withBusy(e.target, async () => {
  await call('visits:save', { url: $('vsUrl').value, token: $('vsToken').value }); $('vsToken').value = '';
  const r = await call('visits:test'); toast(`اتصال ناجح ✅ (${r.branches} فرعاً)`); await refresh(); loadVisits();
});
$('btnVsOff').onclick = async () => { await call('visits:disconnect'); visitsData = null; await refresh(); fillVisits(); Office.update(state, ctData, undefined, null); toast('تم فصل الزيارات'); };

// ---- واتساب (خدمة العملاء) ----
function fillWa() { const w = state.wa; $('waUrl').value = w.workerUrl; $('waPhone').value = w.phoneId; $('waStatus').textContent = [w.hasBridgeToken ? 'رمز الجسر محفوظ' : '', w.hasToken ? 'رمز واتساب محفوظ' : ''].filter(Boolean).join(' · '); }
const waForm = () => ({ workerUrl: $('waUrl').value, phoneId: $('waPhone').value, pullToken: $('waBridge').value, token: $('waToken').value });
$('btnWaSave').onclick = async () => { await call('wa:save', waForm()); $('waBridge').value = ''; $('waToken').value = ''; toast('تم الحفظ'); await refresh(); fillWa(); };
$('btnWaTest').onclick = (e) => withBusy(e.target, async () => { await call('wa:save', waForm()); $('waBridge').value = ''; $('waToken').value = ''; const r = await call('wa:test'); toast(`الجسر يعمل ✅ (${r.pending} رسالة بالانتظار)`); await refresh(); fillWa(); });
$('btnWaOff').onclick = async () => { if (!confirm('فصل واتساب ومسح المحادثات المحفوظة؟')) return; await call('wa:disconnect'); await refresh(); fillWa(); toast('تم فصل واتساب'); };

// ---- تيليجرام ----
let tgTimer = null;
function renderTg() {
  const t = state.telegram, el = $('tgStatus');
  if (!t.hasToken) { el.textContent = 'غير متصل.'; return; }
  el.textContent = t.paired ? `✅ متصل بحسابك${t.username ? ' (@' + t.username + ')' : ''}. أرسل له رسالة من جوالك.` : `البوت @${t.username || '…'} جاهز. اضغط «ربط حسابي» ثم أرسل الرمز له.`;
}
$('btnTgSave').onclick = (e) => withBusy(e.target, async () => {
  const r = await call('telegram:save', $('tgToken').value.trim()); $('tgToken').value = '';
  toast('تم الاتصال بالبوت @' + r.username); await refresh(); renderTg();
});
$('btnTgPair').onclick = (e) => withBusy(e.target, async () => {
  const r = await call('telegram:pair');
  $('tgStatus').textContent = `أرسل هذا الرمز إلى @${r.username} من جوالك خلال 10 دقائق:  ${r.code}`;
  clearInterval(tgTimer);
  tgTimer = setInterval(async () => { await refresh(); if (state.telegram.paired) { clearInterval(tgTimer); renderTg(); toast('تم ربط تيليجرام ✅'); } }, 3000);
  setTimeout(() => clearInterval(tgTimer), 10 * 60 * 1000);
});
$('btnTgOff').onclick = async () => { await call('telegram:disconnect'); await refresh(); renderTg(); toast('تم فصل تيليجرام'); };

// ---- أودو (قراءة فقط) ----
let odooData = null, odooFetching = false;
function fillOdoo() { const o = state.odoo; $('odUrl').value = o.url; $('odDb').value = o.db; $('odLogin').value = o.login; $('odStatus').textContent = o.hasKey ? 'المفتاح محفوظ' : ''; }
async function loadOdoo() {
  if (!state?.odoo?.hasKey || odooFetching) { if (!state?.odoo?.hasKey) { odooData = null; Office.update(state, ctData, null); } return; }
  odooFetching = true;
  try { const r = await window.api.call('odoo:summary'); odooData = r.ok ? r.data : null; if (!r.ok) odooData = { error: r.error }; } finally { odooFetching = false; }
  Office.update(state, ctData, odooData);
}
$('btnOdSave').onclick = async () => { await call('odoo:save', { url: $('odUrl').value, db: $('odDb').value, login: $('odLogin').value, apiKey: $('odKey').value }); $('odKey').value = ''; toast('تم الحفظ'); await refresh(); loadOdoo(); };
$('btnOdTest').onclick = (e) => withBusy(e.target, async () => { await call('odoo:save', { url: $('odUrl').value, db: $('odDb').value, login: $('odLogin').value, apiKey: $('odKey').value }); $('odKey').value = ''; const r = await call('odoo:test'); toast('اتصال ناجح ✅ ' + r.company); await refresh(); loadOdoo(); });
$('btnOdOff').onclick = async () => { await call('odoo:disconnect'); odooData = null; await refresh(); fillOdoo(); toast('تم فصل أودو'); };

// ---- مرفق الحوالة + بطاقة الدفعة ----
let attached = null;
function setAttached(a) {
  attached = a;
  const el = $('cmdChip');
  el.style.display = a ? 'flex' : 'none';
  el.innerHTML = a ? `<span>📎 ${esc(a.name)}</span><button type="button" class="ghost" id="chipX">✕</button>` : '';
  if (a) $('chipX').onclick = () => setAttached(null);
}
async function attachFile(file) {
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) { toast('الملف أكبر من 12 ميجا', true); return; }
  const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(file); });
  const a = await call('inbox:save', { name: file.name || 'حوالة', data });
  setAttached(a); toast('تم إرفاق الحوالة');
}
$('cmdAttach').onclick = async () => { const a = await call('inbox:pick'); if (a) { setAttached(a); toast('تم إرفاق الحوالة'); } };
$('cmdInput').addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files || [])].find((x) => /^image\//.test(x.type));
  if (f) { e.preventDefault(); attachFile(f).catch((err) => toast(err.message, true)); }
});
const officeTab = $('office');
officeTab.addEventListener('dragover', (e) => e.preventDefault());
officeTab.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) attachFile(f).catch((err) => toast(err.message, true)); });

const money2 = (n) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
function payCard(ref) {
  const p = (state?.proposals || []).find((x) => x.id === ref.id);
  if (!p) return `<div class="prop">${esc(ref.summary || '')}</div>`;
  const e = p.extract || {};
  const head = `<div class="pay-h">💰 حوالة ${money2(p.amount)} ${esc(e.currency || 'SAR')} · ${esc(p.date)}${p.dateAssumed ? ' (تاريخ اليوم)' : ''}</div>` +
    `<div class="muted">${e.payer ? 'من: ' + esc(e.payer) + ' · ' : ''}${e.bank ? esc(e.bank) + ' · ' : ''}${e.reference ? 'مرجع: ' + esc(e.reference) : ''}</div>` +
    (p.warnings || []).map((w) => `<div class="pay-w">⚠ ${esc(w)}</div>`).join('');
  if (p.status === 'done') return `<div class="pay done">${head}<div class="pay-ok">✅ سُجّلت الدفعة على ${esc(p.result.name)} (الحالة: ${esc(p.result.paymentState)}، المتبقي ${money2(p.result.residual)})</div></div>`;
  if (p.status === 'rejected') return `<div class="pay">${head}<div class="muted">تم الرفض، ولم يُسجَّل شيء.</div></div>`;
  const cands = (p.candidates || []).map((c) => `<div class="pay-c ${p.selected === c.id ? 'sel' : ''}">
      <span>${esc(c.name)} — ${esc(c.partner)}<br><span class="muted">متبقي ${money2(c.residual)} · ${esc(c.date || '')}${c.exact ? ' · مطابق للمبلغ' : c.partial ? ' · دفعة جزئية' : ''}</span></span>
      ${p.selected === c.id ? '<b>✓ مختارة</b>' : `<button type="button" class="ghost" data-act="sel" data-id="${esc(p.id)}" data-inv="${esc(c.id)}">اختر</button>`}</div>`).join('');
  return `<div class="pay">${head}${cands || '<div class="muted">لا توجد فاتورة مفتوحة مطابقة.</div>'}
    ${p.error ? `<div class="pay-w">⚠ ${esc(p.error)}</div>` : ''}
    <div class="row"><button type="button" data-act="ok" data-id="${esc(p.id)}" ${p.selected && p.status === 'pending' ? '' : 'disabled'}>موافقة وتسجيل الدفعة</button>
    <button type="button" class="ghost" data-act="no" data-id="${esc(p.id)}">رفض</button></div></div>`;
}
$('chatLog').addEventListener('click', async (e) => {
  const d = e.target.closest('button[data-doc]');
  if (d) { try { await call('doc:open', d.dataset.doc); } catch { /* call() يعرض الخطأ */ } return; }
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const { act, id, inv } = b.dataset;
  const p = (state?.proposals || []).find((x) => x.id === id);
  b.disabled = true;
  try {
    if (act === 'sel') await call('proposal:select', id, Number(inv));
    if (act === 'no') await call('proposal:reject', id);
    if (act === 'ok') {
      const c = p && p.candidates.find((x) => x.id === p.selected);
      if (!c || !confirm(`تسجيل دفعة ${money2(p.amount)} على الفاتورة ${c.name} (${c.partner}) بتاريخ ${p.date} في أودو؟\nهذا يغيّر سجلك المحاسبي.`)) { b.disabled = false; return; }
      const r = await call('proposal:approve', id);
      toast(`✅ سُجّلت الدفعة على ${r.name}`);
    }
  } catch { /* call() يعرض الخطأ */ }
  await refresh(); renderChat();
});

// ---- شريط الأوامر ----
const chat = [];
function addChat(role, text, agent, proposal, doc) {
  chat.push({ role, text, agent, proposal, doc });
  renderChat();
}
function renderChat() {
  const el = $('chatLog');
  el.style.display = chat.length ? 'block' : 'none';
  el.innerHTML = chat.slice(-12).map((m) => m.role === 'user'
    ? `<div class="msg me">${esc(m.text)}</div>`
    : `<div class="msg off"><b class="who">${esc(m.agent || 'المكتب')}</b>${esc(m.text).replace(/\n/g, '<br>')}${m.doc ? `<div class="row"><button type="button" class="ghost" data-doc="${esc(m.doc.id)}">📄 فتح: ${esc(m.doc.title)}</button></div>` : ''}${m.proposal ? (m.proposal.type === 'payment' ? payCard(m.proposal) : `<div class="prop">📝 مقترح (لم يُنفَّذ): ${esc(m.proposal.summary || '')}</div>`) : ''}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}
$('cmdBar').onsubmit = async (e) => {
  e.preventDefault();
  let text = $('cmdInput').value.trim();
  const att = attached; if (!text && !att) return;
  if (att && !text) text = 'سجّل هذه الحوالة';
  $('cmdInput').value = ''; setAttached(null);
  addChat('user', (att ? '📎 ' + att.name + (text === 'سجّل هذه الحوالة' ? '' : ' — ' + text) : text));
  const btn = $('cmdSend'); btn.disabled = true; $('cmdInput').disabled = true; addChat('ag', 'أفكر…', 'المكتب');
  try {
    const r = await window.api.call('assistant:ask', { text, attachments: att ? [att.id] : [], history: chat.filter((m) => m.text !== 'أفكر…').slice(-8, -1).map((m) => ({ role: m.role === 'user' ? 'user' : 'office', text: m.text })) });
    chat.pop();
    if (r.ok) { addChat('ag', r.data.reply, r.data.agent, r.data.proposal, r.data.doc); Office.say(r.data.agent, r.data.reply.split('\n')[0].slice(0, 40)); }
    else addChat('off', '⚠ تعذّر الرد من Claude Code: ' + r.error + (/OAuth|authenticate|login/i.test(r.error) ? '\nسجّل الدخول (/login في نافذة Claude) ثم اضغط «فحص الدخول» في الرئيسية.' : ''), 'المكتب');
  } finally { btn.disabled = false; $('cmdInput').disabled = false; $('cmdInput').focus(); }
};

(async () => {
  await refresh();
  fillOdoo(); fillVisits(); fillWa(); renderTg(); loadOdoo(); loadVisits(); setInterval(loadOdoo, 120000); setInterval(loadVisits, 120000);
  loadContracts();
  fillSettings();
  checkClaude();
  setInterval(refresh, 30000);
})();
