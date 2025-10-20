const fs = require("fs-extra");
const path = require("path");
const { chromium } = require("playwright");

const bravePath =
  "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe";
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

async function waitAndClick(page, selector, label, timeout = 15000) {
  try {
    const el = await page.waitForSelector(selector, { timeout });
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await el.click();
    return true;
  } catch {
    return false;
  }
}

async function runDownloader(linksPath, log) {
  try {
    isStopped = false;
    shouldSkip = false;

    const links = fs
      .readFileSync(linksPath, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

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
        headless: false,
        downloadsPath: downloadDir,
        args: ["--window-size=1280,800"],
      });

      const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1280, height: 800 },
      });

      const page = await context.newPage();

      try {
        await page.goto("https://teraboxdl.site/");
        log("🌐 Opened teraboxdl.site");

        // Handle cookie popup if present
        try {
          const acceptBtn = await page.waitForSelector('button:has-text("Accept All")', { timeout: 5000 });
          await acceptBtn.click();
          log("🍪 Cookie popup accepted.");
        } catch {
          log("👍 No cookie popup or already accepted.");
        }

        // Fill link input
        try {
          await page.waitForSelector('input[placeholder*="Terabox"]', { timeout: 8000 });
          await page.fill('input[placeholder*="Terabox"]', link);
          log("📋 Pasted link into input.");
        } catch {
          const input = await page.$("input, textarea");
          if (input) {
            await input.fill(link);
            log("📋 Pasted link using fallback input selector.");
          } else {
            log("⚠️ Could not find input field to paste link.");
          }
        }

        // Click "Download & Stream"
        if (!(await waitAndClick(page, 'button:has-text("Download & Stream")', "Download & Stream", 20000))) {
          log("⚠️ 'Download & Stream' button not found, skipping...");
          await browser.close();
          continue;
        }
        log("🎬 Clicked 'Download & Stream' button...");

        // Wait for play button (robust detection)
        log("⏳ Waiting for play button...");
        const playBtnSelector =
          'button:has(svg.lucide-play), svg.lucide-play';
        let playFound = false;

        for (let attempt = 0; attempt < 5; attempt++) {
          if (await page.$(playBtnSelector)) {
            playFound = true;
            break;
          }
          await page.waitForTimeout(2000);
        }

        if (!playFound) {
          log("⚠️ Play button did not appear, skipping...");
          await browser.close();
          continue;
        }

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(500);
        await page.click(playBtnSelector);
        log("▶️ Clicked play button, loading download page...");

        // Wait for final download button
        log("⏳ Waiting for final 'Download Video' button...");
        const finalDownloadBtn = await page.waitForSelector('button:has-text("Download Video")', {
          timeout: 40000,
        });

        await finalDownloadBtn.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);

        if (shouldSkip) {
          log("⏭️ Skipped before clicking final download.");
          shouldSkip = false;
          await context.close();
          await browser.close();
          continue;
        }

        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 60000 }),
          finalDownloadBtn.click(),
        ]);

        log("⬇️ Final download started...");

        if (shouldSkip) {
          log("⏭️ Skipping active download...");
          shouldSkip = false;
          await context.close();
          await browser.close();
          continue;
        }

        const tempPath = await download.path();
        const stat = await fs.stat(tempPath);
        const fileSizeMB = stat.size / (1024 * 1024);

        if (fileSizeMB > 100) {
          log(`⚠️ File too large (${fileSizeMB.toFixed(2)} MB), skipping.`);
          await fs.remove(tempPath);
          await browser.close();
          continue;
        }

        const baseName = `vid${i + 1}.mp4`;
        const targetPath = path.join(downloadDir, baseName);
        await download.saveAs(targetPath);
        log(`✅ Downloaded as ${baseName}`);

        try {
          if (fs.existsSync(tempPath)) await fs.remove(tempPath);
        } catch (e) {
          log(`⚠️ Failed to delete temp file: ${e.message}`);
        }

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

module.exports = { runDownloader, stopDownload, skipDownload };
