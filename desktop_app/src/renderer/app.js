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

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Tabs
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === b.dataset.tab));
}));

async function refresh() {
  state = await call('state');
  renderHome(); renderLibrary(); renderAccounts();
  if (typeof Office !== 'undefined') Office.update(state, ctData, typeof odooData !== 'undefined' ? odooData : null);
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
        <div class="row"><button data-create="${m.id}">إنشاء منشور</button><button class="ghost" data-del="${m.id}">حذف</button></div>
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
        <span class="status ${p.status}">${ST[p.status] || p.status}</span>
        <span class="muted"> ${p.platforms.map((x) => PL[x]).join('، ')} · ${new Date(p.createdAt).toLocaleString('ar')}</span>
        <textarea data-cap="${p.id}" ${editable ? '' : 'readonly'}>${esc(p.caption)}</textarea>
        ${res ? `<p class="muted">${res}</p>` : ''}${stats}
        ${p.feedback ? `<p class="muted">ملاحظتك: ${esc(p.feedback)}</p>` : ''}
        <div class="row">
          ${editable ? `<button data-pub="${p.id}">${p.status === 'failed' ? 'إعادة المحاولة' : 'نشر الآن'}</button>
          <button class="ghost" data-rej="${p.id}">رفض</button>` : ''}
          <button class="ghost" data-delpost="${p.id}">حذف</button>
        </div>
      </div></div>`;
  }).join('') || '<p class="muted">لا توجد منشورات بعد.</p>';
}

function renderAccounts() {
  const m = state.meta;
  $('metaRedirect').textContent = m.redirect;
  $('metaAppId').value = m.appId; $('metaConfigId').value = m.configId;
  $('metaPage').innerHTML = m.pages.map((p) =>
    `<option value="${p.id}" ${p.id === m.selectedPageId ? 'selected' : ''}>${esc(p.name)}${p.igUsername ? ' + @' + esc(p.igUsername) : ' (بدون إنستغرام)'}</option>`).join('')
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

async function checkClaude() {
  const r = await window.api.call('claude:status');
  const st = r.ok ? r.data : { ok: false, msg: r.error };
  $('claudeStatus').textContent = st.ok ? `متصل ✅ ${st.version}` : `غير متاح ❌ ${st.msg || ''}`;
  $('claudeBadge').textContent = `Claude Code: ${st.ok ? 'متصل' : 'غير متصل'}`;
}

// Events
$('btnClaudeLogin').onclick = () => call('claude:login');
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
$('ctSearch').oninput = renderContracts; $('ctFilter').onchange = renderContracts;

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

// ---- شريط الأوامر ----
const chat = [];
function addChat(role, text, agent, proposal) {
  chat.push({ role, text, agent, proposal });
  renderChat();
}
function renderChat() {
  const el = $('chatLog');
  el.style.display = chat.length ? 'block' : 'none';
  el.innerHTML = chat.slice(-12).map((m) => m.role === 'user'
    ? `<div class="msg me">${esc(m.text)}</div>`
    : `<div class="msg ag"><b class="who">${esc(m.agent || 'المكتب')}</b>${esc(m.text).replace(/\n/g, '<br>')}${m.proposal ? `<div class="prop">📝 مقترح (لم يُنفَّذ): ${esc(m.proposal.summary || '')}</div>` : ''}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}
$('cmdBar').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('cmdInput').value.trim(); if (!text) return;
  $('cmdInput').value = ''; addChat('user', text);
  const btn = $('cmdSend'); btn.disabled = true; $('cmdInput').disabled = true; addChat('ag', 'أفكر…', 'المكتب');
  try {
    const r = await window.api.call('assistant:ask', { text, history: chat.filter((m) => m.text !== 'أفكر…').slice(-8, -1).map((m) => ({ role: m.role === 'user' ? 'user' : 'office', text: m.text })) });
    chat.pop();
    if (r.ok) { addChat('ag', r.data.reply, r.data.agent, r.data.proposal); Office.say(r.data.agent, r.data.reply.split('\n')[0].slice(0, 40)); }
    else addChat('ag', '⚠ ' + (/OAuth|authenticate|login/i.test(r.error) ? 'Claude Code غير مسجّل الدخول. افتح الإعدادات واضغط «تسجيل الدخول».' : r.error), 'المكتب');
  } finally { btn.disabled = false; $('cmdInput').disabled = false; $('cmdInput').focus(); }
};

(async () => {
  await refresh();
  fillOdoo(); loadOdoo(); setInterval(loadOdoo, 120000);
  loadContracts();
  fillSettings();
  checkClaude();
  setInterval(refresh, 30000);
})();
