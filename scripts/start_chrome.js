const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

function parseBool(val, defaultVal = false) {
  if (val === undefined || val === null) return defaultVal;
  const s = String(val).trim().toLowerCase();
  if (s === '') return defaultVal;
  return s === 'true' || s === '1' || s === 'yes';
}

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
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

loadEnv();

function checkCdpPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 1000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(!!json.webSocketDebuggerUrl);
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function detectChromePath() {
  const customPath = (process.env.CHROME_PATH || '').trim();
  if (customPath) {
    if (fs.existsSync(customPath)) return customPath;
    throw new Error(`Specified CHROME_PATH does not exist: "${customPath}".`);
  }
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const candidates = [
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new Error('Google Chrome executable not found. Please install Chrome or set CHROME_PATH in .env');
}

function isProfileInUse(userDataDir) {
  const lockfile = path.join(userDataDir, 'lockfile');
  if (fs.existsSync(lockfile)) {
    try {
      const fd = fs.openSync(lockfile, 'r+');
      fs.closeSync(fd);
    } catch (err) {
      if (err.code === 'EBUSY' || err.code === 'EPERM') return true;
    }
  }
  const singletonLock = path.join(userDataDir, 'SingletonLock');
  if (fs.existsSync(singletonLock)) {
    try {
      const fd = fs.openSync(singletonLock, 'r+');
      fs.closeSync(fd);
    } catch (err) {
      if (err.code === 'EBUSY' || err.code === 'EPERM') return true;
    }
  }
  return false;
}

async function startChrome() {
  const port = parseInt(process.env.CHROME_CDP_PORT, 10) || 9222;
  const chromePath = detectChromePath();
  const rawProfileDir = (process.env.CHROME_PROFILE_DIRECTORY || '').trim();
  const profileDir = rawProfileDir !== '' ? rawProfileDir : 'Default';
  const localAppData = process.env.LOCALAPPDATA || '';
  const defaultUserData = path.join(localAppData, 'Google', 'Chrome', 'User Data');
  const rawUserData = (process.env.CHROME_USER_DATA_DIR || '').trim();
  const userDataDir = rawUserData !== '' ? rawUserData : defaultUserData;
  const isHeadless = parseBool(process.env.HEADLESS, false);
  const focusWindow = parseBool(process.env.FOCUS_WINDOW, false);

  console.log('====================================================');
  console.log('       GOOGLE CHROME REMOTE DEBUGGING LAUNCHER      ');
  console.log('====================================================');
  console.log(`Executable  : ${chromePath}`);
  console.log(`User Data   : ${userDataDir}`);
  console.log(`Profile     : ${profileDir}`);
  console.log(`CDP Port    : ${port}`);
  console.log(`Headless    : ${isHeadless}`);
  console.log(`Focus Window: ${focusWindow}`);
  console.log('----------------------------------------------------');

  // Check if already responding
  const alreadyRunning = await checkCdpPort(port);
  if (alreadyRunning) {
    console.log(`\n✔ Chrome is ALREADY running with remote debugging on port ${port}.`);
    console.log('  Your existing profile and extensions are active.');
    console.log('  You can now start the downloader: npm start\n');
    return;
  }

  // Check if Chrome profile is currently in use without remote debugging
  if (isProfileInUse(userDataDir)) {
    console.log('\n⚠️  Chrome is currently running without remote debugging enabled.');
    console.log('   Chromium profiles cannot be shared concurrently across separate processes.\n');
    console.log('   To start Chrome with remote debugging:');
    console.log('   1. Close all open Google Chrome windows.');
    console.log('   2. Run this command again: npm run chrome');
    console.log('   3. Run the downloader: npm start\n');
    process.exit(1);
  }

  console.log(`Launching Google Chrome with remote debugging on port ${port}...`);

  if (process.platform === 'win32') {
    const extraArgsList = [
      `'--remote-debugging-port=${port}'`,
      `'--user-data-dir=${userDataDir}'`,
      `'--disable-features=DownloadBubble,DownloadBubbleV2'`,
      `'--disable-download-notification'`,
      `'--safebrowsing-disable-download-protection'`,
      `'--no-default-browser-check'`,
      `'--no-first-run'`,
    ];
    if (profileDir && profileDir !== 'Default') {
      extraArgsList.push(`'--profile-directory=${profileDir}'`);
    }
    if (isHeadless) {
      extraArgsList.push(`'--headless=new'`);
    }
    if (!focusWindow) {
      extraArgsList.push(`'--no-focus-on-start'`);
      extraArgsList.push(`'--disable-backgrounding-occluded-windows'`);
      extraArgsList.push(`'--disable-background-timer-throttling'`);
    }
    const windowStyle = isHeadless ? ' -WindowStyle Hidden' : '';
    const script = `$exe = '${chromePath}'; $argsList = @(${extraArgsList.join(', ')}); Start-Process -FilePath $exe -ArgumentList $argsList${windowStyle}`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn('powershell', ['-NoProfile', '-EncodedCommand', encoded], {
      stdio: 'ignore',
    });
    await new Promise((r) => child.on('exit', r));
  } else {
    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--disable-features=DownloadBubble,DownloadBubbleV2',
      '--disable-download-notification',
      '--safebrowsing-disable-download-protection',
      '--no-default-browser-check',
      '--no-first-run',
    ];
    if (profileDir && profileDir !== 'Default') {
      args.push(`--profile-directory=${profileDir}`);
    }
    if (isHeadless) {
      args.push('--headless=new');
    }
    if (!focusWindow) {
      args.push('--no-focus-on-start');
      args.push('--disable-backgrounding-occluded-windows');
      args.push('--disable-background-timer-throttling');
    }
    const child = spawn(chromePath, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }

  // Poll for up to 10 seconds for CDP endpoint to respond
  const startTime = Date.now();
  let ready = false;
  while (Date.now() - startTime < 10000) {
    await new Promise((r) => setTimeout(r, 500));
    if (await checkCdpPort(port)) {
      ready = true;
      break;
    }
  }

  if (ready) {
    console.log(`\n✔ Chrome successfully launched with remote debugging on port ${port}!`);
    console.log('  Your normal profile, extensions, and bookmarks are fully loaded.');
    console.log('  Chrome will remain open after the downloader finishes.');
    console.log('  You can now run: npm start\n');
  } else {
    console.log(`\n⚠️  Chrome was started, but port ${port} did not respond within 10s.`);
    console.log('  If Chrome opened, verify that it was not already running in the background.\n');
  }
}

if (require.main === module) {
  startChrome().catch((err) => {
    console.error('Failed to start Chrome:', err.message);
    process.exit(1);
  });
}

module.exports = { startChrome, checkCdpPort };
