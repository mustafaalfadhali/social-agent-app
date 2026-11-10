// اختبار دخان للتطوير فقط (لا يعمل في النسخة المثبَّتة): يتحقق من إعدادات الأمان فعلياً داخل Electron.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

module.exports = async function smoke(win, store, dataDir) {
  const out = {};
  const wp = win.webContents.getLastWebPreferences();
  out.prefs = { sandbox: wp.sandbox, contextIsolation: wp.contextIsolation, nodeIntegration: wp.nodeIntegration, webSecurity: wp.webSecurity };
  await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));
  await new Promise((r) => setTimeout(r, 800));
  out.renderer = await win.webContents.executeJavaScript(`(async () => {
    const r = {};
    r.hasApi = typeof (window.api && window.api.call) === 'function';
    r.noNodeLeak = typeof require === 'undefined' && typeof process === 'undefined';
    r.state = (await window.api.call('state')).ok;
    r.badChannel = (await window.api.call('shell:exec', 'calc')).error;
    try { await fetch('https://example.com'); r.fetch = 'ALLOWED'; } catch (e) { r.fetch = 'blocked'; }
    r.windowOpen = window.open('https://example.com') === null ? 'denied' : 'OPENED';
    r.navIcons = document.querySelectorAll('nav svg').length;
    r.canvas = (document.getElementById('officeCanvas') || {}).height;
    const before = location.href; location.href = 'https://example.com';
    await new Promise((x) => setTimeout(x, 800));
    r.navigation = location.href === before ? 'blocked' : 'NAVIGATED';
    return r;
  })()`);
  // تشفير الأسرار على القرص
  const d = store.get();
  out.priorSecretDecrypted = d.odoo.apiKey === 'TEST-SECRET-KEY-123' && d.meta.appSecret === 'META-SECRET-456';
  d.odoo.apiKey = 'TEST-SECRET-KEY-123'; d.meta.appSecret = 'META-SECRET-456'; store.save();
  const raw = fs.readFileSync(path.join(dataDir, 'data.json'), 'utf8');
  out.secrets = { encryptionAvailable: safeStorage.isEncryptionAvailable(), plaintextOnDisk: raw.includes('TEST-SECRET-KEY-123') || raw.includes('META-SECRET-456'), hasEncPrefix: raw.includes('enc1:') };
  console.log('SMOKE_RESULT ' + JSON.stringify(out));
  app.quit();
  setTimeout(() => process.exit(0), 1500);
};
