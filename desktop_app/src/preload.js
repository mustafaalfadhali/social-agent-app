const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  call: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});
