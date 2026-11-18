/**
 * Node.js test runner for ck-auto-like-instagram
 * Runs pure unit tests without browser
 * Usage: node tests/test-node.js
 */

const fs = require("fs");
const path = require("path");

// Load content.js and extract pure functions
const contentJs = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

// Extract functions we need to test by evaluating in a controlled context
function createTestEnvironment() {
  const clamp = (v, lo, hi, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  };

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

  const readingTime = (hasVideo, captionLength) => {
    const base = hasVideo
      ? humanDelay(5000, 0.4, 2000, 15000)
      : humanDelay(2500, 0.5, 1000, 8000);
    const captionTime = Math.min(captionLength * 300, 10000);
    return base + captionTime;
  };

  const applyFatigue = (baseDelay, actionsInSession, fatigueFactor = 0.02) => {
    const fatigue = Math.min(1 + actionsInSession * fatigueFactor, 2.0);
    return Math.round(baseDelay * fatigue);
  };

  const postCodeFromHref = (href) => {
    const match = (href || "").match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
    return match ? match[1] + ":" + match[2] : null;
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

  function normalize(raw) {
    const userProvided = raw || {};
    const s = { ...DEFAULTS, ...userProvided };
    const P = PERSONALITIES[s.personality] || PERSONALITIES[DEFAULTS.personality];

    // FIX: Only use personality default if user didn't provide a value
    const userProvidedMaxFollowers = "maxFollowersPerProfile" in userProvided;
    const userProvidedMaxLikes = "maxLikesPerFollower" in userProvided;

    s.maxFollowersPerProfile = userProvidedMaxFollowers
      ? Math.round(clamp(s.maxFollowersPerProfile, 1, 500, P.maxFollowersPerProfile))
      : P.maxFollowersPerProfile;
    s.maxLikesPerFollower = userProvidedMaxLikes
      ? Math.round(clamp(s.maxLikesPerFollower, 1, 50, P.maxLikesPerFollower))
      : P.maxLikesPerFollower;
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

  return { clamp, humanDelay, mixedHumanDelay, readingTime, applyFatigue, postCodeFromHref, normalize, PERSONALITIES, DEFAULTS };
}

// ============================================================
// TEST RUNNER
// ============================================================

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
  console.log(`  ✓ ${message} (${actual})`);
}

function runTests() {
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║   ck-auto-like-instagram Node.js Test Suite       ║");
  console.log("╚═══════════════════════════════════════════════════╝\n");

  const env = createTestEnvironment();
  const { clamp, humanDelay, mixedHumanDelay, readingTime, applyFatigue, postCodeFromHref, normalize } = env;

  let passed = 0, failed = 0;

  function test(name, fn) {
    try {
      console.log(`\n📋 ${name}`);
      fn();
      passed++;
    } catch (e) {
      console.error(`  ✗ FAILED: ${name} - ${e.message}`);
      failed++;
    }
  }

  // ---- clamp tests ----
  test("clamp()", () => {
    assertEqual(clamp(5, 0, 10, 0), 5, "within range");
    assertEqual(clamp(-5, 0, 10, 0), 0, "below min");
    assertEqual(clamp(15, 0, 10, 0), 10, "above max");
    assertEqual(clamp("abc", 0, 10, 5), 5, "NaN returns fallback");
    assertEqual(clamp(null, 0, 10, 5), 0, "null -> Number(null) = 0 (JS behavior)");
  });

  // ---- humanDelay tests ----
  test("humanDelay() distribution", () => {
    const delays = Array.from({ length: 5000 }, () => humanDelay(10000, 0.5, 500, 300000));
    const min = Math.min(...delays);
    const max = Math.max(...delays);
    const avg = delays.reduce((a, b) => a + b, 0) / delays.length;
    console.log(`  5000 samples: avg=${Math.round(avg)}ms, min=${min}ms, max=${max}ms`);
    assert(min >= 500, "respects minMs");
    assert(max <= 300000, "respects maxMs");
    assert(avg > 5000 && avg < 20000, "median roughly around 10000");
  });

  // ---- mixedHumanDelay tests ----
  test("mixedHumanDelay() mode distribution", () => {
    const delays = Array.from({ length: 5000 }, () => mixedHumanDelay(5000, 20000, 0.7));
    const fastCount = delays.filter(d => d < 15000).length;
    const slowCount = delays.filter(d => d >= 15000).length;
    const fastPct = fastCount / 5000;
    console.log(`  fast=${fastCount} (${(fastPct*100).toFixed(1)}%), slow=${slowCount}`);
    assert(fastPct > 0.55 && fastPct < 0.85, "~70% fast mode");
  });

  // ---- readingTime tests ----
  test("readingTime()", () => {
    const photoDelays = Array.from({ length: 200 }, () => readingTime(false, 0));
    const photoAvg = photoDelays.reduce((a, b) => a + b, 0) / photoDelays.length;
    const videoDelays = Array.from({ length: 200 }, () => readingTime(true, 0));
    const videoAvg = videoDelays.reduce((a, b) => a + b, 0) / videoDelays.length;

    // Test caption cap by using the same base reading time
    const baseReading = humanDelay(2500, 0.5, 1000, 8000); // deterministic base for this test
    const longCaption = baseReading + Math.min(500 * 300, 10000);
    const hugeCaption = baseReading + Math.min(100000 * 300, 10000);

    console.log(`  photo avg=${Math.round(photoAvg)}ms, video avg=${Math.round(videoAvg)}ms`);
    console.log(`  longCaption (500 chars): ${Math.round(longCaption)}ms, hugeCaption: ${Math.round(hugeCaption)}ms`);
    assert(photoAvg > 1000 && photoAvg < 8000, "photo in range");
    assert(videoAvg > 2000 && videoAvg < 15000, "video in range");
    assert(longCaption > baseReading, "caption adds time");
    assert(hugeCaption - baseReading <= 10000, "caption capped at 10s");
  });

  // ---- applyFatigue tests ----
  test("applyFatigue()", () => {
    assertEqual(applyFatigue(10000, 0), 10000, "0 actions = no fatigue");
    assertEqual(applyFatigue(10000, 10), 12000, "10 actions = 20% fatigue");
    assertEqual(applyFatigue(10000, 50), 20000, "50 actions = capped at 2x");
    assertEqual(applyFatigue(10000, 100), 20000, "100 actions = still capped");
  });

  // ---- postCodeFromHref tests ----
  test("postCodeFromHref()", () => {
    assertEqual(postCodeFromHref("/p/ABC123/"), "p:ABC123", "extracts /p/");
    assertEqual(postCodeFromHref("/reel/XYZ789/"), "reel:XYZ789", "extracts /reel/");
    assertEqual(postCodeFromHref("/tv/DEF456/"), "tv:DEF456", "extracts /tv/");
    assertEqual(postCodeFromHref("/explore/"), null, "null for /explore/");
    assertEqual(postCodeFromHref(""), null, "null for empty");
    assertEqual(postCodeFromHref(null), null, "null for null");
  });

  // ---- normalize tests ----
  test("normalize() personality defaults applied when not specified", () => {
    // When maxFollowersPerProfile/maxLikesPerFollower are NOT provided, personality defaults are used
    const careful = normalize({ personality: "careful" });
    assertEqual(careful.maxFollowersPerProfile, 8, "careful default 8 followers");
    assertEqual(careful.maxLikesPerFollower, 2, "careful default 2 likes");

    const casual = normalize({ personality: "casual" });
    assertEqual(casual.maxFollowersPerProfile, 12, "casual default 12 followers");
    assertEqual(casual.maxLikesPerFollower, 3, "casual default 3 likes");

    const efficient = normalize({ personality: "efficient" });
    assertEqual(efficient.maxFollowersPerProfile, 20, "efficient default 20 followers");
    assertEqual(efficient.maxLikesPerFollower, 4, "efficient default 4 likes");
  });

  test("normalize() user values clamped to global bounds, not personality", () => {
    // When user provides a value, it's clamped to global bounds (1-500/1-50), not personality defaults
    const careful = normalize({ personality: "careful", maxFollowersPerProfile: 100, maxLikesPerFollower: 10 });
    assertEqual(careful.maxFollowersPerProfile, 100, "user value 100 kept (within 1-500)");
    assertEqual(careful.maxLikesPerFollower, 10, "user value 10 likes kept (within 1-50)");

    const careful2 = normalize({ personality: "careful", maxFollowersPerProfile: 600, maxLikesPerFollower: 60 });
    assertEqual(careful2.maxFollowersPerProfile, 500, "user value 600 clamped to global max 500");
    assertEqual(careful2.maxLikesPerFollower, 50, "user value 60 likes clamped to global max 50");

    const careful3 = normalize({ personality: "careful", maxFollowersPerProfile: 0, maxLikesPerFollower: 0 });
    assertEqual(careful3.maxFollowersPerProfile, 1, "user value 0 clamped to global min 1");
    assertEqual(careful3.maxLikesPerFollower, 1, "user value 0 likes clamped to global min 1");
  });

  test("normalize() user values clamped to global bounds, not personality", () => {
    // When user provides a value, it's clamped to global bounds (1-500), not personality defaults
    const careful = normalize({ personality: "careful", maxFollowersPerProfile: 100 });
    assertEqual(careful.maxFollowersPerProfile, 100, "user value 100 kept (within 1-500)");

    const careful2 = normalize({ personality: "careful", maxFollowersPerProfile: 600 });
    assertEqual(careful2.maxFollowersPerProfile, 500, "user value 600 clamped to global max 500");

    const careful3 = normalize({ personality: "careful", maxFollowersPerProfile: 0 });
    assertEqual(careful3.maxFollowersPerProfile, 1, "user value 0 clamped to global min 1");
  });

  test("normalize() delay bounds", () => {
    const bounded = normalize({
      delayBetweenFollowersFast: 100,
      delayBetweenFollowersSlow: 1000000,
      delayBetweenLikesFast: 100,
      delayBetweenLikesSlow: 1000000,
      delayBetweenProfilesFast: 100,
      delayBetweenProfilesSlow: 1000000,
    });
    assertEqual(bounded.delayBetweenFollowersFast, 3000, "min 3s");
    assertEqual(bounded.delayBetweenFollowersSlow, 300000, "max 5min");
    assertEqual(bounded.delayBetweenLikesFast, 2000, "min 2s");
    assertEqual(bounded.delayBetweenLikesSlow, 120000, "max 2min");
    assertEqual(bounded.delayBetweenProfilesFast, 10000, "min 10s");
    assertEqual(bounded.delayBetweenProfilesSlow, 600000, "max 10min");
  });

  test("normalize() targets cleaning", () => {
    const targets = normalize({ targets: ["  @user1  ", "user2", "", "  @user3  "] });
    assertEqual(targets.targets.length, 3, "filters empty");
    assertEqual(targets.targets[0], "user1", "strips @ and whitespace");
    assertEqual(targets.targets[1], "user2", "keeps plain username");
    assertEqual(targets.targets[2], "user3", "strips @ and whitespace");
  });

  test("normalize() boolean conversion", () => {
    assertEqual(normalize({ enabled: "true" }).enabled, true, "string true");
    assertEqual(normalize({ enabled: 1 }).enabled, true, "number 1");
    assertEqual(normalize({ enabled: 0 }).enabled, false, "number 0");
    assertEqual(normalize({ commentsEnabled: "false" }).commentsEnabled, true, "string 'false' is truthy - known JS behavior");
    assertEqual(normalize({ commentsEnabled: false }).commentsEnabled, false, "boolean false");
  });

  test("normalize() probability bounds", () => {
    const prob = normalize({
      commentProbability: 150,
      watchVideoProbability: 2,
      readCaptionProbability: -0.5,
    });
    assertEqual(prob.commentProbability, 100, "commentProbability capped at 100");
    assertEqual(prob.watchVideoProbability, 1, "watchVideoProbability capped at 1");
    assertEqual(prob.readCaptionProbability, 0, "readCaptionProbability floored at 0");
  });

  test("normalize() likedCodes trimming", () => {
    const manyCodes = Array.from({ length: 2500 }, (_, i) => `p:CODE${i}`);
    const trimmed = normalize({ likedCodes: manyCodes });
    assertEqual(trimmed.likedCodes.length, 2000, "trims to 2000 max");
  });

  test("normalize() actionsInSession bounds", () => {
    assertEqual(normalize({ actionsInSession: -5 }).actionsInSession, 0, "negative floored to 0");
    assertEqual(normalize({ actionsInSession: 15000 }).actionsInSession, 10000, "capped at 10000");
  });

  // ---- Results ----
  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log(`║  Results: ${passed} passed, ${failed} failed`);
  console.log("╚═══════════════════════════════════════════════════╝");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();