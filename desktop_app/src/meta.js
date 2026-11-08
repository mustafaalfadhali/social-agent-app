// Meta (Facebook Page + Instagram Business) - OAuth, publishing, real insights.
// No mock data anywhere: failures are surfaced as errors.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PORT, waitForCode } = require('./oauth');

const V = 'v21.0';
const GRAPH = `https://graph.facebook.com/${V}`;
const REDIRECT = `http://localhost:${PORT}/meta/callback`;
const SCOPES = [
  'pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'read_insights',
  'instagram_basic', 'instagram_content_publish', 'instagram_manage_insights', 'business_management',
].join(',');

async function graph(method, url, params = {}, form) {
  let res;
  if (method === 'GET') {
    const u = new URL(url.startsWith('http') ? url : GRAPH + url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    res = await fetch(u);
  } else {
    const body = form || new URLSearchParams(params);
    if (form) for (const [k, v] of Object.entries(params)) form.append(k, v);
    res = await fetch(url.startsWith('http') ? url : GRAPH + url, { method, body });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`Meta: ${json.error?.message || res.status}`);
  return json;
}

async function loadPages(userToken, meta) {
  const r = await graph('GET', '/me/accounts', {
    fields: 'id,name,access_token,instagram_business_account{id,username}',
    access_token: userToken,
    limit: 100,
  });
  meta.pages = (r.data || []).map((p) => ({
    id: p.id,
    name: p.name,
    token: p.access_token,
    igId: p.instagram_business_account?.id || '',
    igUsername: p.instagram_business_account?.username || '',
  }));
  if (!meta.pages.find((p) => p.id === meta.selectedPageId)) meta.selectedPageId = meta.pages[0]?.id || '';
  if (!meta.pages.length) throw new Error('لا توجد صفحات فيسبوك مرتبطة بهذا الحساب');
}

async function longLived(meta, shortToken) {
  const r = await graph('GET', '/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: meta.appId,
    client_secret: meta.appSecret,
    fb_exchange_token: shortToken,
  });
  return r.access_token;
}

async function connect(meta) {
  if (!meta.appId || !meta.appSecret) throw new Error('أدخل App ID و App Secret أولاً');
  const state = crypto.randomBytes(12).toString('hex');
  const u = new URL(`https://www.facebook.com/${V}/dialog/oauth`);
  u.searchParams.set('client_id', meta.appId);
  u.searchParams.set('redirect_uri', REDIRECT);
  u.searchParams.set('state', state);
  u.searchParams.set('response_type', 'code');
  if (meta.configId) u.searchParams.set('config_id', meta.configId);
  else u.searchParams.set('scope', SCOPES);
  const code = await waitForCode(u.toString(), state, '/meta/callback');
  const t = await graph('GET', '/oauth/access_token', {
    client_id: meta.appId, client_secret: meta.appSecret, redirect_uri: REDIRECT, code,
  });
  await loadPages(await longLived(meta, t.access_token), meta);
}

// Fallback: user pastes a user access token (e.g. from Graph API Explorer).
async function connectWithToken(meta, token) {
  const t = meta.appId && meta.appSecret ? await longLived(meta, token) : token;
  await loadPages(t, meta);
}

function selectedPage(meta) {
  const p = meta.pages.find((x) => x.id === meta.selectedPageId);
  if (!p) throw new Error('لم يتم ربط صفحة فيسبوك');
  return p;
}

function fileForm(filePath) {
  const fd = new FormData();
  fd.append('source', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  return fd;
}

async function publishFacebook(meta, imagePath, caption) {
  const page = selectedPage(meta);
  const r = await graph('POST', `/${page.id}/photos`, { message: caption, access_token: page.token }, fileForm(imagePath));
  return r.post_id || r.id;
}

// Instagram needs a public image URL: upload the photo to the Page as
// unpublished, use its CDN URL, then delete the temporary photo.
async function publishInstagram(meta, imagePath, caption) {
  const page = selectedPage(meta);
  if (!page.igId) throw new Error('الصفحة غير مربوطة بحساب إنستغرام بزنس');
  const tmp = await graph('POST', `/${page.id}/photos`, { published: 'false', access_token: page.token }, fileForm(imagePath));
  try {
    const info = await graph('GET', `/${tmp.id}`, { fields: 'images', access_token: page.token });
    const imageUrl = info.images?.[0]?.source;
    if (!imageUrl) throw new Error('تعذر الحصول على رابط الصورة');
    const container = await graph('POST', `/${page.igId}/media`, { image_url: imageUrl, caption, access_token: page.token });
    for (let i = 0; i < 20; i++) {
      const s = await graph('GET', `/${container.id}`, { fields: 'status_code', access_token: page.token });
      if (s.status_code === 'FINISHED') break;
      if (s.status_code === 'ERROR') throw new Error('إنستغرام رفض الصورة');
      await new Promise((r) => setTimeout(r, 3000));
    }
    const pub = await graph('POST', `/${page.igId}/media_publish`, { creation_id: container.id, access_token: page.token });
    return pub.id;
  } finally {
    graph('DELETE', `/${tmp.id}`, { access_token: page.token }).catch(() => {});
  }
}

// Real engagement numbers for a published post (no mock fallback).
async function postStats(meta, platform, postId) {
  const page = selectedPage(meta);
  if (platform === 'facebook') {
    const r = await graph('GET', `/${postId}`, {
      fields: 'reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares',
      access_token: page.token,
    });
    return {
      reactions: r.reactions?.summary?.total_count ?? 0,
      comments: r.comments?.summary?.total_count ?? 0,
      shares: r.shares?.count ?? 0,
    };
  }
  if (platform === 'instagram') {
    const r = await graph('GET', `/${postId}`, { fields: 'like_count,comments_count', access_token: page.token });
    return { likes: r.like_count ?? 0, comments: r.comments_count ?? 0 };
  }
  return null;
}

module.exports = { connect, connectWithToken, publishFacebook, publishInstagram, postStats, REDIRECT };
