# Auto-Like for Instagram

A small Manifest V3 Chrome extension that likes posts in your Instagram feed for you — one post at a time, spaced by a random delay, capped at a limit you choose.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. Open (or reload) `https://www.instagram.com/` — a small **Auto-Like** panel appears in the top-right corner.

## Use

- Press **Start** in the on-page panel (or in the toolbar popup). Press **Stop** to stop.
- **Min/Max delay** — the random wait between likes, in seconds. Default 3–8 s.
- **Max likes** — the extension stops on its own once it hits this number. Default 20.
- **Auto-scroll feed** — scrolls down when no unliked post is visible, so it can keep going. Off means it only works on posts you bring into view.
- **Reset** clears the counter and the remembered post list.

The counter is a running total; it is not reset when you restart, so raise the limit or hit Reset to keep going.

## How it works

- The content script looks for the post like button (`svg[aria-label="Like"]`, at least 18 px — that size check keeps it away from the tiny comment like icons).
- A post is identified by its shortcode (`/p/…`, `/reel/…`), so the same post is never liked twice in a session.
- It pauses while you are typing in a comment box, and it will not scroll the page while a post modal is open.
- Only one tab runs at a time. Starting in a second tab hands the run to that tab.
- Settings live in `chrome.storage.local`, shared by the panel and the popup.

## Limitations

- Works on the home feed, post pages and post modals. Reels, Stories and the Explore grid are not targeted.
- It depends on Instagram's markup (`aria-label="Like"`). If that changes, the selector in `content.js` (`pickLikeButton`) needs updating.
- The extension is a personal convenience tool, not a growth bot.

## Local test harness

`tests/harness.html` is a fake feed (three posts, an offscreen post and a small comment-like icon) plus a minimal `chrome.storage` shim, so the click loop can be exercised without touching Instagram:

```
node tests/serve.js
# open http://127.0.0.1:8123/tests/harness.html
```

The page sets `window.__igalTestMode`, the only seam in `content.js` that lets the host check pass off-site. Nothing else differs from the real run.


## Heads-up

Automating likes may go against Instagram's terms of use and can get an account rate-limited or restricted. Keep limits low, keep delays long, and use it at your own risk.
