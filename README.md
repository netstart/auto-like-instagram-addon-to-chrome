# Auto-Like for Instagram

A Manifest V3 Chrome extension with **two modes**:

1. **Feed Mode** — likes posts in your home feed (original behavior)
2. **Followers Mode** — goes to target profiles → their followers → likes N recent posts per follower

Both modes share the same **liked-photo memory** so a post is never liked twice, even across modes.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder
4. Open (or reload) `https://www.instagram.com/` — a small **Auto-Like** panel appears in the top-right corner

## Use

### Feed Mode (original)
- Press **Start Feed** in the on-page panel or toolbar popup
- **Min/Max delay** — random wait between likes (default 3–8 s)
- **Max likes** — stops automatically at this number (default 20)
- **Auto-scroll feed** — scrolls down when no unliked post is visible
- **Reset All** clears the counter and the remembered post list

### Followers Mode (new)
1. Switch to **Followers** tab in the popup
2. Enter **target profiles** (one per line, `@` optional) — e.g.:
   ```
   natgeo
   nasa
   natgeotravel
   ```
3. Configure:
   - **Max followers/profile** — how many followers to process per target (default 20)
   - **Max likes/follower** — how many recent posts to like per follower (default 3)
   - **Delay followers min/max** — wait between each follower (default 10–20 s)
   - **Delay likes min/max** — wait between each like (default 5–10 s)
   - **Delay profiles min/max** — wait before moving to next target profile (default 30–60 s)
4. Press **Start Followers**

The extension will:
1. Go to each target's `/followers/` page
2. Collect up to `maxFollowersPerProfile` followers
3. For each follower: open their profile → like up to `maxLikesPerFollower` recent posts (that haven't been liked before)
4. Move to next follower → next target profile

**Only one mode runs at a time.** Stop one before starting the other.

## How it works

- Finds the post Like button (`svg[aria-label="Like"]`, ≥18 px — avoids tiny comment-like icons)
- Identifies a post by its shortcode (`/p/…`, `/reel/…`, `/tv/…`)
- **Shared `likedCodes` storage** — a post liked in Feed mode will not be re-liked in Followers mode, and vice versa, even after browser restart
- Pauses while you type in a comment box
- Won't scroll while a post modal is open (Feed mode)
- Only one tab runs at a time; starting in a second tab hands off the run
- Settings live in `chrome.storage.local`, shared by panel and popup
- Detects "Action Blocked" / "Try Again Later" and stops automatically for safety

## Limitations

- Feed mode: works on home feed, post pages and post modals. Reels, Stories, Explore grid not targeted.
- Followers mode: depends on Instagram's follower modal and profile page markup. If selectors change, collection may stop.
- Both modes: depend on `aria-label="Like"`. If Instagram changes this, `pickLikeButton` needs updating.
- **Not a growth bot** — personal convenience tool only.

## Local test harness

`tests/harness.html` is a fake feed (three posts, a comment-like icon) plus a minimal `chrome.storage` shim, so the click loop can be exercised without touching Instagram:

```
node tests/serve.js
# open http://127.0.0.1:8123/tests/harness.html
```

The page sets `window.__igalTestMode`, the only seam in `content.js` that lets the host check pass off-site. Nothing else differs from the real run.

## Heads-up

> ⚠️ **Automating likes may go against Instagram's Terms of Use** and can get an account rate-limited, action-blocked, or permanently restricted.
>
> **Followers mode is especially risky** — it performs many automated actions in sequence (navigate → scroll → click → like → close).
>
> **Recommended safe defaults:**
> - Feed mode: delay 10–20 s, max 20–30 likes/session
> - Followers mode: max 10 followers/profile, max 2 likes/follower, delays ≥30 s between followers, ≥60 s between profiles
> - Use a **secondary/burner account**
> - Run during human hours, not 24/7
> - Watch for "Action Blocked" warnings — stop immediately if they appear
>
> Use at your own risk.