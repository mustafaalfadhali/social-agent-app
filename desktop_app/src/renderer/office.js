// المكتب التفاعلي v2: مشهد بكسل كبير يُرسم بالكود، والنصوص HTML فوقه (حادة وعربية سليمة).
const Office = (() => {
  const W = 1280, H = 980;
  const cv = document.getElementById('officeCanvas');
  const cx = cv.getContext('2d');
  const layer = document.getElementById('officeLayer');
  const drawer = document.getElementById('officeDrawer');
  let agents = [], frame = 0, selected = null, hover = null, last = { state: null, ct: null, odoo: null, visits: null };
  const money = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n) + ' ر.س';

  const COL = { 'النشر': '#f5a524', 'العقود': '#60a5fa', 'المحاسبة': '#34d399', 'الزيارات': '#c084fc', 'خدمة العملاء': '#fb7185' };
  const SKIN = ['#f1c7a0', '#e0ac82', '#c68a63', '#f1c7a0', '#d9a679'];
  const HAIR = ['#2a2118', '#1b1b1b', '#3b2a1a', '#4a3322', '#101010'];
  const POS = [[250, 400], [640, 400], [1030, 400], [440, 740], [840, 740]]; // مراكز المكاتب

  const R = (x, y, w, h, c) => { cx.fillStyle = c; cx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };

  // ---------- الخلفية ----------
  function room() {
    R(0, 0, W, H, '#232c44');
    // الجدار
    R(0, 0, W, 210, '#2d3857'); R(0, 196, W, 14, '#3a4770'); R(0, 210, W, 6, '#1b2236');
    for (let x = 0; x < W; x += 80) R(x, 0, 2, 196, 'rgba(255,255,255,.035)');
    // النوافذ (مدينة ليلاً)
    [[110, 34], [470, 34], [830, 34]].forEach(([wx, wy]) => {
      R(wx - 6, wy - 6, 312, 152, '#141a2b'); R(wx, wy, 300, 140, '#101a33');
      for (let i = 0; i < 18; i++) R(wx + ((i * 53) % 290), wy + ((i * 29) % 70), 3, 3, 'rgba(255,255,255,.7)');
      [[10, 60, 36, 80], [56, 40, 30, 100], [96, 70, 44, 70], [150, 30, 34, 110], [194, 58, 40, 82], [244, 46, 46, 94]].forEach(([bx, by, bw, bh], k) => {
        R(wx + bx, wy + by, bw, bh, '#1b2547');
        for (let yy = by + 8; yy < by + bh - 6; yy += 14) for (let xx = bx + 6; xx < bx + bw - 6; xx += 12)
          if (((xx + yy + k) % 3)) R(wx + xx, wy + yy, 5, 6, ((xx * yy + frame / 9 | 0) % 7) ? 'rgba(255,214,120,.65)' : 'rgba(255,214,120,.25)');
      });
      R(wx + 148, wy, 4, 140, '#141a2b'); R(wx, wy + 68, 300, 4, '#141a2b');
    });
    // أرضية سجادة مقسّمة
    R(0, 216, W, H - 216, '#2a2740');
    for (let y = 216; y < H; y += 48) for (let x = 0; x < W; x += 48) R(x, y, 48, 48, ((x + y) / 48) % 2 ? '#2d2a45' : '#292640');
    R(0, 216, W, 10, 'rgba(0,0,0,.28)');
    // سجادة المنتصف
    R(260, 560, 760, 330, 'rgba(96,165,250,.06)'); R(260, 560, 760, 4, 'rgba(96,165,250,.18)');
    R(0, 880, W, 100, 'rgba(0,0,0,.18)');
  }

  function plant(x, y, big) {
    const s = big ? 1.4 : 1;
    R(x - 18 * s, y + 24 * s, 36 * s, 30 * s, '#8b5a3c'); R(x - 22 * s, y + 20 * s, 44 * s, 8 * s, '#a06a46');
    [[-4, -30, 8, 54], [-22, -14, 8, 38], [14, -14, 8, 38], [-12, -22, 8, 44], [6, -22, 8, 44]].forEach(([dx, dy, w, h]) => R(x + dx * s, y + dy * s, w * s, h * s, '#3c9d63'));
    R(x - 4 * s, y - 30 * s, 8 * s, 6 * s, '#58c283');
  }

  function shelf(x, y) {
    R(x, y, 130, 150, '#5b3f2a'); R(x + 6, y + 6, 118, 138, '#3d2a1b');
    [0, 1, 2].forEach((r) => {
      R(x + 6, y + 48 + r * 46, 118, 4, '#6b4a31');
      ['#60a5fa', '#f5a524', '#34d399', '#fb7185', '#c084fc', '#e5e7eb'].forEach((c, i) => R(x + 12 + i * 18 + (r % 2) * 4, y + 12 + r * 46 + (i % 2) * 4, 12, 32 - (i % 2) * 4, c));
    });
  }

  function sofa(x, y) { // ركن جلوس
    R(x, y + 40, 150, 70, '#3a4a78'); R(x, y + 10, 150, 40, '#46598f'); R(x - 14, y + 30, 24, 80, '#3a4a78'); R(x + 140, y + 30, 24, 80, '#3a4a78');
    R(x + 10, y + 100, 130, 8, 'rgba(0,0,0,.3)'); R(x + 50, y + 44, 50, 6, 'rgba(255,255,255,.15)');
    R(x + 40, y + 116, 70, 22, '#9b7249'); R(x + 60, y + 108, 14, 10, '#e9edf7'); R(x + 80, y + 110, 14, 8, '#c0392b');
  }

  function coffee(x, y) { // ركن القهوة
    R(x, y + 36, 96, 74, '#5a3f26'); R(x, y + 30, 96, 10, '#9b7249');
    R(x + 10, y - 14, 44, 46, '#2a2f3d'); R(x + 14, y - 10, 36, 14, '#10151f'); R(x + 20, y + 10, 24, 14, '#e9edf7');
    R(x + 66, y + 8, 18, 22, '#e9edf7'); R(x + 84, y + 14, 6, 10, '#e9edf7');
    if (frame % 3 === 0) R(x + 72, y - 4, 3, 10, 'rgba(255,255,255,.3)');
  }

  function board(x, y) { // لوحة الجدار
    R(x, y, 240, 112, '#141a2b'); R(x + 6, y + 6, 228, 100, '#1d2742');
    [20, 44, 68].forEach((yy, i) => R(x + 20, y + yy, 60 + i * 38 + ((frame + i) % 4) * 6, 8, ['#f5a524', '#60a5fa', '#34d399'][i]));
  }

  // ---------- المكتب والشخصية ----------
  function workstation(a, i) {
    const [x, y] = POS[i], on = a.working, c = a.color;
    const hov = hover === i || selected === i;
    // ظل + هالة التحديد
    R(x - 150, y + 92, 300, 18, 'rgba(0,0,0,.3)');
    if (hov) { cx.strokeStyle = c; cx.lineWidth = 3; cx.setLineDash([10, 6]); cx.strokeRect(x - 156, y - 150, 312, 262); cx.setLineDash([]); }
    // الكرسي
    R(x - 38, y - 6, 76, 66, '#1a1f33'); R(x - 32, y - 12, 64, 12, '#232a44'); R(x - 8, y + 60, 16, 28, '#2a3150');
    person(a, i, x, y - 50, on);
    // المكتب
    R(x - 140, y + 46, 280, 20, '#9b7249'); R(x - 140, y + 62, 280, 12, '#6e4f30'); R(x - 128, y + 74, 14, 22, '#5a3f26'); R(x + 114, y + 74, 14, 22, '#5a3f26');
    // الشاشة
    R(x - 56, y - 52, 112, 82, '#0d1220'); R(x - 50, y - 46, 100, 66, on ? '#16315a' : '#141a2c');
    R(x - 8, y + 30, 16, 14, '#0d1220'); R(x - 26, y + 42, 52, 6, '#0d1220');
    if (on) for (let k = 0; k < 6; k++) R(x - 44, y - 40 + k * 10, 20 + ((frame * 3 + k * 7) % 5) * 12, 5, k % 2 ? c : '#9fc6ff');
    else R(x - 44, y - 40, 40, 5, '#2a3350');
    // لوحة المفاتيح + كوب
    R(x - 42, y + 50, 84, 8, '#d0d6e6'); R(x + 78, y + 28, 22, 26, '#e9edf7'); R(x + 100, y + 34, 6, 14, '#e9edf7'); R(x + 80, y + 30, 18, 6, '#6b4a31');
    if (on) { R(x + 84, y + 12 - (frame % 3) * 4, 3, 10, 'rgba(255,255,255,.35)'); }
    // المصباح
    R(x - 112, y + 24, 6, 26, '#4a4f60'); R(x - 124, y + 14, 30, 12, on ? '#ffd84d' : '#6b7080');
    if (on) { const g = cx.createRadialGradient(x - 109, y + 30, 4, x - 109, y + 30, 90); g.addColorStop(0, 'rgba(255,216,77,.28)'); g.addColorStop(1, 'rgba(255,216,77,0)'); cx.fillStyle = g; cx.fillRect(x - 200, y - 60, 180, 180); }
    // نبتة صغيرة
    R(x + 108, y + 14, 16, 18, '#3c9d63'); R(x + 104, y + 30, 24, 16, '#8b5a3c');
  }

  function person(a, i, x, y, on) {
    const bob = on ? ((frame % 2) ? -2 : 0) : ((frame % 6 === 0) ? 2 : 0), c = a.color;
    // الجسم
    R(x - 24, y + 36 + bob, 48, 56, c); R(x - 24, y + 36 + bob, 48, 8, 'rgba(255,255,255,.2)');
    // الرقبة والرأس
    R(x - 6, y + 28 + bob, 12, 10, SKIN[i]); R(x - 20, y - 12 + bob, 40, 42, SKIN[i]);
    // الشعر
    R(x - 22, y - 18 + bob, 44, 16, HAIR[i]); R(x - 22, y - 8 + bob, 6, 14, HAIR[i]); R(x + 16, y - 8 + bob, 6, 14, HAIR[i]);
    // العيون والفم
    const blink = frame % 9 === 0;
    R(x - 11, y + 8 + bob, 6, blink ? 2 : 7, '#1b1b1b'); R(x + 5, y + 8 + bob, 6, blink ? 2 : 7, '#1b1b1b');
    R(x - 6, y + 22 + bob, 12, 3, on ? '#7a3b2e' : '#9b5a46');
    // نظارة للعقود/المحاسبة
    if (i === 1 || i === 2) { cx.strokeStyle = '#1b1b1b'; cx.lineWidth = 2; cx.strokeRect(x - 15, y + 5 + bob, 13, 11); cx.strokeRect(x + 2, y + 5 + bob, 13, 11); }
    // الذراعان (تكتب عند العمل)
    const t = on ? (frame % 2 ? 6 : 0) : 0;
    R(x - 34, y + 50 + bob, 12, 36, c); R(x + 22, y + 50 + bob, 12, 36, c);
    R(x - 36, y + 84 + bob - t, 14, 10, SKIN[i]); R(x + 22, y + 84 + bob - (on ? 6 - t : 0), 14, 10, SKIN[i]);
    if (a.alert) { R(x + 26, y - 32 + bob, 6, 18, '#ef4444'); R(x + 26, y - 10 + bob, 6, 6, '#ef4444'); }
  }

  function draw() {
    room();
    shelf(40, 62); plant(1190, 160, true); plant(70, 860, true); plant(1200, 860, true); board(520, 70 + 20);
    sofa(60, 690); coffee(1110, 690);
    agents.forEach((a, i) => workstation(a, i));
  }

  // ---------- الطبقة التفاعلية (HTML) ----------
  const esc2 = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function layerHtml() {
    return agents.map((a, i) => {
      const [x, y] = POS[i];
      const L = ((x - 150) / W * 100).toFixed(2), T = ((y - 150) / H * 100).toFixed(2), Wd = (300 / W * 100).toFixed(2), Hd = (262 / H * 100).toFixed(2);
      return `<div class="ag" data-i="${i}" style="left:${L}%;top:${T}%;width:${Wd}%;height:${Hd}%;--c:${a.color}">
        <div class="bub ${a.working ? 'on' : ''}">${a.alert ? `<span class="bd">${esc2(a.alert)}</span>` : ''}${esc2(a.text)}</div>
        <div class="plate"><i class="dot ${a.working ? 'on' : ''}"></i>${esc2(a.name)}</div></div>`;
    }).join('');
  }

  function bind() {
    layer.querySelectorAll('.ag').forEach((el) => {
      const i = +el.dataset.i;
      el.onmouseenter = () => { hover = i; draw(); };
      el.onmouseleave = () => { hover = null; draw(); };
      el.onclick = () => { selected = i; draw(); openDrawer(i); };
    });
  }

  const num = (n) => new Intl.NumberFormat('en-US').format(n || 0);
  async function loadMk(el) {
    const r = await window.api.call('social:overview');
    if (!el.isConnected) return;
    if (!r.ok) { el.innerHTML = `<p class="muted">⚠ ${esc2(r.error)}</p>`; return; }
    const s = r.data;
    if (!s.connected) { el.innerHTML = '<p class="muted">اربط ميتا من الحسابات لتظهر الإحصائيات.</p>'; return; }
    const fb = s.facebook, ig = s.instagram, ad = s.ads;
    const cell = (v, lab) => `<div><b>${v}</b><span>${lab}</span></div>`;
    let h = '<div class="mini">';
    h += fb && !fb.__error ? cell(num(fb.followers), 'متابعو فيسبوك') : cell('—', 'فيسبوك');
    h += ig && ig.connected ? cell(num(ig.followers), 'متابعو انستقرام') : cell('—', 'انستقرام');
    h += fb && !fb.__error ? cell(fb.posts_last_30_days, 'منشورات فيسبوك (30 يوماً)') : '';
    h += '</div>';
    const best = [fb, ig].filter((x) => x && x.timing).map((x) => `${x.timing.best_day} ${x.timing.best_hour}`)[0];
    if (best) h += `<p class="muted">أفضل وقت للنشر حسب تفاعلك: ${esc2(best)}</p>`;
    const top = ig && ig.top && ig.top[0];
    if (top) h += `<p class="muted">أفضل منشور في انستقرام: ${esc2(top.text.slice(0, 50))} (${num(top.likes)} إعجاب)</p>`;
    h += ad && ad.connected ? `<p class="muted">الإعلانات: ${ad.accounts.length} حساب مقروء</p>` : '<p class="muted">الإعلانات غير مربوطة بعد.</p>';
    if (fb && fb.__error) h += `<p class="muted">⚠ فيسبوك: ${esc2(fb.__error)}</p>`;
    if (ig && ig.__error) h += `<p class="muted">⚠ انستقرام: ${esc2(ig.__error)}</p>`;
    el.innerHTML = h;
  }

  function openDrawer(i) {
    const a = agents[i], st = last.state, ct = last.ct;
    let body = `<p class="muted">${esc2(a.role)}</p><div class="st"><span class="chip ${a.working ? 'ok' : ''}">${a.working ? 'يعمل الآن' : 'جاهز'}</span> ${esc2(a.text)}</div>`;
    if (a.name === 'النشر') {
      const pend = st.posts.filter((p) => p.status === 'pending_review').length;
      const logs = st.log.slice(0, 5).map((l) => `<li>${esc2(l.msg)}</li>`).join('') || '<li class="muted">لا نشاط بعد</li>';
      body += `<div class="row"><button id="odRun">تشغيل الآن</button><button class="ghost" id="odPosts">المنشورات${pend ? ' (' + pend + ')' : ''}</button></div>` +
        `<h4>خبير التسويق</h4><div id="odMk"><p class="muted">جارِ قراءة إحصائيات ميتا…</p></div>` +
        `<div class="row"><button class="ghost" data-ask="اكتب تقرير السوشال ميديا الأسبوعي: الأرقام وأفضل المنشورات وأفضل وقت للنشر مع 3 توصيات">تقرير أسبوعي</button><button class="ghost" data-ask="اقترح خطة محتوى لأسبوعين مناسبة لنشاطنا بناءً على أداء منشوراتنا">خطة محتوى</button><button class="ghost" data-ask="حلّل الحملات الإعلانية والإنفاق آخر 30 يوماً واقترح حملة جديدة بميزانية وجمهور">الإعلانات</button></div>` +
        `<h4>آخر النشاط</h4><ul>${logs}</ul>`;
    } else if (a.name === 'العقود') {
      const soon = ct ? ct.items.filter((c) => c.days >= 0 && c.days <= 90) : [];
      body += `<div class="row"><button id="odCt">فتح العقود</button></div><h4>تنتهي خلال 90 يوماً</h4><ul>${soon.map((c) => `<li>${esc2(c.client)}<br><span class="muted">باقي ${c.days} يوم · ${esc2(c.end)}</span></li>`).join('') || '<li class="muted">لا شيء</li>'}</ul>`;
    } else if (a.name === 'المحاسبة') {
      const o = last.odoo;
      if (!st.odoo.hasKey) body += `<p class="muted">لم يُربط بأودو بعد.</p><div class="row"><button id="odGo">ربط أودو</button></div>`;
      else if (!o) body += '<p class="muted">جارِ الاتصال بأودو…</p>';
      else if (o.error) body += `<p class="muted">⚠ ${esc2(o.error)}</p><div class="row"><button class="ghost" id="odGo">فتح إعدادات أودو</button></div>`;
      else body += `<div class="mini"><div><b>${money(o.month.total)}</b><span>فواتير هذا الشهر (${o.month.count})</span></div><div><b>${money(o.open.total)}</b><span>مستحقات مفتوحة (${o.open.count})</span></div><div><b>${money(o.year.total)}</b><span>فواتير هذه السنة (${o.year.count})</span></div></div>` +
        (o.customers.length ? '<h4>أرصدة العملاء المفتوحة</h4><ul>' + o.customers.map((c) => `<li>${esc2(c.name)}<br><span class="muted">${money(c.residual)}</span></li>`).join('') + '</ul>' : '') +
        '<h4>آخر الفواتير</h4><ul>' + o.recent.map((i) => `<li>${i.paid ? '✅' : '⏳'} ${esc2(i.name)} · ${money(i.total)}<br><span class="muted">${esc2(i.partner)} · ${esc2(i.date || '')}</span></li>`).join('') + '</ul>';
      body += '<p class="muted">قراءة فقط. الإصدار وتسجيل الدفعات يأتيان لاحقاً بموافقتك.</p>';
    } else if (a.name === 'الزيارات') {
      const v = last.visits;
      if (!st.visits.hasToken) body += '<p class="muted">لم يُربط ببرنامج الزيارات بعد.</p><div class="row"><button id="odGo">ربط الزيارات</button></div>';
      else if (!v) body += '<p class="muted">جارِ الاتصال…</p>';
      else if (v.error) body += `<p class="muted">⚠ ${esc2(v.error)}</p><div class="row"><button class="ghost" id="odGo">فتح إعدادات الزيارات</button></div>`;
      else body += `<div class="mini"><div><b>${v.totals.fullyVisited} / ${v.totals.branches}</b><span>فرع اكتملت زياراته هذا الشهر</span></div></div><h4>التقدم لكل براند</h4><ul>` +
        v.brands.map((b) => `<li><b>${esc2(b.label)}</b>: تمت ${b.done} من ${b.required} زيارة<br><span class="muted">${b.remainingSites ? 'باقٍ ' + b.remainingSites + ' فرع' : '✅ اكتمل'}${b.missing ? '' : ''}</span></li>`).join('') + '</ul>' +
        (v.today_list.length ? '<h4>زيارات اليوم</h4><ul>' + v.today_list.map((x) => `<li>${esc2(x.branch)}<br><span class="muted">${esc2(x.brand)} · ${esc2(x.type)}</span></li>`).join('') + '</ul>' : '');
      body += '<p class="muted">قراءة فقط. أرقام الشهر الحالي وتُصفَّر آخر الشهر.</p>';
    } else {
      body += `<p class="muted">لم يُربط بالبرنامج بعد، وسيبدأ عمله عند الربط.</p>`;
    }
    drawer.innerHTML = `<button class="x" id="odX">✕</button><h3 style="color:${a.color}">${esc2(a.name)}</h3>${body}`;
    drawer.classList.toggle('r', POS[i][0] < W / 2);
    drawer.classList.add('open');
    drawer.querySelector('#odX').onclick = () => { drawer.classList.remove('open'); selected = null; draw(); };
    const g = (id) => drawer.querySelector(id);
    drawer.querySelectorAll('[data-ask]').forEach((b) => { b.onclick = () => { $('cmdInput').value = b.dataset.ask; drawer.classList.remove('open'); $('cmdBar').requestSubmit(); }; });
    if (g('#odMk')) loadMk(g('#odMk'));
    if (g('#odRun')) g('#odRun').onclick = (e) => withBusy(e.target, async () => { toast('جارِ التوليد…'); await call('agent:runNow'); await refresh(); });
    if (g('#odPosts')) g('#odPosts').onclick = () => document.querySelector('nav button[data-tab=posts]').click();
    if (g('#odGo')) g('#odGo').onclick = () => document.querySelector('nav button[data-tab=accounts]').click();
    if (g('#odCt')) g('#odCt').onclick = () => document.querySelector('nav button[data-tab=contracts]').click();
  }

  // ---------- البيانات ----------
  const pendingPay = (state) => (state.proposals || []).filter((p) => p.type === 'payment' && p.status === 'pending').length;

  function accountingAgent(state, o) {
    const base = { name: 'المحاسبة', role: 'يعرض فواتير أودو ومستحقاتك (شعلة الخدمات). الإصدار وتسجيل الدفعات لاحقاً بموافقتك.' };
    if (!state.odoo || !state.odoo.hasKey) return { ...base, working: false, alert: '', text: 'اربط أودو من الحسابات' };
    const pp = pendingPay(state);
    if (pp) return { ...base, working: true, alert: pp, text: 'حوالة تنتظر موافقتك' };
    if (!o) return { ...base, working: false, alert: '', text: 'أتصل بأودو…' };
    if (o.error) return { ...base, working: false, alert: '!', text: 'تعذّر الاتصال بأودو' };
    return { ...base, working: true, alert: o.open.count || '', text: o.open.total > 0 ? `مستحقات ${money(o.open.total)}` : 'لا مستحقات مفتوحة' };
  }

  function visitsAgent(state, v) {
    const base = { name: 'الزيارات', role: 'يتابع تقدم زيارات الفروع هذا الشهر لكل براند (قراءة فقط من برنامج الزيارات).' };
    if (!state.visits || !state.visits.hasToken) return { ...base, working: false, alert: '', text: 'اربط الزيارات من الحسابات' };
    if (!v) return { ...base, working: false, alert: '', text: 'أتصل ببرنامج الزيارات…' };
    if (v.error) return { ...base, working: false, alert: '!', text: 'تعذّر الاتصال بالزيارات' };
    return { ...base, working: true, alert: '', text: `${v.totals.remaining} فرع لم تكتمل زياراته` };
  }

  function build(state, ct) {
    const pending = state.posts.filter((p) => p.status === 'pending_review').length;
    const soon = ct ? ct.summary.soon30 + ct.summary.soon90 : 0;
    const pubPage = state.meta && (state.meta.pages || []).find((p) => p.id === state.meta.selectedPageId);
    return [
      { name: 'النشر', role: 'يكتب المنشورات وينشرها على فيسبوك وإنستغرام وتيك توك، وما يحتاج موافقتك يقف عندك.', working: !!state.agentBusy || !!pubPage, alert: pending || '', text: state.agentBusy ? 'أكتب منشوراً الآن…' : pending ? 'منشورات تنتظر موافقتك' : !pubPage ? 'اربط ميتا من الحسابات' : pubPage.igId ? 'مربوط: فيسبوك + إنستغرام' : 'مربوط: فيسبوك فقط' },
      { name: 'العقود', role: 'يتابع عقود العملاء ويحسب ما ينتهي قريباً وما تجدد تلقائياً.', working: soon > 0, alert: soon || '', text: soon ? 'عقود تنتهي قريباً' : 'كل العقود سليمة' },
      accountingAgent(state, last.odoo),
      visitsAgent(state, last.visits),
      { name: 'خدمة العملاء', role: 'سيعرض حالة محادثات واتساب (للعرض فقط).', working: false, alert: '', text: 'قريباً' },
    ].map((a) => ({ ...a, color: COL[a.name], text: said[a.name] ? said[a.name] : a.text }));
  }

  function kpis(state, ct) {
    const pend = state.posts.filter((p) => p.status === 'pending_review').length + pendingPay(state);
    const soon = ct ? ct.summary.soon30 + ct.summary.soon90 : 0;
    const working = agents.filter((a) => a.working).length;
    document.getElementById('officeKpis').innerHTML =
      `<div class="kpi"><b>${working}</b><span>وكلاء يعملون</span></div><div class="kpi ${pend ? 'warn' : ''}"><b>${pend}</b><span>بانتظار موافقتك</span></div><div class="kpi ${soon ? 'warn' : ''}"><b>${soon}</b><span>عقود تنتهي قريباً</span></div>`;
  }

  function update(state, ct, odoo, visits) {
    last = { state, ct, odoo: odoo === undefined ? last.odoo : odoo, visits: visits === undefined ? last.visits : visits };
    const prev = layer.children.length;
    agents = build(state, ct);
    layer.innerHTML = layerHtml(); bind();
    kpis(state, ct); draw();
    if (selected !== null && drawer.classList.contains('open')) openDrawer(selected);
  }

  setInterval(() => { frame++; if (agents.length) draw(); }, 500);
  // فقاعة مؤقتة من الوكيل بعد رد شريط الأوامر
  const said = {};
  function say(name, text) { said[name] = text; setTimeout(() => { delete said[name]; if (last.state) update(last.state, last.ct); }, 9000); if (last.state) update(last.state, last.ct); }
  return { update, say };
})();
