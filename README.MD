# TeraBox Batch Downloader

A simple batch downloader for TeraBox links using `teraboxdl.site`.

It connects to your normal Google Chrome session instead of creating a separate browser profile, so your existing cookies, extensions, logins, and settings stay available.

## Features

- Uses your existing Chrome profile
- Keeps your Chrome extensions and cookies
- Works with `Default`, `Profile 1`, `Profile 2`, etc.
- Keeps Chrome open after the downloader finishes
- Reuses the same tab for the whole queue
- Automatically processes multiple TeraBox links
- Detects the final download button automatically
- Waits for downloads to fully finish before moving on
- Automatically renames files:
  - `vid_1.mp4`
  - `vid_2.mp4`
  - `vid_3.mp4`
- Won't overwrite files from previous runs
- Remembers completed URLs so you can resume later
- Retries failed downloads automatically
- Saves failed URLs to `failed_urls.txt`
- Handles Cloudflare verification without restarting Chrome
- Blocks common ad/tracking requests that can cause unwanted redirects

## Requirements

- Windows
- Node.js 16 or newer
- Google Chrome

Chrome is normally found in one of these locations:

```text
C:\Program Files\Google\Chrome\Application\chrome.exe
C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe
```

You can also set a custom Chrome path in `.env`.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure `.env`

Copy `.env.example` to `.env` and change anything you need.

```ini
# Chrome
CHROME_PATH=
CHROME_USER_DATA_DIR=
CHROME_PROFILE_DIRECTORY=Default

# Browser
HEADLESS=false
FOCUS_WINDOW=false
PERSIST_BROWSER=true
REUSE_PAGE=true

# Downloads
OUTPUT_DIR=downloads
DOWNLOAD_TIMEOUT=300
RESULT_TIMEOUT=60

# Timing
INPUT_SETTLE_DELAY=0.5
BUTTON_STABILIZATION_DELAY=1.0

# Retry
MAX_RETRIES=3

# Chrome debugging
CHROME_CDP_PORT=9222

# URL list
URLS_FILE=urls.txt
```

For most users, the default settings should be fine.

## Using it

### 1. Start Chrome

If Chrome is already open normally, close it first.

Then run:

```bash
npm run chrome
```

You can also double-click:

```text
start_chrome.bat
```

This starts Chrome with remote debugging enabled.

Chrome will still look and behave normally. Your usual profile, extensions, cookies, bookmarks, and logins are kept.

### 2. Add your links

Put your TeraBox links in:

```text
urls.txt
```

One link per line:

```text
https://teraboxapp.com/s/example1
https://1024terabox.com/s/example2
https://teraboxapp.com/s/example3
```

Empty lines and lines starting with `#` are ignored.

### 3. Start the downloader

```bash
npm start
```

Or:

```bash
node downloader.js
```

The downloader will process the links one by one.

## How it works

The downloader attaches to the Chrome instance started with remote debugging.

It then:

1. Finds an existing `teraboxdl.site` tab.
2. If there isn't one, it uses an available blank tab.
3. Opens the TeraBox downloader.
4. Enters the next URL.
5. Waits for the download result.
6. Finds the final download button.
7. Starts the download.
8. Waits until the file is completely downloaded.
9. Renames it to the next available `vid_#.extension`.
10. Moves to the next URL.

The same Chrome window and tab are used throughout the entire queue.

When everything is finished, the downloader disconnects from Chrome.

**Chrome stays open.**

## Downloads

Downloaded files are stored in:

```text
downloads/
```

For example:

```text
downloads/
├── vid_1.mp4
├── vid_2.mp4
├── vid_3.mp4
└── vid_4.mkv
```

The original file extension is preserved.

If `vid_1.mp4` already exists, the downloader will automatically use the next available number instead of replacing it.

## Resume support

Successfully completed URLs are saved in:

```text
completed_urls.txt
```

If you stop the downloader and run it again, completed links will be skipped automatically.

Failed links are stored in:

```text
failed_urls.txt
```

The file includes the URL, error information, and timestamp.

## Cloudflare

If Cloudflare verification appears, the downloader won't try to fight it.

Chrome will stay open so you can complete the verification yourself.

Once the normal TeraBox page is available again, the downloader continues with the current URL.

## Retries

Each URL can be retried automatically.

The default is:

```ini
MAX_RETRIES=3
```

You can change this in `.env`.

A failed URL won't stop the rest of the queue.

## Project structure

```text
TeraboxDownloader/
│
├── downloads/             # Downloaded files
├── scripts/
│   └── start_chrome.js    # Starts Chrome with debugging enabled
│
├── start_chrome.bat       # Windows launcher
├── urls.txt               # TeraBox URLs
├── completed_urls.txt     # Successfully completed URLs
├── failed_urls.txt        # Failed URLs
├── downloader.js          # Main downloader
├── .env.example           # Configuration template
├── package.json
└── tests/
    └── suite.js           # Test suite
```

## Tests

Run the test suite with:

```bash
npm test
```

Or:

```bash
node tests/suite.js
```

## Notes

- Chrome must be started with remote debugging enabled.
- Don't open the same Chrome profile normally while the downloader is using it.
- Keep Chrome open while the downloader is running.
- If a download gets stuck, check the Chrome window first. Some TeraBox links may require manual interaction.

## License

MIT
