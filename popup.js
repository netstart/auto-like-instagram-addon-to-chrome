/* ck-auto-like-instagram - popup controller (followers mode only) */
const KEY = "igAutoLike";
const DEFAULT_EMOJIS = "❤️ 🔥 😍 👏 🙌 😎 💯 ✨ 🌟 💪 🎉 🥰 😊 👍 💖 🌈 ☀️ 🌸 🦄 🍀";

const PERSONALITIES = {
  careful: {
    name: "Careful Observer",
    description: "Slow, reads captions, watches videos, low action volume. Safest for main accounts.",
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
    name: "Casual Browser",
    description: "Natural pace, sometimes reads, sometimes skims. Good balance for secondary accounts.",
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
    name: "Efficient Scroller",
    description: "Faster pace, skims content, higher volume. Higher risk, use with burner accounts only.",
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
  personality: "casual",
  maxFollowersPerProfile: 12,
  maxLikesPerFollower: 3,
  delayBetweenFollowersFast: 15000,
  delayBetweenFollowersSlow: 35000,
  delayBetweenLikesFast: 8000,
  delayBetweenLikesSlow: 20000,
  delayBetweenProfilesFast: 60000,
  delayBetweenProfilesSlow: 120000,
  sessionBreakEvery: 25,
  sessionBreakMin: 60000,
  sessionBreakMax: 180000,
  watchVideoProbability: 0.5,
  readCaptionProbability: 0.6,
  commentsEnabled: false,
  commentEmojis: DEFAULT_EMOJIS,
  commentProbability: 35,
  commentDelayMin: 2000,
  commentDelayMax: 5000,
  enabled: false,
  targets: [],
  likeCount: 0,
  commentCount: 0,
  likedCodes: [],
  owner: "",
  actionsInSession: 0,
  lastSessionBreak: 0,
};

const $ = (id) => document.getElementById(id);
let state = { ...DEFAULTS };

const clamp = (v, lo, hi, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
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
  s.commentEmojis = typeof s.commentEmojis === "string" ? s.commentEmojis : DEFAULT_EMOJIS;

  s.enabled = Boolean(s.enabled);
  s.likeCount = Math.round(clamp(s.likeCount, 0, 100000, 0));
  s.commentCount = Math.round(clamp(s.commentCount, 0, 100000, 0));
  s.owner = typeof s.owner === "string" ? s.owner : "";
  s.targets = Array.isArray(s.targets) ? s.targets.filter(t => typeof t === "string" && t.trim()).map(t => t.trim().replace(/^@/, "")) : [];
  s.likedCodes = Array.isArray(s.likedCodes) ? s.likedCodes.slice(-2000) : [];
  s.actionsInSession = Math.round(clamp(s.actionsInSession, 0, 10000, 0));
  s.lastSessionBreak = Math.round(clamp(s.lastSessionBreak, 0, Date.now(), 0));
  return s;
}

function render(status) {
  const isRunning = state.enabled;

  $("count").textContent = `❤️${state.likeCount} 💬${state.commentCount}`;
  $("dot").classList.toggle("on", isRunning);
  $("toggle").textContent = isRunning ? "Stop" : "Start";
  $("toggle").classList.toggle("stop", isRunning);

  // Personality
  $("personality").value = state.personality;
  $("personalityDesc").textContent = PERSONALITIES[state.personality]?.description || "";

  // Targets
  $("targets").value = state.targets.join("\n");

  // Limits
  $("maxFollowers").value = String(state.maxFollowersPerProfile);
  $("maxLikesPerFollower").value = String(state.maxLikesPerFollower);

  // Delays (show in seconds)
  $("delayFollowersFast").value = String(state.delayBetweenFollowersFast / 1000);
  $("delayFollowersSlow").value = String(state.delayBetweenFollowersSlow / 1000);
  $("delayLikesFast").value = String(state.delayBetweenLikesFast / 1000);
  $("delayLikesSlow").value = String(state.delayBetweenLikesSlow / 1000);
  $("delayProfilesFast").value = String(state.delayBetweenProfilesFast / 1000);
  $("delayProfilesSlow").value = String(state.delayBetweenProfilesSlow / 1000);

  // Session breaks
  $("sessionBreakEvery").value = String(state.sessionBreakEvery);
  $("sessionBreakMin").value = String(state.sessionBreakMin / 1000);
  $("sessionBreakMax").value = String(state.sessionBreakMax / 1000);

  // Content interaction
  $("watchVideoProbability").value = String(Math.round(state.watchVideoProbability * 100));
  $("readCaptionProbability").value = String(Math.round(state.readCaptionProbability * 100));

  // Comments
  $("commentsEnabled").checked = state.commentsEnabled;
  $("commentEmojis").value = state.commentEmojis;
  $("commentProbability").value = String(state.commentProbability);
  $("commentDelayMin").value = String(state.commentDelayMin / 1000);
  $("commentDelayMax").value = String(state.commentDelayMax / 1000);
  updateEmojiPreview();

  const line = status !== undefined ? status : describe();
  $("status").textContent = line;
}

function updateEmojiPreview() {
  const emojis = ($("commentEmojis").value || state.commentEmojis).trim().split(/\s+/).filter(Boolean);
  $("emojiPreview").textContent = emojis.slice(0, 10).join(" ") + (emojis.length > 10 ? " …" : "");
}

function describe() {
  if (state.enabled) return "Running in your Instagram tab";
  return state.likeCount > 0 ? `Stopped after ${state.likeCount} likes, ${state.commentCount} comments` : "Idle";
}

function save(patch) {
  Object.assign(state, patch);
  state = normalize(state);
  chrome.storage.local.set({ [KEY]: state });
  render();
}

function applyPersonality(key) {
  if (!PERSONALITIES[key]) return;
  const P = PERSONALITIES[key];
  save({
    personality: key,
    maxFollowersPerProfile: P.maxFollowersPerProfile,
    maxLikesPerFollower: P.maxLikesPerFollower,
    delayBetweenFollowersFast: P.delayBetweenFollowersFast,
    delayBetweenFollowersSlow: P.delayBetweenFollowersSlow,
    delayBetweenLikesFast: P.delayBetweenLikesFast,
    delayBetweenLikesSlow: P.delayBetweenLikesSlow,
    delayBetweenProfilesFast: P.delayBetweenProfilesFast,
    delayBetweenProfilesSlow: P.delayBetweenProfilesSlow,
    commentProbability: P.commentProbability,
    watchVideoProbability: P.watchVideoProbability,
    readCaptionProbability: P.readCaptionProbability,
    sessionBreakEvery: P.sessionBreakEvery,
    sessionBreakMin: P.sessionBreakMin,
    sessionBreakMax: P.sessionBreakMax,
  });
}

async function instagramTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return null;
  const url = tab.url || "";
  return /^https?:\/\/(www\.)?instagram\.com\//.test(url) ? tab : null;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "igal-ping" });
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      return true;
    } catch {
      return false;
    }
  }
}

// Toggle
$("toggle").addEventListener("click", async () => {
  if (state.enabled) {
    save({ enabled: false, owner: "" });
    render("Stopped");
    return;
  }

  const targets = $("targets").value.split("\n").map(t => t.trim().replace(/^@/, "")).filter(Boolean);
  if (!targets.length) { render("Add at least one target profile"); return; }

  const tab = await instagramTab();
  if (!tab) { render("Open instagram.com in this tab first"); return; }

  save({ enabled: true, owner: "", targets });
  const ok = await ensureContentScript(tab.id);
  render(ok ? "Running in your Instagram tab" : "Reload the Instagram tab, then try again");
});

// Targets
$("targets").addEventListener("change", () => {
  const targets = $("targets").value.split("\n").map(t => t.trim().replace(/^@/, "")).filter(Boolean);
  save({ targets });
});

// Limits
$("maxFollowers").addEventListener("change", () => save({ maxFollowersPerProfile: Math.round(clamp($("maxFollowers").value, 1, 500, state.maxFollowersPerProfile)) }));
$("maxLikesPerFollower").addEventListener("change", () => save({ maxLikesPerFollower: Math.round(clamp($("maxLikesPerFollower").value, 1, 50, state.maxLikesPerFollower)) }));

// Delays (input in seconds, store as ms)
$("delayFollowersFast").addEventListener("change", () => save({ delayBetweenFollowersFast: Math.round(clamp($("delayFollowersFast").value, 3, 120, state.delayBetweenFollowersFast / 1000)) * 1000 }));
$("delayFollowersSlow").addEventListener("change", () => save({ delayBetweenFollowersSlow: Math.round(clamp($("delayFollowersSlow").value, 3, 300, state.delayBetweenFollowersSlow / 1000)) * 1000 }));
$("delayLikesFast").addEventListener("change", () => save({ delayBetweenLikesFast: Math.round(clamp($("delayLikesFast").value, 2, 60, state.delayBetweenLikesFast / 1000)) * 1000 }));
$("delayLikesSlow").addEventListener("change", () => save({ delayBetweenLikesSlow: Math.round(clamp($("delayLikesSlow").value, 2, 120, state.delayBetweenLikesSlow / 1000)) * 1000 }));
$("delayProfilesFast").addEventListener("change", () => save({ delayBetweenProfilesFast: Math.round(clamp($("delayProfilesFast").value, 10, 300, state.delayBetweenProfilesFast / 1000)) * 1000 }));
$("delayProfilesSlow").addEventListener("change", () => save({ delayBetweenProfilesSlow: Math.round(clamp($("delayProfilesSlow").value, 10, 600, state.delayBetweenProfilesSlow / 1000)) * 1000 }));

// Session breaks
$("sessionBreakEvery").addEventListener("change", () => save({ sessionBreakEvery: Math.round(clamp($("sessionBreakEvery").value, 5, 100, state.sessionBreakEvery)) }));
$("sessionBreakMin").addEventListener("change", () => save({ sessionBreakMin: Math.round(clamp($("sessionBreakMin").value, 10, 600, state.sessionBreakMin / 1000)) * 1000 }));
$("sessionBreakMax").addEventListener("change", () => save({ sessionBreakMax: Math.round(clamp($("sessionBreakMax").value, 10, 1200, state.sessionBreakMax / 1000)) * 1000 }));

// Content interaction
$("watchVideoProbability").addEventListener("change", () => save({ watchVideoProbability: clamp($("watchVideoProbability").value / 100, 0, 1, state.watchVideoProbability) }));
$("readCaptionProbability").addEventListener("change", () => save({ readCaptionProbability: clamp($("readCaptionProbability").value / 100, 0, 1, state.readCaptionProbability) }));

// Comments
$("commentsEnabled").addEventListener("change", () => save({ commentsEnabled: $("commentsEnabled").checked }));
$("commentEmojis").addEventListener("input", () => {
  save({ commentEmojis: $("commentEmojis").value });
  updateEmojiPreview();
});
$("commentProbability").addEventListener("change", () => save({ commentProbability: Math.round(clamp($("commentProbability").value, 0, 100, state.commentProbability)) }));
$("commentDelayMin").addEventListener("change", () => save({ commentDelayMin: Math.round(clamp($("commentDelayMin").value, 1, 60, state.commentDelayMin / 1000)) * 1000 }));
$("commentDelayMax").addEventListener("change", () => save({ commentDelayMax: Math.round(clamp($("commentDelayMax").value, 1, 60, state.commentDelayMax / 1000)) * 1000 }));

// Personality
$("personality").addEventListener("change", () => applyPersonality($("personality").value));
$("presetCareful").addEventListener("click", () => applyPersonality("careful"));
$("presetCasual").addEventListener("click", () => applyPersonality("casual"));
$("presetEfficient").addEventListener("click", () => applyPersonality("efficient"));

// Reset
$("reset").addEventListener("click", () => {
  save({ likeCount: 0, commentCount: 0, likedCodes: [], enabled: false, actionsInSession: 0, lastSessionBreak: 0 });
  render("All counters reset");
});

// Storage sync
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[KEY]) return;
  state = normalize(changes[KEY].newValue);
  render();
});

chrome.storage.local.get(KEY, (res) => {
  state = normalize(res[KEY]);
  render();
});