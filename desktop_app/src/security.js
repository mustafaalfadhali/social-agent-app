// تحصين Electron: منع التنقل والنوافذ الجديدة والأذونات والطلبات الخارجية من الواجهة،
// والتحقق من مرسل رسائل IPC ومن المدخلات، وفتح الروابط الخارجية بقائمة مسموحة فقط.
const { app, session, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const APP_INDEX = pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;
const OPEN_ALLOW = [/(^|\.)facebook\.com$/, /(^|\.)tiktok\.com$/, /(^|\.)claude\.com$/, /(^|\.)anthropic\.com$/];

function safeOpenExternal(url) {
  let u;
  try { u = new URL(String(url)); } catch { throw new Error('رابط غير صالح'); }
  if (u.protocol !== 'https:' || u.username || u.password || !OPEN_ALLOW.some((re) => re.test(u.hostname))) {
    throw new Error('رابط غير مسموح فتحه');
  }
  return shell.openExternal(u.toString());
}

// يُقبل فقط ما يأتي من صفحة التطبيق نفسها.
function trustedSender(e) {
  const u = (e && e.senderFrame && e.senderFrame.url) || '';
  return u.split('#')[0].split('?')[0] === APP_INDEX;
}

function lockDown() {
  app.on('web-contents-created', (_e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    const block = (ev, url) => { if (String(url).split('#')[0] !== APP_INDEX) ev.preventDefault(); };
    wc.on('will-navigate', block);
    wc.on('will-redirect', block);
    wc.on('will-attach-webview', (ev) => ev.preventDefault());
  });
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  // الواجهة لا تحتاج أي اتصال بالشبكة: كل الطلبات تمر عبر العملية الرئيسية.
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] }, (_d, cb) => cb({ cancel: true }));
}

// ---- أدوات التحقق من المدخلات ----
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORMS = ['facebook', 'instagram', 'tiktok'];
const str = (v, max = 5000) => {
  if (typeof v !== 'string') throw new Error('مدخل غير صالح');
  if (v.length > max) throw new Error('المدخل أطول من المسموح');
  return v;
};
const uuid = (v) => { if (typeof v !== 'string' || !UUID.test(v)) throw new Error('معرّف غير صالح'); return v; };
const platforms = (v) => {
  if (!Array.isArray(v) || v.length > 3 || !v.every((p) => PLATFORMS.includes(p))) throw new Error('منصات غير صالحة');
  return [...new Set(v)];
};
const bool = (v) => v === true || v === false;

module.exports = { safeOpenExternal, trustedSender, lockDown, str, uuid, platforms, bool, PLATFORMS, APP_INDEX };
