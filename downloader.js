const fs = require("fs-extra");
const path = require("path");
const { chromium } = require("playwright");

const bravePath =
  "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe";
const downloadDir = path.join(
  require("os").homedir(),
  "Documents",
  "TeraDownload"
);

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
        headless: true,
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

        // Handle cookie popup if it appears
        try {
          const acceptBtn = await page.waitForSelector(
            'button:has-text("Accept All")',
            { timeout: 5000 }
          );
          await acceptBtn.click();
          log("🍪 Cookie popup accepted.");
        } catch {
          log("👍 No cookie popup or already accepted.");
        }

        // Paste the Terabox link
        try {
          await page.waitForSelector('input[placeholder*="Terabox"]', {
            timeout: 8000,
          });
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

        // Click "Download & Stream" button
        try {
          const streamBtn = await page.waitForSelector(
            'button:has-text("Download & Stream")',
            { timeout: 15000 }
          );
          await streamBtn.click();
          log("🎬 Clicked 'Download & Stream' button...");
        } catch {
          log("⚠️ 'Download & Stream' button not found, skipping...");
          await browser.close();
          continue;
        }

        // Step 1: Click the play button
        try {
          const playBtn = await page.waitForSelector("svg.lucide-play", {
            timeout: 20000,
          });
          await playBtn.click();
          log("▶️ Clicked play button to load download page...");
          await page.waitForTimeout(2000);
        } catch {
          log("⚠️ Play button not found, skipping...");
          await browser.close();
          continue;
        }

        // Step 2: Click the final "Download Video" button
        try {
          const finalDownloadBtn = await page.waitForSelector(
            'button:has-text("Download Video")',
            { timeout: 30000 }
          );

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

          // Get temp download path
          const tempPath = await download.path();
          const stat = await fs.stat(tempPath);
          const fileSizeMB = stat.size / (1024 * 1024);

          if (fileSizeMB > 100) {
            log(`⚠️ File too large (${fileSizeMB.toFixed(2)} MB), skipping.`);
            await fs.remove(tempPath); // delete temp file
            await browser.close();
            continue;
          }

          // Save final file
          const baseName = `vid${i + 1}.mp4`;
          const targetPath = path.join(downloadDir, baseName);
          await download.saveAs(targetPath);
          log(`✅ Downloaded as ${baseName}`);

          // Delete temp file after saving (Playwright should clean up, but extra safety)
          try {
            if (fs.existsSync(tempPath)) await fs.remove(tempPath);
          } catch (e) {
            log(`⚠️ Failed to delete temp file: ${e.message}`);
          }

          await browser.close();
        } catch (err) {
          log(`❌ Error clicking final download: ${err.message}`);
          await browser.close();
        }
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
  skipDownload,
};
