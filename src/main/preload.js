const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld('howl', {
  state: () => ipcRenderer.invoke('state'),
  onState: on('state'),
  settings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  onSettings: on('settings'),
  logs: () => ipcRenderer.invoke('log:get'),
  onLog: on('log'),
  importBuild: () => ipcRenderer.invoke('import'),
  applySpells: () => ipcRenderer.invoke('spells'),
  sync: () => ipcRenderer.invoke('sync'),
  augments: () => ipcRenderer.invoke('augments'),
  community: () => ipcRenderer.invoke('community'),
  champions: () => ipcRenderer.invoke('champions'),
  plan: (champId, enemies) => ipcRenderer.invoke('plan', champId, enemies),
  rateAugments: (champId, ids) => ipcRenderer.invoke('rate-augments', champId, ids),
  scan: () => ipcRenderer.invoke('scan'),
  aramStatus: () => ipcRenderer.invoke('aram:status'),
  aramRun: () => ipcRenderer.invoke('aram:run'),
  aramStop: () => ipcRenderer.invoke('aram:stop'),
  onAram: on('aram'),
  onOpenTab: on('open-tab'),
  onToast: on('toast'),
  open: (url) => ipcRenderer.invoke('open', url),
  debugOffer: (cards) => ipcRenderer.invoke('debug:offer', cards),
  debugCleared: (id) => ipcRenderer.invoke('debug:cleared', id),
  debugToast: (text, kind) => ipcRenderer.invoke('debug:toast', text, kind),
});
