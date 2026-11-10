// Simple JSON persistence in the app's data folder.
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

// الأسرار تُشفَّر على القرص (DPAPI عبر safeStorage) ولا تُحفظ نصاً صريحاً.
const PREFIX = 'enc1:';
const canEnc = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
const enc = (v) => (v && typeof v === 'string' && !v.startsWith(PREFIX) && canEnc() ? PREFIX + safeStorage.encryptString(v).toString('base64') : v);
const dec = (v) => {
  if (typeof v !== 'string' || !v.startsWith(PREFIX)) return v;
  try { return safeStorage.decryptString(Buffer.from(v.slice(PREFIX.length), 'base64')); } catch { return ''; }
};
const SECRETS = [['meta', 'appSecret'], ['meta', 'userToken'], ['tiktok', 'clientSecret'], ['tiktok', 'accessToken'], ['tiktok', 'refreshToken'], ['odoo', 'apiKey'], ['telegram', 'token'], ['visits', 'token'], ['wa', 'pullToken'], ['wa', 'token']];
function transform(obj, fn) {
  for (const [a, b] of SECRETS) if (obj[a] && b in obj[a]) obj[a][b] = fn(obj[a][b]);
  if (obj.meta && Array.isArray(obj.meta.pages)) obj.meta.pages.forEach((p) => { if (p && 'token' in p) p.token = fn(p.token); });
  return obj;
}

const DEFAULTS = {
  settings: {
    businessName: '',
    businessDescription: '',
    tone: 'ودّي واحترافي',
    language: 'العربية',
    dailyTimes: '10:00',
    autoPlatforms: { facebook: true, instagram: true, tiktok: false },
    reviewBeforePublish: true,   // الافتراضي الآمن: مراجعة المالك قبل أي نشر علني
    autoStart: true,
    claudePath: '',
    tiktokPrivacy: 'SELF_ONLY',
  },
  meta: { appId: '', appSecret: '', configId: '', userToken: '', pages: [], selectedPageId: '' },
  tiktok: { clientKey: '', clientSecret: '', accessToken: '', refreshToken: '', expiresAt: 0, openId: '', displayName: '' },
  odoo: { url: '', db: '', login: '', apiKey: '' },
  telegram: { token: '', chatId: 0, username: '' },
  visits: { url: 'https://branches.mustafa-server.vip', token: '' },
  wa: { workerUrl: 'https://siraj-relay.mustafalive2022.workers.dev', pullToken: '', phoneId: '', token: '', convs: {}, seen: [] }, // واتساب: خدمة العملاء
  proposals: [], // مقترحات تنتظر موافقة المالك (دفعات...)
  media: [],   // {id, file, name, addedAt, usedAt}
  posts: [],   // {id, mediaId, caption, status, platforms, results, createdAt, publishedAt}
  log: [],     // {at, msg}
  lastRuns: {}, // "YYYY-MM-DD HH:MM": true
};

let file, data;

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'data.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    data = { ...structuredClone(DEFAULTS), ...saved };
    data.settings = { ...DEFAULTS.settings, ...saved.settings };
    data.settings.autoPlatforms = { ...DEFAULTS.settings.autoPlatforms, ...(saved.settings || {}).autoPlatforms };
    data.meta = { ...DEFAULTS.meta, ...saved.meta };
    data.tiktok = { ...DEFAULTS.tiktok, ...saved.tiktok };
    data.odoo = { ...DEFAULTS.odoo, ...saved.odoo };
    data.telegram = { ...DEFAULTS.telegram, ...saved.telegram };
    data.visits = { ...DEFAULTS.visits, ...saved.visits };
    data.wa = { ...structuredClone(DEFAULTS.wa), ...saved.wa };
    transform(data, dec);
    setImmediate(save); // ترحيل أي أسرار قديمة نصية إلى نسخة مشفّرة
  } catch {
    data = structuredClone(DEFAULTS);
  }
}

function save() {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(transform(structuredClone(data), enc), null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function get() { return data; }

function log(msg) {
  data.log.unshift({ at: new Date().toISOString(), msg });
  data.log = data.log.slice(0, 300);
  save();
}

module.exports = { init, save, get, log };
