// Simple JSON persistence in the app's data folder.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  settings: {
    businessName: '',
    businessDescription: '',
    tone: 'ودّي واحترافي',
    language: 'العربية',
    dailyTimes: '10:00',
    autoPlatforms: { facebook: true, instagram: true, tiktok: false },
    reviewBeforePublish: false,
    autoStart: true,
    claudePath: '',
    tiktokPrivacy: 'SELF_ONLY',
  },
  meta: { appId: '', appSecret: '', configId: '', pages: [], selectedPageId: '' },
  tiktok: { clientKey: '', clientSecret: '', accessToken: '', refreshToken: '', expiresAt: 0, openId: '', displayName: '' },
  odoo: { url: '', db: '', login: '', apiKey: '' },
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
  } catch {
    data = structuredClone(DEFAULTS);
  }
}

function save() {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function get() { return data; }

function log(msg) {
  data.log.unshift({ at: new Date().toISOString(), msg });
  data.log = data.log.slice(0, 300);
  save();
}

module.exports = { init, save, get, log };
