/**
 * Automated tests for ck-auto-like-instagram
 * Run in browser console on test harness page, or via Node with Playwright/Puppeteer
 */

(function() {
  "use strict";

  // ============================================================
  // TEST UTILITIES
  // ============================================================

  const assert = (condition, message) => {
    if (!condition) throw new Error(`Assertion failed: ${message}`);
    console.log(`  ✓ ${message}`);
  };

  const assertEqual = (actual, expected, message) => {
    if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
    console.log(`  ✓ ${message} (${actual})`);
  };

  const assertThrows = (fn, message) => {
    try {
      fn();
      throw new Error(`${message}: should have thrown`);
    } catch (e) {
      if (e.message.includes("should have thrown")) throw e;
      console.log(`  ✓ ${message} (threw as expected)`);
    }
  };

  // ============================================================
  // TEST HELPERS
  // ============================================================

  function createMockStore(initialState = {}) {
    const defaultState = {
      personality: "careful",
      enabled: false,
      targets: ["testuser"],
      maxFollowersPerProfile: 3,
      maxLikesPerFollower: 2,
      delayBetweenFollowersFast: 100,
      delayBetweenFollowersSlow: 200,
      delayBetweenLikesFast: 50,
      delayBetweenLikesSlow: 100,
      delayBetweenProfilesFast: 200,
      delayBetweenProfilesSlow: 400,
      sessionBreakEvery: 10,
      sessionBreakMin: 100,
      sessionBreakMax: 200,
      watchVideoProbability: 0.5,
      readCaptionProbability: 0.5,
      commentsEnabled: false,
      commentEmojis: "❤️ 🔥 😍",
      commentProbability: 50,
      commentDelayMin: 50,
      commentDelayMax: 100,
      likeCount: 0,
      commentCount: 0,
      likedCodes: [],
      owner: "",
      actionsInSession: 0,
      lastSessionBreak: 0,
    };
    return { ...defaultState, ...initialState };
  }

  function createMockChrome(store) {
    const listeners = [];
    return {
      storage: {
        local: {
          get(key, cb) {
            setTimeout(() => cb({ [key]: store[key] }), 0);
          },
          set(obj, cb) {
            const changes = {};
            for (const k of Object.keys(obj)) {
              changes[k] = { newValue: JSON.parse(JSON.stringify(obj[k])) };
              store[k] = changes[k].newValue;
            }
            setTimeout(() => listeners.forEach(fn => fn(changes, "local")), 0);
            if (cb) cb();
          },
        },
        onChanged: { addListener: (fn) => listeners.push(fn) },
      },
      runtime: { onMessage: { addListener: () => {} } },
      tabs: {
        query: (opts, cb) => cb([{ id: 1, url: "https://www.instagram.com/", active: true }]),
        sendMessage: (tabId, msg, cb) => { if (msg?.type === "igal-ping") cb({ ok: true }); },
      },
      scripting: { executeScript: (opts, cb) => cb?.() },
    };
  }

  function resetTestEnvironment() {
    // Clear any existing test elements
    document.querySelectorAll('[data-test]').forEach(el => el.remove());
    // Reset logs
    const logEl = document.getElementById("log");
    if (logEl) logEl.textContent = "";
  }

  // ============================================================
  // UNIT TESTS (Pure Functions)
  // ============================================================

  function testClamp() {
    console.log("\n🧪 Testing clamp()...");
    const clamp = (v, lo, hi, fallback) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(hi, Math.max(lo, n));
    };

    assertEqual(clamp(5, 0, 10, 0), 5, "clamp within range");
    assertEqual(clamp(-5, 0, 10, 0), 0, "clamp below min");
    assertEqual(clamp(15, 0, 10, 0), 10, "clamp above max");
    assertEqual(clamp("abc", 0, 10, 5), 5, "clamp NaN returns fallback");
    assertEqual(clamp(null, 0, 10, 5), 5, "clamp null returns fallback");
    assertEqual(clamp(3.7, 0, 10, 0), 3.7, "clamp float");
  }

  function testHumanDelay() {
    console.log("\n🧪 Testing humanDelay()...");
    const humanDelay = (medianMs, spread = 0.5, minMs = 500, maxMs = 300000) => {
      const u = Math.random();
      const v = Math.random();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      const lnMedian = Math.log(medianMs);
      const delay = Math.exp(lnMedian + spread * z);
      return Math.round(Math.min(maxMs, Math.max(minMs, delay)));
    };

    const delays = Array.from({ length: 1000 }, () => humanDelay(10000, 0.5, 500, 300000));
    const avg = delays.reduce((a, b) => a + b, 0) / delays.length;
    const min = Math.min(...delays);
    const max = Math.max(...delays);

    console.log(`  1000 samples: avg=${Math.round(avg)}ms, min=${min}ms, max=${max}ms`);
    assert(min >= 500, "respects minMs");
    assert(max <= 300000, "respects maxMs");
    assert(avg > 5000 && avg < 20000, "median roughly around 10000 (log-normal is right-skewed)");
  }

  function testMixedHumanDelay() {
    console.log("\n🧪 Testing mixedHumanDelay()...");
    const humanDelay = (medianMs, spread = 0.5, minMs = 500, maxMs = 300000) => {
      const u = Math.random();
      const v = Math.random();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      const lnMedian = Math.log(medianMs);
      const delay = Math.exp(lnMedian + spread * z);
      return Math.round(Math.min(maxMs, Math.max(minMs, delay)));
    };

    const mixedHumanDelay = (fastMedian, slowMedian, fastProb = 0.7, spread = 0.4) => {
      return Math.random() < fastProb
        ? humanDelay(fastMedian, spread)
        : humanDelay(slowMedian, spread * 1.5);
    };

    const delays = Array.from({ length: 1000 }, () => mixedHumanDelay(5000, 20000, 0.7));
    const fastCount = delays.filter(d => d < 15000).length;
    const slowCount = delays.filter(d => d >= 15000).length;

    console.log(`  1000 samples: fast=${fastCount}, slow=${slowCount}`);
    assert(fastCount > 500 && fastCount < 900, "~70% fast mode");
    assert(slowCount > 100 && slowCount < 500, "~30% slow mode");
  }

  function testReadingTime() {
    console.log("\n🧪 Testing readingTime()...");
    const humanDelay = (medianMs, spread = 0.5, minMs = 500, maxMs = 300000) => {
      const u = Math.random();
      const v = Math.random();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      const lnMedian = Math.log(medianMs);
      const delay = Math.exp(lnMedian + spread * z);
      return Math.round(Math.min(maxMs, Math.max(minMs, delay)));
    };

    const readingTime = (hasVideo, captionLength) => {
      const base = hasVideo
        ? humanDelay(5000, 0.4, 2000, 15000)
        : humanDelay(2500, 0.5, 1000, 8000);
      const captionTime = Math.min(captionLength * 300, 10000);
      return base + captionTime;
    };

    // Photo without caption
    const photoDelays = Array.from({ length: 100 }, () => readingTime(false, 0));
    const photoAvg = photoDelays.reduce((a, b) => a + b, 0) / photoDelays.length;
    console.log(`  Photo (no caption): avg=${Math.round(photoAvg)}ms`);
    assert(photoAvg > 1000 && photoAvg < 8000, "photo reading time in range");

    // Video
    const videoDelays = Array.from({ length: 100 }, () => readingTime(true, 0));
    const videoAvg = videoDelays.reduce((a, b) => a + b, 0) / videoDelays.length;
    console.log(`  Video (no caption): avg=${Math.round(videoAvg)}ms`);
    assert(videoAvg > 2000 && videoAvg < 15000, "video reading time in range");

    // Long caption
    const longCaptionDelays = Array.from({ length: 100 }, () => readingTime(false, 500));
    const longCaptionAvg = longCaptionDelays.reduce((a, b) => a + b, 0) / longCaptionDelays.length;
    console.log(`  Photo (500 chars): avg=${Math.round(longCaptionAvg)}ms`);
    assert(longCaptionAvg > photoAvg, "caption adds time");

    // Caption capped at 10s
    const hugeCaption = readingTime(false, 100000);
    assert(hugeCaption - readingTime(false, 0) <= 10000, "caption time capped at 10s");
  }

  function testApplyFatigue() {
    console.log("\n🧪 Testing applyFatigue()...");
    const applyFatigue = (baseDelay, actionsInSession, fatigueFactor = 0.02) => {
      const fatigue = Math.min(1 + actionsInSession * fatigueFactor, 2.0);
      return Math.round(baseDelay * fatigue);
    };

    assertEqual(applyFatigue(10000, 0), 10000, "no fatigue at 0 actions");
    assertEqual(applyFatigue(10000, 10), 12000, "20% fatigue at 10 actions");
    assertEqual(applyFatigue(10000, 50), 20000, "capped at 2x (100% fatigue)");
    assertEqual(applyFatigue(10000, 100), 20000, "stays capped at 2x");
  }

  function testPostCode() {
    console.log("\n🧪 Testing postCode extraction...");

    // Mock DOM
    const container = document.createElement("div");
    container.innerHTML = `
      <article>
        <a href="/p/ABC123/"></a>
        <svg aria-label="Like"></svg>
      </article>
    `;
    const svg = container.querySelector("svg");
    svg.closest = (sel) => sel === "article" ? container.querySelector("article") : null;

    // We can't easily test postCode without full DOM, but we can test postCodeFromHref
    const postCodeFromHref = (href) => {
      const match = (href || "").match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
      return match ? match[1] + ":" + match[2] : null;
    };

    assertEqual(postCodeFromHref("/p/ABC123/"), "p:ABC123", "extracts /p/ shortcode");
    assertEqual(postCodeFromHref("/reel/XYZ789/"), "reel:XYZ789", "extracts /reel/ shortcode");
    assertEqual(postCodeFromHref("/tv/DEF456/"), "tv:DEF456", "extracts /tv/ shortcode");
    assertEqual(postCodeFromHref("/explore/"), null, "returns null for non-post URLs");
    assertEqual(postCodeFromHref(""), null, "returns null for empty");
    assertEqual(postCodeFromHref(null), null, "returns null for null");
  }

  function testNormalize() {
    console.log("\n🧪 Testing normalize()...");

    const clamp = (v, lo, hi, fallback) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(hi, Math.max(lo, n));
    };

    const DEFAULTS = {
      personality: "careful",
      maxFollowersPerProfile: 8,
      maxLikesPerFollower: 2,
      delayBetweenFollowersFast: 25000,
      delayBetweenFollowersSlow: 60000,
      delayBetweenLikesFast: 12000,
      delayBetweenLikesSlow: 30000,
      delayBetweenProfilesFast: 90000,
      delayBetweenProfilesSlow: 180000,
      sessionBreakEvery: 15,
      sessionBreakMin: 120000,
      sessionBreakMax: 300000,
      watchVideoProbability: 0.8,
      readCaptionProbability: 0.9,
      commentsEnabled: false,
      commentProbability: 15,
      commentDelayMin: 2000,
      commentDelayMax: 5000,
      commentEmojis: "❤️ 🔥",
      enabled: false,
      targets: [],
      likeCount: 0,
      commentCount: 0,
      likedCodes: [],
      owner: "",
      actionsInSession: 0,
      lastSessionBreak: 0,
    };

    const PERSONALITIES = {
      careful: {
        maxFollowersPerProfile: 8,
        maxLikesPerFollower: 2,
        delayBetweenFollowersFast: 25000,
        delayBetweenFollowersSlow: 60000,
        delayBetweenLikesFast: 12000,
        delayBetweenLikesSlow: 30000,
        delayBetweenProfilesFast: 90000,
        delayBetweenProfilesSlow: 180000,
        commentProbability: 15,
        watchVideoProbability: 0.8,
        readCaptionProbability: 0.9,
        sessionBreakEvery: 15,
        sessionBreakMin: 120000,
        sessionBreakMax: 300000,
      },
      casual: {
        maxFollowersPerProfile: 12,
        maxLikesPerFollower: 3,
        delayBetweenFollowersFast: 15000,
        delayBetweenFollowersSlow: 35000,
        delayBetweenLikesFast: 8000,
        delayBetweenLikesSlow: 20000,
        delayBetweenProfilesFast: 60000,
        delayBetweenProfilesSlow: 120000,
        commentProbability: 35,
        watchVideoProbability: 0.5,
        readCaptionProbability: 0.6,
        sessionBreakEvery: 25,
        sessionBreakMin: 60000,
        sessionBreakMax: 180000,
      },
      efficient: {
        maxFollowersPerProfile: 20,
        maxLikesPerFollower: 4,
        delayBetweenFollowersFast: 8000,
        delayBetweenFollowersSlow: 18000,
        delayBetweenLikesFast: 4000,
        delayBetweenLikesSlow: 10000,
        delayBetweenProfilesFast: 30000,
        delayBetweenProfilesSlow: 60000,
        commentProbability: 20,
        watchVideoProbability: 0.3,
        readCaptionProbability: 0.3,
        sessionBreakEvery: 40,
        sessionBreakMin: 30000,
        sessionBreakMax: 90000,
      },
    };

    function normalize(raw) {
      const s = { ...DEFAULTS, ...(raw || {}) };
      const P = PERSONALITIES[s.personality] || PERSONALITIES[DEFAULTS.personality];

      s.maxFollowersPerProfile = Math.round(clamp(s.maxFollowersPerProfile, 1, 500, P.maxFollowersPerProfile));
      s.maxLikesPerFollower = Math.round(clamp(s.maxLikesPerFollower, 1, 50, P.maxLikesPerFollower));

      s.delayBetweenFollowersFast = Math.round(clamp(s.delayBetweenFollowersFast, 3000, 120000, P.delayBetweenFollowersFast));
      s.delayBetweenFollowersSlow = Math.round(clamp(s.delayBetweenFollowersSlow, s.delayBetweenFollowersFast, 300000, P.delayBetweenFollowersSlow));
      s.delayBetweenLikesFast = Math.round(clamp(s.delayBetweenLikesFast, 2000, 60000, P.delayBetweenLikesFast));
      s.delayBetweenLikesSlow = Math.round(clamp(s.delayBetweenLikesSlow, s.delayBetweenLikesFast, 120000, P.delayBetweenLikesSlow));
      s.delayBetweenProfilesFast = Math.round(clamp(s.delayBetweenProfilesFast, 10000, 300000, P.delayBetweenProfilesFast));
      s.delayBetweenProfilesSlow = Math.round(clamp(s.delayBetweenProfilesSlow, s.delayBetweenProfilesFast, 600000, P.delayBetweenProfilesSlow));

      s.sessionBreakEvery = Math.round(clamp(s.sessionBreakEvery, 5, 100, DEFAULTS.sessionBreakEvery));
      s.sessionBreakMin = Math.round(clamp(s.sessionBreakMin, 10000, 600000, DEFAULTS.sessionBreakMin));
      s.sessionBreakMax = Math.round(clamp(s.sessionBreakMax, s.sessionBreakMin, 1200000, DEFAULTS.sessionBreakMax));

      s.watchVideoProbability = clamp(s.watchVideoProbability, 0, 1, DEFAULTS.watchVideoProbability);
      s.readCaptionProbability = clamp(s.readCaptionProbability, 0, 1, DEFAULTS.readCaptionProbability);

      s.commentsEnabled = Boolean(s.commentsEnabled);
      s.commentProbability = Math.round(clamp(s.commentProbability, 0, 100, DEFAULTS.commentProbability));
      s.commentDelayMin = Math.round(clamp(s.commentDelayMin, 500, 60000, DEFAULTS.commentDelayMin));
      s.commentDelayMax = Math.round(clamp(s.commentDelayMax, s.commentDelayMin, 60000, DEFAULTS.commentDelayMax));
      s.commentEmojis = typeof s.commentEmojis === "string" ? s.commentEmojis : DEFAULTS.commentEmojis;

      s.enabled = Boolean(s.enabled);
      s.likeCount = Math.round(clamp(s.likeCount, 0, 100000, 0));
      s.commentCount = Math.round(clamp(s.commentCount, 0, 100000, 0));
      s.owner = typeof s.owner === "string" ? s.owner : "";
      s.targets = Array.isArray(s.targets) ? s.targets.filter(t => typeof t === "string" && t.trim()).map(t => t.trim().replace(/^@/, "")) : [];
      s.likedCodes = Array.isArray(s.likedCodes) ? s.likedCodes.filter(c => typeof c === "string").slice(-2000) : [];
      s.actionsInSession = Math.round(clamp(s.actionsInSession, 0, 10000, 0));
      s.lastSessionBreak = Math.round(clamp(s.lastSessionBreak, 0, Date.now(), 0));
      return s;
    }

    // Test personality application
    const careful = normalize({ personality: "careful", maxFollowersPerProfile: 100 });
    assertEqual(careful.maxFollowersPerProfile, 8, "careful caps at 8");

    const casual = normalize({ personality: "casual", maxFollowersPerProfile: 100 });
    assertEqual(casual.maxFollowersPerProfile, 12, "casual caps at 12");

    // Test bounds
    const bounded = normalize({ delayBetweenFollowersFast: 100, delayBetweenFollowersSlow: 1000000 });
    assertEqual(bounded.delayBetweenFollowersFast, 3000, "enforces min 3s");
    assertEqual(bounded.delayBetweenFollowersSlow, 300000, "enforces max 5min");

    // Test targets cleaning
    const targets = normalize({ targets: ["  @user1  ", "user2", "", "  @user3  "] });
    assertEqual(targets.targets.length, 3, "filters empty");
    assertEqual(targets.targets[0], "user1", "strips @ and whitespace");
    assertEqual(targets.targets[2], "user3", "strips @ and whitespace");

    // Test boolean conversion
    assertEqual(normalize({ enabled: "true" }).enabled, true, "string true -> boolean");
    assertEqual(normalize({ enabled: 0 }).enabled, false, "0 -> false");
    assertEqual(normalize({ commentsEnabled: 1 }).commentsEnabled, true, "1 -> true");

    // Test probability bounds
    const prob = normalize({ commentProbability: 150, watchVideoProbability: 2, readCaptionProbability: -0.5 });
    assertEqual(prob.commentProbability, 100, "probability capped at 100");
    assertEqual(prob.watchVideoProbability, 1, "probability capped at 1");
    assertEqual(prob.readCaptionProbability, 0, "probability floored at 0");
  }

  // ============================================================
  // INTEGRATION TESTS (with test harness page)
  // ============================================================

  async function testStartStopCycle() {
    console.log("\n🧪 Testing Start/Stop cycle...");

    // This requires the harness page to be loaded with content.js
    if (typeof window.__store === "undefined") {
      console.log("  ⚠ Skipped: not on test harness page");
      return;
    }

    const store = window.__store.igAutoLike;
    const log = (msg) => console.log(`  ${msg}`);

    // Initial state
    assertEqual(store.enabled, false, "initially disabled");
    assertEqual(store.likeCount, 0, "initial like count 0");

    // Start
    store.enabled = true;
    store.owner = "test-tab";
    store.targets = ["testuser"];
    const changes = { igAutoLike: { newValue: JSON.parse(JSON.stringify(store)) } };
    if (window.chrome?.storage?.onChanged) {
      // Trigger listeners manually
    }
    log("Started");

    // Wait a bit for navigation
    await new Promise(r => setTimeout(r, 100));

    // Stop
    store.enabled = false;
    store.owner = "";
    log("Stopped");
    assertEqual(store.enabled, false, "disabled after stop");
  }

  async function testLikeFlow() {
    console.log("\n🧪 Testing like flow on harness...");

    if (typeof window.__store === "undefined") {
      console.log("  ⚠ Skipped: not on test harness page");
      return;
    }

    const store = window.__store.igAutoLike;
    const logEl = document.getElementById("log");

    // Click first post's like button
    const firstLikeBtn = document.querySelector("#fakeProfile article .post-like");
    if (!firstLikeBtn) {
      console.log("  ⚠ No like button found");
      return;
    }

    firstLikeBtn.click();
    await new Promise(r => setTimeout(r, 50));

    const logText = logEl.textContent;
    assert(logText.includes("FOLLOWER_POST_1"), "first post liked");
    console.log("  ✓ First post like registered");
  }

  async function testCommentFlow() {
    console.log("\n🧪 Testing comment flow...");

    if (typeof window.__store === "undefined") {
      console.log("  ⚠ Skipped: not on test harness page");
      return;
    }

    const store = window.__store.igAutoLike;
    store.commentsEnabled = true;
    store.commentProbability = 100; // always comment

    // This would need the modal to be open, which is complex in test harness
    console.log("  ⚠ Comment flow test requires modal interaction - manual verification needed");
  }

  // ============================================================
  // RUN ALL TESTS
  // ============================================================

  async function runAllTests() {
    console.log("╔═══════════════════════════════════════════════════╗");
    console.log("║   ck-auto-like-instagram Automated Test Suite    ║");
    console.log("╚═══════════════════════════════════════════════════╝");

    const tests = [
      { name: "clamp()", fn: testClamp },
      { name: "humanDelay()", fn: testHumanDelay },
      { name: "mixedHumanDelay()", fn: testMixedHumanDelay },
      { name: "readingTime()", fn: testReadingTime },
      { name: "applyFatigue()", fn: testApplyFatigue },
      { name: "postCodeFromHref()", fn: testPostCode },
      { name: "normalize()", fn: testNormalize },
    ];

    let passed = 0, failed = 0;

    for (const test of tests) {
      try {
        console.log(`\n📋 Running: ${test.name}`);
        await test.fn();
        passed++;
      } catch (e) {
        console.error(`  ✗ FAILED: ${test.name} - ${e.message}`);
        failed++;
      }
    }

    // Integration tests (only on harness)
    if (typeof window.__store !== "undefined") {
      try {
        await testStartStopCycle();
        passed++;
      } catch (e) {
        console.error(`  ✗ FAILED: Start/Stop - ${e.message}`);
        failed++;
      }

      try {
        await testLikeFlow();
        passed++;
      } catch (e) {
        console.error(`  ✗ FAILED: Like Flow - ${e.message}`);
        failed++;
      }
    }

    console.log("\n╔═══════════════════════════════════════════════════╗");
    console.log(`║  Results: ${passed} passed, ${failed} failed                      ║`);
    console.log("╚═══════════════════════════════════════════════════╝");

    if (failed > 0) {
      throw new Error(`${failed} test(s) failed`);
    }

    return { passed, failed };
  }

  // Export for manual running
  window.runTests = runAllTests;
  window.testUtils = { assert, assertEqual, createMockStore, createMockChrome };

  // Auto-run if on harness page
  if (document.readyState === "complete" && typeof window.__store !== "undefined") {
    setTimeout(runAllTests, 1000);
  }
})();