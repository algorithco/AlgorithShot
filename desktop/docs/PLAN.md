# Algorithco Shot — improved plan

## Context
You asked for more than a screenshot tool: an app that is **better than what's on the market** and **makes everyday work easier**. I looked at the main competitors and rebuilt the plan around the gaps they leave.
- Everything goes in `D:\repos\algorithco\algorithco-shot`, which is still empty. No other repos are touched.
- Your PC already has all the build tools.

## What the market is missing
| App | What it does well | What it's missing |
|---|---|---|
| **Windows Snipping Tool** (free) | Simple, built in, copies text, records the screen | No scrolling capture, no magnifier or exact sizes, no library or search, no pinning. Its AI "Perfect screenshot" needs a new Copilot+ PC. |
| **ShareX** (free) | Very powerful, scrolling capture, offline text recognition | Very complicated to use. History search uses file, app and window names, not the text inside screenshots. |
| **Snagit** (paid, about $39 a year) | Step guides, scrolling capture, auto-hiding of private data | Paid subscription, a big heavy app, no Uzbek. |
| **CleanShot X** (the best-loved one) | Best design and ease of use | **Mac only**: there is no Windows version. |

Windows' old **Steps Recorder**, which recorded what you clicked step by step, is also being phased out. The replacements Microsoft suggests record video and don't make step-by-step guides.

## Our advantage in one sentence
**Capture exactly what you need, find it again in seconds, and share it safely. It's free, fast, private, and in Uzbek, Russian and English.**

## 6 ideas that make us different
1. **Screenshot memory.** The app reads the text in every screenshot, on your PC. It also remembers which app, window and website each screenshot came from. Type "invoice", "error" or "+998" and the right screenshot comes up. Nothing leaves your PC.
2. **Privacy shield.** Before you copy or share, the app looks for private things and offers to hide them in one click: emails, phone numbers (+998 and others), card numbers (Uzcard, Humo, Visa, Mastercard), passport and ID numbers, API keys and tokens, and faces. It works on any picture too. For example, paste a photo of a document and hide its numbers before you forward it.
3. **Perfect screenshot on every PC.** Point at any part of any app (a button, a chat message, a table, a dialog) and the box fits it exactly. You also get a magnifier, a ruler, a colour picker and exact sizes. You don't need a Copilot+ PC.
4. **Guide maker** *(release 2)*. Press Record, do the task, press Stop. Each click becomes a numbered step with a screenshot, a highlight and a sentence like "Click **Save**". You can export the guide to PDF, Word or a web page, or send it in Telegram. It's good for teaching colleagues and students, or showing parents and grandparents how to do something.
5. **One hotkey for everything.** One key freezes the screen and shows a small toolbar: Region, Window, Full screen, Copy text, Scan QR, Colour, Pin. Power users can still give each tool its own hotkey.
6. **Made for here.** The app is in Uzbek, Russian and English. You can share to Telegram in one click, and the privacy shield knows Uzbek phone, card and passport formats.

## Who it helps
- **Students** capture lecture slides, find them later by a word in them, and turn 20 screenshots into one PDF.
- **Office workers** hide private data, send screenshots to Telegram quickly, and find last week's receipt.
- **Support staff, teachers and family helpers** make a step-by-step guide in a minute.
- **Sellers and creators** get clean product shots at exact Instagram or Telegram sizes, with their watermark.
- **Developers and designers** get element capture, a pixel ruler, a colour picker and exact sizes.

## Release 1 (what I build now)

### Capture
- Press the hotkey or click the tray icon. The screen freezes, so menus and tooltips get captured too, and the toolbar appears.
- Modes: region, window, full screen (one monitor or all of them), fixed size (e.g. 1280×720), timer (3, 5 or 10 s), and repeat last area.
- **Smart element capture**: the box snaps to buttons, panels, messages and windows.
- **Exact size**:
  - a magnifier that shows the pixel position and colour
  - the live size, e.g. `1280 × 720`
  - arrow keys move an edge by 1 px (10 px with Shift)
  - Shift keeps the ratio
  - you can type the size
- **Screen tools** from the same toolbar: copy text, scan QR codes and barcodes, colour picker, ruler, and pin to screen.

### Quick card after each capture
- A small card appears in the corner with Copy · Save · Edit · Pin · Telegram/Share · Copy text · Delete.
- You can drag the card straight into a chat or a folder.
- The Telegram button copies the screenshot and opens Telegram, so you just pick a chat and paste.
- If the privacy shield finds something private, it warns you right on the card.

### Editor
- **Delete parts of the image**:
  - **crop** to an exact size and ratio
  - **erase**, which makes that part transparent
  - **remove & fill**, which fills the area from the background around it. This works very well on app and website screenshots, offline.
  - **cut out a strip** and join the parts that are left
  - **hide** with blur, pixelate or a solid box
- **Marks**: arrow, box, text, highlighter, numbered steps.
- **Perfect size**:
  - presets such as 1920×1080, 1280×720, 1080×1080 and 1200×630, or any size you type
  - fit to a size without stretching
  - "keep the file under X KB"
- Undo and redo. The original is always kept, so you can go back to it.
- The editor opens any picture too: paste one or drag it in.

### Library
- A grid of all your screenshots, newest first, with **search** by the text inside, the app, the website and the date.
- **Delete** one or more screenshots. They go to the Recycle Bin, and Shift+Delete removes them for good after asking first.
- Rename, star as a favourite, open, show in the folder, or copy as a file.
- **Clean-up helper**: finds duplicates and very old or very large screenshots, so you can delete them in one go. Optionally, it can clean up screenshots older than 30 days automatically, unless you starred them.
- Files are named by app and time (e.g. `Telegram 2026-10-23 14-05.png`) and saved in `Pictures\Algorithco Shot`.

### Quality
- The app captures real screen pixels, so Windows scaling doesn't blur anything.
- It saves PNG by default (no quality loss, shrunk automatically), and JPEG and WebP too.
- It's small and light: the installer should be about 10–15 MB. The goal is for the capture to open in under 0.3 s.
- Fully offline: no account, no cloud, no tracking.

## Release 2 (after you try release 1)
- Guide maker
- Scrolling capture of long pages and chats
- Beautify: background, padding, shadow, device frames
- Watermark, and export profiles ("Telegram", "Instagram 1080×1350", "Docs")
- Screenshots → PDF
- **Send to phone with a QR code over Wi-Fi**: no cloud, and the link works only once and expires after 2 minutes

## Release 3 (later)
- Screen recording and GIF
- Optional AI, off by default: translate or explain the text in a screenshot, better removal on photos, sharper upscaling
- Auto-update and code signing
- macOS

## How it's built
- **Tauri 2** (a Rust core with Windows' built-in WebView2) and a **React + TypeScript + Vite** UI.
- **Rust** handles:
  - capture through Windows APIs, at real pixels
  - image work: `image`, `oxipng` and `fast_image_resize`, plus remove & fill with the `inpaint` crate or a small version of my own
  - the library: SQLite with full-text search, thumbnails, and the Recycle Bin through `trash`
- **Windows' built-in offline engines**:
  - **Text recognition**: your PC has English and Russian. Uzbek isn't one of Windows' languages for this, but the English and Russian engines should read most Uzbek text (I'll test that), and search ignores the oʻ / o' difference.
  - **Face detection** for the privacy shield.
  - **UI Automation** for element capture. If an app doesn't share its layout, the box snaps to the window edges instead.
- QR codes and barcodes use `rxing`, duplicates are found with image fingerprints (`image_hasher`), and dragging out of the app uses `tauri-plugin-drag`.
- The capture overlay waits ready in the background and gets the frozen image uncompressed, so it opens instantly.
- The UI follows the Windows 11 look, with light and dark themes. Dialogs with typed input close only with Cancel, as you asked for the web app.

Main folders:
```
algorithco-shot/
  src-tauri/src/capture/   screen, window and element capture
  src-tauri/src/imaging/   crop, resize, fill, cut strip, encode, optimize
  src-tauri/src/smart/     text recognition, privacy detection, QR, faces, duplicates
  src-tauri/src/library/   SQLite index + search, thumbnails, Recycle Bin
  src/overlay/  src/card/  src/editor/  src/library/  src/settings/
  src/i18n/                en, uz, ru
  docs/PLAN.md             this plan
```

## Build steps (release 1)
| # | Step | What you can try after it |
|---|---|---|
| 1 | Setup: project, git repo (inside algorithco-shot only), tray, hotkey, settings, 3 languages | The app starts |
| 2 | Capture: freeze, toolbar, all modes, magnifier, nudging, typed size, snapping | Every capture mode |
| 3 | Quick card + library: copy / save / pin / delete, drag out, grid, Recycle Bin, rename, favourites | Everyday use |
| 4 | Editor: delete tools, marks, perfect size, export | Editing |
| 5 | Smart features: copy text, search, QR, element capture, privacy shield, clean-up helper | The standout features |
| 6 | Sharing and polish: Telegram and Windows share, Uzbek and Russian texts, speed check, installer | Installing it like a normal app |

After each step I commit locally as hamroqulovv, signed with `id_ed25519`. I won't push unless you ask.

## How I'll check it
- **Automated tests**: exact sizes, crop, cut strip, resize, fill, the saved file matching the screen pixel for pixel, the privacy patterns (made-up test numbers only), and search.
- **Real runs on your PC**: I'll take test screenshots to check sharpness, speed and text recognition. They stay on your PC.
- **What I can't test here**: your PC has one 1920×1080 screen at 100%, so multiple monitors, 125–200% scaling and HDR need a try on other screens. Element capture depends on each app, so I'll test it in Explorer, Edge or Chrome, Telegram and VS Code, and tell you which ones work.

## Good to know
- **Print Screen**: on your PC Snipping Tool has this key right now. The app shows a button that opens the Windows setting; I won't change it myself. A backup hotkey and the tray icon always work.
- **Your C: drive has 4.1 GB free.** The project and build files stay on D:, but Rust's download cache on C: will grow a little.
- **There's no code-signing certificate yet**, so Windows SmartScreen will show a warning when someone installs the app.
- **Uzbek texts**: I'll write them, but please check them, since you know the language best.

## Decisions for later (not needed to start)
- Should it be free for everyone, or free with a paid Pro version (e.g. the guide maker and AI in Pro)?
- The name stays **Algorithco Shot** for now.

## Sources
- [Snagit Smart Redact](https://www.techsmith.com/snagit/features/smart-redact/) · [Snagit pricing](https://www.screensnap.pro/blog/snagit-pricing)
- [Snipping Tool has no scrolling capture (TechSmith, 2026)](https://www.techsmith.com/blog/scrolling-screenshot/) · [Microsoft's Snipping Tool guide](https://www.microsoft.com/windows/learning-center/how-to-use-snipping-tool-on-windows-screenshots-shortcuts-and-screen-recordings) · [Perfect screenshot needs a Copilot+ PC (ASUS)](https://www.asus.com/support/faq/1056025/)
- [ShareX history search uses app and window names (13.6 notes)](https://www.neowin.net/amp/sharex-1360/) · [ShareX offline OCR](https://www.ghacks.net/?p=179516) · [ShareX's own roundup](https://getsharex.com/blog/best-screenshot-tools-windows/)
- [Steps Recorder being removed (gHacks)](https://www.ghacks.net/2024/01/08/microsoft-is-removing-a-tool-from-windows-11-that-you-may-have-never-used/) · [Winaero](https://winaero.com/windows-11-deprecates-the-steps-recorder-and-tips-inbox-apps)
- [CleanShot X is Mac only (review)](https://www.tenorshare.com/image-translator/cleanshot-x-review.html)
