// وكيل العقود: يقرأ جدول العقود ويحسب الحالة من تاريخ اليوم (قراءة فقط، لا يغيّر شيئاً).
const data = require('./contracts-data.json');

function daysLeft(end, today) {
  return Math.round((new Date(end + 'T00:00:00') - today) / 86400000);
}

function statusOf(c, days) {
  if (c.superseded && days < 0) return 'old';
  if (days < 0) return 'expired';
  if (days <= 30) return 'soon30';
  if (days <= 90) return 'soon90';
  return 'active';
}

function list(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const items = data.contracts.map((c) => {
    const days = daysLeft(c.end, today);
    return { ...c, days, status: statusOf(c, days) };
  });
  const count = (s) => items.filter((i) => i.status === s).length;
  return {
    generated: data.generated,
    today: today.toISOString().slice(0, 10),
    summary: { expired: count('expired'), soon30: count('soon30'), soon90: count('soon90'), active: count('active'), old: count('old') },
    items: items.filter((i) => i.status !== 'old').sort((a, b) => a.days - b.days),
  };
}

module.exports = { list };
