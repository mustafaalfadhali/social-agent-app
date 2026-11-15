// خريطة سراج: بطاقات الوكلاء بأرقام حيّة من بيانات التطبيق. المفاتيح تعمل فقط حيث وُسمت (الرد التلقائي، الموافقة قبل النشر).
(function () {
  const grid = document.getElementById('mapGrid');
  if (!grid) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (n) => Number(n).toLocaleString('ar-SA');
  const money = (n) => num(Math.round(Number(n) || 0)) + ' ر.س';
  let last = { state: null, ct: null, odoo: null, visits: null };
  const GO = { 1: 'office', 2: 'office', 3: 'office', 4: 'posts', 5: 'office', 6: 'contracts', 7: 'office', 8: 'settings' };

  // وكيل: [الاسم، الحالة 'on'|'off'|'soon'، معرّف المفتاح إن كان قابلاً للتبديل]
  function model(st, ct, odoo, visits) {
    const w = st.wa || {}, prof = w.profile || {}, tg = !!(st.telegram && st.telegram.paired);
    const waOn = !!(w.hasBridgeToken && w.hasToken && w.phoneId);
    const posts = st.posts || [];
    const pendingPosts = posts.filter((p) => p.status === 'pending_review' || p.status === 'draft').length;
    const soon = ct && ct.summary ? (ct.summary.soon30 || 0) + (ct.summary.soon90 || 0) : 0;
    const page = st.meta && (st.meta.pages || []).find((p) => p.id === st.meta.selectedPageId);
    const odooOn = !!(st.odoo && st.odoo.hasKey), visOn = !!(st.visits && st.visits.hasToken);
    const review = !(st.settings && st.settings.reviewBeforePublish === false);
    const autoReply = prof.autoReply !== 'off';
    const odooTotal = odoo && !odoo.error && odoo.open ? odoo.open.total : null;
    const remain = visits && !visits.error && visits.totals ? visits.totals.remaining : null;
    const st1 = (b) => (b ? 'on' : 'off');
    return [
      { n: 1, t: 'خدمة العملاء', tag: 'واتساب', c: '#f59e0b', k: waOn ? [num(w.waiting || 0), 'محادثة تنتظر ردّك'] : ['—', 'اربط واتساب من الحسابات'], ag: [['الرد التلقائي', waOn ? st1(autoReply) : 'off', 'auto'], ['كتابة المسودات', st1(waOn)], ['تدخّل المالك عبر تيليجرام', st1(tg)]] },
      { n: 2, t: 'المتابعة والمبيعات', tag: 'تحويل', c: '#a78bfa', k: [num(prof.followFirstHours || 20) + ' ساعة', 'أول متابعة للمتردد'], ag: [['متابعة تلقائية داخل النافذة', st1(waOn)], ['متابعة كل ' + num(prof.followDays || 2) + ' أيام', st1(waOn)], ['مفاوضة السعر من دليلك', st1(waOn)]] },
      { n: 3, t: 'الحجوزات والزيارات', tag: 'ميداني', c: '#fb7185', k: remain === null ? ['—', visOn ? 'أتصل ببرنامج الزيارات…' : 'اربط الزيارات من الحسابات'] : [num(remain), 'فرع لم تكتمل زياراته'], ag: [['تثبيت الموعد عبر تيليجرام', st1(tg)], ['تقدّم زيارات الفروع', st1(visOn)], ['تذكير الفني', 'soon']] },
      { n: 4, t: 'النشر والمحتوى', tag: page ? (page.igId ? 'فيسبوك + إنستغرام' : 'فيسبوك') : 'غير مربوط', c: '#60a5fa', k: [num(pendingPosts), 'بوستات بانتظار النشر'], ag: [['تصميم الصور (Meta + تركيب الشعار)', 'on'], ['كتابة الكابشن', 'on'], ['الموافقة قبل النشر', st1(review), 'review']] },
      { n: 8, t: 'التقارير والعمليات', tag: 'يومي', c: '#2dd4bf', k: [tg ? '✓' : '—', tg ? 'تيليجرام مربوط' : 'اربط تيليجرام'], ag: [['ملخص صباحي', 'soon'], ['تنبيه توقف المهام', st1(tg)], ['سجل العمليات', 'on']] },
      { n: 5, t: 'المحاسبة', tag: 'أودو', c: '#facc15', k: !odooOn ? ['—', 'اربط أودو من الحسابات'] : odooTotal === null ? ['…', 'أتصل بأودو'] : [money(odooTotal), 'مستحقات مفتوحة'], ag: [['تسجيل الدفعات (بموافقتك)', st1(odooOn)], ['إصدار الفواتير (بموافقتك)', st1(odooOn)], ['كشف الحساب PDF', st1(odooOn)]] },
      { n: 6, t: 'العقود', tag: 'تجديد', c: '#4ade80', k: [num(soon), 'عقود تنتهي قريباً'], ag: [['تنبيه الانتهاء', 'on'], ['تقارير العقود', 'on'], ['تجديد تلقائي', 'soon']] },
      { n: 7, t: 'التسويق والإعلانات', tag: 'تحليل', c: '#f472b6', k: [page ? (page.igId ? '٢' : '١') : '٠', 'منصات مربوطة'], ag: [['تحليل الصفحة', st1(!!page)], ['خطة المحتوى', st1(!!page)], ['حملات بموافقتك', 'soon']] },
    ];
  }

  function cardHtml(m) {
    const ag = m.ag.map(([label, s, key]) => {
      const tog = key ? `<button class="mtg ${s === 'on' ? 'on' : ''} live" data-key="${key}" title="تشغيل / إيقاف"></button>` : `<span class="mtg ${s === 'on' ? 'on' : ''}"></span>`;
      return `<li class="mrow ${s}" data-go="${GO[m.n]}" data-state="${s}" data-label="${esc(label)}">${tog}<span>${esc(label)}</span>${s === 'soon' ? '<span class="msoon">قريباً</span>' : ''}</li>`;
    }).join('');
    return `<div class="mcard" style="--c:${m.c}" data-n="${m.n}"><div class="mhd" data-go="${GO[m.n]}"><span class="mnum">0${m.n}</span><b>${esc(m.t)}</b><i class="mtag">${esc(m.tag)}</i></div><div class="mkpi mclick" data-go="${GO[m.n]}"><big>${esc(m.k[0])}</big><span>${esc(m.k[1])}</span></div><ul class="mag">${ag}</ul></div>`;
  }

  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const ICON = { 1: '💬', 2: '📈', 3: '📅', 4: '📝', 5: '💰', 6: '📄', 7: '📣', 8: '📊' };
  let sel = null; // رقم الوكيل المفتوحة تفاصيله

  // خطوط نيون مستقيمة من النواة إلى كل وكيل وإلى رأس الشركة، مع مدارين خافتين ونبضات تتحرك
  function drawLines() {
    let svg = grid.querySelector('.map-lines');
    if (!svg) { svg = mk('svg', { class: 'map-lines' }); grid.prepend(svg); }
    svg.innerHTML = '';
    const core = grid.querySelector('.ncore'); if (!core) return;
    const g = grid.getBoundingClientRect(); if (!g.width) return;
    svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);
    const mid = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - g.left + r.width / 2, y: r.top - g.top + r.height / 2 }; };
    const o = mid(core);
    [[0.38, 0.34], [0.27, 0.24]].forEach(([rx, ry], i) => svg.appendChild(mk('ellipse', { cx: o.x, cy: o.y, rx: g.width * rx, ry: g.height * ry, fill: 'none', stroke: '#7aa2ff', 'stroke-opacity': i ? '.10' : '.16', 'stroke-width': '1', 'stroke-dasharray': i ? '2 9' : '' })));
    const line = (x2, y2, col, delay, dur) => {
      const d = `M${o.x},${o.y} L${x2},${y2}`;
      svg.appendChild(mk('path', { d, fill: 'none', stroke: col, 'stroke-opacity': '.45', 'stroke-width': '1.3' }));
      svg.appendChild(mk('path', { d, fill: 'none', stroke: col, 'stroke-opacity': '.95', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-dasharray': '3 26', class: 'mflow', style: `animation-delay:${delay}s;animation-duration:${dur}s` }));
      const dot = mk('circle', { r: '3', fill: col });
      dot.appendChild(mk('animateMotion', { path: d, dur: (dur * 1.6) + 's', begin: delay + 's', repeatCount: 'indefinite', keyPoints: '0;1;0', keyTimes: '0;.5;1', calcMode: 'linear' }));
      svg.appendChild(dot);
    };
    grid.querySelectorAll('.nnode .nring, .nhead .nring').forEach((el, i) => {
      const c = mid(el), col = getComputedStyle(el).getPropertyValue('--c').trim() || '#60a5fa';
      line(c.x, c.y, col, (i * 0.37) % 3, 3 + (i % 3) * 0.6);
    });
  }

  // نواة الجزيئات: كرة نقاط تدور ببطء (تتوقف حين تكون الخريطة مخفية)
  const PTS = Array.from({ length: 420 }, (_, i) => { const y = 1 - (i / 419) * 2, r = Math.sqrt(1 - y * y), t = i * 2.399963; return [Math.cos(t) * r, y, Math.sin(t) * r, Math.random()]; });
  function spin(ts) {
    requestAnimationFrame(spin);
    const cv = grid.querySelector('canvas.ncore'); if (!cv || !cv.offsetParent) return;
    const S = cv.width, x = cv.getContext('2d'), a = ts / 5200, ca = Math.cos(a), sa = Math.sin(a), R0 = S * 0.42;
    x.clearRect(0, 0, S, S);
    for (const [px, py, pz, rnd] of PTS) {
      const X = px * ca + pz * sa, Z = pz * ca - px * sa, k = (Z + 1.6) / 2.6;
      const tw = 0.55 + 0.45 * Math.sin(ts / 400 + rnd * 40);
      x.globalAlpha = k * tw;
      x.fillStyle = rnd > 0.82 ? '#ffffff' : rnd > 0.45 ? '#ff7a45' : '#ff3d5a';
      x.beginPath(); x.arc(S / 2 + X * R0, S / 2 + py * R0, (0.7 + k * 1.5) * (S / 220), 0, 6.283); x.fill();
    }
    x.globalAlpha = 1;
  }
  requestAnimationFrame(spin);

  function nodeHtml(m, i, total) {
    const ang = (-90 + 360 / total / 2 + i * (360 / total)) * Math.PI / 180;
    const left = 50 + 38 * Math.cos(ang), top = 55 + 34 * Math.sin(ang);
    const on = m.ag.filter((a) => a[1] === 'on').length;
    const dots = m.ag.map((a, j) => `<i class="${a[1]}" style="--a:${(j - (m.ag.length - 1) / 2) * 24}deg"></i>`).join('');
    return `<div class="nnode ${sel === m.n ? 'sel' : ''}" style="--c:${m.c};left:${left.toFixed(2)}%;top:${top.toFixed(2)}%" data-n="${m.n}" title="اضغط لعرض الوكلاء">` +
      `<div class="nring" style="--c:${m.c}">${dots}<span>${ICON[m.n] || '●'}</span></div>` +
      `<div class="nlab"><b>${esc(m.t)}</b><small>${num(on)} من ${num(m.ag.length)} يعمل · <u class="${on ? 'on' : ''}"></u> ${on ? 'متصل' : 'متوقف'}</small><em><big>${esc(m.k[0])}</big> ${esc(m.k[1])}</em></div></div>`;
  }

  function render() {
    const st = last.state; if (!st) return;
    const cards = model(st, last.ct, last.odoo, last.visits);
    const live = cards.reduce((n, m) => n + m.ag.filter((a) => a[1] === 'on').length, 0);
    const soonN = cards.reduce((n, m) => n + m.ag.filter((a) => a[1] === 'soon').length, 0);
    const cur = cards.find((m) => m.n === sel);
    grid.classList.add('neon');
    grid.innerHTML =
      `<div class="nhead" data-go="office" title="افتح المكتب"><div class="nring" style="--c:#fde68a"><img src="center-art.webp" alt=""></div><div class="nlab"><b>شعلة الجزيرة</b><small>الإدارة</small></div></div>` +
      `<div class="ncorebox" data-go="office" title="افتح المكتب"><canvas class="ncore" width="440" height="440"></canvas><div class="ncap"><b>نواة سراج</b><small>${num(live)} وكيلاً يعمل · ${num(soonN)} قريباً · ${num(cards.length)} أقسام</small></div></div>` +
      cards.map((m, i) => nodeHtml(m, i, cards.length)).join('') +
      (cur ? `<div class="ndetail"><button class="nclose" title="إغلاق">✕</button>${cardHtml(cur)}</div>` : '');
    const go = (tab) => { const b = document.querySelector(`nav button[data-tab="${tab}"]`); if (b) b.click(); };
    grid.querySelectorAll('.nnode').forEach((n) => { n.onclick = () => { const k = Number(n.dataset.n); sel = sel === k ? null : k; render(); }; });
    const cl = grid.querySelector('.nclose'); if (cl) cl.onclick = () => { sel = null; render(); };
    grid.querySelectorAll('[data-go]').forEach((h) => {
      h.onclick = (e) => {
        if (e.target.closest('.mtg.live')) return;
        const row = h.closest('.mrow');
        if (row && row.dataset.state === 'soon') { if (typeof toast === 'function') toast(`«${row.dataset.label}» قيد التطوير`); return; }
        if (row && typeof toast === 'function') toast(`${row.dataset.label}: ${row.dataset.state === 'on' ? 'مفعّل' : 'غير مفعّل'}`);
        go(h.dataset.go);
      };
    });
    grid.querySelectorAll('.mtg.live').forEach((b) => { b.onclick = () => toggle(b.dataset.key, !b.classList.contains('on')); });
    requestAnimationFrame(drawLines);
  }

  async function toggle(key, on) {
    const st = last.state || {};
    try {
      if (key === 'auto') {
        const r = await window.api.call('wa:save', { profile: { ...((st.wa && st.wa.profile) || {}), autoReply: on ? 'on' : 'off' } });
        if (!r.ok) throw new Error(r.error);
      } else if (key === 'review') {
        if (!on && !confirm('إلغاء «الموافقة قبل النشر» يعني أن البوستات تُنشر تلقائياً على فيسبوك وإنستغرام دون أن تراها. متأكد؟')) return;
        const r = await window.api.call('settings:save', { reviewBeforePublish: on });
        if (!r.ok) throw new Error(r.error);
      }
      if (typeof refresh === 'function') await refresh();
      if (typeof toast === 'function') toast(on ? 'تم التشغيل' : 'تم الإيقاف');
    } catch (e) { if (typeof toast === 'function') toast('تعذّر: ' + String(e.message || e)); }
  }

  function update(state, ct, odoo, visits) {
    last = { state: state || last.state, ct: ct === undefined ? last.ct : ct, odoo: odoo === undefined ? last.odoo : odoo, visits: visits === undefined ? last.visits : visits };
    render();
  }
  window.SirajMap = { update };
  window.addEventListener('resize', () => requestAnimationFrame(drawLines));
  // نعلّق على Office.update الموجود، فتتحدث الخريطة كلما تحدثت البيانات
  if (typeof Office !== 'undefined' && Office.update) {
    const orig = Office.update;
    Office.update = function (...a) { const r = orig.apply(this, a); try { update(...a); } catch (e) { console.error(e); } return r; };
  }
})();
