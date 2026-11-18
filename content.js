/* Auto-Like for Instagram - content script
 * Finds "Like" buttons in the feed and clicks them one at a time,
 * spaced by a random human-like delay, until the configured limit.
 */
(() => {
  "use strict";
  if (window.__igalLoaded) return;
  window.__igalLoaded = true;

  const KEY = "igAutoLike";
  const TAB_ID = "tab_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const MAX_TRACKED_POSTS = 500;
  const MAX_SCROLLS = 40;
  const MIN_BUTTON_PX = 18; // post like icons are ~24px; comment like icons are ~12px

  // Test seam: tests/harness.html sets window.__igalTestMode to exercise the loop off-site.
  const isInstagramHost = () =>
    /^https?:\/\/(www\.)?instagram\.com\//.test(location.href) || window.__igalTestMode === true;

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

  let state = { ...DEFAULTS };
  let timer = null;
  let running = false;
  let scrolls = 0;
  let clicked = new Set();
  let statusText = "Idle";

  /* ---------------------------------------------------------------- state */

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
    s.likedCodes = Array.isArray(s.likedCodes)
      ? s.likedCodes.filter((c) => typeof c === "string").slice(-MAX_TRACKED_POSTS)
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

  /* ------------------------------------------------------------- main loop */

  const randInt = (lo, hi) => Math.round(lo + Math.random() * Math.max(0, hi - lo));

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(step, Math.max(50, ms));
  }

  function claimAndStart() {
    if (state.owner && state.owner !== TAB_ID) {
      setStatus("Running in another tab");
      return;
    }
    state.owner = TAB_ID;
    state.enabled = true;
    save();
    running = true;
    scrolls = 0;
    setStatus("Running...");
    paint();
    schedule(700);
  }

  function stop(message) {
    running = false;
    clearTimeout(timer);
    timer = null;
    if (state.owner === TAB_ID) state.owner = "";
    state.enabled = false;
    save();
    setStatus(message || "Stopped");
    paint();
  }

  function step() {
    timer = null;
    if (!running) return;
    if (!isInstagramHost()) {
      return stop("Not on instagram.com");
    }
    if (state.likeCount >= state.maxLikes) {
      return stop("Finished - " + state.likeCount + " likes");
    }

    const active = document.activeElement;
    if (active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable)) {
      setStatus("Waiting while you type");
      return schedule(1500);
    }

    const button = pickLikeButton();
    if (!button) {
      if (state.autoScroll && scrolls < MAX_SCROLLS) {
        scrolls += 1;
        scrollFeed();
        setStatus("Scrolling for posts...");
      } else {
        setStatus("No unliked posts in view");
      }
      return schedule(randInt(1200, 2600));
    }

    doLike(button);
    schedule(randInt(state.minDelay, state.maxDelay));
  }

  /* ------------------------------------------------------------- dom utils */

  function postCode(el) {
    const scope = el.closest("article");
    if (!scope) return null;
    const link = scope.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]');
    if (!link) return null;
    const match = (link.getAttribute("href") || "").match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
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
    return Boolean(svg.closest("article"));
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
      return;
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
    setStatus("Liked " + state.likeCount + " of " + state.maxLikes);
    paint();
    save();
  }

  function scrollFeed() {
    if (document.querySelector('div[role="dialog"]')) return; // post modal: don't jump the page behind it
    window.scrollBy({ top: Math.round(window.innerHeight * 0.8), left: 0, behavior: "smooth" });
  }

  /* -------------------------------------------------------------- the panel */

  const CSS = `
    :host { all: initial; }
    .card {
      width: 246px; background: #15171b; color: #e9edf3;
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
      width: 52px; padding: 5px 6px; border-radius: 7px; text-align: right;
      border: 1px solid rgba(255,255,255,.13); background: #1d2026; color: #e9edf3;
      font: inherit; font-variant-numeric: tabular-nums;
    }
    input[type="number"]:focus { outline: 1px solid #3b82f6; }
    input[type="checkbox"] { width: 15px; height: 15px; accent-color: #3b82f6; cursor: pointer; }
    .foot { display: flex; justify-content: space-between; align-items: center; color: #6f7885; font-size: 11px; }
    .link {
      background: none; border: 0; padding: 0; color: #7f8b9c;
      font: inherit; font-size: 11px; cursor: pointer; text-decoration: underline;
    }
    .link:hover { color: #b7c1cd; }
  `;

  const root = document.createElement("div");
  root.id = "igal-host";
  root.style.cssText =
    "position:fixed;top:12px;right:12px;z-index:2147483647;";
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
        <button class="primary" id="toggle" type="button">Start</button>
        <div class="row">
          <label for="min">Min delay</label>
          <span class="value"><input id="min" type="number" min="0.5" max="120" step="0.5"> s</span>
        </div>
        <div class="row">
          <label for="max">Max delay</label>
          <span class="value"><input id="max" type="number" min="0.5" max="120" step="0.5"> s</span>
        </div>
        <div class="row">
          <label for="limit">Max likes</label>
          <span class="value"><input id="limit" type="number" min="1" max="500" step="1"></span>
        </div>
        <div class="row">
          <label for="scroll">Auto-scroll feed</label>
          <input id="scroll" type="checkbox">
        </div>
        <div class="foot">
          <span id="hint">Human-paced, one at a time</span>
          <button class="link" id="reset" type="button">Reset</button>
        </div>
      </div>
    </div>
  `;

  const el = {};
  for (const id of ["head", "body", "chev", "dot", "count", "status", "toggle", "min", "max", "limit", "scroll", "reset"]) {
    el[id] = shadow.getElementById(id);
  }

  let collapsed = false;

  function setStatus(text) {
    statusText = text;
    if (el.status) el.status.textContent = text;
  }

  function paint() {
    el.count.textContent = state.likeCount + "/" + state.maxLikes;
    el.toggle.textContent = running ? "Stop" : "Start";
    el.toggle.classList.toggle("stop", running);
    el.dot.classList.toggle("on", running);
    el.status.textContent = statusText;
    if (shadow.activeElement !== el.min) el.min.value = (state.minDelay / 1000).toFixed(1);
    if (shadow.activeElement !== el.max) el.max.value = (state.maxDelay / 1000).toFixed(1);
    if (shadow.activeElement !== el.limit) el.limit.value = String(state.maxLikes);
    el.scroll.checked = state.autoScroll;
  }

  // Drag the panel by its header; a plain click (no movement) still collapses it.
  let drag = null;
  let dragged = false;

  el.head.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = root.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    dragged = false;
    try {
      el.head.setPointerCapture(event.pointerId);
    } catch {}
  });

  el.head.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!dragged && Math.abs(dx) + Math.abs(dy) < 5) return;
    dragged = true;
    const width = root.offsetWidth;
    const height = root.offsetHeight;
    const left = Math.min(Math.max(0, drag.left + dx), Math.max(0, window.innerWidth - width));
    const top = Math.min(Math.max(0, drag.top + dy), Math.max(0, window.innerHeight - height));
    root.style.left = left + "px";
    root.style.top = top + "px";
    root.style.right = "auto";
  });

  const endDrag = (event) => {
    if (!drag) return;
    drag = null;
    try {
      el.head.releasePointerCapture(event.pointerId);
    } catch {}
  };
  el.head.addEventListener("pointerup", endDrag);
  el.head.addEventListener("pointercancel", endDrag);

  el.head.addEventListener("click", () => {
    if (dragged) {
      dragged = false;
      return;
    }
    collapsed = !collapsed;
    el.body.hidden = collapsed;
    el.chev.innerHTML = collapsed ? "&#9656;" : "&#9662;";
  });

  el.toggle.addEventListener("click", () => {
    if (running) {
      stop("Stopped");
      return;
    }
    if (!isInstagramHost()) {
      setStatus("Open instagram.com first");
      return;
    }
    if (state.likeCount >= state.maxLikes) {
      setStatus("Limit reached - raise max or reset");
      return;
    }
    claimAndStart();
  });

  function commit(patch) {
    Object.assign(state, patch);
    state = normalize(state);
    paint();
    save();
  }

  el.min.addEventListener("change", () => {
    const sec = clamp(el.min.value, 0.5, 120, state.minDelay / 1000);
    commit({ minDelay: Math.round(sec * 1000) });
  });
  el.max.addEventListener("change", () => {
    const sec = clamp(el.max.value, 0.5, 120, state.maxDelay / 1000);
    commit({ maxDelay: Math.round(sec * 1000) });
  });
  el.limit.addEventListener("change", () => {
    commit({ maxLikes: Math.round(clamp(el.limit.value, 1, 500, state.maxLikes)) });
  });
  el.scroll.addEventListener("change", () => commit({ autoScroll: el.scroll.checked }));

  el.reset.addEventListener("click", () => {
    clicked = new Set();
    commit({ likeCount: 0, likedCodes: [] });
    setStatus(running ? "Counter reset" : "Idle");
  });

  function mount() {
    if (!document.body) return;
    if (document.getElementById("igal-host")) return;
    document.body.appendChild(root);
    paint();
  }

  /* ------------------------------------------------------------- bootstrap */

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[KEY]) return;

    state = normalize(changes[KEY].newValue);
    clicked = new Set(state.likedCodes);

    if (state.enabled && (!state.owner || state.owner === TAB_ID)) {
      if (!running) claimAndStart();
    } else if (running) {
      // Disabled from the popup, or another tab took over the run.
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
