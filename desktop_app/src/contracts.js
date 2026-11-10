// وكيل العقود: يجمع العقود من مجلدات سطح المكتب (مراقبة تلقائية) + عقود برنامج العقود المحفوظة،
// ويطبّق قواعد مصطفى، ويحسب الحالة من تاريخ اليوم (قراءة فقط، لا يغيّر شيئاً).
// التاريخ الماضي = «تم التجديد» (العقود تتجدد تلقائياً ما لم يُخطَر بالإلغاء).
const fs = require('fs');
const path = require('path');
const scanner = require('./contractScan');
const bundled = require('./contracts-data.json'); // نسخة احتياطية + عقود برنامج العقود بالسيرفر

const STOP = new Set('شركة شركه مطاعم مطعم مصنع مؤسسة موسسة مقهى لتقديم لخدمات الوجبات المحدودة للحلويات للتجارة انظمة'.split(' '));
const keyOf = (name) => {
  const w = String(name).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((x) => x && !STOP.has(x));
  return (w.length ? w.slice(0, 2).join(' ') : String(name));
};
const SPECIAL = /تصبيحة|ابو الهوس|أبو الهوس|دار السلال/;

let state = { records: null, cache: {}, lastScan: null, filesSeen: 0, roots: [], cacheFile: '' };

function roots(desktop) {
  return ['شعلة الجزيرة', 'شعلة الجديدة'].map((n) => path.join(desktop, n)).filter((p) => fs.existsSync(p));
}

// قواعد الجهة: الخدمات للعميلين تصبيحة وأبو الهوس فقط، والباقي الجزيرة.
function applyRules(records) {
  const kept = [];
  for (const r of records) {
    const special = SPECIAL.test((r.client || '') + ' ' + (r.file || ''));
    if (special) { if (/تصبيحة/.test(r.client || '')) r.entity = 'شعلة الخدمات'; if (r.entity === 'شعلة الخدمات') kept.push(r); }
    else if (r.entity === 'شعلة الجزيرة') kept.push(r);
  }
  return kept;
}

function merged() {
  const fromBundle = bundled.contracts.filter((c) => c.source === 'برنامج العقود' || !state.records);
  const scanned = state.records ? applyRules(state.records.map((r) => ({ ...r, source: 'ملفات العقود' }))) : [];
  const all = [...fromBundle, ...scanned].map((c) => ({
    ...c, key: keyOf(c.client),
    flags: c.flags || [...(c.baddate ? ['تاريخ غير صحيح في العقد'] : []), ...(['RS-0327', 'RS-0321', 'RS-0328'].includes(c.no) ? ['رقم قالب متكرر'] : [])],
  }));
  // إزالة المكرر (نفس العميل والتواريخ) مع تفضيل عقود برنامج العقود
  const seen = new Set(), uniq = [];
  for (const c of all.sort((a, b) => (a.source !== 'برنامج العقود') - (b.source !== 'برنامج العقود'))) {
    const k = `${c.key}|${c.start}|${c.end}`;
    if (seen.has(k)) continue; seen.add(k); uniq.push(c);
  }
  return uniq;
}

function daysLeft(end, today) { return Math.round((new Date(end + 'T00:00:00') - today) / 86400000); }
function statusOf(days) { return days < 0 ? 'renewed' : days <= 30 ? 'soon30' : days <= 90 ? 'soon90' : 'active'; }

function list(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const all = merged();
  const latest = {};
  for (const c of all) latest[c.key] = c.end > (latest[c.key] || '') ? c.end : latest[c.key];
  const items = all.map((c) => ({ ...c, days: daysLeft(c.end, today) }))
    .filter((c) => !(c.days < 0 && c.end < latest[c.key])) // النسخ الأقدم المنتهية لنفس العميل
    .map((c) => ({ ...c, status: statusOf(c.days) }));
  const count = (s) => items.filter((i) => i.status === s).length;
  return {
    generated: bundled.generated, lastScan: state.lastScan, filesSeen: state.filesSeen, live: !!state.records,
    today: today.toISOString().slice(0, 10),
    summary: { renewed: count('renewed'), soon30: count('soon30'), soon90: count('soon90'), active: count('active') },
    items: items.sort((a, b) => (a.days < 0) - (b.days < 0) || (a.days < 0 ? b.days - a.days : a.days - b.days)),
  };
}

// ---------- المسح والمراقبة ----------
const idsOf = () => new Set(merged().map((c) => `${c.key}|${c.start}|${c.end}|${c.no}`));

function rescan(log = () => {}) {
  const before = state.records ? idsOf() : null;
  const r = scanner.scan(state.roots, state.cache);
  state.records = r.records; state.cache = r.cache; state.filesSeen = r.filesSeen; state.lastScan = new Date().toISOString();
  try { fs.writeFileSync(state.cacheFile, JSON.stringify({ cache: state.cache })); } catch { /* الكاش اختياري */ }
  if (before) {
    for (const c of merged()) if (!before.has(`${c.key}|${c.start}|${c.end}|${c.no}`)) log(`عقد جديد أو معدَّل: ${c.client} (${c.start} → ${c.end})`);
  }
  return { contracts: list().items.length, filesSeen: r.filesSeen, parsed: r.parsed };
}

function init({ desktop, userData, log }) {
  state.roots = roots(desktop);
  state.cacheFile = path.join(userData, 'contracts-scan.json');
  try { state.cache = JSON.parse(fs.readFileSync(state.cacheFile, 'utf8')).cache || {}; } catch { state.cache = {}; }
  setTimeout(() => { try { rescan(() => {}); } catch (e) { log('تعذّر مسح العقود: ' + e.message); } }, 1500);
  scanner.watch(state.roots, () => { try { const r = rescan(log); log(`تحديث العقود من المجلد: ${r.contracts} عقد`); } catch (e) { log('تعذّر مسح العقود: ' + e.message); } });
  setInterval(() => { try { rescan(log); } catch { /* يُعاد لاحقاً */ } }, 10 * 60 * 1000);
}

module.exports = { list, init, rescan: (log) => rescan(log) };
