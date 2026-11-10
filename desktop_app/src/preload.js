const { contextBridge, ipcRenderer } = require('electron');

// قائمة القنوات المسموحة فقط (الواجهة لا تستطيع استدعاء غيرها).
const ALLOWED = new Set(['agent:runNow', 'assistant:ask', 'claude:check', 'claude:install', 'claude:login', 'claude:status', 'contracts:list', 'contracts:rescan', 'doc:open', 'inbox:pick', 'inbox:save', 'media:add', 'media:remove', 'meta:connect', 'meta:connectToken', 'meta:saveApp', 'meta:selectPage', 'odoo:disconnect', 'odoo:save', 'odoo:summary', 'odoo:test', 'post:create', 'post:delete', 'post:publish', 'post:reject', 'post:update', 'proposal:approve', 'proposal:reject', 'proposal:select', 'settings:save', 'social:overview', 'state', 'telegram:disconnect', 'telegram:pair', 'telegram:save', 'telegram:status', 'tiktok:connect', 'tiktok:disconnect', 'tiktok:saveApp', 'visits:disconnect', 'visits:save', 'visits:summary', 'visits:test']);

contextBridge.exposeInMainWorld('api', {
  call: (channel, ...args) => {
    if (!ALLOWED.has(channel)) return Promise.resolve({ ok: false, error: 'قناة غير مسموحة' });
    return ipcRenderer.invoke(channel, ...args);
  },
});
