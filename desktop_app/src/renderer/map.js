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
  // خيوط عنكبوت: حبال منحنية من النواة إلى كل وكيل، وحلقة تربط الوكلاء بعضهم ببعض، وعليها نبضات تذهب وتعود
  function drawLines() {
    let svg = grid.querySelector('.map-lines');
    if (!svg) { svg = mk('svg', { class: 'map-lines' }); grid.prepend(svg); }
    svg.innerHTML = '';
    const orb = grid.querySelector('.morb'); if (!orb) return;
    const g = grid.getBoundingClientRect(), o = orb.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);
    const ox = o.left - g.left + o.width / 2, oy = o.top - g.top + o.height / 2;
    const nodes = [...grid.querySelectorAll('.mcard')].map((c) => {
      const r = c.getBoundingClientRect();
      return { x: r.left - g.left + r.width / 2, y: r.top - g.top + r.height / 2, col: getComputedStyle(c).getPropertyValue('--c').trim() || '#60a5fa' };
    });
    nodes.forEach((n) => { n.a = Math.atan2(n.y - oy, n.x - ox); });
    const ring = [...nodes].sort((p, q) => p.a - q.a);
    const rope = (x1, y1, x2, y2, sag, col, delay, dur) => {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const cx = mx - (dy / len) * sag, cy = my + (dx / len) * sag, d = `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
      svg.appendChild(mk('path', { d, fill: 'none', stroke: col, 'stroke-opacity': '.3', 'stroke-width': '1.4', 'stroke-linecap': 'round' }));
      svg.appendChild(mk('path', { d, fill: 'none', stroke: col, 'stroke-opacity': '.9', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-dasharray': '3 26', class: 'mflow', style: `animation-delay:${delay}s;animation-duration:${dur}s` }));
      const dot = mk('circle', { r: '3.2', fill: col, opacity: '.95' });
      dot.appendChild(mk('animateMotion', { path: d, dur: (dur * 1.6) + 's', begin: delay + 's', repeatCount: 'indefinite', keyPoints: '0;1;0', keyTimes: '0;.5;1', calcMode: 'linear' }));
      svg.appendChild(dot);
    };
    nodes.forEach((n, i) => rope(ox, oy, n.x, n.y, (i % 2 ? 1 : -1) * 26, n.col, (i * 0.37) % 3, 3.2 + (i % 3) * 0.6));
    ring.forEach((n, i) => { const m = ring[(i + 1) % ring.length]; rope(n.x, n.y, m.x, m.y, 34, n.col, (i * 0.5) % 4, 4 + (i % 2)); });
  }

  function render() {
    const st = last.state; if (!st) return;
    const cards = model(st, last.ct, last.odoo, last.visits);
    const live = cards.reduce((n, m) => n + m.ag.filter((a) => a[1] === 'on').length, 0);
    const soonN = cards.reduce((n, m) => n + m.ag.filter((a) => a[1] === 'soon').length, 0);
    grid.innerHTML = cards.map(cardHtml).join('') +
      `<div class="morb" data-go="office" title="افتح المكتب"><i></i><div class="mfilm"><img src="center-art.webp" alt=""><u class="mdust"></u><u class="msweep"></u><u class="mvig"></u></div><div class="mcap"><b>${num(live)}</b><span>وكيلاً يعمل</span><small>${num(soonN)} قريباً</small></div></div>`;
    const go = (tab) => { const b = document.querySelector(`nav button[data-tab="${tab}"]`); if (b) b.click(); };
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
