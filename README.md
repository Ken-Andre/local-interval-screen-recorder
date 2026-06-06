# Local Interval Screen Recorder

A small browser app for local screen recording in controlled chunks.

It is designed for people who want proof, revision material, or a lightweight
recording trail without filling the disk with one huge video file.

## What it does

- Takes periodic JPEG screenshots.
- Records WebM video segments.
- Can chain video segments continuously with minimal gaps.
- Lets Chrome write directly to a local folder when the user grants permission.
- Applies retention limits by file count and total session size.
- Keeps a local note draft for review points and strategy.
- Includes 20 training questions for aptitude-style practice sessions.

Everything runs in the browser. The app does not upload recordings, call an API,
or send telemetry.

## Live demo

This project can run on GitHub Pages because it is a static app:

```text
https://ken-andre.github.io/local-interval-screen-recorder/
```

Screen capture works on GitHub Pages because it is served over HTTPS. Direct
folder writing requires a Chromium-based browser that supports the File System
Access API.

## Local launch

From the project directory on Windows:

```powershell
.\start-app.ps1
```

Then open:

```text
http://localhost:8123
```

You can also use any static HTTP server. Opening `index.html` directly from the
filesystem is not recommended because browser capture APIs need a secure context
such as `localhost` or HTTPS.

## Modes

### Images

Captures one JPEG every configured interval. Image width and JPEG quality are
configurable to control file size.

### Video segments

Records WebM files of a fixed duration.

When `Enchainer les segments sans trou` is enabled, the next segment starts as
soon as the previous one is saved. This is the best mode for keeping a complete
session trail while preventing a single oversized recording file.

When that option is disabled, the app records one clip, waits for the interval,
then records the next clip.

## Retention

Two limits are applied during the session:

- maximum number of files;
- maximum total size in MB.

The oldest files are removed first. Automatic deletion is strongest when a local
folder has been selected, because the app can remove old files from that folder.
Without a selected folder, generated files remain available as in-page downloads
for the current browser session.

## Privacy and safety

- Choose exactly what Chrome should share: a tab, a window, or the whole screen.
- Prefer a specific window instead of the whole screen to avoid accidental leaks.
- Do not record password managers, banking pages, identity documents, private
  messages, or other sensitive material.
- Respect the terms of the service or test platform you are using. This tool is
  for personal evidence, revision, demos, and transparent challenge recordings;
  it is not a way to bypass platform rules.

## Browser support

Recommended:

- Google Chrome or another Chromium-based browser.
- HTTPS or `localhost`.

Main APIs used:

- `navigator.mediaDevices.getDisplayMedia`
- `MediaRecorder`
- File System Access API, when available
- `IndexedDB`, only to remember the chosen folder handle
- `localStorage`, only for user settings and draft notes

## Development

No build step is required.

Syntax check:

```powershell
node --check app.js
```

Local server:

```powershell
.\start-app.ps1
```

## GitHub Pages setup

For a static branch deployment:

1. Push the repository to GitHub.
2. Enable Pages from the `main` branch and `/` root.
3. Keep `.nojekyll` in the repository root.

The app is intentionally static so it can be hosted without a backend.
