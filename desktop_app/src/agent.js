// Daily agent: picks an unused image from the library, asks Claude Code to
// write the post (learning from real feedback/performance - never mock data),
// then publishes or queues it for review.
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const claude = require('./claude');
const meta = require('./meta');
const tiktok = require('./tiktok');

let mediaDir = '';
let busy = false;

function setMediaDir(d) { mediaDir = d; }

function enabledPlatforms(s) {
  return Object.entries(s.autoPlatforms).filter(([, v]) => v).map(([k]) => k);
}

function feedbackHint(data) {
  const recent = data.posts.filter((p) => ['published', 'rejected'].includes(p.status)).slice(0, 8);
  if (!recent.length) return '';
  const lines = recent.map((p) => {
    const stats = p.stats ? ` | تفاعل حقيقي: ${JSON.stringify(p.stats)}` : '';
    const fb = p.feedback ? ` | ملاحظة المالك: ${p.feedback}` : '';
    return `- [${p.status === 'published' ? 'نُشر' : 'رُفض'}] ${p.caption.slice(0, 120)}${stats}${fb}`;
  });
  return 'منشورات سابقة (تعلّم منها: كرّر ما نجح وتجنّب ما رُفض أو ضعف تفاعله):\n' + lines.join('\n');
}

async function createPost(mediaId, platforms, { extraHint = '' } = {}) {
  const data = store.get();
  const m = data.media.find((x) => x.id === mediaId);
  if (!m) throw new Error('الصورة غير موجودة');
  const imagePath = path.join(mediaDir, path.basename(m.file));
  const hint = [feedbackHint(data), extraHint].filter(Boolean).join('\n');
  const caption = await claude.captionForImage({ imagePath, settings: data.settings, platforms, extraHint: hint });
  const post = {
    id: crypto.randomUUID(), mediaId, caption, platforms,
    status: 'draft', results: {}, createdAt: new Date().toISOString(),
  };
  m.usedAt = post.createdAt;
  data.posts.unshift(post);
  store.save();
  return post;
}

async function publishPost(postId) {
  const data = store.get();
  const post = data.posts.find((p) => p.id === postId);
  if (!post) throw new Error('المنشور غير موجود');
  const m = data.media.find((x) => x.id === post.mediaId);
  if (!m) throw new Error('صورة المنشور حُذفت');
  const imagePath = path.join(mediaDir, path.basename(m.file));
  post.results = post.results || {};
  for (const pl of post.platforms) {
    if (post.results[pl]?.ok) continue;
    try {
      let id;
      if (pl === 'facebook') id = await meta.publishFacebook(data.meta, imagePath, post.caption);
      else if (pl === 'instagram') id = await meta.publishInstagram(data.meta, imagePath, post.caption);
      else if (pl === 'tiktok') id = await tiktok.publishImage(data.tiktok, imagePath, post.caption, data.settings.tiktokPrivacy, mediaDir);
      post.results[pl] = { ok: true, id };
      store.log(`✅ نُشر على ${pl}`);
    } catch (e) {
      post.results[pl] = { ok: false, error: e.message };
      store.log(`❌ فشل النشر على ${pl}: ${e.message}`);
    }
  }
  const allOk = post.platforms.every((pl) => post.results[pl]?.ok);
  post.status = allOk ? 'published' : 'failed';
  if (allOk) post.publishedAt = new Date().toISOString();
  store.save();
  return post;
}

let reviewNotifier = null;
function setReviewNotifier(fn) { reviewNotifier = fn; }
let notifier = () => {};
function setNotifier(fn) { notifier = fn || (() => {}); }
const note = (t) => { try { Promise.resolve(notifier(t)).catch(() => {}); } catch {} };

async function dailyRun(opts = {}) {
  if (busy) return;
  busy = true;
  try {
    const data = store.get();
    const platforms = enabledPlatforms(data.settings);
    const gap = Math.max(1, Number(data.settings.everyDays) || 1);
    if (!opts.force && data.lastDailyAt && gap > 1 && Date.now() - Date.parse(data.lastDailyAt) < (gap - 0.5) * 86400000) return;
    if (!platforms.length) return store.log('⚠️ لم تُفعَّل أي منصة للنشر التلقائي');
    const next = data.media.filter((m) => !m.usedAt).sort((a, b) => a.addedAt.localeCompare(b.addedAt))[0];
    if (!next) { note('📣 النشر: لا توجد صور جديدة في «مكتبة الصور». أضف صوراً ليستمر النشر.'); return store.log('⚠️ لا توجد صور جديدة في المكتبة للنشر اليومي'); }
    store.log('🤖 بدء التوليد اليومي…');
    const post = await createPost(next.id, platforms);
    data.lastDailyAt = new Date().toISOString();
    if (data.settings.reviewBeforePublish) {
      post.status = 'pending_review';
      store.save();
      store.log('📝 منشور جديد بانتظار مراجعتك');
      const m0 = data.media.find((x) => x.id === post.mediaId);
      if (reviewNotifier && m0) reviewNotifier(post, path.join(mediaDir, path.basename(m0.file))); else note('📝 منشور جديد بانتظار مراجعتك في سراج (المنشورات):' + String.fromCharCode(10, 10) + String(post.caption).slice(0, 700));
    } else {
      await publishPost(post.id);
      note((post.status === 'published' ? '✅ نُشر بوست جديد على ' + post.platforms.join(' + ') : '❌ فشل نشر البوست: ' + Object.values(post.results || {}).map((r) => r.error).filter(Boolean).join(' | ').slice(0, 300)) + String.fromCharCode(10, 10) + String(post.caption).slice(0, 700));
    }
  } catch (e) {
    store.log('❌ التوليد اليومي فشل: ' + e.message); note('❌ فشل توليد/نشر البوست: ' + String(e.message).slice(0, 200));
  } finally {
    busy = false;
  }
}

// Pull real engagement for posts published 24h+ ago (once), so the agent learns.
async function refreshStats() {
  const data = store.get();
  const due = data.posts.filter((p) => p.status === 'published' && !p.stats &&
    Date.now() - Date.parse(p.publishedAt) > 24 * 3600 * 1000);
  for (const p of due) {
    const stats = {};
    for (const pl of ['facebook', 'instagram']) {
      if (!p.results?.[pl]?.ok) continue;
      try { stats[pl] = await meta.postStats(data.meta, pl, p.results[pl].id); }
      catch (e) { store.log(`⚠️ تعذر جلب إحصائيات ${pl}: ${e.message}`); }
    }
    if (Object.keys(stats).length) p.stats = stats;
  }
  store.save();
}

function tick() {
  const s = store.get().settings;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const day = now.toISOString().slice(0, 10);
  const times = s.dailyTimes.split(/[,،\s]+/).map((t) => t.trim()).filter(Boolean)
    .map((t) => t.replace(/^(\d):/, '0$1:'));
  if (!times.includes(hhmm)) return;
  const key = `${day} ${hhmm}`;
  const data = store.get();
  if (data.lastRuns[key]) return;
  data.lastRuns[key] = true;
  for (const k of Object.keys(data.lastRuns)) if (!k.startsWith(day)) delete data.lastRuns[k];
  store.save();
  dailyRun();
}

function startScheduler() {
  setInterval(tick, 20 * 1000);
  setInterval(() => refreshStats().catch(() => {}), 3 * 3600 * 1000);
  setTimeout(() => refreshStats().catch(() => {}), 60 * 1000);
}

module.exports = { setReviewNotifier, setNotifier, isBusy: () => busy, setMediaDir, createPost, publishPost, dailyRun, startScheduler };
