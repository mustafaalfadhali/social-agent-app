// المكتب التفاعلي: مشهد بكسل يعرض الوكلاء وحالتهم الحية (يرسم بالكامل بالكود، بدون صور).
const Office = (() => {
  const W = 960, H = 540;
  const cv = document.getElementById('officeCanvas');
  const cx = cv.getContext('2d');
  cx.imageSmoothingEnabled = false;
  let agents = [], frame = 0;

  const COLORS = { 'النشر': '#f5a524', 'العقود': '#60a5fa', 'المحاسبة': '#34d399', 'الزيارات': '#c084fc', 'خدمة العملاء': '#fb7185' };
  const SLOTS = [[150, 170], [480, 170], [810, 170], [315, 400], [645, 400]];

  function rect(x, y, w, h, c) { cx.fillStyle = c; cx.fillRect(Math.round(x), Math.round(y), w, h); }

  function floor() {
    rect(0, 0, W, H, '#1c2333');
    for (let y = 0; y < H; y += 40) for (let x = 0; x < W; x += 40) rect(x, y, 40, 40, ((x + y) / 40) % 2 ? '#212a3d' : '#1e2638');
    rect(0, 0, W, 64, '#2b3550'); rect(0, 60, W, 6, '#3b4a6e');
    cx.fillStyle = '#8fa0c8'; cx.font = 'bold 20px sans-serif'; cx.textAlign = 'center'; cx.direction = 'rtl';
    cx.fillText('مكتب سِراج', W / 2, 40);
  }

  function desk(a, x, y, on) {
    rect(x - 70, y + 30, 140, 30, '#7a5a3a'); rect(x - 70, y + 58, 140, 6, '#5b4129');
    rect(x - 28, y - 6, 56, 38, '#10151f'); rect(x - 24, y - 2, 48, 30, on ? '#1f3a5f' : '#171c28');
    if (on) for (let i = 0; i < 4; i++) rect(x - 20, y + 2 + i * 7, 14 + ((frame + i) % 3) * 8, 3, a.color);
    rect(x - 4, y + 32, 8, 4, '#10151f');
    rect(x + 46, y + 8, 6, 22, '#444'); rect(x + 40, y + 2, 18, 8, on ? '#ffd84d' : '#555');
    if (on) { cx.fillStyle = 'rgba(255,216,77,0.14)'; cx.beginPath(); cx.arc(x + 49, y + 16, 46, 0, 7); cx.fill(); }
  }

  function person(a, x, y, on) {
    const bob = on && frame % 2 ? -2 : 0;
    rect(x - 12, y + 34 + bob, 24, 22, a.color);
    rect(x - 10, y + 12 + bob, 20, 22, '#f1c7a0');
    rect(x - 12, y + 8 + bob, 24, 8, '#2a2118');
    rect(x - 6, y + 22 + bob, 3, 3, '#222'); rect(x + 3, y + 22 + bob, 3, 3, '#222');
  }

  function bubble(text, x, y, color) {
    cx.font = '15px sans-serif'; cx.textAlign = 'center'; cx.direction = 'rtl';
    const w = Math.min(230, cx.measureText(text).width + 22);
    rect(x - w / 2, y, w, 28, '#f4f6fb'); rect(x - 5, y + 28, 10, 6, '#f4f6fb');
    rect(x - w / 2, y, 4, 28, color);
    cx.fillStyle = '#1b2233'; cx.fillText(text, x, y + 19, w - 14);
  }

  function draw() {
    floor();
    agents.forEach((a, i) => {
      const [x, y] = SLOTS[i]; const on = a.working;
      desk(a, x, y, on); person(a, x - 30, y - 6, on);
      cx.font = 'bold 17px sans-serif'; cx.textAlign = 'center'; cx.direction = 'rtl';
      cx.fillStyle = a.color; cx.fillText(a.name, x, y + 90);
      bubble(a.text, x, y - 70, a.color);
      if (a.alert) { rect(x + 58, y - 66, 22, 22, '#ef4444'); cx.fillStyle = '#fff'; cx.font = 'bold 15px sans-serif'; cx.fillText(String(a.alert), x + 69, y - 50); }
    });
  }

  function build(state, ct) {
    const pending = state.posts.filter((p) => p.status === 'pending_review').length;
    const soon = ct ? ct.summary.soon30 + ct.summary.soon90 : 0;
    return [
      { name: 'النشر', working: !!state.agentBusy, alert: pending || '', text: state.agentBusy ? 'أكتب منشوراً الآن…' : pending ? `${pending} منشور ينتظر موافقتك` : 'جاهز للنشر' },
      { name: 'العقود', working: soon > 0, alert: soon || '', text: soon ? `${soon} عقود تنتهي قريباً` : 'كل العقود سليمة' },
      { name: 'المحاسبة', working: false, alert: '', text: 'غير مربوط بالبرنامج بعد' },
      { name: 'الزيارات', working: false, alert: '', text: 'قريباً' },
      { name: 'خدمة العملاء', working: false, alert: '', text: 'قريباً (عرض فقط)' },
    ].map((a) => ({ ...a, color: COLORS[a.name] }));
  }

  function renderBox(state, ct) {
    const box = document.getElementById('officeBox');
    const pending = state.posts.filter((p) => p.status === 'pending_review');
    const soon = ct ? ct.items.filter((i) => i.days >= 0 && i.days <= 90) : [];
    box.innerHTML = '<h3>يحتاج موافقتك</h3>' +
      (pending.length ? `<p>📝 ${pending.length} منشور بانتظار المراجعة <button class="ghost" id="goPosts">فتح</button></p>` : '<p class="muted">لا منشورات معلّقة</p>') +
      '<h3>عقود تنتهي قريباً</h3>' +
      (soon.length ? soon.map((i) => `<p>⏳ ${esc(i.client)}<br><span class="muted">باقي ${i.days} يوم · ${esc(i.end)}</span></p>`).join('') : '<p class="muted">لا شيء خلال 90 يوماً</p>');
    const g = document.getElementById('goPosts');
    if (g) g.onclick = () => document.querySelector('nav button[data-tab=posts]').click();
  }

  function update(state, ct) { agents = build(state, ct); draw(); renderBox(state, ct); }

  setInterval(() => { frame++; if (agents.length) draw(); }, 600);
  return { update };
})();
