const fs = require("fs-extra");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

// ==========================================
// ENVIRONMENT / .ENV CONFIG LOADER & PARSERS
// ==========================================
function parseBool(val, defaultVal = false) {
  if (val === undefined || val === null) return defaultVal;
  const s = String(val).trim().toLowerCase();
  if (s === "") return defaultVal;
  return s === "true" || s === "1" || s === "yes";
}

function parseIntVal(val, defaultVal) {
  if (val === undefined || val === null) return defaultVal;
  const s = String(val).trim();
  if (s === "") return defaultVal;
  const n = parseInt(s, 10);
  return isNaN(n) ? defaultVal : n;
}

function parseFloatVal(val, defaultVal) {
  if (val === undefined || val === null) return defaultVal;
  const s = String(val).trim();
  if (s === "") return defaultVal;
  const n = parseFloat(s);
  return isNaN(n) ? defaultVal : n;
}

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.substring(0, eqIdx).trim();
        let val = trimmed.substring(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.substring(1, val.length - 1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
  }
}

// Auto-load .env on module load
loadEnv();

// ==========================================
// GOOGLE CHROME AUTO-DETECTION
// ==========================================
function detectChromePath() {
  const customPath = (process.env.CHROME_PATH || "").trim();
  if (customPath) {
    if (fs.existsSync(customPath)) {
      return customPath;
    }
    throw new Error(
      `❌ Specified CHROME_PATH does not exist: "${customPath}".\nPlease check the path and make sure chrome.exe exists.`
    );
  }

  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  const candidates = [
    path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "❌ Google Chrome not found!\n" +
    "Please install Google Chrome or specify its exact path using the CHROME_PATH environment variable.\n" +
    "Example: CHROME_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\n" +
    "(Note: Fallback to another browser is strictly disabled.)"
  );
}

// ==========================================
// CHROME PROFILE VALIDATION & DETECTION
// ==========================================
function getAvailableProfiles(userDataDir) {
  if (!fs.existsSync(userDataDir)) return [];
  try {
    const entries = fs.readdirSync(userDataDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => name === "Default" || /^Profile \d+$/i.test(name));
  } catch {
    return [];
  }
}

function getChromeProfileConfig() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const defaultUserDataDir = path.join(
    localAppData,
    "Google",
    "Chrome",
    "User Data"
  );

  const rawUserDataDir = (process.env.CHROME_USER_DATA_DIR || "").trim();
  const userDataDir = rawUserDataDir !== "" ? rawUserDataDir : defaultUserDataDir;

  const rawProfileDirectory = (process.env.CHROME_PROFILE_DIRECTORY || "").trim();
  const profileDirectory = rawProfileDirectory !== "" ? rawProfileDirectory : "Default";

  // Validate User Data directory existence
  if (!fs.existsSync(userDataDir)) {
    throw new Error(
      `❌ Configured CHROME_USER_DATA_DIR does not exist:\n"${userDataDir}"\n` +
      `Please verify your Chrome User Data path in your configuration or .env file.`
    );
  }

  // Validate specific profile directory existence inside User Data
  const fullProfilePath = path.join(userDataDir, profileDirectory);
  if (!fs.existsSync(fullProfilePath)) {
    const available = getAvailableProfiles(userDataDir);
    const availableStr = available.length > 0 ? available.join(", ") : "None detected";
    throw new Error(
      `❌ Configured CHROME_PROFILE_DIRECTORY "${profileDirectory}" does not exist in User Data directory:\n"${userDataDir}"\n` +
      `Available profile directories found: ${availableStr}\n` +
      `Please set CHROME_PROFILE_DIRECTORY in your .env or environment variable to a valid profile.`
    );
  }

  return {
    userDataDir,
    profileDirectory,
    fullProfilePath,
  };
}

// Check if the specified Chrome profile is currently locked by another process
function isProfileInUse(userDataDir) {
  if (process.env.SIMULATE_PROFILE_IN_USE === "true") {
    return true;
  }
  const lockfile = path.join(userDataDir, "lockfile");
  if (fs.existsSync(lockfile)) {
    try {
      const fd = fs.openSync(lockfile, "r+");
      fs.closeSync(fd);
      return false;
    } catch (err) {
      if (err.code === "EBUSY" || err.code === "EPERM") {
        return true;
      }
    }
  }

  const singletonLock = path.join(userDataDir, "SingletonLock");
  if (fs.existsSync(singletonLock)) {
    try {
      const fd = fs.openSync(singletonLock, "r+");
      fs.closeSync(fd);
    } catch (err) {
      if (err.code === "EBUSY" || err.code === "EPERM") {
        return true;
      }
    }
  }

  return false;
}

// Check if Chrome DevTools Protocol endpoint is responding
function checkCdpEndpoint(cdpUrl) {
  return new Promise((resolve) => {
    try {
      const urlObj = new URL(cdpUrl);
      const host = urlObj.hostname || "127.0.0.1";
      const port = urlObj.port || (urlObj.protocol === "https:" ? 443 : 80);
      const req = http.get(
        {
          hostname: host,
          port: port,
          path: "/json/version",
          timeout: 1500,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            try {
              const json = JSON.parse(data);
              resolve(!!json.webSocketDebuggerUrl);
            } catch {
              resolve(false);
            }
          });
        }
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

// ==========================================
// CONFIGURATION
// ==========================================
function getConfig(customUrlsPath = null) {
  loadEnv();

  const chromePath = detectChromePath();
  const profileConfig = getChromeProfileConfig();

  const rawOutputDir =
    (process.env.OUTPUT_DIR && process.env.OUTPUT_DIR.trim() !== "")
      ? process.env.OUTPUT_DIR.trim()
      : (process.env.DOWNLOAD_DIR && process.env.DOWNLOAD_DIR.trim() !== "")
      ? process.env.DOWNLOAD_DIR.trim()
      : "downloads";
  const outputDir = path.isAbsolute(rawOutputDir)
    ? rawOutputDir
    : path.resolve(__dirname, rawOutputDir);

  const failedFile = process.env.FAILED_FILE || path.join(__dirname, "failed_urls.txt");
  const completedFile = process.env.COMPLETED_FILE || path.join(__dirname, "completed_urls.txt");

  let urlsFile = customUrlsPath;
  if (!urlsFile) {
    if (process.env.URLS_FILE && fs.existsSync(process.env.URLS_FILE)) {
      urlsFile = process.env.URLS_FILE;
    } else if (fs.existsSync(path.join(__dirname, "urls.txt"))) {
      urlsFile = path.join(__dirname, "urls.txt");
    } else if (fs.existsSync(path.join(__dirname, "links.txt"))) {
      urlsFile = path.join(__dirname, "links.txt");
    } else {
      urlsFile = path.join(__dirname, "urls.txt");
    }
  }

  const cdpPort = parseIntVal(process.env.CHROME_CDP_PORT, 9222);
  const cdpUrl = process.env.CDP_URL || `http://127.0.0.1:${cdpPort}`;
  const isHeadless = parseBool(process.env.HEADLESS, false);
  const focusWindow = parseBool(process.env.FOCUS_WINDOW, false);
  const persistBrowser = parseBool(process.env.PERSIST_BROWSER, true);
  const reusePage = parseBool(process.env.REUSE_PAGE, true);
  const maxRetries = parseIntVal(process.env.MAX_RETRIES, 3);
  const resultTimeout = parseIntVal(process.env.RESULT_TIMEOUT, 60);
  const downloadTimeout = parseIntVal(process.env.DOWNLOAD_TIMEOUT, 300);
  const inputSettleDelay = parseFloatVal(process.env.INPUT_SETTLE_DELAY, 0.5);
  const buttonStabilizationDelay = parseFloatVal(
    process.env.BUTTON_STABILIZATION_DELAY || process.env.POST_BUTTON_APPEAR_DELAY,
    1.0
  );
  const timeout = parseIntVal(process.env.TIMEOUT, 60000);

  return {
    chromePath,
    userDataDir: profileConfig.userDataDir,
    profileDirectory: profileConfig.profileDirectory,
    fullProfilePath: profileConfig.fullProfilePath,
    outputDir,
    downloadDir: outputDir, // backward compatibility
    urlsFile,
    failedFile,
    completedFile,
    cdpPort,
    cdpUrl,
    isHeadless,
    focusWindow,
    persistBrowser,
    reusePage,
    maxRetries,
    resultTimeout,
    downloadTimeout,
    inputSettleDelay,
    buttonStabilizationDelay,
    postButtonAppearDelay: buttonStabilizationDelay,
    timeout,
  };
}

// ==========================================
// STATE MANAGEMENT & CONTROLS
// ==========================================
let isStopped = false;
let shouldSkip = false;

function stopDownload() {
  isStopped = true;
}

function skipDownload() {
  shouldSkip = true;
}

function logHeader(title, log) {
  const line = "═".repeat(Math.max(title.length + 4, 34));
  log(`\n${line}\n  ${title}\n${line}`);
}

// ==========================================
// SEQUENTIAL FILENAME GENERATOR
// ==========================================
function getNextSequentialFilename(downloadDir, defaultExt = ".mp4") {
  fs.ensureDirSync(downloadDir);
  const ext = defaultExt.startsWith(".") ? defaultExt : `.${defaultExt}`;
  const files = fs.readdirSync(downloadDir);

  let maxNum = 0;
  const pattern = /^vid_(\d+)(\.[a-zA-Z0-9_-]+)?$/i;

  for (const file of files) {
    const match = file.match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  let nextNum = maxNum + 1;
  while (fs.existsSync(path.join(downloadDir, `vid_${nextNum}${ext}`))) {
    nextNum++;
  }

  return `vid_${nextNum}${ext}`;
}

// ==========================================
// URL PARSER
// ==========================================
function loadUrls(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
      filePath,
      "# Add your TeraBox URLs here, one per line\n# Lines starting with # and blank lines are ignored\n",
      "utf-8"
    );
    return [];
  }

  return fs
    .readFileSync(filePath, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

// ==========================================
// PROGRESS & FAILURE RECORDING
// ==========================================
function loadCompletedUrls(completedFile) {
  const set = new Set();
  if (fs.existsSync(completedFile)) {
    const lines = fs.readFileSync(completedFile, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        set.add(trimmed);
      }
    }
  }
  return set;
}

function markCompleted(completedFile, url) {
  fs.appendFileSync(completedFile, `${url}\n`, "utf-8");
}

function recordFailedUrl(failedFile, url, reason) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(failedFile, `[${timestamp}] ${url} | Reason: ${reason}\n`, "utf-8");
}

// ==========================================
// DISMISS OVERLAYS & POPUPS
// ==========================================
async function handlePopupsAndOverlays(page, log) {
  try {
    const cookieBtn = await page.$(
      'button:has-text("Accept All"), button:has-text("Accept"), button:has-text("I Accept"), button:has-text("Got it")'
    );
    if (cookieBtn && (await cookieBtn.isVisible())) {
      await cookieBtn.click();
    }
  } catch {
    // Ignore
  }

  try {
    const closeBtn = await page.$(
      '.fixed.bottom-0 button[aria-label="Close"], .fixed.bottom-0 svg path[d*="6 18L18 6"]'
    );
    if (closeBtn && (await closeBtn.isVisible())) {
      const parentBtn = await closeBtn.evaluateHandle((el) => el.closest("button") || el);
      await parentBtn.click();
    }
  } catch {
    // Ignore
  }
}

// ==========================================
// VERIFY COMPLETE DOWNLOAD ON DISK
// ==========================================
async function verifyDownloadedFile(filePath, timeout = 60000) {
  const startTime = Date.now();

  while (!fs.existsSync(filePath)) {
    if (Date.now() - startTime > timeout) {
      throw new Error(`Timeout waiting for file to appear on disk: ${filePath}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  let lastSize = -1;
  let stableCount = 0;

  while (stableCount < 3) {
    if (Date.now() - startTime > timeout) {
      throw new Error(`Timeout waiting for file download to stabilize: ${filePath}`);
    }

    const stat = await fs.stat(filePath);
    if (stat.size > 0 && stat.size === lastSize) {
      stableCount++;
    } else {
      stableCount = 0;
      lastSize = stat.size;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  const dir = path.dirname(filePath);
  const tempFiles = (await fs.readdir(dir)).filter(
    (f) => f.endsWith(".crdownload") || f.endsWith(".part") || f.endsWith(".tmp")
  );

  return {
    size: lastSize,
    tempFilesCount: tempFiles.length,
  };
}

// ==========================================
// PAUSE & WAIT FOR CLOUDFLARE TO CLEAR
// ==========================================
async function handleCloudflareChallenge(page, log) {
  log(
    "\n" +
    "═════════════════════════════════════════════════════════════════════\n" +
    "🛡️  Cloudflare verification detected.\n\n" +
    "👉 Complete the verification in the Chrome window.\n" +
    "   The downloader will continue automatically when the normal TeraBox\n" +
    "   Downloader page returns.\n" +
    "═════════════════════════════════════════════════════════════════════\n"
  );

  while (!isStopped) {
    await page.waitForTimeout(2000);

    try {
      const input = page.locator('input[placeholder*="Terabox"], input[type="text"]').first();
      const isInputVisible = await input.isVisible().catch(() => false);
      const isInputEnabled = await input.isEnabled().catch(() => false);

      const frames = page.frames();
      const cfFrame = frames.find((f) => f.url().includes("challenges.cloudflare.com"));

      if (isInputVisible && isInputEnabled && !cfFrame) {
        log("✅ Cloudflare verification cleared! Resuming current URL...\n");
        return true;
      }
    } catch {
      // Loop continues
    }
  }

  return false;
}

// ==========================================
// DETECT GENERATED RESULT-CARD DOWNLOAD BUTTON
// ==========================================
// Distinguishes the newly generated result button (e.g. "Download (7.49 MB)")
// from the initial page Download button (which is inside the search form).
async function findGeneratedDownloadButton(page) {
  try {
    // Find all buttons on the page
    const buttons = await page.$$("button");

    for (const btn of buttons) {
      // Check if button is inside the search form (initial submit button)
      const isInsideForm = await btn.evaluate((el) => !!el.closest("form"));
      if (isInsideForm) {
        continue; // DO NOT click the initial page button
      }

      const text = (await btn.innerText()).trim();

      // Check pattern: "Download (<size>)" or "Download File (<size>)"
      const matchesPattern =
        /Download\s*(?:File\s*)?\([0-9.]+\s*[KMGT]?B\)/i.test(text) ||
        (/^Download\s*\(/i.test(text) && text.includes(")"));

      if (matchesPattern) {
        const isVisible = await btn.isVisible();
        const isEnabled = await btn.isEnabled();

        if (isVisible && isEnabled) {
          return {
            element: btn,
            text,
          };
        }
      }
    }
  } catch {
    // Transient DOM navigation
  }

  return null;
}

// ==========================================
// CORE DOWNLOADER ENGINE
// ==========================================
async function runDownloader(customUrlsPath = null, logCallback = null) {
  const log = logCallback || console.log;
  let config;

  try {
    config = getConfig(customUrlsPath);
  } catch (err) {
    log(err.message);
    return { total: 0, completed: 0, failed: 0, skipped: 0, error: err.message };
  }

  isStopped = false;
  shouldSkip = false;

  fs.ensureDirSync(config.outputDir);

  const targetSiteUrl = process.env.TARGET_URL || "https://teraboxdl.site/";
  logHeader("🚀 TeraBox Downloader Starting", log);
  log(`🌐 Target: ${targetSiteUrl}`);
  log(`🌐 Chrome Path: ${config.chromePath}`);
  log(`📂 Chrome Profile: "${config.profileDirectory}" in "${config.userDataDir}"`);
  log(`🔌 CDP Endpoint: ${config.cdpUrl}`);
  log(`📁 Output Dir: ${config.outputDir}`);
  log(`📄 URLs File: ${config.urlsFile}`);
  log(`🔄 Max Retries: ${config.maxRetries}`);
  log(`⏱️ Settle Delays: Input ${config.inputSettleDelay}s | Stabilization ${config.buttonStabilizationDelay}s`);
  log(`⏳ Timeouts: Result ${config.resultTimeout}s | Download ${config.downloadTimeout}s`);
  log(`⚙️ Automation Options: Headless=${config.isHeadless} | FocusWindow=${config.focusWindow} | PersistBrowser=${config.persistBrowser} | ReusePage=${config.reusePage}`);

  // 1. Check if Chrome CDP endpoint is already responding
  let cdpAvailable = await checkCdpEndpoint(config.cdpUrl);

  if (!cdpAvailable) {
    // 2. Check if Chrome profile is currently in use without remote debugging
    if (isProfileInUse(config.userDataDir)) {
      log(
        "\n" +
        "================================================================================\n" +
        "⚠️  Chrome is currently running without remote debugging enabled.\n" +
        "================================================================================\n" +
        "To allow the downloader to attach to your existing Chrome profile & extensions:\n\n" +
        "1. Close all open Google Chrome windows.\n" +
        "2. Start Chrome with remote debugging enabled by running:\n" +
        "   npm run chrome\n" +
        "   (or run start_chrome.bat)\n" +
        "3. Start the downloader:\n" +
        "   npm start\n\n" +
        "Your normal Chrome profile, extensions, and bookmarks will load naturally!\n" +
        "================================================================================\n"
      );
      return {
        total: 0,
        completed: 0,
        failed: 0,
        skipped: 0,
        error: "CHROME_NOT_RUNNING_WITH_CDP",
      };
    }

    // 3. Chrome is not running at all - launch Chrome with remote debugging detached
    log(`🚀 Chrome is not currently running. Launching Chrome with remote debugging on port ${config.cdpPort} (headless: ${config.isHeadless})...`);
    if (process.platform === "win32") {
      const extraArgsList = [
        `'--remote-debugging-port=${config.cdpPort}'`,
        `'--user-data-dir=${config.userDataDir}'`,
        `'--disable-features=DownloadBubble,DownloadBubbleV2'`,
        `'--disable-download-notification'`,
        `'--safebrowsing-disable-download-protection'`,
        `'--no-default-browser-check'`,
        `'--no-first-run'`,
      ];
      if (config.profileDirectory && config.profileDirectory !== "Default") {
        extraArgsList.push(`'--profile-directory=${config.profileDirectory}'`);
      }
      if (config.isHeadless) {
        extraArgsList.push(`'--headless=new'`);
      }
      if (!config.focusWindow) {
        extraArgsList.push(`'--no-focus-on-start'`);
        extraArgsList.push(`'--disable-backgrounding-occluded-windows'`);
        extraArgsList.push(`'--disable-background-timer-throttling'`);
      }
      const windowStyleArg = config.isHeadless ? " -WindowStyle Hidden" : "";
      const script = `$exe = '${config.chromePath}'; $argsList = @(${extraArgsList.join(", ")}); Start-Process -FilePath $exe -ArgumentList $argsList${windowStyleArg}`;
      const encoded = Buffer.from(script, "utf16le").toString("base64");
      const child = spawn("powershell", ["-NoProfile", "-EncodedCommand", encoded], {
        stdio: "ignore",
      });
      await new Promise((r) => child.on("exit", r));
    } else {
      const chromeArgs = [
        `--remote-debugging-port=${config.cdpPort}`,
        `--user-data-dir=${config.userDataDir}`,
        "--disable-features=DownloadBubble,DownloadBubbleV2",
        "--disable-download-notification",
        "--safebrowsing-disable-download-protection",
        "--no-default-browser-check",
        "--no-first-run",
      ];
      if (config.profileDirectory && config.profileDirectory !== "Default") {
        chromeArgs.push(`--profile-directory=${config.profileDirectory}`);
      }
      if (config.isHeadless) {
        chromeArgs.push("--headless=new");
      }
      if (!config.focusWindow) {
        chromeArgs.push("--no-focus-on-start");
        chromeArgs.push("--disable-backgrounding-occluded-windows");
        chromeArgs.push("--disable-background-timer-throttling");
      }
      const spawnedProc = spawn(config.chromePath, chromeArgs, {
        detached: true,
        stdio: "ignore",
      });
      spawnedProc.unref();
    }

    // Wait for CDP endpoint to respond
    const startTime = Date.now();
    while (Date.now() - startTime < 12000) {
      await new Promise((r) => setTimeout(r, 500));
      if (await checkCdpEndpoint(config.cdpUrl)) {
        cdpAvailable = true;
        break;
      }
    }

    if (!cdpAvailable) {
      log(
        "\n" +
        "================================================================================\n" +
        "❌ Unable to connect to Chrome remote debugging endpoint at " + config.cdpUrl + "\n" +
        "================================================================================\n" +
        "Please start Chrome manually using:\n" +
        "   npm run chrome\n" +
        "   (or start_chrome.bat)\n" +
        "Then run: npm start\n" +
        "================================================================================\n"
      );
      return {
        total: 0,
        completed: 0,
        failed: 0,
        skipped: 0,
        error: "CDP_CONNECT_TIMEOUT",
      };
    }
  }

  const urls = loadUrls(config.urlsFile);
  if (urls.length === 0) {
    log(`⚠️ No URLs found in ${config.urlsFile}.`);
    log(`📝 Please add TeraBox links (one per line) to ${config.urlsFile} and run again.`);
    return { total: 0, completed: 0, failed: 0, skipped: 0 };
  }

  const completedUrls = loadCompletedUrls(config.completedFile);
  log(`📋 Found ${urls.length} URLs in queue (${completedUrls.size} previously completed).`);

  let totalSuccess = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  // Helper to connect over CDP and apply network route filtering
  async function connectSession() {
    log(`🔗 Attaching to Chrome session at ${config.cdpUrl}...`);
    const b = await chromium.connectOverCDP(config.cdpUrl);
    const ctx = b.contexts().length > 0 ? b.contexts()[0] : await b.newContext();
    try {
      await ctx.route("**/*", (route) => {
        const reqUrl = route.request().url();
        if (
          reqUrl.includes("googleads") ||
          reqUrl.includes("doubleclick") ||
          reqUrl.includes("pagead2") ||
          reqUrl.includes("fundingchoicesmessages") ||
          reqUrl.includes("adservice") ||
          reqUrl.includes("adpub")
        ) {
          return route.abort();
        }
        return route.continue();
      });
    } catch {
      // Non-critical
    }
    return { browser: b, context: ctx };
  }

  // Helper to acquire a page according to REUSE_PAGE setting
  async function acquirePage(ctx, reuse) {
    if (reuse) {
      const pages = ctx.pages();
      const existingTab = pages.find((p) => {
        try {
          const u = p.url();
          return u && u.includes("teraboxdl.site");
        } catch {
          return false;
        }
      });
      if (existingTab) {
        log(`Reusing existing TeraBox tab: ${existingTab.url()}`);
        return existingTab;
      }
      const blankTab = pages.find((p) => {
        try {
          const u = p.url();
          return (
            u === "about:blank" ||
            u === "chrome://newtab/" ||
            u === "chrome://new-tab-page/"
          );
        } catch {
          return false;
        }
      });
      const chosen = blankTab || (pages.length > 0 ? pages[0] : await ctx.newPage());
      return chosen;
    } else {
      log("Opening fresh tab for URL (REUSE_PAGE=false)...");
      return await ctx.newPage();
    }
  }

  let persistentBrowser = null;
  let persistentContext = null;
  let sharedPage = null;

  try {
    if (config.persistBrowser) {
      const session = await connectSession();
      persistentBrowser = session.browser;
      persistentContext = session.context;
      log("Connected to Chrome (persistent session)");

      if (config.reusePage) {
        sharedPage = await acquirePage(persistentContext, true);
      }
    }

    for (let i = 0; i < urls.length; i++) {
      if (isStopped) {
        log("⛔ Download process stopped by user request.");
        break;
      }

      const prefix = `[${i + 1}/${urls.length}]`;
      const url = urls[i];

      logHeader(`${prefix} Processing URL...`, log);
      log(`${prefix} URL: ${url}`);

      // Resume support: check if already completed
      if (completedUrls.has(url)) {
        log(`${prefix} Already completed in previous run. Skipping.`);
        totalSkipped++;
        continue;
      }

      let activeBrowser = persistentBrowser;
      let activeContext = persistentContext;
      let urlPage = null;

      if (!config.persistBrowser) {
        const session = await connectSession();
        activeBrowser = session.browser;
        activeContext = session.context;
      }

      if (config.reusePage && sharedPage && !sharedPage.isClosed()) {
        urlPage = sharedPage;
      } else {
        urlPage = await acquirePage(activeContext, config.reusePage);
        if (config.reusePage) {
          sharedPage = urlPage;
        }
      }

      // Bring to front only if focusWindow is explicitly true
      if (config.focusWindow && urlPage) {
        await urlPage.bringToFront().catch(() => {});
      }

      let success = false;
      let lastErrorMessage = "";

      for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
        if (isStopped) break;

        shouldSkip = false;
        if (attempt > 1) {
          log(`${prefix} 🔁 Retry attempt ${attempt}/${config.maxRetries} for: ${url}`);
          await urlPage.waitForTimeout(2000);
        }

        try {
          // Listen to API proxy response to capture error messages directly
          let proxyResponseData = null;
          const onResponse = async (resp) => {
            if (resp.url().includes("/api/proxy")) {
              try {
                const text = await resp.text();
                proxyResponseData = JSON.parse(text);
              } catch {
                // Ignore parse errors
              }
            }
          };
          urlPage.on("response", onResponse);

          await urlPage.goto(targetSiteUrl, {
            waitUntil: "domcontentloaded",
            timeout: config.timeout,
          });

          await urlPage.waitForTimeout(500);
          await handlePopupsAndOverlays(urlPage, log);

          // Locate input field
          const input = urlPage.locator('input[placeholder*="Terabox"], input[type="text"]').first();
          await input.waitFor({ state: "visible", timeout: 15000 });
          await input.click({ force: true });

          // Paste the URL using clipboard and React native value setter
          await urlPage.evaluate(async ({ val, focusWindow }) => {
            const el = document.querySelector('input[placeholder*="Terabox"], input[type="text"]');
            if (el) {
              if (focusWindow) {
                el.focus();
              }
              try {
                await navigator.clipboard.writeText(val);
              } catch {
                // Fallback
              }
              const nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value"
              )?.set;
              if (nativeSetter) {
                nativeSetter.call(el, val);
              } else {
                el.value = val;
              }
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));

              // Dispatch paste event with clipboard data
              try {
                const dt = new DataTransfer();
                dt.setData("text/plain", val);
                const pasteEvt = new ClipboardEvent("paste", {
                  bubbles: true,
                  cancelable: true,
                  clipboardData: dt,
                });
                el.dispatchEvent(pasteEvt);
              } catch {
                // Ignore
              }
            }
          }, { val: url, focusWindow: config.focusWindow });

          await input.fill(url);

          // Also click the built-in paste button on the form if present (triggers automatic generation)
          try {
            const pasteBtn = urlPage.locator('form button[type="button"]').first();
            if (await pasteBtn.isVisible()) {
              await pasteBtn.click();
            }
          } catch {
            // Ignore
          }

          log(`${prefix} URL pasted.`);

          // Small settle delay after paste for UI registration
          if (config.inputSettleDelay > 0) {
            await urlPage.waitForTimeout(config.inputSettleDelay * 1000);
          }

          // ==========================================================
          // CRITICAL: DO NOT CLICK THE INITIAL PAGE DOWNLOAD BUTTON!
          // The paste action automatically triggers result generation.
          // Wait directly for the generated result card & final button.
          // ==========================================================
          log(`${prefix} Waiting for generated result...`);

          const startTime = Date.now();
          const resultMaxTimeoutMs = config.resultTimeout * 1000;
          let finalButtonInfo = null;
          let resultCardDetected = false;
          let siteError = null;

          while (Date.now() - startTime < resultMaxTimeoutMs) {
            if (isStopped || shouldSkip) break;

            // Check if Cloudflare verification appeared
            const frames = urlPage.frames();
            const cfFrame = frames.find((f) => f.url().includes("challenges.cloudflare.com"));
            const cfElement = await urlPage.$(
              "#challenge-running, #cf-turnstile-wrapper, .challenge-platform"
            );

            if (cfFrame || cfElement) {
              const cleared = await handleCloudflareChallenge(urlPage, log);
              if (cleared) {
                log(`${prefix} Re-checking for generated result after verification...`);
                continue;
              }
            }

            // Check API proxy response for errors
            if (proxyResponseData) {
              if (
                proxyResponseData.errno !== undefined &&
                proxyResponseData.errno !== 0
              ) {
                siteError =
                  proxyResponseData.errmsg ||
                  proxyResponseData.message ||
                  `TeraBox API error (code: ${proxyResponseData.errno})`;
                break;
              }
            }

            // Check DOM error banners or toasts
            try {
              const errorElement = await urlPage.$(
                '[role="alert"], .toast, [class*="destructive"], [class*="error"]'
              );
              if (errorElement) {
                const errorText = await errorElement.innerText().catch(() => "");
                if (
                  errorText &&
                  (errorText.toLowerCase().includes("not accessible") ||
                    errorText.toLowerCase().includes("failed") ||
                    errorText.toLowerCase().includes("rejected") ||
                    errorText.toLowerCase().includes("invalid") ||
                    errorText.toLowerCase().includes("error"))
                ) {
                  siteError = errorText.replace(/\n+/g, " ").trim();
                  break;
                }
              }
            } catch {
              // Transient navigation
            }

            // Check if result card container has appeared
            if (!resultCardDetected) {
              try {
                const resultCard = await urlPage.$(
                  ".scroll-target, [class*='result'], div:has(h3)"
                );
                if (resultCard && (await resultCard.isVisible())) {
                  resultCardDetected = true;
                  log(`${prefix} Result card detected.`);
                }
              } catch {
                // Ignore
              }
            }

            // Check for the generated result-card Download button: Download (SIZE)
            finalButtonInfo = await findGeneratedDownloadButton(urlPage);
            if (finalButtonInfo) {
              break;
            }

            await urlPage.waitForTimeout(500);
          }

          urlPage.off("response", onResponse);

          if (shouldSkip) {
            log(`${prefix} ⏭️ Skipped URL by user request.`);
            break;
          }

          if (siteError) {
            throw new Error(`Site reported error: ${siteError}`);
          }

          if (!finalButtonInfo) {
            log(`${prefix} Final Download button not detected after ${config.resultTimeout} seconds.`);
            throw new Error(`Final Download button not detected after ${config.resultTimeout} seconds.`);
          }

          log(`${prefix} Final Download button detected: ${finalButtonInfo.text}`);

          // Wait until button is visible and enabled
          await finalButtonInfo.element.waitForElementState("visible", { timeout: 10000 }).catch(() => {});
          await finalButtonInfo.element.waitForElementState("enabled", { timeout: 10000 }).catch(() => {});

          // Small stabilization delay as requested
          const stabDelay = config.buttonStabilizationDelay;
          if (stabDelay > 0) {
            log(`${prefix} Waiting ${stabDelay.toFixed(1)}s for UI stabilization...`);
            await urlPage.waitForTimeout(stabDelay * 1000);
          }

          log(`${prefix} Clicking final Download...`);

          // Set up download listeners on both page and context
          const downloadMaxTimeoutMs = config.downloadTimeout * 1000;
          const downloadPromise = Promise.race([
            urlPage.waitForEvent("download", { timeout: downloadMaxTimeoutMs }),
            activeContext.waitForEvent("download", { timeout: downloadMaxTimeoutMs }),
          ]);

          let popupPromise = activeContext.waitForEvent("page", { timeout: 5000 }).catch(() => null);

          // Click the verified final Download button
          await finalButtonInfo.element.scrollIntoViewIfNeeded();
          await finalButtonInfo.element.click({ force: true });

          const popupPage = await popupPromise;
          let popupDownloadPromise = null;
          if (popupPage) {
            popupDownloadPromise = popupPage
              .waitForEvent("download", { timeout: 30000 })
              .catch(() => null);
          }

          const download = await Promise.race([
            downloadPromise,
            ...(popupDownloadPromise ? [popupDownloadPromise] : []),
          ]);

          if (!download) {
            throw new Error("Download event did not fire after clicking final download button.");
          }

          log(`${prefix} Download started.`);

          // Close any extra popup tab opened by the download click
          if (popupPage && !popupPage.isClosed()) {
            await popupPage.close().catch(() => {});
          }

          // Determine sequential filename and preserve actual extension
          const suggestedName = download.suggestedFilename() || "video.mp4";
          const rawExt = path.extname(suggestedName);
          const ext = rawExt && rawExt.length > 1 && rawExt.length < 8 ? rawExt : ".mp4";

          const targetFilename = getNextSequentialFilename(config.outputDir, ext);
          const targetPath = path.join(config.outputDir, targetFilename);

          // Wait for download to finish from browser
          await download.saveAs(targetPath);

          // Verify file completely downloaded and stabilized on disk
          await verifyDownloadedFile(targetPath, Math.max(60000, downloadMaxTimeoutMs));

          log(`${prefix} Download completed.`);
          log(`${prefix} Saved as ${targetFilename}`);

          // Mark URL as completed for resume support
          markCompleted(config.completedFile, url);
          completedUrls.add(url);

          success = true;
          totalSuccess++;
          break; // Success! Exit retry loop
        } catch (err) {
          lastErrorMessage = err.message;
          log(`${prefix} ⚠️ Attempt ${attempt}/${config.maxRetries} failed: ${err.message}`);
        } finally {
          // Clean up any extra tabs created, keep the working page alive
          try {
            for (const p of activeContext.pages()) {
              if (p !== urlPage && !p.isClosed()) {
                await p.close().catch(() => {});
              }
            }
          } catch {
            // Ignore
          }
        }
      }

      // If REUSE_PAGE=false, close the URL's page now that processing is finished
      if (!config.reusePage && urlPage && !urlPage.isClosed()) {
        try {
          await urlPage.close();
        } catch {
          // Ignore
        }
        urlPage = null;
      }

      // If PERSIST_BROWSER=false, disconnect the per-URL browser connection now
      if (!config.persistBrowser && activeBrowser) {
        try {
          await activeBrowser.close();
        } catch {
          // Ignore
        }
        activeBrowser = null;
        activeContext = null;
      }

      if (!success && !shouldSkip && !isStopped) {
        log(`${prefix} ❌ URL failed after ${config.maxRetries} attempts: ${url}`);
        recordFailedUrl(config.failedFile, url, lastErrorMessage || "Max retries exceeded");
        totalFailed++;
      }
    }

    logHeader("📊 Batch Processing Finished", log);
    log(`✨ Successfully Downloaded: ${totalSuccess}`);
    log(`⏩ Skipped (Already Downloaded): ${totalSkipped}`);
    log(`❌ Failed: ${totalFailed}`);
    log(`📁 Output Folder: ${config.outputDir}`);
    if (totalFailed > 0) {
      log(`📝 Check failed URLs in: ${config.failedFile}`);
    }
  } catch (fatalErr) {
    log(`🔥 Fatal Error: ${fatalErr.message}`);
  } finally {
    // If persistent browser was connected, disconnect cleanly
    if (persistentBrowser) {
      log("Disconnecting from Chrome session...");
      try {
        await persistentBrowser.close();
      } catch {
        // Ignore
      }
      log("✨ Downloader disconnected. Chrome browser session remains open.");
    }
  }

  return {
    total: urls.length,
    completed: totalSuccess,
    failed: totalFailed,
    skipped: totalSkipped,
  };
}

// CLI Execution entrypoint
if (require.main === module) {
  const args = process.argv.slice(2);
  let customFile = null;

  for (const arg of args) {
    if (arg === "--headless") {
      process.env.HEADLESS = "true";
    } else if (arg === "--no-headless" || arg === "--visible") {
      process.env.HEADLESS = "false";
    } else if (arg === "--focus") {
      process.env.FOCUS_WINDOW = "true";
    } else if (arg === "--no-focus") {
      process.env.FOCUS_WINDOW = "false";
    } else if (!arg.startsWith("-")) {
      customFile = arg;
    }
  }

  runDownloader(customFile, (msg) => {
    console.log(msg);
  })
    .then((result) => {
      if (
        result &&
        (result.error === "PROFILE_IN_USE" ||
          result.error === "CHROME_NOT_RUNNING_WITH_CDP" ||
          result.error === "CDP_CONNECT_TIMEOUT")
      ) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("FATAL:", err);
      process.exit(1);
    });
}

module.exports = {
  runDownloader,
  stopDownload,
  skipDownload,
  detectChromePath,
  getChromeProfileConfig,
  isProfileInUse,
  checkCdpEndpoint,
  getConfig,
  getNextSequentialFilename,
  loadUrls,
  loadCompletedUrls,
  markCompleted,
  recordFailedUrl,
  verifyDownloadedFile,
  findGeneratedDownloadButton,
};
