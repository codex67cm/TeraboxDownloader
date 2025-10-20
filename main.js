const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  screen,
  dialog,
} = require("electron");
const path = require("path");

let tray = null;
let win;
const { runDownloader, stopDownload, skipDownload } = require("./downloader");

process.on("unhandledRejection", (error) => {
  console.error("UNHANDLED REJECTION:", error);
});

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: Math.min(1000, width - 100),
    height: Math.min(700, height - 100),
    frame: false,
    show: false,
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.loadFile("index.html");

  ipcMain.on("window-control", (event, action) => {
    if (action === "minimize") win.minimize();
    else if (action === "maximize")
      win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === "close") win.hide();
  });

  win.once("ready-to-show", () => {
    win.show(); // show immediately, no splash delay
  });
}

function createTray() {
  const iconPath = path.join(__dirname, "icon.ico");
  let trayIcon = nativeImage
    .createFromPath(iconPath)
    .resize({ width: 16, height: 16 });

  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    { label: "Show App", click: () => win.show() },
    { label: "Quit", click: () => app.quit() },
  ]);

  tray.setToolTip("Terabox Downloader");
  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    win.isVisible() ? win.hide() : win.show();
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// IPC handlers
ipcMain.handle("select-links-file", async () => {
  const result = await dialog.showOpenDialog(win, {
    title: "Select links.txt",
    filters: [{ name: "Text Files", extensions: ["txt"] }],
    properties: ["openFile"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("start-download", async (event, filePath) => {
  await runDownloader(filePath, (msg) => {
    event.sender.send("log-message", msg);
  });
});

ipcMain.on("stop-download", () => stopDownload());
ipcMain.on("skip-download", () => skipDownload());
