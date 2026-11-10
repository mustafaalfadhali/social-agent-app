const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const store = require('./store');
const claude = require('./claude');
const meta = require('./meta');
const tiktok = require('./tiktok');
const agent = require('./agent');
const contracts = require('./contracts');
const odoo = require('./odoo');
const commander = require('./commander');
const sec = require('./security');

// مجلد اختبار اختياري للتطوير فقط (يُتجاهل في النسخة المثبَّتة)
const TEST_DIR = !app.isPackaged && process.env.SIRAJ_TEST_DIR;
app.setPath('userData', TEST_DIR || path.join(app.getPath('appData'), 'SirajDesktop'));
const dataDir = app.getPath('userData');
const mediaDir = path.join(dataDir, 'media');

if (!TEST_DIR && !app.requestSingleInstanceLock()) app.quit();

let win, tray, quitting = false;

function createWindow(show = true) {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600, show,
    title: 'سراج', icon: path.join(__dirname, 'icon.png'), backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false,
      spellcheck: false, devTools: !app.isPackaged,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('سراج - وكيل السوشال ميديا');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'فتح سراج', click: () => win.show() },
    { label: 'تشغيل التوليد اليومي الآن', click: () => agent.dailyRun() },
    { type: 'separator' },
    { label: 'خروج', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => win.show());
}

function applyAutoStart() {
  if (process.platform !== 'win32') return;
  app.setLoginItemSettings({ openAtLogin: !!store.get().settings.autoStart, args: ['--hidden'] });
}

// Hide secrets/tokens from the renderer.
function publicState() {
  const d = store.get();
  return {
    settings: d.settings,
    meta: {
      appId: d.meta.appId, hasSecret: !!d.meta.appSecret, configId: d.meta.configId,
      pages: d.meta.pages.map(({ token, ...p }) => p), selectedPageId: d.meta.selectedPageId,
      redirect: meta.REDIRECT,
    },
    tiktok: {
      clientKey: d.tiktok.clientKey, hasSecret: !!d.tiktok.clientSecret,
      connected: !!d.tiktok.refreshToken, displayName: d.tiktok.displayName, redirect: tiktok.REDIRECT,
    },
    odoo: { url: d.odoo.url, db: d.odoo.db, login: d.odoo.login, hasKey: !!d.odoo.apiKey },
    media: d.media.map((m) => ({ ...m, url: 'file:///' + path.join(mediaDir, m.file).replace(/\\/g, '/') })),
    posts: d.posts,
    log: d.log.slice(0, 100),
    agentBusy: agent.isBusy(),
  };
}

function handle(name, fn) {
  ipcMain.handle(name, async (e, ...args) => {
    if (!sec.trustedSender(e)) return { ok: false, error: 'مرفوض' };
    try { return { ok: true, data: await fn(...args) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
}

function registerIpc() {
  handle('state', () => publicState());
  handle('contracts:list', () => contracts.list());
  handle('contracts:rescan', () => contracts.rescan((m) => store.log(m)));
  handle('assistant:ask', (p) => {
    if (!p || typeof p !== 'object') throw new Error('مدخل غير صالح');
    const history = Array.isArray(p.history) ? p.history.slice(-8).map((m) => ({ role: m && m.role === 'user' ? 'user' : 'office', text: sec.str(String((m && m.text) || ''), 3000) })) : [];
    return commander.ask({ text: sec.str(p.text, 2000), history }, store.get());
  });
  handle('odoo:save', (f) => {
    const d = store.get();
    const url = odoo.checkUrl(sec.str(f.url || '', 300).trim());
    d.odoo = { url, db: sec.str(f.db || '', 120).trim(), login: sec.str(f.login || '', 200).trim(), apiKey: f.apiKey ? sec.str(f.apiKey, 500).trim() : d.odoo.apiKey };
    store.save();
  });
  handle('odoo:test', () => odoo.test(store.get().odoo));
  handle('odoo:summary', () => odoo.summary(store.get().odoo));
  handle('odoo:disconnect', () => { store.get().odoo = { url: '', db: '', login: '', apiKey: '' }; store.save(); });
  handle('claude:status', () => claude.status(store.get().settings.claudePath));
  handle('claude:check', async () => { const t = Date.now(); const txt = await claude.askText('أجب بكلمة واحدة فقط: تم', store.get().settings); return { reply: txt.trim().slice(0, 80), seconds: Math.round((Date.now() - t) / 1000) }; });
  handle('claude:login', () => {
    if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', 'cmd', '/k', 'claude'], { detached: true, windowsHide: false });
    else sec.safeOpenExternal('https://docs.claude.com/en/docs/claude-code/setup');
  });
  handle('claude:install', () => sec.safeOpenExternal('https://docs.claude.com/en/docs/claude-code/setup'));

  handle('settings:save', (s) => {
    if (!s || typeof s !== 'object') throw new Error('مدخل غير صالح');
    const d = store.get(), clean = {};
    for (const k of ['businessName', 'businessDescription', 'tone', 'language', 'dailyTimes', 'claudePath']) if (k in s) clean[k] = sec.str(s[k], k === 'businessDescription' ? 3000 : 300);
    for (const k of ['reviewBeforePublish', 'autoStart']) if (k in s) { if (!sec.bool(s[k])) throw new Error('مدخل غير صالح'); clean[k] = s[k]; }
    if ('tiktokPrivacy' in s) { if (!['SELF_ONLY', 'FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'PUBLIC_TO_EVERYONE'].includes(s.tiktokPrivacy)) throw new Error('خصوصية غير صالحة'); clean.tiktokPrivacy = s.tiktokPrivacy; }
    const ap = {};
    for (const k of sec.PLATFORMS) if (s.autoPlatforms && k in s.autoPlatforms) { if (!sec.bool(s.autoPlatforms[k])) throw new Error('مدخل غير صالح'); ap[k] = s.autoPlatforms[k]; }
    d.settings = { ...d.settings, ...clean, autoPlatforms: { ...d.settings.autoPlatforms, ...ap } };
    store.save(); applyAutoStart();
  });

  handle('media:add', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'صور', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    const d = store.get();
    for (const src of r.filePaths) {
      const ext = path.extname(src).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;
      if (fs.statSync(src).size > 25 * 1024 * 1024) continue;
      const id = crypto.randomUUID();
      const file = id + ext;
      fs.copyFileSync(src, path.join(mediaDir, file));
      d.media.push({ id, file, name: path.basename(src), addedAt: new Date().toISOString(), usedAt: null });
    }
    store.save();
    return r.filePaths.length;
  });
  handle('media:remove', (id) => {
    sec.uuid(id);
    const d = store.get();
    const m = d.media.find((x) => x.id === id);
    if (m) fs.rmSync(path.join(mediaDir, path.basename(m.file)), { force: true });
    d.media = d.media.filter((x) => x.id !== id);
    store.save();
  });

  handle('post:create', (mediaId, platforms, hint) => agent.createPost(sec.uuid(mediaId), sec.platforms(platforms), { extraHint: sec.str(hint || '', 500) }));
  handle('post:update', (id, fields) => {
    sec.uuid(id);
    if (!fields || typeof fields !== 'object') throw new Error('مدخل غير صالح');
    const p = store.get().posts.find((x) => x.id === id);
    if (!p) throw new Error('غير موجود');
    if ('caption' in fields) p.caption = sec.str(fields.caption, 5000);
    if ('platforms' in fields) p.platforms = sec.platforms(fields.platforms);
    if ('feedback' in fields) p.feedback = sec.str(fields.feedback, 1000);
    store.save();
  });
  handle('post:publish', (id) => agent.publishPost(sec.uuid(id)));
  handle('post:reject', (id, feedback) => {
    sec.uuid(id);
    const p = store.get().posts.find((x) => x.id === id);
    if (p) { p.status = 'rejected'; p.feedback = sec.str(feedback || '', 1000); store.save(); }
  });
  handle('post:delete', (id) => { sec.uuid(id); const d = store.get(); d.posts = d.posts.filter((p) => p.id !== id); store.save(); });
  handle('agent:runNow', () => agent.dailyRun());

  handle('meta:saveApp', (f) => {
    const m = store.get().meta;
    m.appId = sec.str(f.appId, 60).trim(); m.configId = sec.str(f.configId || '', 60).trim();
    if (f.appSecret) m.appSecret = sec.str(f.appSecret, 200).trim();
    store.save();
  });
  handle('meta:connect', async () => { await meta.connect(store.get().meta); store.save(); store.log('🔗 تم ربط Meta'); });
  handle('meta:connectToken', async (t) => { await meta.connectWithToken(store.get().meta, sec.str(t, 1000).trim()); store.save(); store.log('🔗 تم ربط Meta'); });
  handle('meta:selectPage', (id) => { const m = store.get().meta; sec.str(id, 60); if (!m.pages.some((p) => p.id === id)) throw new Error('صفحة غير معروفة'); m.selectedPageId = id; store.save(); });

  handle('tiktok:saveApp', (f) => {
    const t = store.get().tiktok;
    t.clientKey = sec.str(f.clientKey, 100).trim();
    if (f.clientSecret) t.clientSecret = sec.str(f.clientSecret, 200).trim();
    store.save();
  });
  handle('tiktok:connect', async () => { await tiktok.connect(store.get().tiktok); store.save(); store.log('🔗 تم ربط تيك توك'); });
  handle('tiktok:disconnect', () => {
    Object.assign(store.get().tiktok, { accessToken: '', refreshToken: '', expiresAt: 0, openId: '', displayName: '' });
    store.save();
  });
}

app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

app.whenReady().then(() => {
  sec.lockDown();
  fs.mkdirSync(mediaDir, { recursive: true });
  store.init(dataDir);
  agent.setMediaDir(mediaDir);
  registerIpc();
  contracts.init({ desktop: app.getPath('desktop'), userData: app.getPath('userData'), log: (m) => store.log(m) });
  createWindow(!process.argv.includes('--hidden'));
  createTray();
  applyAutoStart();
  agent.startScheduler();
  if (TEST_DIR && process.argv.includes('--smoke')) require('./smoke')(win, store, dataDir);
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', (e) => e.preventDefault());
