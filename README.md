# ck-auto-like-instagram

A Manifest V3 Chrome extension that **likes posts from followers of target Instagram profiles** you specify, with **human-like behavior simulation** to minimize detection risk.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder
4. Open (or reload) `https://www.instagram.com/` — a small **ck-auto-like-instagram** panel appears in the top-right corner

## How It Works

1. You provide a list of **target profiles** (one username per line)
2. For each target, the extension:
   - Opens their `/followers/` modal
   - Collects up to `maxFollowersPerProfile` followers
   - For each follower: opens their profile → likes up to `maxLikesPerFollower` recent posts
3. **Never likes the same post twice** — shared `likedCodes` memory persists across browser restarts
4. **Optional comments** with random emojis at configurable probability

## Personality Presets (Recommended)

Choose a preset that matches your risk tolerance:

| Preset | Speed | Volume | Reading | Comments | Best For |
|--------|-------|--------|---------|----------|----------|
| **Careful Observer** | Slow (25-60s between followers) | Low (8 followers, 2 likes) | Reads 90%, watches 80% | 15% | **Main accounts** — safest |
| **Casual Browser** | Natural (15-35s) | Medium (12 followers, 3 likes) | Reads 60%, watches 50% | 35% | **Secondary accounts** — balanced |
| **Efficient Scroller** | Fast (8-18s) | High (20 followers, 4 likes) | Skims 70% | 20% | **Burner accounts only** — higher risk |

> **Start with "Careful Observer"**. Only move to "Casual" after weeks with no action blocks. Never use "Efficient" on an account you value.

## Human-Like Delay Engine

The extension **does not use uniform random delays**. Instead:

- **Log-normal distribution** — clusters around a "comfortable" median with long tails (like real human reaction times)
- **Mixture model** — 70% "in flow" (fast), 30% "distracted" (slow) — mimics attention shifts
- **Reading simulation** — pauses to read captions (~3 chars/sec) and watch videos before liking
- **Micro-pauses** — 200-2000ms hesitation before each action
- **Post-action satisfaction pause** — 300-3000ms after like/comment
- **Session fatigue** — each action adds ~2% delay, capping at 2x (humans slow down when tired)
- **Session breaks** — configurable long breaks (1-5 min) every N actions

## Configuration

All settings in the popup panel:

### Target Profiles
- One username per line, `@` optional
- Example: `natgeo`, `nasa`, `natgeotravel`

### Limits
- **Max followers/profile** — how many followers to process per target
- **Max likes/follower** — how many recent posts to like per follower

### Human-Like Delays (medians in seconds)
| Setting | What it controls |
|---------|------------------|
| Between followers (fast) | Median delay when "in flow" |
| Between followers (slow) | Median delay when "distracted" |
| Between likes (fast) | Median delay between likes in flow |
| Between likes (slow) | Median delay between likes distracted |
| Between profiles (fast) | Median delay between target profiles |
| Between profiles (slow) | Median delay between profiles distracted |

> **Actual delays vary naturally** — the engine samples from log-normal distributions around these medians.

### Session Breaks (Fatigue Simulation)
- **Break every N actions** — long pause after this many likes+comments
- **Break duration min/max** — random duration in range

### Content Interaction
- **Watch videos (%)** — probability of watching Reels before liking
- **Read captions (%)** — probability of reading caption before liking

### Comments (Optional)
- **Enable comments** — toggle
- **Emojis** — space-separated list (default: 20 emojis)
- **Comment probability (%)** — chance to comment after each like
- **Before comment min/max (s)** — extra delay before typing comment

## Safety Features

- **Action Block detection** — stops immediately if "Action Blocked", "Try Again Later", "Challenge Required" detected
- **Single-tab enforcement** — only one tab runs at a time
- **Shared liked-photo memory** — `likedCodes` in `chrome.storage.local` survives restarts
- **Keyboard/type simulation** — comments typed character-by-character with human timing
- **Modal handling** — properly closes post modals, doesn't scroll behind them

## Local Test Harness

Test without Instagram:

```bash
node tests/serve.js 8123
# open http://127.0.0.1:8123/
```

Click **Start** / **Stop** / **Reset** buttons on the page. Select a personality to see delay differences.

## Heads-Up

> ⚠️ **Automating likes/comments violates Instagram's Terms of Use** and can get accounts rate-limited, action-blocked, or permanently banned.
>
> **Follow these rules to minimize risk:**
> 1. Use **"Careful Observer"** preset for any account you care about
> 2. **Secondary/burner accounts only** for "Casual" or "Efficient"
> 3. **Max 50-100 actions/day** per account (likes + comments)
> 4. **Run during human hours** (8am-11pm local), not 24/7
> 5. **Watch for warnings** — "Action Blocked" = stop immediately, wait 24-48h
> 6. **Don't combine** with other automation tools
> 7. **Real engagement matters** — manually like/comment/post sometimes
>
> **Use at your own risk.** The author is not responsible for banned accounts.

## Files

```
├── manifest.json          (v3.0.0)
├── content.js             (human-like delay engine + followers logic)
├── popup.html             (settings UI)
├── popup.js               (popup controller)
├── popup.css              (styles)
├── README.md              (this file)
└── tests/
    ├── harness.html       (off-site test page)
    └── serve.js           (local static server)
```

## Version History

- **v3.0** — Human-like delay engine, personality presets, session fatigue, reading simulation, micro-pauses
- **v2.0** — Followers mode, multi-target, comments with emojis, shared liked-photo memory
- **v1.0** — Original feed mode only