const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  windowControl: (action) => ipcRenderer.send("window-control", action),
  selectFile: () => ipcRenderer.invoke("select-links-file"),
  startDownload: (filePath) => ipcRenderer.invoke("start-download", filePath),
  stopDownload: () => ipcRenderer.send("stop-download"),
  skipDownload: () => ipcRenderer.send("skip-download"),
  onLog: (callback) => ipcRenderer.on("log-message", (e, msg) => callback(msg))
});
