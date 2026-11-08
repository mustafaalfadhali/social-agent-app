// TikTok Content Posting API (Direct Post, FILE_UPLOAD). Images are turned
// into a short vertical video locally with ffmpeg (uses the PC's resources).
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { PORT, waitForCode } = require('./oauth');

const REDIRECT = `http://localhost:${PORT}/tiktok/callback/`;
const API = 'https://open.tiktokapis.com/v2';

function ffmpegPath() {
  const p = require('ffmpeg-static');
  return p.replace('app.asar', 'app.asar.unpacked');
}

function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

async function tokenRequest(params) {
  const res = await fetch(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(`TikTok: ${j.error_description || j.error || res.status}`);
  return j;
}

function saveTokens(tk, j) {
  tk.accessToken = j.access_token;
  tk.refreshToken = j.refresh_token;
  tk.expiresAt = Date.now() + (j.expires_in - 60) * 1000;
  tk.openId = j.open_id;
}

async function connect(tk) {
  if (!tk.clientKey || !tk.clientSecret) throw new Error('أدخل Client Key و Client Secret أولاً');
  const state = crypto.randomBytes(12).toString('hex');
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = crypto.createHash('sha256').update(verifier).digest('hex'); // TikTok desktop PKCE uses hex
  const u = new URL('https://www.tiktok.com/v2/auth/authorize/');
  u.searchParams.set('client_key', tk.clientKey);
  u.searchParams.set('scope', 'user.info.basic,video.publish');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', REDIRECT);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  const code = await waitForCode(u.toString(), state, '/tiktok/callback');
  saveTokens(tk, await tokenRequest({
    client_key: tk.clientKey, client_secret: tk.clientSecret, code,
    grant_type: 'authorization_code', redirect_uri: REDIRECT, code_verifier: verifier,
  }));
  const me = await api(tk, 'GET', '/user/info/?fields=display_name');
  tk.displayName = me.data?.user?.display_name || '';
}

async function ensureToken(tk) {
  if (!tk.refreshToken) throw new Error('تيك توك غير مربوط');
  if (Date.now() < tk.expiresAt) return;
  saveTokens(tk, await tokenRequest({
    client_key: tk.clientKey, client_secret: tk.clientSecret,
    grant_type: 'refresh_token', refresh_token: tk.refreshToken,
  }));
}

async function api(tk, method, p, body) {
  await ensureToken(tk);
  const res = await fetch(API + p, {
    method,
    headers: { Authorization: `Bearer ${tk.accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json();
  if (!res.ok || (j.error && j.error.code !== 'ok')) throw new Error(`TikTok: ${j.error?.message || res.status}`);
  return j;
}

function imageToVideo(imagePath, outPath, seconds = 8) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath(), [
      '-y', '-loop', '1', '-i', imagePath,
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-t', String(seconds),
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'veryfast', '-r', '30', '-c:a', 'aac', '-shortest', outPath,
    ], { windowsHide: true }, (err, _o, se) => (err ? reject(new Error('ffmpeg: ' + (se || err.message).slice(-300))) : resolve(outPath)));
  });
}

async function publishImage(tk, imagePath, caption, privacy, workDir) {
  const video = await imageToVideo(imagePath, require('path').join(workDir, `tiktok-${Date.now()}.mp4`));
  try {
    const info = await api(tk, 'POST', '/post/publish/creator_info/query/', {});
    const options = info.data?.privacy_level_options || [];
    const level = options.includes(privacy) ? privacy : (options.includes('SELF_ONLY') ? 'SELF_ONLY' : options[0]);
    const size = fs.statSync(video).size;
    const init = await api(tk, 'POST', '/post/publish/video/init/', {
      post_info: { title: caption.slice(0, 2200), privacy_level: level, disable_comment: false, disable_duet: false, disable_stitch: false },
      source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 },
    });
    const up = await fetch(init.data.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Content-Range': `bytes 0-${size - 1}/${size}` },
      body: fs.readFileSync(video),
    });
    if (!up.ok) throw new Error(`TikTok upload: ${up.status}`);
    return init.data.publish_id;
  } finally {
    fs.rm(video, { force: true }, () => {});
  }
}

module.exports = { connect, publishImage, REDIRECT };
