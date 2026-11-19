/* ck-auto-like-instagram - content script
 * Followers mode only: goes to target profiles → their followers → likes N recent posts per follower
 * Optional: comments with random emojis on liked posts
 * Uses likedCodes storage to never like the same post twice.
 * Human-like delay engine with fatigue, burst/break patterns, and reading simulation.
 */
(() => {
  "use strict";
  if (window.__igalLoaded) return;
  window.__igalLoaded = true;

  const KEY = "igAutoLike";
  const TAB_ID = "tab_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const MAX_TRACKED_POSTS = 2000;
  const MAX_SCROLLS_FOLLOWERS = 200;
  const MIN_BUTTON_PX = 18;

  // Test seam: tests/harness.html sets window.__igalTestMode to exercise the loop off-site.
  const isInstagramHost = () =>
    /^https?:\/\/(www\.)?instagram\.com\//.test(location.href) || window.__igalTestMode === true;

  const DEFAULT_EMOJIS = [
    "❤️", "🔥", "😍", "👏", "🙌", "😎", "💯", "✨", "🌟", "💪",
    "🎉", "🥰", "😊", "👍", "💖", "🌈", "☀️", "🌸", "🦄", "🍀"
  ];

  // ============================================================
  // HUMAN-LIKE DELAY ENGINE
  // ============================================================

  /**
   * Generates human-like delays using log-normal distribution
   * Humans don't use uniform random - they cluster around a "comfortable" time
   * with long tails for distractions, reading, hesitation
   */
  function humanDelay(medianMs, spread = 0.5, minMs = 500, maxMs = 300000) {
    // Log-normal: ln(X) ~ Normal(ln(median), spread)
    // This creates right-skewed distribution like real human reaction times
    const u = Math.random();
    const v = Math.random();
    // Box-Muller transform for normal distribution
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    const lnMedian = Math.log(medianMs);
    const delay = Math.exp(lnMedian + spread * z);
    return Math.round(Math.min(maxMs, Math.max(minMs, delay)));
  }

  /**
   * Mixture model: sometimes humans are "in flow" (fast), sometimes "distracted" (slow)
   */
  function mixedHumanDelay(fastMedian, slowMedian, fastProb = 0.7, spread = 0.4) {
    return Math.random() < fastProb
      ? humanDelay(fastMedian, spread)
      : humanDelay(slowMedian, spread * 1.5);
  }

  /**
   * Reading time simulation based on content type
   */
  function readingTime(hasVideo = false, captionLength = 0) {
    // Base reading: 1.5-4s for photo, 3-8s for video (watch time)
    const base = hasVideo ? humanDelay(5000, 0.4, 2000, 15000) : humanDelay(2500, 0.5, 1000, 8000);
    // Caption reading: ~200 chars/min = ~3 chars/sec
    const captionTime = Math.min(captionLength * 300, 10000); // cap at 10s
    return base + captionTime;
  }

  /**
   * Session fatigue: humans slow down over time
   */
  function applyFatigue(baseDelay, actionsInSession, fatigueFactor = 0.02) {
    // Each action adds ~2% delay, caps at 2x
    const fatigue = Math.min(1 + actionsInSession * fatigueFactor, 2.0);
    return Math.round(baseDelay * fatigue);
  }

  /**
   * Micro-pause: brief hesitation before action (0.3-1.5s)
   */
  function microPause() {
    return humanDelay(600, 0.6, 200, 2000);
  }

  /**
   * Post-action pause: after like/comment, brief satisfaction pause (0.5-2s)
   */
  function postActionPause() {
    return humanDelay(1000, 0.5, 300, 3000);
  }

  // ============================================================
  // PRESET PERSONALITIES
  // ============================================================

  const PERSONALITIES = {
    careful: {
      name: "Careful Observer",
      description: "Slow, reads captions, watches videos, low probability actions",
      // Delays (median ms)
      betweenFollowers: { fast: 25000, slow: 60000 },      // 25-60s
      betweenLikes: { fast: 12000, slow: 30000 },          // 12-30s
      betweenProfiles: { fast: 90000, slow: 180000 },      // 1.5-3min
      // Behavior
      commentProbability: 15,
      maxFollowersPerProfile: 8,
      maxLikesPerFollower: 2,
      watchVideoProbability: 0.8,
      readCaptionProbability: 0.9,
      sessionBreakEvery: 15,      // actions before long break
      sessionBreakDuration: { min: 120000, max: 300000 }, // 2-5 min
    },
    casual: {
      name: "Casual Browser",
      description: "Natural pace, sometimes reads, sometimes skims, moderate activity",
      betweenFollowers: { fast: 15000, slow: 35000 },      // 15-35s
      betweenLikes: { fast: 8000, slow: 20000 },           // 8-20s
      betweenProfiles: { fast: 60000, slow: 120000 },      // 1-2min
      commentProbability: 35,
      maxFollowersPerProfile: 12,
      maxLikesPerFollower: 3,
      watchVideoProbability: 0.5,
      readCaptionProbability: 0.6,
      sessionBreakEvery: 25,
      sessionBreakDuration: { min: 60000, max: 180000 },  // 1-3 min
    },
    efficient: {
      name: "Efficient Scroller",
      description: "Faster pace, skims content, higher volume, still human-like",
      betweenFollowers: { fast: 8000, slow: 18000 },       // 8-18s
      betweenLikes: { fast: 4000, slow: 10000 },           // 4-10s
      betweenProfiles: { fast: 30000, slow: 60000 },       // 30-60s
      commentProbability: 20,
      maxFollowersPerProfile: 20,
      maxLikesPerFollower: 4,
      watchVideoProbability: 0.3,
      readCaptionProbability: 0.3,
      sessionBreakEvery: 40,
      sessionBreakDuration: { min: 30000, max: 90000 },   // 30-90s
    },
    // Default = casual
  };

  // ============================================================
  // DEFAULTS - Using "casual" personality as base
  // ============================================================

  const DEFAULT_PERSONALITY = "careful";
  const P = PERSONALITIES[DEFAULT_PERSONALITY];

  const DEFAULTS = {
    // Personality
    personality: DEFAULT_PERSONALITY,

    // Followers mode limits (from personality)
    maxFollowersPerProfile: P.maxFollowersPerProfile,
    maxLikesPerFollower: P.maxLikesPerFollower,

    // Delay configuration (ms) - medians for humanDelay
    delayBetweenFollowersFast: P.betweenFollowers.fast,
    delayBetweenFollowersSlow: P.betweenFollowers.slow,
    delayBetweenLikesFast: P.betweenLikes.fast,
    delayBetweenLikesSlow: P.betweenLikes.slow,
    delayBetweenProfilesFast: P.betweenProfiles.fast,
    delayBetweenProfilesSlow: P.betweenProfiles.slow,

    // Session breaks
    sessionBreakEvery: P.sessionBreakEvery,
    sessionBreakMin: P.sessionBreakDuration.min,
    sessionBreakMax: P.sessionBreakDuration.max,

    // Content interaction
    watchVideoProbability: P.watchVideoProbability,
    readCaptionProbability: P.readCaptionProbability,

    // Comments
    commentsEnabled: false,
    commentEmojis: DEFAULT_EMOJIS.join(" "),
    commentProbability: P.commentProbability,
    commentDelayMin: 2000,
    commentDelayMax: 5000,

    // Shared
    enabled: false,
    targets: [],
    likeCount: 0,
    commentCount: 0,
    likedCodes: [],
    owner: "",
    // Runtime
    actionsInSession: 0,
    lastSessionBreak: 0,
  };

  let state = { ...DEFAULTS };
  let timer = null;
  let running = false;
  let clicked = new Set();
  let statusText = "Idle";

  // Followers-mode runtime state
  let followersState = {
    phase: "idle",
    targetIndex: 0,
    followerIndex: 0,
    followersList: [],
    postsList: [],
    postIndex: 0,
    likesDoneForFollower: 0,
    originalUrl: "",
    abortRequested: false,
    currentPostCode: null,
    shouldComment: false,
    currentPostHasVideo: false,
    currentCaptionLength: 0,
  };

  /* ---------------------------------------------------------------- state */

  const clamp = (v, lo, hi, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  };

  function normalize(raw) {
    const userProvided = raw || {};
    const s = { ...DEFAULTS, ...userProvided };
    // Personality update
    if (PERSONALITIES[s.personality]) {
      const P = PERSONALITIES[s.personality];
      // Only use personality default if user didn't provide a value
      const userProvidedMaxFollowers = "maxFollowersPerProfile" in userProvided;
      const userProvidedMaxLikes = "maxLikesPerFollower" in userProvided;
      s.maxFollowersPerProfile = userProvidedMaxFollowers
        ? Math.round(clamp(s.maxFollowersPerProfile, 1, 500, P.maxFollowersPerProfile))
        : P.maxFollowersPerProfile;
      s.maxLikesPerFollower = userProvidedMaxLikes
        ? Math.round(clamp(s.maxLikesPerFollower, 1, 50, P.maxLikesPerFollower))
        : P.maxLikesPerFollower;
    } else {
      s.maxFollowersPerProfile = Math.round(clamp(s.maxFollowersPerProfile, 1, 500, DEFAULTS.maxFollowersPerProfile));
      s.maxLikesPerFollower = Math.round(clamp(s.maxLikesPerFollower, 1, 50, DEFAULTS.maxLikesPerFollower));
    }

    // Delays (medians for humanDelay)
    s.delayBetweenFollowersFast = Math.round(clamp(s.delayBetweenFollowersFast, 3000, 120000, DEFAULTS.delayBetweenFollowersFast));
    s.delayBetweenFollowersSlow = Math.round(clamp(s.delayBetweenFollowersSlow, s.delayBetweenFollowersFast, 300000, DEFAULTS.delayBetweenFollowersSlow));
    s.delayBetweenLikesFast = Math.round(clamp(s.delayBetweenLikesFast, 2000, 60000, DEFAULTS.delayBetweenLikesFast));
    s.delayBetweenLikesSlow = Math.round(clamp(s.delayBetweenLikesSlow, s.delayBetweenLikesFast, 120000, DEFAULTS.delayBetweenLikesSlow));
    s.delayBetweenProfilesFast = Math.round(clamp(s.delayBetweenProfilesFast, 10000, 300000, DEFAULTS.delayBetweenProfilesFast));
    s.delayBetweenProfilesSlow = Math.round(clamp(s.delayBetweenProfilesSlow, s.delayBetweenProfilesFast, 600000, DEFAULTS.delayBetweenProfilesSlow));

    // Session breaks
    s.sessionBreakEvery = Math.round(clamp(s.sessionBreakEvery, 5, 100, DEFAULTS.sessionBreakEvery));
    s.sessionBreakMin = Math.round(clamp(s.sessionBreakMin, 10000, 600000, DEFAULTS.sessionBreakMin));
    s.sessionBreakMax = Math.round(clamp(s.sessionBreakMax, s.sessionBreakMin, 1200000, DEFAULTS.sessionBreakMax));

    // Content interaction
    s.watchVideoProbability = clamp(s.watchVideoProbability, 0, 1, DEFAULTS.watchVideoProbability);
    s.readCaptionProbability = clamp(s.readCaptionProbability, 0, 1, DEFAULTS.readCaptionProbability);

    // Comments
    s.commentsEnabled = Boolean(s.commentsEnabled);
    s.commentProbability = Math.round(clamp(s.commentProbability, 0, 100, DEFAULTS.commentProbability));
    s.commentDelayMin = Math.round(clamp(s.commentDelayMin, 500, 60000, DEFAULTS.commentDelayMin));
    s.commentDelayMax = Math.round(clamp(s.commentDelayMax, s.commentDelayMin, 60000, DEFAULTS.commentDelayMax));
    s.commentEmojis = typeof s.commentEmojis === "string" ? s.commentEmojis : DEFAULT_EMOJIS.join(" ");

    s.enabled = Boolean(s.enabled);
    s.likeCount = Math.round(clamp(s.likeCount, 0, 100000, 0));
    s.commentCount = Math.round(clamp(s.commentCount, 0, 100000, 0));
    s.owner = typeof s.owner === "string" ? s.owner : "";
    s.targets = Array.isArray(s.targets) ? s.targets.filter(t => typeof t === "string" && t.trim()).map(t => t.trim().replace(/^@/, "")) : [];
    s.likedCodes = Array.isArray(s.likedCodes)
      ? s.likedCodes.filter(c => typeof c === "string").slice(-MAX_TRACKED_POSTS)
      : [];
    s.actionsInSession = Math.round(clamp(s.actionsInSession, 0, 10000, 0));
    s.lastSessionBreak = Math.round(clamp(s.lastSessionBreak, 0, Date.now(), 0));
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
      const before = state.enabled;
      state = normalize(res[KEY]);
      clicked = new Set(state.likedCodes);

      if (state.enabled && (!state.owner || state.owner === TAB_ID)) {
        claimAndStart();
      } else if (state.enabled && before !== state.enabled) {
        setStatus("Running in another tab");
      }

      paint();
    });
  }

  /* ---------------------------------------------------------------- Human Delay Helpers */

  const randInt = (lo, hi) => Math.round(lo + Math.random() * Math.max(0, hi - lo));
  const randChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function humanDelay(medianMs, spread = 0.5, minMs = 500, maxMs = 300000) {
    const u = Math.random();
    const v = Math.random();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    const lnMedian = Math.log(medianMs);
    const delay = Math.exp(lnMedian + spread * z);
    return Math.round(Math.min(maxMs, Math.max(minMs, delay)));
  }

  function mixedHumanDelay(fastMedian, slowMedian, fastProb = 0.7, spread = 0.4) {
    return Math.random() < fastProb
      ? humanDelay(fastMedian, spread)
      : humanDelay(slowMedian, spread * 1.5);
  }

  function readingTime(hasVideo, captionLength) {
    const base = hasVideo
      ? humanDelay(5000, 0.4, 2000, 15000)
      : humanDelay(2500, 0.5, 1000, 8000);
    const captionTime = Math.min(captionLength * 300, 10000);
    return base + captionTime;
  }

  function applyFatigue(baseDelay, actionsInSession, fatigueFactor = 0.02) {
    const fatigue = Math.min(1 + actionsInSession * fatigueFactor, 2.0);
    return Math.round(baseDelay * fatigue);
  }

  function microPause() {
    return humanDelay(600, 0.6, 200, 2000);
  }

  function postActionPause() {
    return humanDelay(1000, 0.5, 300, 3000);
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(step, Math.max(50, ms));
  }

  function setStatus(text) {
    statusText = text;
    if (el.status) el.status.textContent = text;
    console.log("[ck-auto-like]", text);
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
    state.actionsInSession += 1;
    save();
    return true;
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

  /* ------------------------------------------------------- Comment logic */

  function getRandomEmoji() {
    const emojis = state.commentEmojis.trim().split(/\s+/).filter(Boolean);
    return emojis.length ? randChoice(emojis) : randChoice(DEFAULT_EMOJIS);
  }

  function shouldCommentNow() {
    if (!state.commentsEnabled) return false;
    return Math.random() * 100 < state.commentProbability;
  }

  async function typeComment(emoji) {
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return false;

    const textarea = dialog.querySelector('textarea[aria-label*="comment" i], textarea[placeholder*="comment" i], textarea[placeholder*="Coment" i]');
    if (!textarea) return false;

    textarea.focus();
    textarea.value = "";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    for (const char of emoji) {
      textarea.value += char;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise(r => setTimeout(r, randInt(100, 300)));
    }

    const buttons = dialog.querySelectorAll('button, div[role="button"]');
    let submitted = false;
    for (const btn of buttons) {
      const txt = (btn.textContent || btn.innerText || "").trim().toLowerCase();
      if (txt === "post" || txt === "publicar") {
        btn.click();
        submitted = true;
        break;
      }
    }

    if (!submitted) {
      const event = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", which: 13, keyCode: 13, bubbles: true });
      textarea.dispatchEvent(event);
    }

    return true;
  }

  /* ----------------------------------------------------------- Followers mode */

  function claimAndStart() {
    if (state.owner && state.owner !== TAB_ID) {
      setStatus("Running in another tab");
      return;
    }
    if (!state.targets.length) {
      setStatus("No target profiles set");
      state.enabled = false;
      save();
      paint();
      return;
    }
    state.owner = TAB_ID;
    state.enabled = true;
    state.actionsInSession = 0;
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
      currentPostCode: null,
      shouldComment: false,
      currentPostHasVideo: false,
      currentCaptionLength: 0,
    };
    setStatus("Starting immediately...");
    paint();
    // IMMEDIATE START - no delay, first action runs now
    step();
  }

  function stop(message) {
    state.enabled = false;
    followersState.abortRequested = true;
    if (state.owner === TAB_ID) state.owner = "";
    save();
    setStatus(message || "Stopped");
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

  function getCurrentPersonality() {
    return PERSONALITIES[state.personality] || PERSONALITIES[DEFAULT_PERSONALITY];
  }

  async function step() {
    timer = null;
    if (!running) return;
    if (!state.enabled) return;

    if (!isInstagramHost()) {
      return stop("Not on instagram.com");
    }

    if (detectActionBlock()) {
      return stop("Action Blocked detected - stopping for safety");
    }

    // Check for session break
    if (state.actionsInSession > 0 && state.actionsInSession % state.sessionBreakEvery === 0
        && state.actionsInSession !== state.lastSessionBreak) {
      const breakDuration = randInt(state.sessionBreakMin, state.sessionBreakMax);
      state.lastSessionBreak = state.actionsInSession;
      save();
      setStatus(`Session break (${Math.round(breakDuration/1000)}s) - mimicking human fatigue`);
      schedule(breakDuration);
      return;
    }

    const { phase, targetIndex, followerIndex, followersList, postsList, postIndex, likesDoneForFollower, currentPostHasVideo, currentCaptionLength } = followersState;
    const targets = state.targets;
    const currentTarget = targets[targetIndex];

    switch (phase) {
      case "navigating": {
        setStatus(`Opening @${currentTarget}/followers/`);
        navigateTo(`https://www.instagram.com/${currentTarget}/followers/`);
        followersState.phase = "collectingFollowers";
        followersState.followersList = [];
        followersState.followerIndex = 0;
        schedule(mixedHumanDelay(3000, 8000, 0.6)); // initial page load
        break;
      }

      case "collectingFollowers": {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) {
          setStatus("Followers modal not found");
          return schedule(mixedHumanDelay(2000, 5000));
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
        const seen = new Set(followersList.map(f => f.username));
        newFollowers.forEach(f => { if (!seen.has(f.username)) { followersList.push(f); seen.add(f.username); } });

        if (followersList.length >= state.maxFollowersPerProfile) {
          setStatus(`Collected ${followersList.length} followers for @${currentTarget}`);
          followersState.phase = "processingFollower";
          followersState.followerIndex = 0;
          schedule(microPause());
        } else {
          scrollFollowersModal();
          setStatus(`Scrolling followers (${followersList.length}/${state.maxFollowersPerProfile})...`);
          schedule(mixedHumanDelay(1500, 4000, 0.7));
        }
        break;
      }

      case "processingFollower": {
        if (followerIndex >= followersList.length) {
          if (targetIndex + 1 < targets.length) {
            followersState.targetIndex++;
            followersState.phase = "navigating";
            setStatus(`Moving to next target @${targets[targetIndex + 1]}`);
            const P = getCurrentPersonality();
            const delay = mixedHumanDelay(P.betweenProfiles.fast, P.betweenProfiles.slow, 0.6);
            schedule(applyFatigue(delay, state.actionsInSession));
          } else {
            setStatus(`All targets done. Likes: ${state.likeCount}, Comments: ${state.commentCount}`);
            stop("Finished all targets");
          }
          break;
        }

        const follower = followersList[followerIndex];
        setStatus(`[@${currentTarget}] Opening follower @${follower.username} (${followerIndex + 1}/${followersList.length})`);
        followersState.originalUrl = location.href;
        navigateTo(`https://www.instagram.com/${follower.username}/`);
        followersState.phase = "openingProfile";
        schedule(mixedHumanDelay(2000, 6000, 0.6));
        break;
      }

      case "openingProfile": {
        const articles = document.querySelectorAll('main article, div[role="feed"] article');
        if (articles.length === 0) {
          setStatus("Profile not loaded yet");
          return schedule(mixedHumanDelay(1500, 4000));
        }
        followersState.postsList = [];
        followersState.postIndex = 0;
        followersState.likesDoneForFollower = 0;
        followersState.phase = "collectingPosts";
        schedule(microPause());
        break;
      }

      case "collectingPosts": {
        const articles = document.querySelectorAll('main article a[href*="/p/"], main article a[href*="/reel/"]');
        const newPosts = [];
        articles.forEach(a => {
          const href = a.getAttribute("href");
          const code = postCodeFromHref(href);
          if (code && !clicked.has(code)) {
            // Check if video (reel)
            const article = a.closest("article");
            const hasVideo = article?.querySelector('video, svg[aria-label*="Reel" i]') !== null;
            newPosts.push({ href, code, hasVideo });
          }
        });
        const seen = new Set(followersState.postsList.map(p => p.code));
        newPosts.forEach(p => { if (!seen.has(p.code)) { followersState.postsList.push(p); seen.add(p.code); } });

        if (followersState.postsList.length >= state.maxLikesPerFollower) {
          setStatus(`Found ${followersState.postsList.length} posts for @${followersList[followerIndex].username}`);
          followersState.phase = "likingPost";
          followersState.postIndex = 0;
          schedule(microPause());
        } else {
          window.scrollBy({ top: window.innerHeight, left: 0, behavior: "smooth" });
          setStatus(`Scrolling for posts (${followersState.postsList.length}/${state.maxLikesPerFollower})...`);
          schedule(mixedHumanDelay(1500, 4000, 0.7));
        }
        break;
      }

      case "likingPost": {
        if (followersState.postIndex >= followersState.postsList.length ||
            followersState.likesDoneForFollower >= state.maxLikesPerFollower) {
          followersState.followerIndex++;
          followersState.phase = "processingFollower";
          setStatus(`Done with @${followersList[followerIndex - 1].username}, moving to next follower`);
          const P = getCurrentPersonality();
          const delay = mixedHumanDelay(P.betweenFollowers.fast, P.betweenFollowers.slow, 0.7);
          schedule(applyFatigue(delay, state.actionsInSession));
          break;
        }

        const post = followersState.postsList[followersState.postIndex];
        followersState.currentPostCode = post.code;
        followersState.currentPostHasVideo = post.hasVideo || post.href.includes("/reel/");
        followersState.currentCaptionLength = 0; // Could extract caption if needed
        followersState.shouldComment = shouldCommentNow();
        setStatus(`Liking post ${post.code} (${followersState.postIndex + 1}/${followersState.postsList.length})`);
        navigateTo(`https://www.instagram.com${post.href}`);
        followersState.phase = "waitingForPostModal";
        schedule(mixedHumanDelay(1500, 4000, 0.6));
        break;
      }

      case "waitingForPostModal": {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) {
          setStatus("Post modal not opened");
          followersState.postIndex++;
          followersState.phase = "likingPost";
          schedule(microPause());
          break;
        }

        // Simulate reading/watching before like
        const P = getCurrentPersonality();
        const shouldRead = Math.random() < P.readCaptionProbability;
        const shouldWatch = followersState.currentPostHasVideo && Math.random() < P.watchVideoProbability;

        if (shouldRead || shouldWatch) {
          const readTime = readingTime(shouldWatch, followersState.currentCaptionLength);
          const fatiguedTime = applyFatigue(readTime, state.actionsInSession);
          setStatus(shouldWatch ? `Watching video...` : `Reading caption...`);
          schedule(fatiguedTime);
          // Stay in this phase, will re-enter and then like
          followersState.phase = "waitingForPostModal";
          // Mark that we've "viewed" it
          followersState.currentCaptionLength = -1; // sentinel: already viewed
          return;
        }

        // Micro-pause before like (hesitation)
        schedule(microPause());
        followersState.phase = "doingLike";
        break;
      }

      case "doingLike": {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) {
          setStatus("Post modal closed unexpectedly");
          followersState.postIndex++;
          followersState.phase = "likingPost";
          schedule(microPause());
          break;
        }

        const likeBtn = dialog.querySelector('svg[aria-label="Like" i]');
        if (likeBtn && isClickableLike(likeBtn)) {
          const code = postCode(likeBtn);
          if (code && !clicked.has(code)) {
            doLike(likeBtn);
            followersState.likesDoneForFollower++;
            setStatus(`Liked ${state.likeCount} total (${followersState.likesDoneForFollower}/${state.maxLikesPerFollower} for this follower)`);
            paint();
          }
        } else {
          setStatus("Like button not found or already liked");
        }

        // Post-action pause (satisfaction)
        schedule(postActionPause());
        followersState.phase = "afterLike";
        break;
      }

      case "afterLike": {
        // Decide whether to comment
        if (followersState.shouldComment && state.commentsEnabled) {
          followersState.phase = "commenting";
          setStatus("Preparing to comment...");
          const delay = mixedHumanDelay(state.commentDelayMin, state.commentDelayMax, 0.6);
          schedule(applyFatigue(delay, state.actionsInSession));
        } else {
          // Close modal and move on
          const dialog = document.querySelector('div[role="dialog"]');
          const closeBtn = dialog?.querySelector('svg[aria-label="Close" i], button[aria-label="Close"]');
          if (closeBtn) closeBtn.click();
          else history.back();
          followersState.postIndex++;
          followersState.phase = "likingPost";
          const P = getCurrentPersonality();
          const delay = mixedHumanDelay(P.betweenLikes.fast, P.betweenLikes.slow, 0.7);
          schedule(applyFatigue(delay, state.actionsInSession));
        }
        break;
      }

      case "commenting": {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) {
          setStatus("Post modal closed before comment");
          followersState.postIndex++;
          followersState.phase = "likingPost";
          schedule(microPause());
          break;
        }

        const emoji = getRandomEmoji();
        setStatus(`Commenting: ${emoji}`);

        const success = await typeComment(emoji);
        if (success) {
          state.commentCount += 1;
          state.actionsInSession += 1;
          save();
          setStatus(`Commented ${state.commentCount} total`);
          paint();
        } else {
          setStatus("Comment failed (input not found)");
        }

        // Post-comment pause
        schedule(postActionPause());

        // Close modal and move on
        const closeBtn = dialog.querySelector('svg[aria-label="Close" i], button[aria-label="Close"]');
        if (closeBtn) closeBtn.click();
        else history.back();

        followersState.postIndex++;
        followersState.phase = "likingPost";
        const P = getCurrentPersonality();
        const delay = mixedHumanDelay(P.betweenLikes.fast, P.betweenLikes.slow, 0.7);
        schedule(applyFatigue(delay, state.actionsInSession));
        break;
      }

      default:
        setStatus("Unknown phase, stopping");
        stop("Error");
    }
  }

  /* ---------------------------------------------------------------- UI */

  const CSS = `
    :host { all: initial; }
    .card {
      width: 320px; background: #15171b; color: #e9edf3;
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
    .body { display: grid; gap: 9px; padding: 0 12px 12px; max-height: 70vh; overflow-y: auto; }
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
    .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #c2cad6; }
    .row span.value { display: inline-flex; align-items: center; gap: 4px; color: #8e98a6; }
    input[type="number"] {
      width: 60px; padding: 5px 6px; border-radius: 7px; text-align: right;
      border: 1px solid rgba(255,255,255,.13); background: #1d2026; color: #e9edf3;
      font: inherit; font-variant-numeric: tabular-nums;
    }
    input[type="number"]:focus { outline: 1px solid #3b82f6; }
    input[type="text"], textarea, select {
      width: 100%; padding: 6px 8px; border-radius: 7px;
      border: 1px solid rgba(255,255,255,.13); background: #1d2026; color: #e9edf3;
      font: inherit; font-size: 12px; resize: vertical;
    }
    input[type="text"]:focus, textarea:focus, select:focus { outline: 1px solid #3b82f6; }
    select { appearance: none; cursor: pointer; }
    input[type="checkbox"] { width: 15px; height: 15px; accent-color: #3b82f6; cursor: pointer; }
    .foot { display: flex; justify-content: space-between; align-items: center; color: #6f7885; font-size: 11px; }
    .link {
      background: none; border: 0; padding: 0; color: #7f8b9c;
      font: inherit; font-size: 11px; cursor: pointer; text-decoration: underline;
    }
    .link:hover { color: #b7c1cd; }
    .emoji-preview { font-size: 14px; line-height: 1.5; min-height: 20px; }
    .help { font-size: 10px; color: #6f7885; margin-top: 2px; }
    .preset-btn { font-size: 11px; padding: 4px 8px; margin-right: 4px; }
  `;

  const root = document.createElement("div");
  root.id = "igal-host";
  root.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;";
  const shadow = root.attachShadow({ mode: "open" });

  // Build personality options
  const personalityOptions = Object.entries(PERSONALITIES).map(([key, p]) =>
    `<option value="${key}" ${key === "careful" ? "selected" : ""}>${p.name}</option>`
  ).join("");

  shadow.innerHTML = `
    <style>${CSS}</style>
    <div class="card">
      <button class="head" id="head" type="button">
        <span class="dot" id="dot"></span>
        <span class="name">ck-auto-like-instagram</span>
        <span class="count" id="count">❤️0 💬0</span>
        <span class="chev" id="chev">&#9662;</span>
      </button>
      <div class="body" id="body">
        <div class="status" id="status">Idle</div>

        <div class="section">
          <div class="section-title">Personality Preset</div>
          <div class="row" style="flex-direction:column;align-items:flex-start;gap:6px;">
            <select id="personality">${personalityOptions}</select>
            <div class="help" id="personalityDesc"></div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;">
              <button class="primary preset-btn" id="presetCareful" type="button">Careful</button>
              <button class="primary preset-btn" id="presetCasual" type="button">Casual</button>
              <button class="primary preset-btn" id="presetEfficient" type="button">Efficient</button>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Target Profiles</div>
          <div class="row" style="flex-direction:column;align-items:flex-start;gap:4px;">
            <label for="targets">Profiles (one per line, @ optional)</label>
            <textarea id="targets" rows="3" placeholder="profile1&#10;profile2&#10;profile3"></textarea>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Limits</div>
          <div class="row">
            <label for="maxFollowers">Max followers/profile</label>
            <span class="value"><input id="maxFollowers" type="number" min="1" max="500" step="1"></span>
          </div>
          <div class="row">
            <label for="maxLikesPerFollower">Max likes/follower</label>
            <span class="value"><input id="maxLikesPerFollower" type="number" min="1" max="50" step="1"></span>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Human-Like Delays (medians in seconds)</div>
          <div class="help">Uses log-normal distribution with fast/slow modes. Actual delays vary naturally.</div>
          <div class="row">
            <label for="delayFollowersFast">Between followers (fast)</label>
            <span class="value"><input id="delayFollowersFast" type="number" min="3" max="120" step="1"></span>
          </div>
          <div class="row">
            <label for="delayFollowersSlow">Between followers (slow/distracted)</label>
            <span class="value"><input id="delayFollowersSlow" type="number" min="3" max="300" step="1"></span>
          </div>
          <div class="row">
            <label for="delayLikesFast">Between likes (fast)</label>
            <span class="value"><input id="delayLikesFast" type="number" min="2" max="60" step="1"></span>
          </div>
          <div class="row">
            <label for="delayLikesSlow">Between likes (slow/distracted)</label>
            <span class="value"><input id="delayLikesSlow" type="number" min="2" max="120" step="1"></span>
          </div>
          <div class="row">
            <label for="delayProfilesFast">Between profiles (fast)</label>
            <span class="value"><input id="delayProfilesFast" type="number" min="10" max="300" step="1"></span>
          </div>
          <div class="row">
            <label for="delayProfilesSlow">Between profiles (slow/distracted)</label>
            <span class="value"><input id="delayProfilesSlow" type="number" min="10" max="600" step="1"></span>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Session Breaks (fatigue simulation)</div>
          <div class="row">
            <label for="sessionBreakEvery">Break every N actions</label>
            <span class="value"><input id="sessionBreakEvery" type="number" min="5" max="100" step="1"></span>
          </div>
          <div class="row">
            <label for="sessionBreakMin">Break duration min (s)</label>
            <span class="value"><input id="sessionBreakMin" type="number" min="10" max="600" step="10"></span>
          </div>
          <div class="row">
            <label for="sessionBreakMax">Break duration max (s)</label>
            <span class="value"><input id="sessionBreakMax" type="number" min="10" max="1200" step="10"></span>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Content Interaction</div>
          <div class="row">
            <label for="watchVideoProbability">Watch videos (%)</label>
            <span class="value"><input id="watchVideoProbability" type="number" min="0" max="100" step="5"></span>
          </div>
          <div class="row">
            <label for="readCaptionProbability">Read captions (%)</label>
            <span class="value"><input id="readCaptionProbability" type="number" min="0" max="100" step="5"></span>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Comments (Optional)</div>
          <div class="row">
            <label for="commentsEnabled">Enable comments</label>
            <input id="commentsEnabled" type="checkbox">
          </div>
          <div class="row" style="flex-direction:column;align-items:flex-start;gap:4px;">
            <label for="commentEmojis">Emojis (space separated)</label>
            <input id="commentEmojis" type="text" placeholder="❤️ 🔥 😍 👏 ...">
          </div>
          <div class="row">
            <label for="commentProbability">Comment probability (%)</label>
            <span class="value"><input id="commentProbability" type="number" min="0" max="100" step="1"></span>
          </div>
          <div class="row">
            <label for="commentDelayMin">Before comment min (s)</label>
            <span class="value"><input id="commentDelayMin" type="number" min="1" max="60" step="1"></span>
          </div>
          <div class="row">
            <label for="commentDelayMax">Before comment max (s)</label>
            <span class="value"><input id="commentDelayMax" type="number" min="1" max="60" step="1"></span>
          </div>
          <div class="row">
            <span>Preview:</span>
            <span class="emoji-preview value" id="emojiPreview"></span>
          </div>
        </div>

        <button class="primary" id="toggle" type="button">Start</button>

        <div class="foot">
          <span id="hint">Liked-photo memory persists across sessions</span>
          <button class="link" id="reset" type="button">Reset All</button>
        </div>
      </div>
    </div>
  `;

  const el = {};
  const ids = ["head","body","chev","dot","count","status",
    "personality","personalityDesc",
    "presetCareful","presetCasual","presetEfficient",
    "targets","maxFollowers","maxLikesPerFollower",
    "delayFollowersFast","delayFollowersSlow","delayLikesFast","delayLikesSlow",
    "delayProfilesFast","delayProfilesSlow",
    "sessionBreakEvery","sessionBreakMin","sessionBreakMax",
    "watchVideoProbability","readCaptionProbability",
    "commentsEnabled","commentEmojis","commentProbability","commentDelayMin","commentDelayMax",
    "emojiPreview","toggle","reset","hint"];
  ids.forEach(id => { el[id] = shadow.getElementById(id); });

  let collapsed = false;

  const PERSONALITY_DESCRIPTIONS = {
    careful: "Slow, reads captions, watches videos, low action volume. Safest for main accounts.",
    casual: "Natural pace, sometimes reads, sometimes skims. Good balance for secondary accounts.",
    efficient: "Faster pace, skims content, higher volume. Higher risk, use with burner accounts only."
  };

  function paint() {
    const isRunning = state.enabled && running;
    el.count.textContent = `❤️${state.likeCount} 💬${state.commentCount}`;
    el.dot.classList.toggle("on", isRunning);
    el.toggle.textContent = isRunning ? "Stop" : "Start";
    el.toggle.classList.toggle("stop", isRunning);
    el.targets.value = state.targets.join("\n");
    if (shadow.activeElement !== el.maxFollowers) el.maxFollowers.value = String(state.maxFollowersPerProfile);
    if (shadow.activeElement !== el.maxLikesPerFollower) el.maxLikesPerFollower.value = String(state.maxLikesPerFollower);

    // Personality
    el.personality.value = state.personality;
    el.personalityDesc.textContent = PERSONALITY_DESCRIPTIONS[state.personality] || "";

    // Delays (show in seconds)
    if (shadow.activeElement !== el.delayFollowersFast) el.delayFollowersFast.value = String(state.delayBetweenFollowersFast / 1000);
    if (shadow.activeElement !== el.delayFollowersSlow) el.delayFollowersSlow.value = String(state.delayBetweenFollowersSlow / 1000);
    if (shadow.activeElement !== el.delayLikesFast) el.delayLikesFast.value = String(state.delayBetweenLikesFast / 1000);
    if (shadow.activeElement !== el.delayLikesSlow) el.delayLikesSlow.value = String(state.delayBetweenLikesSlow / 1000);
    if (shadow.activeElement !== el.delayProfilesFast) el.delayProfilesFast.value = String(state.delayBetweenProfilesFast / 1000);
    if (shadow.activeElement !== el.delayProfilesSlow) el.delayProfilesSlow.value = String(state.delayBetweenProfilesSlow / 1000);

    // Session breaks
    if (shadow.activeElement !== el.sessionBreakEvery) el.sessionBreakEvery.value = String(state.sessionBreakEvery);
    if (shadow.activeElement !== el.sessionBreakMin) el.sessionBreakMin.value = String(state.sessionBreakMin / 1000);
    if (shadow.activeElement !== el.sessionBreakMax) el.sessionBreakMax.value = String(state.sessionBreakMax / 1000);

    // Content interaction
    if (shadow.activeElement !== el.watchVideoProbability) el.watchVideoProbability.value = String(Math.round(state.watchVideoProbability * 100));
    if (shadow.activeElement !== el.readCaptionProbability) el.readCaptionProbability.value = String(Math.round(state.readCaptionProbability * 100));

    // Comments
    el.commentsEnabled.checked = state.commentsEnabled;
    if (shadow.activeElement !== el.commentEmojis) el.commentEmojis.value = state.commentEmojis;
    if (shadow.activeElement !== el.commentProbability) el.commentProbability.value = String(state.commentProbability);
    if (shadow.activeElement !== el.commentDelayMin) el.commentDelayMin.value = String(state.commentDelayMin / 1000);
    if (shadow.activeElement !== el.commentDelayMax) el.commentDelayMax.value = String(state.commentDelayMax / 1000);
    updateEmojiPreview();

    el.status.textContent = statusText;
  }

  function updateEmojiPreview() {
    const emojis = (el.commentEmojis.value || state.commentEmojis).trim().split(/\s+/).filter(Boolean);
    el.emojiPreview.textContent = emojis.slice(0, 10).join(" ") + (emojis.length > 10 ? " …" : "");
  }

  function applyPersonality(key) {
    if (!PERSONALITIES[key]) return;
    const P = PERSONALITIES[key];
    commit({
      personality: key,
      maxFollowersPerProfile: P.maxFollowersPerProfile,
      maxLikesPerFollower: P.maxLikesPerFollower,
      delayBetweenFollowersFast: P.betweenFollowers.fast,
      delayBetweenFollowersSlow: P.betweenFollowers.slow,
      delayBetweenLikesFast: P.betweenLikes.fast,
      delayBetweenLikesSlow: P.betweenLikes.slow,
      delayBetweenProfilesFast: P.betweenProfiles.fast,
      delayBetweenProfilesSlow: P.betweenProfiles.slow,
      commentProbability: P.commentProbability,
      watchVideoProbability: P.watchVideoProbability,
      readCaptionProbability: P.readCaptionProbability,
      sessionBreakEvery: P.sessionBreakEvery,
      sessionBreakMin: P.sessionBreakDuration.min,
      sessionBreakMax: P.sessionBreakDuration.max,
    });
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

  // Personality preset buttons
  el.presetCareful.addEventListener("click", () => applyPersonality("careful"));
  el.presetCasual.addEventListener("click", () => applyPersonality("casual"));
  el.presetEfficient.addEventListener("click", () => applyPersonality("efficient"));

  // Personality select
  el.personality.addEventListener("change", () => applyPersonality(el.personality.value));

  // Toggle
  el.toggle.addEventListener("click", () => {
    if (state.enabled) { stop("Stopped"); return; }
    if (!isInstagramHost()) { setStatus("Open instagram.com first"); return; }
    if (!el.targets.value.trim()) { setStatus("Add at least one target profile"); return; }
    const targets = el.targets.value.split("\n").map(t => t.trim().replace(/^@/, "")).filter(Boolean);
    commit({ targets, enabled: true });
    claimAndStart();
  });

  el.targets.addEventListener("change", () => {
    const targets = el.targets.value.split("\n").map(t => t.trim().replace(/^@/, "")).filter(Boolean);
    commit({ targets });
  });
  el.maxFollowers.addEventListener("change", () => commit({ maxFollowersPerProfile: Math.round(clamp(el.maxFollowers.value, 1, 500, state.maxFollowersPerProfile)) }));
  el.maxLikesPerFollower.addEventListener("change", () => commit({ maxLikesPerFollower: Math.round(clamp(el.maxLikesPerFollower.value, 1, 50, state.maxLikesPerFollower)) }));

  // Delays (input in seconds, store as ms)
  el.delayFollowersFast.addEventListener("change", () => commit({ delayBetweenFollowersFast: Math.round(clamp(el.delayFollowersFast.value, 3, 120, state.delayBetweenFollowersFast / 1000)) * 1000 }));
  el.delayFollowersSlow.addEventListener("change", () => commit({ delayBetweenFollowersSlow: Math.round(clamp(el.delayFollowersSlow.value, 3, 300, state.delayBetweenFollowersSlow / 1000)) * 1000 }));
  el.delayLikesFast.addEventListener("change", () => commit({ delayBetweenLikesFast: Math.round(clamp(el.delayLikesFast.value, 2, 60, state.delayBetweenLikesFast / 1000)) * 1000 }));
  el.delayLikesSlow.addEventListener("change", () => commit({ delayBetweenLikesSlow: Math.round(clamp(el.delayLikesSlow.value, 2, 120, state.delayBetweenLikesSlow / 1000)) * 1000 }));
  el.delayProfilesFast.addEventListener("change", () => commit({ delayBetweenProfilesFast: Math.round(clamp(el.delayProfilesFast.value, 10, 300, state.delayBetweenProfilesFast / 1000)) * 1000 }));
  el.delayProfilesSlow.addEventListener("change", () => commit({ delayBetweenProfilesSlow: Math.round(clamp(el.delayProfilesSlow.value, 10, 600, state.delayBetweenProfilesSlow / 1000)) * 1000 }));

  // Session breaks
  el.sessionBreakEvery.addEventListener("change", () => commit({ sessionBreakEvery: Math.round(clamp(el.sessionBreakEvery.value, 5, 100, state.sessionBreakEvery)) }));
  el.sessionBreakMin.addEventListener("change", () => commit({ sessionBreakMin: Math.round(clamp(el.sessionBreakMin.value, 10, 600, state.sessionBreakMin / 1000)) * 1000 }));
  el.sessionBreakMax.addEventListener("change", () => commit({ sessionBreakMax: Math.round(clamp(el.sessionBreakMax.value, 10, 1200, state.sessionBreakMax / 1000)) * 1000 }));

  // Content interaction
  el.watchVideoProbability.addEventListener("change", () => commit({ watchVideoProbability: clamp(el.watchVideoProbability.value / 100, 0, 1, state.watchVideoProbability) }));
  el.readCaptionProbability.addEventListener("change", () => commit({ readCaptionProbability: clamp(el.readCaptionProbability.value / 100, 0, 1, state.readCaptionProbability) }));

  // Comments
  el.commentsEnabled.addEventListener("change", () => commit({ commentsEnabled: el.commentsEnabled.checked }));
  el.commentEmojis.addEventListener("input", () => {
    commit({ commentEmojis: el.commentEmojis.value });
    updateEmojiPreview();
  });
  el.commentProbability.addEventListener("change", () => commit({ commentProbability: Math.round(clamp(el.commentProbability.value, 0, 100, state.commentProbability)) }));
  el.commentDelayMin.addEventListener("change", () => commit({ commentDelayMin: Math.round(clamp(el.commentDelayMin.value, 1, 60, state.commentDelayMin / 1000)) * 1000 }));
  el.commentDelayMax.addEventListener("change", () => commit({ commentDelayMax: Math.round(clamp(el.commentDelayMax.value, 1, 60, state.commentDelayMax / 1000)) * 1000 }));

  el.reset.addEventListener("click", () => {
    clicked = new Set();
    commit({ likeCount: 0, commentCount: 0, likedCodes: [], enabled: false, actionsInSession: 0, lastSessionBreak: 0 });
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

    if (state.enabled && (!state.owner || state.owner === TAB_ID)) {
      if (!running) claimAndStart();
    } else if (running) {
      running = false;
      clearTimeout(timer);
      timer = null;
      setStatus(state.enabled ? "Handed off to another tab" : "Stopped");
    }
    paint();
  });

  window.addEventListener("pagehide", () => {
    if (running && state.owner === TAB_ID) {
      state.enabled = false;
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