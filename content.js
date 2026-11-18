/* Auto-Like for Instagram - content script
 * Two modes:
 *  1. Feed mode (original): likes posts in your home feed
 *  2. Followers mode (new): goes to target profiles → their followers → likes N recent posts per follower
 * Both share the same likedCodes storage to never like the same post twice.
 */
(() => {
  "use strict";
  if (window.__igalLoaded) return;
  window.__igalLoaded = true;

  const KEY = "igAutoLike";
  const TAB_ID = "tab_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const MAX_TRACKED_POSTS = 2000;
  const MAX_SCROLLS_FEED = 40;
  const MAX_SCROLLS_FOLLOWERS = 200;
  const MIN_BUTTON_PX = 18;

  // Test seam: tests/harness.html sets window.__igalTestMode to exercise the loop off-site.
  const isInstagramHost = () =>
    /^https?:\/\/(www\.)?instagram\.com\//.test(location.href) || window.__igalTestMode === true;

  const DEFAULTS = {
    // Feed mode
    feedEnabled: false,
    feedMinDelay: 3000,
    feedMaxDelay: 8000,
    feedMaxLikes: 20,
    feedAutoScroll: true,

    // Followers mode
    followersEnabled: false,
    targets: [],                    // ["profile1", "profile2", ...]
    maxFollowersPerProfile: 20,
    maxLikesPerFollower: 3,
    delayBetweenFollowersMin: 10000,
    delayBetweenFollowersMax: 20000,
    delayBetweenLikesMin: 5000,
    delayBetweenLikesMax: 10000,
    delayBetweenProfilesMin: 30000,
    delayBetweenProfilesMax: 60000,

    // Shared
    likeCount: 0,
    likedCodes: [],
    owner: "",
  };

  let state = { ...DEFAULTS };
  let timer = null;
  let running = false;
  let scrolls = 0;
  let clicked = new Set();
  let statusText = "Idle";

  // Followers-mode runtime state
  let followersState = {
    phase: "idle",              // idle, navigating, collectingFollowers, processingFollower, openingProfile, collectingPosts, likingPost, waiting
    targetIndex: 0,
    followerIndex: 0,
    followersList: [],          // [{username, href}]
    postsList: [],              // [{href, code}]
    postIndex: 0,
    likesDoneForFollower: 0,
    originalUrl: "",
    abortRequested: false,
  };

  /* ---------------------------------------------------------------- state */

  const clamp = (v, lo, hi, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  };

  function normalize(raw) {
    const s = { ...DEFAULTS, ...(raw || {}) };
    s.feedMinDelay = Math.round(clamp(s.feedMinDelay, 300, 600000, DEFAULTS.feedMinDelay));
    s.feedMaxDelay = Math.round(clamp(s.feedMaxDelay, s.feedMinDelay, 900000, Math.max(s.feedMinDelay, DEFAULTS.feedMaxDelay)));
    s.feedMaxLikes = Math.round(clamp(s.feedMaxLikes, 1, 500, DEFAULTS.feedMaxLikes));
    s.feedAutoScroll = Boolean(s.feedAutoScroll);

    s.maxFollowersPerProfile = Math.round(clamp(s.maxFollowersPerProfile, 1, 500, DEFAULTS.maxFollowersPerProfile));
    s.maxLikesPerFollower = Math.round(clamp(s.maxLikesPerFollower, 1, 50, DEFAULTS.maxLikesPerFollower));
    s.delayBetweenFollowersMin = Math.round(clamp(s.delayBetweenFollowersMin, 1000, 3600000, DEFAULTS.delayBetweenFollowersMin));
    s.delayBetweenFollowersMax = Math.round(clamp(s.delayBetweenFollowersMax, s.delayBetweenFollowersMin, 3600000, DEFAULTS.delayBetweenFollowersMax));
    s.delayBetweenLikesMin = Math.round(clamp(s.delayBetweenLikesMin, 1000, 3600000, DEFAULTS.delayBetweenLikesMin));
    s.delayBetweenLikesMax = Math.round(clamp(s.delayBetweenLikesMax, s.delayBetweenLikesMin, 3600000, DEFAULTS.delayBetweenLikesMax));
    s.delayBetweenProfilesMin = Math.round(clamp(s.delayBetweenProfilesMin, 1000, 3600000, DEFAULTS.delayBetweenProfilesMin));
    s.delayBetweenProfilesMax = Math.round(clamp(s.delayBetweenProfilesMax, s.delayBetweenProfilesMin, 3600000, DEFAULTS.delayBetweenProfilesMax));

    s.likeCount = Math.round(clamp(s.likeCount, 0, 100000, 0));
    s.owner = typeof s.owner === "string" ? s.owner : "";
    s.targets = Array.isArray(s.targets) ? s.targets.filter(t => typeof t === "string" && t.trim()).map(t => t.trim().replace(/^@/, "")) : [];
    s.likedCodes = Array.isArray(s.likedCodes)
      ? s.likedCodes.filter(c => typeof c === "string").slice(-MAX_TRACKED_POSTS)
      : [];
    return s;
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.local.set({ [KEY]: normalize(state) });
    }, 60);
  }

  function load() {
    chrome.storage.local.get(KEY, (res) => {
      const beforeFeed = state.feedEnabled;
      const beforeFollowers = state.followersEnabled;
      state = normalize(res[KEY]);
      clicked = new Set(state.likedCodes);

      if (state.feedEnabled && (!state.owner || state.owner === TAB_ID)) {
        claimAndStartFeed();
      } else if (state.feedEnabled && beforeFeed !== state.feedEnabled) {
        setStatus("Feed mode running in another tab");
      }

      if (state.followersEnabled && (!state.owner || state.owner === TAB_ID)) {
        claimAndStartFollowers();
      } else if (state.followersEnabled && beforeFollowers !== state.followersEnabled) {
        setStatus("Followers mode running in another tab");
      }

      paint();
    });
  }

  /* ---------------------------------------------------------------- utils */

  const randInt = (lo, hi) => Math.round(lo + Math.random() * Math.max(0, hi - lo));

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(step, Math.max(50, ms));
  }

  function setStatus(text) {
    statusText = text;
    if (el.status) el.status.textContent = text;
    console.log("[AutoLike]", text);
  }

  function postCode(el) {
    const scope = el.closest("article");
    if (!scope) return null;
    const link = scope.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]');
    if (!link) return null;
    const match = (link.getAttribute("href") || "").match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
    return match ? match[1] + ":" + match[2] : null;
  }

  function postCodeFromHref(href) {
    const match = (href || "").match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
    return match ? match[1] + ":" + match[2] : null;
  }

  function isClickableLike(svg) {
    const label = (svg.getAttribute("aria-label") || "").toLowerCase();
    if (label !== "like") return false;
    const rect = svg.getBoundingClientRect();
    if (rect.width < MIN_BUTTON_PX || rect.height < MIN_BUTTON_PX) return false;
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
    if (rect.right <= 0 || rect.left >= window.innerWidth) return false;
    if (svg.dataset.igalDone) return false;
    return Boolean(svg.closest("article") || svg.closest('[role="dialog"]'));
  }

  function pickLikeButton() {
    const icons = document.querySelectorAll('svg[aria-label="Like" i]');
    for (const svg of icons) {
      if (!isClickableLike(svg)) continue;
      const code = postCode(svg);
      if (code && clicked.has(code)) continue;
      return svg;
    }
    return null;
  }

  function doLike(svg) {
    const button = svg.closest("button") || svg.closest('[role="button"]') || svg;
    try {
      button.click();
    } catch {
      svg.dataset.igalDone = "1";
      return false;
    }
    svg.dataset.igalDone = "1";

    const code = postCode(svg);
    if (code) {
      clicked.add(code);
      state.likedCodes.push(code);
      if (state.likedCodes.length > MAX_TRACKED_POSTS) {
        state.likedCodes = state.likedCodes.slice(-MAX_TRACKED_POSTS);
      }
    }
    state.likeCount += 1;
    save();
    return true;
  }

  function scrollFeed() {
    if (document.querySelector('div[role="dialog"]')) return;
    window.scrollBy({ top: Math.round(window.innerHeight * 0.8), left: 0, behavior: "smooth" });
  }

  function scrollFollowersModal() {
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return false;
    const scrollable = dialog.querySelector('div[style*="overflow"], ul, div[class*="scroll"]') || dialog;
    scrollable.scrollBy({ top: scrollable.clientHeight * 0.9, left: 0, behavior: "smooth" });
    return true;
  }

  function detectActionBlock() {
    const text = document.body.innerText || "";
    return /Action Blocked|Try Again Later|Challenge Required|Too Many Requests|Please wait/i.test(text);
  }

  /* ----------------------------------------------------------- Feed mode */

  function claimAndStartFeed() {
    if (state.owner && state.owner !== TAB_ID) {
      setStatus("Running in another tab");
      return;
    }
    state.owner = TAB_ID;
    state.feedEnabled = true;
    save();
    running = true;
    scrolls = 0;
    setStatus("Feed: Running...");
    paint();
    schedule(700);
  }

  function stopFeed(message) {
    state.feedEnabled = false;
    if (state.owner === TAB_ID) state.owner = "";
    save();
    setStatus(message || "Feed: Stopped");
    paint();
  }

  function stepFeed() {
    if (!state.feedEnabled) return;
    if (!isInstagramHost()) return stopFeed("Feed: Not on instagram.com");
    if (state.likeCount >= state.feedMaxLikes) return stopFeed("Feed: Finished - " + state.likeCount + " likes");

    const active = document.activeElement;
    if (active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable)) {
      setStatus("Feed: Waiting while you type");
      return schedule(1500);
    }

    const button = pickLikeButton();
    if (!button) {
      if (state.feedAutoScroll && scrolls < MAX_SCROLLS_FEED) {
        scrolls += 1;
        scrollFeed();
        setStatus("Feed: Scrolling for posts...");
      } else {
        setStatus("Feed: No unliked posts in view");
      }
      return schedule(randInt(1200, 2600));
    }

    doLike(button);
    setStatus("Feed: Liked " + state.likeCount + " of " + state.feedMaxLikes);
    paint();
    schedule(randInt(state.feedMinDelay, state.feedMaxDelay));
  }

  /* ------------------------------------------------------- Followers mode */

  function claimAndStartFollowers() {
    if (state.owner && state.owner !== TAB_ID) {
      setStatus("Running in another tab");
      return;
    }
    if (!state.targets.length) {
      setStatus("Followers: No target profiles set");
      state.followersEnabled = false;
      save();
      paint();
      return;
    }
    state.owner = TAB_ID;
    state.followersEnabled = true;
    save();
    running = true;
    followersState = {
      phase: "navigating",
      targetIndex: 0,
      followerIndex: 0,
      followersList: [],
      postsList: [],
      postIndex: 0,
      likesDoneForFollower: 0,
      originalUrl: location.href,
      abortRequested: false,
    };
    setStatus("Followers: Starting...");
    paint();
    schedule(500);
  }

  function stopFollowers(message) {
    state.followersEnabled = false;
    followersState.abortRequested = true;
    if (state.owner === TAB_ID) state.owner = "";
    save();
    setStatus(message || "Followers: Stopped");
    paint();
  }

  async function navigateTo(url) {
    return new Promise(resolve => {
      const handler = () => {
        window.removeEventListener("load", handler);
        setTimeout(resolve, 1000);
      };
      window.addEventListener("load", handler);
      location.href = url;
    });
  }

  function stepFollowers() {
    if (!state.followersEnabled) return;
    if (followersState.abortRequested) return stopFollowers("Followers: Aborted");

    if (!isInstagramHost()) {
      return stopFollowers("Followers: Not on instagram.com");
    }

    if (detectActionBlock()) {
      return stopFollowers("Followers: Action Blocked detected - stopping for safety");
    }

    const { phase, targetIndex, followerIndex, followersList, postsList, postIndex, likesDoneForFollower } = followersState;
    const targets = state.targets;
    const currentTarget = targets[targetIndex];

    switch (phase) {
      case "navigating": {
        setStatus(`Followers: Opening @${currentTarget}/followers/`);
        navigateTo(`https://www.instagram.com/${currentTarget}/followers/`);
        followersState.phase = "collectingFollowers";
        followersState.followersList = [];
        followersState.followerIndex = 0;
        scrolls = 0;
        schedule(3000);
        break;
      }

      case "collectingFollowers": {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) {
          setStatus("Followers: Followers modal not found");
          return schedule(2000);
        }
        const links = dialog.querySelectorAll('a[href^="/"]');
        const newFollowers = [];
        links.forEach(a => {
          const href = a.getAttribute("href");
          const match = href.match(/^\/([^\/]+)\/?$/);
          if (match && !match[1].includes(".") && match[1] !== currentTarget) {
            newFollowers.push({ username: match[1], href });
          }
        });
        // Deduplicate
        const seen = new Set(followersList.map(f => f.username));
        newFollowers.forEach(f => { if (!seen.has(f.username)) { followersList.push(f); seen.add(f.username); } });

        if (followersList.length >= state.maxFollowersPerProfile || scrolls >= MAX_SCROLLS_FOLLOWERS) {
          setStatus(`Followers: Collected ${followersList.length} followers for @${currentTarget}`);
          followersState.phase = "processingFollower";
          followersState.followerIndex = 0;
          schedule(1000);
        } else {
          scrolls++;
          scrollFollowersModal();
          setStatus(`Followers: Scrolling followers (${followersList.length}/${state.maxFollowersPerProfile})...`);
          schedule(randInt(1500, 3000));
        }
        break;
      }

      case "processingFollower": {
        if (followerIndex >= followersList.length) {
          // Done with this target, move to next
          if (targetIndex + 1 < targets.length) {
            followersState.targetIndex++;
            followersState.phase = "navigating";
            setStatus(`Followers: Moving to next target @${targets[targetIndex + 1]}`);
            schedule(randInt(state.delayBetweenProfilesMin, state.delayBetweenProfilesMax));
          } else {
            setStatus(`Followers: All targets done. Total likes: ${state.likeCount}`);
            stopFollowers("Followers: Finished all targets");
          }
          break;
        }

        const follower = followersList[followerIndex];
        setStatus(`Followers: [@${currentTarget}] Opening follower @${follower.username} (${followerIndex + 1}/${followersList.length})`);
        followersState.originalUrl = location.href;
        navigateTo(`https://www.instagram.com/${follower.username}/`);
        followersState.phase = "openingProfile";
        schedule(3000);
        break;
      }

      case "openingProfile": {
        // Wait for profile page to load, then collect posts
        const articles = document.querySelectorAll('main article, div[role="feed"] article');
        if (articles.length === 0) {
          setStatus("Followers: Profile not loaded yet");
          return schedule(2000);
        }
        followersState.postsList = [];
        followersState.postIndex = 0;
        followersState.likesDoneForFollower = 0;
        followersState.phase = "collectingPosts";
        schedule(500);
        break;
      }

      case "collectingPosts": {
        const articles = document.querySelectorAll('main article a[href*="/p/"], main article a[href*="/reel/"]');
        const newPosts = [];
        articles.forEach(a => {
          const href = a.getAttribute("href");
          const code = postCodeFromHref(href);
          if (code && !clicked.has(code)) {
            newPosts.push({ href, code });
          }
        });
        // Deduplicate
        const seen = new Set(followersState.postsList.map(p => p.code));
        newPosts.forEach(p => { if (!seen.has(p.code)) { followersState.postsList.push(p); seen.add(p.code); } });

        if (followersState.postsList.length >= state.maxLikesPerFollower) {
          setStatus(`Followers: Found ${followersState.postsList.length} posts for @${followersList[followerIndex].username}`);
          followersState.phase = "likingPost";
          followersState.postIndex = 0;
          schedule(500);
        } else {
          // Scroll for more posts
          window.scrollBy({ top: window.innerHeight, left: 0, behavior: "smooth" });
          setStatus(`Followers: Scrolling for posts (${followersState.postsList.length}/${state.maxLikesPerFollower})...`);
          schedule(randInt(1500, 3000));
        }
        break;
      }

      case "likingPost": {
        if (followersState.postIndex >= followersState.postsList.length ||
            followersState.likesDoneForFollower >= state.maxLikesPerFollower) {
          // Done with this follower
          followersState.followerIndex++;
          followersState.phase = "processingFollower";
          setStatus(`Followers: Done with @${followersList[followerIndex - 1].username}, moving to next follower`);
          schedule(randInt(state.delayBetweenFollowersMin, state.delayBetweenFollowersMax));
          break;
        }

        const post = followersState.postsList[followersState.postIndex];
        setStatus(`Followers: Liking post ${post.code} (${followersState.postIndex + 1}/${followersState.postsList.length})`);
        navigateTo(`https://www.instagram.com${post.href}`);
        followersState.phase = "waitingForPostModal";
        schedule(2000);
        break;
      }

      case "waitingForPostModal": {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) {
          setStatus("Followers: Post modal not opened");
          followersState.postIndex++;
          followersState.phase = "likingPost";
          schedule(1000);
          break;
        }
        // Find like button in modal
        const likeBtn = dialog.querySelector('svg[aria-label="Like" i]');
        if (likeBtn && isClickableLike(likeBtn)) {
          const code = postCode(likeBtn);
          if (code && !clicked.has(code)) {
            doLike(likeBtn);
            followersState.likesDoneForFollower++;
            setStatus(`Followers: Liked ${state.likeCount} total (${followersState.likesDoneForFollower}/${state.maxLikesPerFollower} for this follower)`);
            paint();
          }
        } else {
          setStatus("Followers: Like button not found or already liked");
        }
        // Close modal
        const closeBtn = dialog.querySelector('svg[aria-label="Close" i], button[aria-label="Close"]');
        if (closeBtn) closeBtn.click();
        else history.back(); // fallback
        followersState.postIndex++;
        followersState.phase = "likingPost";
        schedule(randInt(state.delayBetweenLikesMin, state.delayBetweenLikesMax));
        break;
      }

      default:
        setStatus("Followers: Unknown phase, stopping");
        stopFollowers("Followers: Error");
    }
  }

  /* --------------------------------------------------------------- Main step */

  function step() {
    timer = null;
    if (!running) return;

    // Run feed mode if enabled
    if (state.feedEnabled) {
      stepFeed();
    }

    // Run followers mode if enabled
    if (state.followersEnabled) {
      stepFollowers();
    }

    // If neither mode is running, stop
    if (!state.feedEnabled && !state.followersEnabled) {
      running = false;
      clearTimeout(timer);
      timer = null;
      paint();
    }
  }

  /* ---------------------------------------------------------------- UI */

  const CSS = `
    :host { all: initial; }
    .card {
      width: 300px; background: #15171b; color: #e9edf3;
      border: 1px solid rgba(255,255,255,.09); border-radius: 14px;
      box-shadow: 0 14px 34px rgba(0,0,0,.38);
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      overflow: hidden; user-select: none;
    }
    .head {
      display: flex; align-items: center; gap: 8px; width: 100%;
      padding: 11px 12px; background: none; border: 0; color: inherit;
      font: inherit; cursor: grab; text-align: left; touch-action: none;
    }
    .head:active { cursor: grabbing; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #5b6472; flex: none; transition: background .15s; }
    .dot.on { background: #35d07f; box-shadow: 0 0 0 3px rgba(53,208,127,.18); }
    .name { font-weight: 600; letter-spacing: .01em; }
    .count { margin-left: auto; color: #9aa4b2; font-size: 12px; font-variant-numeric: tabular-nums; }
    .chev { color: #6b7480; font-size: 10px; }
    .body { display: grid; gap: 9px; padding: 0 12px 12px; }
    .body[hidden] { display: none; }
    .section { border-top: 1px solid rgba(255,255,255,.06); padding-top: 8px; margin-top: 4px; }
    .section:first-child { border-top: none; margin-top: 0; padding-top: 0; }
    .section-title { font-weight: 600; color: #c2cad6; font-size: 12px; margin-bottom: 6px; }
    .status { color: #9aa4b2; font-size: 12px; min-height: 17px; }
    .primary {
      padding: 9px 12px; border: 0; border-radius: 9px; font: inherit;
      font-weight: 600; color: #fff; background: #3b82f6; cursor: pointer;
    }
    .primary:hover { filter: brightness(1.08); }
    .primary.stop { background: #e5484d; }
    .primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #c2cad6; }
    .row span.value { display: inline-flex; align-items: center; gap: 4px; color: #8e98a6; }
    input[type="number"] {
      width: 56px; padding: 5px 6px; border-radius: 7px; text-align: right;
      border: 1px solid rgba(255,255,255,.13); background: #1d2026; color: #e9edf3;
      font: inherit; font-variant-numeric: tabular-nums;
    }
    input[type="number"]:focus { outline: 1px solid #3b82f6; }
    input[type="text"], textarea {
      width: 100%; padding: 6px 8px; border-radius: 7px;
      border: 1px solid rgba(255,255,255,.13); background: #1d2026; color: #e9edf3;
      font: inherit; font-size: 12px; resize: vertical;
    }
    input[type="text"]:focus, textarea:focus { outline: 1px solid #3b82f6; }
    input[type="checkbox"] { width: 15px; height: 15px; accent-color: #3b82f6; cursor: pointer; }
    .foot { display: flex; justify-content: space-between; align-items: center; color: #6f7885; font-size: 11px; }
    .link {
      background: none; border: 0; padding: 0; color: #7f8b9c;
      font: inherit; font-size: 11px; cursor: pointer; text-decoration: underline;
    }
    .link:hover { color: #b7c1cd; }
    .mode-toggle { display: flex; gap: 8px; margin-bottom: 4px; }
    .mode-btn { flex: 1; padding: 6px; border: 1px solid rgba(255,255,255,.13); border-radius: 7px; background: #1d2026; color: #c2cad6; font: inherit; cursor: pointer; }
    .mode-btn.active { background: #3b82f6; color: #fff; border-color: #3b82f6; }
  `;

  const root = document.createElement("div");
  root.id = "igal-host";
  root.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;";
  const shadow = root.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>${CSS}</style>
    <div class="card">
      <button class="head" id="head" type="button">
        <span class="dot" id="dot"></span>
        <span class="name">Auto-Like</span>
        <span class="count" id="count">0/20</span>
        <span class="chev" id="chev">&#9662;</span>
      </button>
      <div class="body" id="body">
        <div class="status" id="status">Idle</div>

        <div class="mode-toggle">
          <button class="mode-btn" id="modeFeed" type="button">Feed Mode</button>
          <button class="mode-btn" id="modeFollowers" type="button">Followers Mode</button>
        </div>

        <!-- Feed Mode Section -->
        <div class="section" id="feedSection">
          <div class="section-title">Feed Mode</div>
          <button class="primary" id="feedToggle" type="button">Start Feed</button>
          <div class="row">
            <label for="feedMin">Min delay</label>
            <span class="value"><input id="feedMin" type="number" min="0.5" max="120" step="0.5"> s</span>
          </div>
          <div class="row">
            <label for="feedMax">Max delay</label>
            <span class="value"><input id="feedMax" type="number" min="0.5" max="120" step="0.5"> s</span>
          </div>
          <div class="row">
            <label for="feedLimit">Max likes</label>
            <span class="value"><input id="feedLimit" type="number" min="1" max="500" step="1"></span>
          </div>
          <div class="row">
            <label for="feedScroll">Auto-scroll feed</label>
            <input id="feedScroll" type="checkbox">
          </div>
        </div>

        <!-- Followers Mode Section -->
        <div class="section" id="followersSection">
          <div class="section-title">Followers Mode</div>
          <div class="row" style="flex-direction:column;align-items:flex-start;gap:4px;">
            <label for="targets">Target profiles (one per line, @ optional)</label>
            <textarea id="targets" rows="3" placeholder="profile1&#10;profile2&#10;profile3"></textarea>
          </div>
          <div class="row">
            <label for="maxFollowers">Max followers/profile</label>
            <span class="value"><input id="maxFollowers" type="number" min="1" max="500" step="1"></span>
          </div>
          <div class="row">
            <label for="maxLikesPerFollower">Max likes/follower</label>
            <span class="value"><input id="maxLikesPerFollower" type="number" min="1" max="50" step="1"></span>
          </div>
          <div class="row">
            <label for="delayFollowersMin">Delay followers min (s)</label>
            <span class="value"><input id="delayFollowersMin" type="number" min="1" max="600" step="1"></span>
          </div>
          <div class="row">
            <label for="delayFollowersMax">Delay followers max (s)</label>
            <span class="value"><input id="delayFollowersMax" type="number" min="1" max="600" step="1"></span>
          </div>
          <div class="row">
            <label for="delayLikesMin">Delay likes min (s)</label>
            <span class="value"><input id="delayLikesMin" type="number" min="1" max="600" step="1"></span>
          </div>
          <div class="row">
            <label for="delayLikesMax">Delay likes max (s)</label>
            <span class="value"><input id="delayLikesMax" type="number" min="1" max="600" step="1"></span>
          </div>
          <div class="row">
            <label for="delayProfilesMin">Delay profiles min (s)</label>
            <span class="value"><input id="delayProfilesMin" type="number" min="1" max="600" step="1"></span>
          </div>
          <div class="row">
            <label for="delayProfilesMax">Delay profiles max (s)</label>
            <span class="value"><input id="delayProfilesMax" type="number" min="1" max="600" step="1"></span>
          </div>
          <button class="primary" id="followersToggle" type="button">Start Followers</button>
        </div>

        <div class="foot">
          <span id="hint">Shared liked-photo memory across modes</span>
          <button class="link" id="reset" type="button">Reset All</button>
        </div>
      </div>
    </div>
  `;

  const el = {};
  const ids = ["head","body","chev","dot","count","status",
    "modeFeed","modeFollowers",
    "feedSection","followersSection",
    "feedToggle","feedMin","feedMax","feedLimit","feedScroll",
    "targets","maxFollowers","maxLikesPerFollower",
    "delayFollowersMin","delayFollowersMax","delayLikesMin","delayLikesMax",
    "delayProfilesMin","delayProfilesMax","followersToggle",
    "reset","hint"];
  ids.forEach(id => { el[id] = shadow.getElementById(id); });

  let collapsed = false;
  let activeMode = "feed"; // "feed" | "followers"

  function paint() {
    const feedRunning = state.feedEnabled && running;
    const followersRunning = state.followersEnabled && running;
    const anyRunning = feedRunning || followersRunning;

    el.count.textContent = state.likeCount + "/" + (state.feedEnabled ? state.feedMaxLikes : (state.followersEnabled ? "∞" : state.feedMaxLikes));
    el.dot.classList.toggle("on", anyRunning);

    // Mode buttons
    el.modeFeed.classList.toggle("active", activeMode === "feed");
    el.modeFollowers.classList.toggle("active", activeMode === "followers");
    el.feedSection.hidden = activeMode !== "feed";
    el.followersSection.hidden = activeMode !== "followers";

    // Feed controls
    el.feedToggle.textContent = feedRunning ? "Stop Feed" : "Start Feed";
    el.feedToggle.classList.toggle("stop", feedRunning);
    el.feedToggle.disabled = followersRunning;
    if (shadow.activeElement !== el.feedMin) el.feedMin.value = (state.feedMinDelay / 1000).toFixed(1);
    if (shadow.activeElement !== el.feedMax) el.feedMax.value = (state.feedMaxDelay / 1000).toFixed(1);
    if (shadow.activeElement !== el.feedLimit) el.feedLimit.value = String(state.feedMaxLikes);
    el.feedScroll.checked = state.feedAutoScroll;

    // Followers controls
    el.followersToggle.textContent = followersRunning ? "Stop Followers" : "Start Followers";
    el.followersToggle.classList.toggle("stop", followersRunning);
    el.followersToggle.disabled = feedRunning;
    el.targets.value = state.targets.join("\n");
    if (shadow.activeElement !== el.maxFollowers) el.maxFollowers.value = String(state.maxFollowersPerProfile);
    if (shadow.activeElement !== el.maxLikesPerFollower) el.maxLikesPerFollower.value = String(state.maxLikesPerFollower);
    if (shadow.activeElement !== el.delayFollowersMin) el.delayFollowersMin.value = String(state.delayBetweenFollowersMin / 1000);
    if (shadow.activeElement !== el.delayFollowersMax) el.delayFollowersMax.value = String(state.delayBetweenFollowersMax / 1000);
    if (shadow.activeElement !== el.delayLikesMin) el.delayLikesMin.value = String(state.delayBetweenLikesMin / 1000);
    if (shadow.activeElement !== el.delayLikesMax) el.delayLikesMax.value = String(state.delayBetweenLikesMax / 1000);
    if (shadow.activeElement !== el.delayProfilesMin) el.delayProfilesMin.value = String(state.delayBetweenProfilesMin / 1000);
    if (shadow.activeElement !== el.delayProfilesMax) el.delayProfilesMax.value = String(state.delayBetweenProfilesMax / 1000);

    el.status.textContent = statusText;
  }

  function commit(patch) {
    Object.assign(state, patch);
    state = normalize(state);
    paint();
    save();
  }

  // Drag
  let drag = null, dragged = false;
  el.head.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    const rect = root.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
    dragged = false;
    try { el.head.setPointerCapture(e.pointerId); } catch {}
  });
  el.head.addEventListener("pointermove", e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!dragged && Math.abs(dx) + Math.abs(dy) < 5) return;
    dragged = true;
    const w = root.offsetWidth, h = root.offsetHeight;
    root.style.left = Math.min(Math.max(0, drag.left + dx), Math.max(0, window.innerWidth - w)) + "px";
    root.style.top = Math.min(Math.max(0, drag.top + dy), Math.max(0, window.innerHeight - h)) + "px";
    root.style.right = "auto";
  });
  const endDrag = e => {
    if (!drag) return;
    drag = null;
    try { el.head.releasePointerCapture(e.pointerId); } catch {}
  };
  el.head.addEventListener("pointerup", endDrag);
  el.head.addEventListener("pointercancel", endDrag);

  el.head.addEventListener("click", () => {
    if (dragged) { dragged = false; return; }
    collapsed = !collapsed;
    el.body.hidden = collapsed;
    el.chev.innerHTML = collapsed ? "&#9656;" : "&#9662;";
  });

  // Mode switching
  el.modeFeed.addEventListener("click", () => { activeMode = "feed"; paint(); });
  el.modeFollowers.addEventListener("click", () => { activeMode = "followers"; paint(); });

  // Feed events
  el.feedToggle.addEventListener("click", () => {
    if (state.feedEnabled) { stopFeed("Feed: Stopped"); return; }
    if (state.followersEnabled) { setStatus("Stop Followers mode first"); return; }
    if (!isInstagramHost()) { setStatus("Open instagram.com first"); return; }
    if (state.likeCount >= state.feedMaxLikes) { setStatus("Feed: Limit reached - raise max or reset"); return; }
    claimAndStartFeed();
  });
  el.feedMin.addEventListener("change", () => {
    const sec = clamp(el.feedMin.value, 0.5, 120, state.feedMinDelay / 1000);
    commit({ feedMinDelay: Math.round(sec * 1000) });
  });
  el.feedMax.addEventListener("change", () => {
    const sec = clamp(el.feedMax.value, 0.5, 120, state.feedMaxDelay / 1000);
    commit({ feedMaxDelay: Math.round(sec * 1000) });
  });
  el.feedLimit.addEventListener("change", () => {
    commit({ feedMaxLikes: Math.round(clamp(el.feedLimit.value, 1, 500, state.feedMaxLikes)) });
  });
  el.feedScroll.addEventListener("change", () => commit({ feedAutoScroll: el.feedScroll.checked }));

  // Followers events
  el.followersToggle.addEventListener("click", () => {
    if (state.followersEnabled) { stopFollowers("Followers: Stopped"); return; }
    if (state.feedEnabled) { setStatus("Stop Feed mode first"); return; }
    if (!isInstagramHost()) { setStatus("Open instagram.com first"); return; }
    if (!el.targets.value.trim()) { setStatus("Followers: Add at least one target profile"); return; }
    const targets = el.targets.value.split("\n").map(t => t.trim().replace(/^@/, "")).filter(Boolean);
    commit({ targets, followersEnabled: true });
    claimAndStartFollowers();
  });
  el.targets.addEventListener("change", () => {
    const targets = el.targets.value.split("\n").map(t => t.trim().replace(/^@/, "")).filter(Boolean);
    commit({ targets });
  });
  el.maxFollowers.addEventListener("change", () => commit({ maxFollowersPerProfile: Math.round(clamp(el.maxFollowers.value, 1, 500, state.maxFollowersPerProfile)) }));
  el.maxLikesPerFollower.addEventListener("change", () => commit({ maxLikesPerFollower: Math.round(clamp(el.maxLikesPerFollower.value, 1, 50, state.maxLikesPerFollower)) }));
  el.delayFollowersMin.addEventListener("change", () => commit({ delayBetweenFollowersMin: Math.round(clamp(el.delayFollowersMin.value, 1, 3600, state.delayBetweenFollowersMin / 1000)) * 1000 }));
  el.delayFollowersMax.addEventListener("change", () => commit({ delayBetweenFollowersMax: Math.round(clamp(el.delayFollowersMax.value, 1, 3600, state.delayBetweenFollowersMax / 1000)) * 1000 }));
  el.delayLikesMin.addEventListener("change", () => commit({ delayBetweenLikesMin: Math.round(clamp(el.delayLikesMin.value, 1, 3600, state.delayBetweenLikesMin / 1000)) * 1000 }));
  el.delayLikesMax.addEventListener("change", () => commit({ delayBetweenLikesMax: Math.round(clamp(el.delayLikesMax.value, 1, 3600, state.delayBetweenLikesMax / 1000)) * 1000 }));
  el.delayProfilesMin.addEventListener("change", () => commit({ delayBetweenProfilesMin: Math.round(clamp(el.delayProfilesMin.value, 1, 3600, state.delayBetweenProfilesMin / 1000)) * 1000 }));
  el.delayProfilesMax.addEventListener("change", () => commit({ delayBetweenProfilesMax: Math.round(clamp(el.delayProfilesMax.value, 1, 3600, state.delayBetweenProfilesMax / 1000)) * 1000 }));

  el.reset.addEventListener("click", () => {
    clicked = new Set();
    commit({ likeCount: 0, likedCodes: [], feedEnabled: false, followersEnabled: false });
    setStatus("All counters reset");
  });

  function mount() {
    if (!document.body) return;
    if (document.getElementById("igal-host")) return;
    document.body.appendChild(root);
    paint();
  }

  /* -------------------------------------------------------------- bootstrap */

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[KEY]) return;

    state = normalize(changes[KEY].newValue);
    clicked = new Set(state.likedCodes);

    if (state.feedEnabled && (!state.owner || state.owner === TAB_ID)) {
      if (!state.feedEnabled) claimAndStartFeed(); // actually this checks old value
    } else if (state.feedEnabled) {
      // Disabled from popup or another tab took over
      if (running && state.feedEnabled) { /* keep running */ }
    }

    if (state.followersEnabled && (!state.owner || state.owner === TAB_ID)) {
      if (!state.followersEnabled) claimAndStartFollowers();
    } else if (state.followersEnabled) {
      // Disabled from popup or another tab took over
    }

    paint();
  });

  window.addEventListener("pagehide", () => {
    if (running && state.owner === TAB_ID) {
      state.feedEnabled = false;
      state.followersEnabled = false;
      state.owner = "";
      chrome.storage.local.set({ [KEY]: normalize(state) });
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message && message.type === "igal-ping") reply({ ok: true });
  });

  mount();
  load();
})();