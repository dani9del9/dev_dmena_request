// dmena_request - fondo: cuenta las peticiones modificadas por pestaña y lo muestra en el icono.
// Chrome lo carga como service worker; Firefox como script de fondo (rules.js ya cargado).
if (typeof RT === "undefined") importScripts("rules.js");

let matchers = null;           // reglas compiladas
let globalEnabled = true;
let stats = null;              // { [tabId]: { total, rules: { ruleId: n } } }
const seen = new Map();        // tabId -> Set(requestId) para no contar dos veces una redirección
let persistTimer = null;

async function ensureLoaded() {
  if (!matchers) {
    const st = await RT.load();
    globalEnabled = st.enabled;
    matchers = RT.compileState(st);
  }
  if (!stats) {
    try { stats = (await chrome.storage.session.get("tabstats")).tabstats || {}; }
    catch { stats = {}; }
  }
}

function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try { chrome.storage.session.set({ tabstats: stats }); } catch {}
  }, 150);
}

// ---------- Icono dibujado: menta, menta + punto tomato, o gris (apagado) ----------
const ICON_SIZES = [16, 32];
const DOT_COLOR = "#ff6347"; // tomato
const iconCache = {};
const lastIcon = new Map(); // tabId -> variante aplicada (evita repintar sin necesidad)

async function drawIcon(variant) {
  if (iconCache[variant]) return iconCache[variant];
  const out = {};
  for (const size of ICON_SIZES) {
    const blob = await (await fetch(chrome.runtime.getURL(`icons/mint${size}.png`))).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(size, size);
    const ctx = c.getContext("2d");
    if (variant === "off") { ctx.filter = "grayscale(1)"; ctx.globalAlpha = 0.55; }
    ctx.drawImage(bmp, 0, 0, size, size);
    ctx.filter = "none"; ctx.globalAlpha = 1;
    if (variant === "dot") {
      const r = size * 0.2;
      const cx = size - r - size * 0.02, cy = r + size * 0.02;
      ctx.beginPath(); ctx.arc(cx, cy, r + size * 0.07, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff"; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = DOT_COLOR; ctx.fill();
    }
    out[size] = ctx.getImageData(0, 0, size, size);
  }
  return (iconCache[variant] = out);
}

function variantFor(tabId) {
  if (!globalEnabled) return "off";
  return stats?.[tabId]?.total ? "dot" : "base";
}

async function updateBadge(tabId, force = false) {
  if (tabId < 0) return;
  const v = variantFor(tabId);
  if (!force && lastIcon.get(tabId) === v) return;
  try {
    await chrome.action.setIcon({ tabId, imageData: await drawIcon(v) });
    await chrome.action.setBadgeText({ tabId, text: "" });
    lastIcon.set(tabId, v);
  } catch { /* la pestaña puede haberse cerrado */ }
}

async function updateGlobalBadge() {
  try {
    await chrome.action.setIcon({ imageData: await drawIcon(globalEnabled ? "base" : "off") });
    await chrome.action.setBadgeText({ text: "" });
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) updateBadge(t.id, true);
  } catch {}
}

function resetTab(tabId) {
  if (stats) delete stats[tabId];
  lastIcon.delete(tabId);
  seen.delete(tabId);
}

chrome.webRequest.onBeforeRequest.addListener(details => {
  const { tabId, type, url, requestId } = details;
  if (tabId < 0) return;
  (async () => {
    await ensureLoaded();
    // Nueva navegación en la pestaña: contador a cero.
    if (type === "main_frame") {
      const s = seen.get(tabId);
      if (!s || !s.has(requestId)) resetTab(tabId);
    }
    if (!globalEnabled || !matchers.length) { if (type === "main_frame") { persist(); updateBadge(tabId); } return; }
    const hits = matchers.filter(m => m.fn(url, type));
    if (!hits.length) { if (type === "main_frame") { persist(); updateBadge(tabId); } return; }

    let s = seen.get(tabId);
    if (!s) { s = new Set(); seen.set(tabId, s); }
    const isNew = !s.has(requestId);
    s.add(requestId);
    if (s.size > 5000) s.clear();

    const t = stats[tabId] || (stats[tabId] = { total: 0, rules: {} });
    if (isNew) t.total++;
    for (const h of hits) t.rules[h.id] = (t.rules[h.id] || 0) + (isNew ? 1 : 0);
    persist();
    updateBadge(tabId);
  })();
}, { urls: ["<all_urls>"] });

// Chrome borra el texto del icono al navegar: lo volvemos a poner.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status || info.url) { await ensureLoaded(); updateBadge(tabId, true); }
});

chrome.tabs.onRemoved.addListener(async tabId => {
  await ensureLoaded();
  resetTab(tabId);
  persist();
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && changes[RT.STORAGE_KEY]) {
    const st = await RT.load();
    const wasEnabled = globalEnabled;
    globalEnabled = st.enabled;
    matchers = RT.compileState(st);
    await ensureLoaded();
    if (wasEnabled !== globalEnabled) updateGlobalBadge();
  }
});

async function startup() {
  await ensureLoaded();
  updateGlobalBadge();
}
chrome.runtime.onStartup.addListener(startup);
startup();
chrome.runtime.onInstalled.addListener(startup);
