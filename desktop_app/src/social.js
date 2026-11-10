// خبير السوشال ميديا: قراءة حقيقية فقط من ميتا (فيسبوك + انستقرام + الإعلانات). لا ينشر ولا ينفق شيئاً.
const meta = require('./meta');

const TTL = 10 * 60 * 1000;
let cache = { at: 0, key: '', data: null };

const riyadh = (iso) => new Date(new Date(iso).getTime() + 3 * 3600e3); // يُقرأ بـ getUTC*
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const short = (s, n = 90) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

async function safe(fn) { try { return await fn(); } catch (e) { return { __error: e.message }; } }

// أفضل يوم وساعة من متوسط التفاعل (يحتاج 5 منشورات على الأقل)
function timing(posts) {
  if (posts.length < 5) return null;
  const byDay = {}, byHour = {};
  for (const p of posts) {
    const d = riyadh(p.at);
    (byDay[d.getUTCDay()] ||= []).push(p.score);
    (byHour[d.getUTCHours()] ||= []).push(p.score);
  }
  const avg = (o) => Object.entries(o).map(([k, v]) => [Number(k), v.reduce((a, b) => a + b, 0) / v.length, v.length]).sort((a, b) => b[1] - a[1]);
  const d = avg(byDay)[0], h = avg(byHour)[0];
  return { best_day: DAYS[d[0]], best_day_posts: d[2], best_hour: `${String(h[0]).padStart(2, '0')}:00`, best_hour_posts: h[2] };
}

function wrap(posts, sinceDays = 30) {
  const now = Date.now();
  const recent = posts.filter((p) => now - new Date(p.at).getTime() < sinceDays * 864e5);
  const top = [...posts].sort((a, b) => b.score - a.score).slice(0, 5);
  const avg = posts.length ? Math.round(posts.reduce((a, p) => a + p.score, 0) / posts.length) : 0;
  return { sampled: posts.length, posts_last_30_days: recent.length, avg_score: avg, timing: timing(posts), top, latest: posts.slice(0, 5) };
}

async function facebook(m, page) {
  const info = await meta.graph('GET', `/${page.id}`, { fields: 'name,fan_count,followers_count', access_token: page.token });
  const r = await meta.graph('GET', `/${page.id}/posts`, {
    fields: 'id,message,created_time,permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)',
    limit: 30, access_token: page.token,
  });
  const posts = (r.data || []).map((p) => {
    const reactions = p.reactions?.summary?.total_count ?? 0, comments = p.comments?.summary?.total_count ?? 0, shares = p.shares?.count ?? 0;
    return { id: p.id, at: p.created_time, text: short(p.message), url: p.permalink_url, reactions, comments, shares, score: reactions + comments * 2 + shares * 3 };
  });
  return { name: info.name, followers: info.followers_count ?? info.fan_count ?? 0, ...wrap(posts) };
}

async function instagram(m, page) {
  if (!page.igId) return { connected: false };
  const info = await meta.graph('GET', `/${page.igId}`, { fields: 'username,followers_count,media_count', access_token: page.token });
  const r = await meta.graph('GET', `/${page.igId}/media`, { fields: 'id,caption,timestamp,media_type,like_count,comments_count,permalink', limit: 30, access_token: page.token });
  const posts = (r.data || []).map((p) => {
    const likes = p.like_count ?? 0, comments = p.comments_count ?? 0;
    return { id: p.id, at: p.timestamp, type: p.media_type, text: short(p.caption), url: p.permalink, likes, comments, score: likes + comments * 2 };
  });
  // وصول الحساب آخر 28 يوماً (قد يفشل حسب الصلاحية؛ لا نوقف التقرير)
  const reach = await safe(async () => {
    const since = Math.floor(Date.now() / 1000) - 28 * 86400;
    const x = await meta.graph('GET', `/${page.igId}/insights`, { metric: 'reach', metric_type: 'total_value', period: 'day', since, until: Math.floor(Date.now() / 1000), access_token: page.token });
    return x.data?.[0]?.total_value?.value ?? null;
  });
  return { connected: true, username: info.username, followers: info.followers_count ?? 0, media_count: info.media_count ?? 0, reach_28d: typeof reach === 'number' ? reach : null, ...wrap(posts) };
}

// الإعلانات: قراءة فقط. تحتاج صلاحية ads_read ورمز المستخدم المحفوظ عند الربط.
async function ads(m) {
  if (!m.userToken) return { connected: false, reason: 'أعد الربط من الحسابات ليُحفظ رمز المستخدم، وأضف صلاحية ads_read لتطبيق ميتا' };
  const acc = await meta.graph('GET', '/me/adaccounts', { fields: 'id,name,account_status,currency,amount_spent', limit: 10, access_token: m.userToken });
  const accounts = [];
  for (const a of acc.data || []) {
    const camps = await safe(() => meta.graph('GET', `/${a.id}/campaigns`, { fields: 'id,name,status,objective,daily_budget,lifetime_budget', limit: 15, access_token: m.userToken }));
    const ins = await safe(() => meta.graph('GET', `/${a.id}/insights`, { fields: 'spend,impressions,reach,clicks,cpc,ctr,actions', date_preset: 'last_30d', access_token: m.userToken }));
    accounts.push({
      id: a.id, name: a.name, currency: a.currency, total_spent_minor_units: a.amount_spent,
      campaigns: camps.__error ? { error: camps.__error } : (camps.data || []),
      last_30_days: ins.__error ? { error: ins.__error } : (ins.data?.[0] || null),
    });
  }
  return { connected: true, accounts };
}

async function overview(d, { force = false } = {}) {
  const m = d.meta;
  const page = (m.pages || []).find((p) => p.id === m.selectedPageId);
  if (!page) return { connected: false };
  const key = page.id + ':' + !!m.userToken;
  if (!force && cache.data && cache.key === key && Date.now() - cache.at < TTL) return cache.data;
  const data = { connected: true, page_name: page.name, fetched_at: new Date().toISOString() };
  data.facebook = await safe(() => facebook(m, page));
  data.instagram = await safe(() => instagram(m, page));
  data.ads = await safe(() => ads(m));
  if (!data.facebook.__error && !data.instagram.__error) cache = { at: Date.now(), key, data }; // لا نخزّن الأخطاء
  return data;
}

module.exports = { overview, timing, wrap };
