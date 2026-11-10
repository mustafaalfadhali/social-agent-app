const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } = require('electron');
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

app.setPath('userData', path.join(app.getPath('appData'), 'SirajDesktop'));
const dataDir = app.getPath('userData');
const mediaDir = path.join(dataDir, 'media');

if (!app.requestSingleInstanceLock()) app.quit();

let win, tray, quitting = false;

function createWindow(show = true) {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600, show,
    title: 'سراج', icon: path.join(__dirname, 'icon.png'), backgroundColor: '#0f1115',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
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
    media: d.media.map((m) => ({ ...m, url: 'file:///' + path.join(mediaDir, m.file).replace(/\\/g, '/') })),
    posts: d.posts,
    log: d.log.slice(0, 100),
  };
}

function handle(name, fn) {
  ipcMain.handle(name, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
}

function registerIpc() {
  handle('state', () => publicState());
  handle('contracts:list', () => contracts.list());
  handle('claude:status', () => claude.status(store.get().settings.claudePath));
  handle('claude:login', () => {
    if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', 'cmd', '/k', 'claude'], { detached: true, windowsHide: false });
    else shell.openExternal('https://docs.claude.com/en/docs/claude-code/setup');
  });
  handle('claude:install', () => shell.openExternal('https://docs.claude.com/en/docs/claude-code/setup'));

  handle('settings:save', (s) => {
    const d = store.get();
    d.settings = { ...d.settings, ...s, autoPlatforms: { ...d.settings.autoPlatforms, ...(s.autoPlatforms || {}) } };
    store.save(); applyAutoStart();
  });

  handle('media:add', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'صور', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    const d = store.get();
    for (const src of r.filePaths) {
      const id = crypto.randomUUID();
      const file = id + path.extname(src).toLowerCase();
      fs.copyFileSync(src, path.join(mediaDir, file));
      d.media.push({ id, file, name: path.basename(src), addedAt: new Date().toISOString(), usedAt: null });
    }
    store.save();
    return r.filePaths.length;
  });
  handle('media:remove', (id) => {
    const d = store.get();
    const m = d.media.find((x) => x.id === id);
    if (m) fs.rmSync(path.join(mediaDir, m.file), { force: true });
    d.media = d.media.filter((x) => x.id !== id);
    store.save();
  });

  handle('post:create', (mediaId, platforms, hint) => agent.createPost(mediaId, platforms, { extraHint: hint }));
  handle('post:update', (id, fields) => {
    const p = store.get().posts.find((x) => x.id === id);
    if (!p) throw new Error('غير موجود');
    for (const k of ['caption', 'platforms', 'feedback']) if (k in fields) p[k] = fields[k];
    store.save();
  });
  handle('post:publish', (id) => agent.publishPost(id));
  handle('post:reject', (id, feedback) => {
    const p = store.get().posts.find((x) => x.id === id);
    if (p) { p.status = 'rejected'; p.feedback = feedback || ''; store.save(); }
  });
  handle('post:delete', (id) => { const d = store.get(); d.posts = d.posts.filter((p) => p.id !== id); store.save(); });
  handle('agent:runNow', () => agent.dailyRun());

  handle('meta:saveApp', (f) => {
    const m = store.get().meta;
    m.appId = f.appId.trim(); m.configId = (f.configId || '').trim();
    if (f.appSecret) m.appSecret = f.appSecret.trim();
    store.save();
  });
  handle('meta:connect', async () => { await meta.connect(store.get().meta); store.save(); store.log('🔗 تم ربط Meta'); });
  handle('meta:connectToken', async (t) => { await meta.connectWithToken(store.get().meta, t.trim()); store.save(); store.log('🔗 تم ربط Meta'); });
  handle('meta:selectPage', (id) => { store.get().meta.selectedPageId = id; store.save(); });

  handle('tiktok:saveApp', (f) => {
    const t = store.get().tiktok;
    t.clientKey = f.clientKey.trim();
    if (f.clientSecret) t.clientSecret = f.clientSecret.trim();
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
  fs.mkdirSync(mediaDir, { recursive: true });
  store.init(dataDir);
  agent.setMediaDir(mediaDir);
  registerIpc();
  createWindow(!process.argv.includes('--hidden'));
  createTray();
  applyAutoStart();
  agent.startScheduler();
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', (e) => e.preventDefault());
