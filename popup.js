/* Auto-Like for Instagram - popup controller (dual mode) */
const KEY = "igAutoLike";
const DEFAULTS = {
  // Feed mode
  feedEnabled: false,
  feedMinDelay: 3000,
  feedMaxDelay: 8000,
  feedMaxLikes: 20,
  feedAutoScroll: true,

  // Followers mode
  followersEnabled: false,
  targets: [],
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

const $ = (id) => document.getElementById(id);
let state = { ...DEFAULTS };
let activeMode = "feed"; // "feed" | "followers"

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
  s.likedCodes = Array.isArray(s.likedCodes) ? s.likedCodes.slice(-2000) : [];
  return s;
}

function render(status) {
  const feedRunning = state.feedEnabled;
  const followersRunning = state.followersEnabled;
  const anyRunning = feedRunning || followersRunning;

  $("count").textContent = state.likeCount + "/" + (state.feedEnabled ? state.feedMaxLikes : "∞");
  $("feedToggle").textContent = feedRunning ? "Stop Feed" : "Start Feed";
  $("feedToggle").classList.toggle("stop", feedRunning);
  $("feedToggle").disabled = followersRunning;
  $("dot").classList.toggle("on", anyRunning);
  $("feedMin").value = (state.feedMinDelay / 1000).toFixed(1);
  $("feedMax").value = (state.feedMaxDelay / 1000).toFixed(1);
  $("feedLimit").value = String(state.feedMaxLikes);
  $("feedScroll").checked = state.feedAutoScroll;

  $("followersToggle").textContent = followersRunning ? "Stop Followers" : "Start Followers";
  $("followersToggle").classList.toggle("stop", followersRunning);
  $("followersToggle").disabled = feedRunning;
  $("targets").value = state.targets.join("\n");
  $("maxFollowers").value = String(state.maxFollowersPerProfile);
  $("maxLikesPerFollower").value = String(state.maxLikesPerFollower);
  $("delayFollowersMin").value = String(state.delayBetweenFollowersMin / 1000);
  $("delayFollowersMax").value = String(state.delayBetweenFollowersMax / 1000);
  $("delayLikesMin").value = String(state.delayBetweenLikesMin / 1000);
  $("delayLikesMax").value = String(state.delayBetweenLikesMax / 1000);
  $("delayProfilesMin").value = String(state.delayBetweenProfilesMin / 1000);
  $("delayProfilesMax").value = String(state.delayBetweenProfilesMax / 1000);

  // Mode tabs
  $("modeFeed").classList.toggle("active", activeMode === "feed");
  $("modeFollowers").classList.toggle("active", activeMode === "followers");
  $("feedPanel").hidden = activeMode !== "feed";
  $("followersPanel").hidden = activeMode !== "followers";

  const line = status !== undefined ? status : describe();
  $("status").textContent = line;
}

function describe() {
  if (state.feedEnabled) return "Feed mode running in your Instagram tab";
  if (state.followersEnabled) return "Followers mode running in your Instagram tab";
  return state.likeCount > 0 ? "Stopped after " + state.likeCount + " likes" : "Idle";
}

function save(patch) {
  Object.assign(state, patch);
  state = normalize(state);
  chrome.storage.local.set({ [KEY]: state });
  render();
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

// Feed toggle
$("feedToggle").addEventListener("click", async () => {
  if (state.feedEnabled) {
    save({ feedEnabled: false, owner: "" });
    render("Feed: Stopped");
    return;
  }
  if (state.followersEnabled) { render("Stop Followers mode first"); return; }

  const tab = await instagramTab();
  if (!tab) { render("Open instagram.com in this tab first"); return; }
  if (state.likeCount >= state.feedMaxLikes) { render("Feed: Limit reached — raise max likes or reset"); return; }

  save({ feedEnabled: true, owner: "" });
  const ok = await ensureContentScript(tab.id);
  render(ok ? "Feed: Running in your Instagram tab" : "Reload the Instagram tab, then try again");
});

// Followers toggle
$("followersToggle").addEventListener("click", async () => {
  if (state.followersEnabled) {
    save({ followersEnabled: false, owner: "" });
    render("Followers: Stopped");
    return;
  }
  if (state.feedEnabled) { render("Stop Feed mode first"); return; }

  const targets = $("targets").value.split("\n").map(t => t.trim().replace(/^@/, "")).filter(Boolean);
  if (!targets.length) { render("Followers: Add at least one target profile"); return; }

  const tab = await instagramTab();
  if (!tab) { render("Open instagram.com in this tab first"); return; }

  save({ followersEnabled: true, owner: "", targets });
  const ok = await ensureContentScript(tab.id);
  render(ok ? "Followers: Running in your Instagram tab" : "Reload the Instagram tab, then try again");
});

// Feed inputs
$("feedMin").addEventListener("change", () => {
  const sec = clamp($("feedMin").value, 0.5, 120, state.feedMinDelay / 1000);
  save({ feedMinDelay: Math.round(sec * 1000) });
});
$("feedMax").addEventListener("change", () => {
  const sec = clamp($("feedMax").value, 0.5, 120, state.feedMaxDelay / 1000);
  save({ feedMaxDelay: Math.round(sec * 1000) });
});
$("feedLimit").addEventListener("change", () => {
  save({ feedMaxLikes: Math.round(clamp($("feedLimit").value, 1, 500, state.feedMaxLikes)) });
});
$("feedScroll").addEventListener("change", () => save({ feedAutoScroll: $("feedScroll").checked }));

// Followers inputs
$("targets").addEventListener("change", () => {
  const targets = $("targets").value.split("\n").map(t => t.trim().replace(/^@/, "")).filter(Boolean);
  save({ targets });
});
$("maxFollowers").addEventListener("change", () => save({ maxFollowersPerProfile: Math.round(clamp($("maxFollowers").value, 1, 500, state.maxFollowersPerProfile)) }));
$("maxLikesPerFollower").addEventListener("change", () => save({ maxLikesPerFollower: Math.round(clamp($("maxLikesPerFollower").value, 1, 50, state.maxLikesPerFollower)) }));
$("delayFollowersMin").addEventListener("change", () => save({ delayBetweenFollowersMin: Math.round(clamp($("delayFollowersMin").value, 1, 3600, state.delayBetweenFollowersMin / 1000)) * 1000 }));
$("delayFollowersMax").addEventListener("change", () => save({ delayBetweenFollowersMax: Math.round(clamp($("delayFollowersMax").value, 1, 3600, state.delayBetweenFollowersMax / 1000)) * 1000 }));
$("delayLikesMin").addEventListener("change", () => save({ delayBetweenLikesMin: Math.round(clamp($("delayLikesMin").value, 1, 3600, state.delayBetweenLikesMin / 1000)) * 1000 }));
$("delayLikesMax").addEventListener("change", () => save({ delayBetweenLikesMax: Math.round(clamp($("delayLikesMax").value, 1, 3600, state.delayBetweenLikesMax / 1000)) * 1000 }));
$("delayProfilesMin").addEventListener("change", () => save({ delayBetweenProfilesMin: Math.round(clamp($("delayProfilesMin").value, 1, 3600, state.delayBetweenProfilesMin / 1000)) * 1000 }));
$("delayProfilesMax").addEventListener("change", () => save({ delayBetweenProfilesMax: Math.round(clamp($("delayProfilesMax").value, 1, 3600, state.delayBetweenProfilesMax / 1000)) * 1000 }));

// Mode tabs
$("modeFeed").addEventListener("click", () => { activeMode = "feed"; render(); });
$("modeFollowers").addEventListener("click", () => { activeMode = "followers"; render(); });

// Reset
$("reset").addEventListener("click", () => {
  save({ likeCount: 0, likedCodes: [], feedEnabled: false, followersEnabled: false });
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