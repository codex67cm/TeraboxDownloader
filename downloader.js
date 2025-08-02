const fs = require("fs-extra");
const path = require("path");
const { chromium } = require("playwright");

const bravePath = "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe";
const downloadDir = path.join(require("os").homedir(), "Documents", "TeraDownload");

fs.ensureDirSync(downloadDir);

let isStopped = false;
let shouldSkip = false;

function stopDownload() {
  isStopped = true;
}

function skipDownload() {
  shouldSkip = true;
}

function logHeader(title, log) {
  const line = "═".repeat(title.length + 4);
  log(`\n${line}\n  ${title}\n${line}`);
}

async function runDownloader(linksPath, log) {
  try {
    isStopped = false;
    shouldSkip = false;

    const links = fs.readFileSync(linksPath, "utf-8")
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean);

    outerLoop:
    for (let i = 0; i < links.length; i++) {
      if (isStopped) {
        log("⛔ Download Stopped.");
        break;
      }

      const link = links[i];
      logHeader(`🔗 Processing link ${i + 1} of ${links.length}`, log);
      log(`📎 ${link}`);

      const browser = await chromium.launch({
        executablePath: bravePath,
        headless: true,
        downloadsPath: downloadDir,
        args: ["--window-size=1280,800"]
      });

      const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1280, height: 800 }
      });

      const page = await context.newPage();

      try {
        await page.goto("https://teraboxdl.site/");
        log("🌐 Opened teraboxdl.site");

        try {
          const acceptBtn = await page.waitForSelector('button:has-text("Accept All")', { timeout: 5000 });
          await acceptBtn.click();
          log("🍪 Cookie popup accepted.");
        } catch {
          log("👍 No cookie popup or already accepted.");
        }

        await page.fill('input[placeholder="Paste your Terabox URL here..."]', link);
        await page.click('button:has-text("Fetch Files")');
        log("🔍 Fetching files...");

        log("⏳ Waiting for download button...");
        const downloadBtn = await page.waitForSelector('button:has(span:text(\"Download\"))', { timeout: 30000 });

        if (shouldSkip) {
          log("⏭️ Skipped before clicking download.");
          shouldSkip = false;
          await context.close();
          await browser.close();
          continue;
        }

        await downloadBtn.scrollIntoViewIfNeeded();
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 60000 }),
          downloadBtn.click()
        ]);

        log("⬇️ Download started...");

        if (shouldSkip) {
          log("⏭️ Skipping active download...");
          shouldSkip = false;
          await context.close(); // force kill download
          await browser.close();
          continue;
        }

        const downloadPath = await download.path();
        const stat = await fs.stat(downloadPath);
        const fileSizeMB = stat.size / (1024 * 1024);

        if (fileSizeMB > 100) {
          log(`⚠️ File too large (${fileSizeMB.toFixed(2)} MB), skipping.`);
          await fs.remove(downloadPath);
          await browser.close();
          continue;
        }

        const baseName = `vid${i + 1}.mp4`;
        const targetPath = path.join(downloadDir, baseName);
        await download.saveAs(targetPath);

        log(`✅ Downloaded as ${baseName}`);
        await browser.close();

      } catch (err) {
        log(`❌ Error: ${err.message}`);
        await browser.close();
      }
    }

    logHeader("✅ All Links Processed", log);

  } catch (e) {
    log("🔥 Fatal error: " + e.message);
  }
}

module.exports = {
  runDownloader,
  stopDownload,
  skipDownload
};
