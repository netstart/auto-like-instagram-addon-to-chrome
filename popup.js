/* Auto-Like for Instagram - popup controller */
const KEY = "igAutoLike";
const DEFAULTS = {
  enabled: false,
  minDelay: 3000,
  maxDelay: 8000,
  maxLikes: 20,
  likeCount: 0,
  autoScroll: true,
  likedCodes: [],
  owner: "",
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
  s.minDelay = Math.round(clamp(s.minDelay, 300, 600000, DEFAULTS.minDelay));
  s.maxDelay = Math.round(clamp(s.maxDelay, s.minDelay, 900000, Math.max(s.minDelay, DEFAULTS.maxDelay)));
  s.maxLikes = Math.round(clamp(s.maxLikes, 1, 500, DEFAULTS.maxLikes));
  s.likeCount = Math.round(clamp(s.likeCount, 0, 100000, 0));
  s.autoScroll = Boolean(s.autoScroll);
  s.owner = typeof s.owner === "string" ? s.owner : "";
  s.likedCodes = Array.isArray(s.likedCodes) ? s.likedCodes.slice(-500) : [];
  return s;
}

function render(status) {
  $("count").textContent = state.likeCount + "/" + state.maxLikes;
  $("toggle").textContent = state.enabled ? "Stop" : "Start";
  $("toggle").classList.toggle("stop", state.enabled);
  $("dot").classList.toggle("on", state.enabled);
  $("min").value = (state.minDelay / 1000).toFixed(1);
  $("max").value = (state.maxDelay / 1000).toFixed(1);
  $("limit").value = String(state.maxLikes);
  $("scroll").checked = state.autoScroll;

  const line = status !== undefined ? status : describe();
  $("status").textContent = line;
}

function describe() {
  if (!state.enabled) {
    return state.likeCount > 0 ? "Stopped after " + state.likeCount + " likes" : "Idle";
  }
  return "Running in your Instagram tab";
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

$("toggle").addEventListener("click", async () => {
  if (state.enabled) {
    save({ enabled: false, owner: "" });
    render("Stopped");
    return;
  }

  const tab = await instagramTab();
  if (!tab) {
    render("Open instagram.com in this tab first");
    return;
  }
  if (state.likeCount >= state.maxLikes) {
    render("Limit reached — raise max likes or reset");
    return;
  }

  // Clear ownership so the active Instagram tab claims the run.
  save({ enabled: true, owner: "" });
  const ok = await ensureContentScript(tab.id);
  render(ok ? "Running in your Instagram tab" : "Reload the Instagram tab, then try again");
});

$("min").addEventListener("change", () => {
  const sec = clamp($("min").value, 0.5, 120, state.minDelay / 1000);
  save({ minDelay: Math.round(sec * 1000) });
});

$("max").addEventListener("change", () => {
  const sec = clamp($("max").value, 0.5, 120, state.maxDelay / 1000);
  save({ maxDelay: Math.round(sec * 1000) });
});

$("limit").addEventListener("change", () => {
  save({ maxLikes: Math.round(clamp($("limit").value, 1, 500, state.maxLikes)) });
});

$("scroll").addEventListener("change", () => save({ autoScroll: $("scroll").checked }));

$("reset").addEventListener("click", () => {
  save({ likeCount: 0, likedCodes: [] });
  render("Counter reset");
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[KEY]) return;
  state = normalize(changes[KEY].newValue);
  render();
});

chrome.storage.local.get(KEY, (res) => {
  state = normalize(res[KEY]);
  render();
});
