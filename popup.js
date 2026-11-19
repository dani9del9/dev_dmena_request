let state;
let currentHost = "";

const $ = id => document.getElementById(id);

let tabStats = { total: 0, rules: {} };

async function loadTabStats(tabId) {
  try {
    const all = (await chrome.storage.session.get("tabstats")).tabstats || {};
    tabStats = all[tabId] || { total: 0, rules: {} };
  } catch {}
}

function renderSummary() {
  const box = $("pageSummary");
  const n = tabStats.total || 0;
  if (!state.enabled) { box.textContent = "dmena_request está desactivado"; box.className = "page-summary off"; return; }
  box.className = "page-summary" + (n ? " active" : "");
  box.textContent = n
    ? `⚡ ${n} petición${n === 1 ? "" : "es"} modificada${n === 1 ? "" : "s"} en esta pestaña`
    : "Ninguna regla ha actuado en esta pestaña";
}

function setStatus(res) {
  const el = $("status");
  if (!res) { el.textContent = ""; el.className = "status"; return; }
  if (res.ok && res.msg) { el.textContent = res.msg; el.className = "status ok"; return; }
  if (res.ok) { el.textContent = `✓ ${res.count} regla(s) del navegador activas`; el.className = "status ok"; }
  else { el.textContent = "Error: " + res.error; el.className = "status err"; }
}

function render() {
  renderSummary();
  $("globalToggle").checked = state.enabled;
  document.body.classList.toggle("global-off", !state.enabled);
  const list = $("list");
  list.innerHTML = "";
  if (!state.rules.length) {
    list.innerHTML = `<div class="empty">No hay reglas todavía.<br>Crea una con el editor.</div>`;
    return;
  }
  for (const rule of state.rules) {
    const row = document.createElement("div");
    const hits = tabStats.rules?.[rule.id] || 0;
    const kinds = RT.ruleKinds(rule);
    row.className = "rule kind-bar-" + (kinds[0] || "none") + (hits && state.enabled && rule.enabled ? " match" : "");
    row.title = "Editar regla";
    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = rule.name || "(sin nombre)";
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = `${RT.describeMatch(rule)} — ${RT.summarize(rule)}`;
    info.append(name, sub);
    if (hits && state.enabled && rule.enabled) {
      name.append(Object.assign(document.createElement("span"), { className: "hits", textContent: hits, title: "Peticiones modificadas por esta regla en esta pestaña" }));
    }

    const sw = document.createElement("label");
    sw.className = "switch";
    sw.innerHTML = `<input type="checkbox"><span></span>`;
    const cb = sw.querySelector("input");
    cb.checked = rule.enabled;
    sw.addEventListener("click", e => e.stopPropagation());
    cb.addEventListener("change", async () => {
      rule.enabled = cb.checked;
      setStatus(await RT.saveAndApply(state));
    });

    row.append(info, sw);
    row.addEventListener("click", () => openEditor({ rule: rule.id }));
    list.append(row);
  }
}

function openEditor(params = {}) {
  const qs = new URLSearchParams(params).toString();
  chrome.tabs.create({ url: chrome.runtime.getURL("options.html" + (qs ? "?" + qs : "")) });
  window.close();
}

async function init() {
  state = await RT.load();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /^https?:/.test(tab.url)) currentHost = new URL(tab.url).hostname;
    if (tab) await loadTabStats(tab.id);
  } catch {}
  render();

  if (!(await RT.hasHostPermission())) $("permBanner").classList.remove("hidden");
  $("grantBtn").addEventListener("click", async () => {
    if (await RT.requestHostPermission()) {
      $("permBanner").classList.add("hidden");
      setStatus(await RT.apply(state));
    }
  });

  $("globalToggle").addEventListener("change", async e => {
    state.enabled = e.target.checked;
    render();
    setStatus(await RT.saveAndApply(state));
  });

  $("openEditorBtn").addEventListener("click", () => openEditor());

  // Exportar / importar
  $("exportBtn").addEventListener("click", () => {
    RT.downloadJson(state);
    setStatus({ ok: true, msg: `⬇ Exportadas ${state.rules.length} regla(s)` });
  });
  // En Firefox el popup se cierra al abrir el selector de ficheros: se importa desde el editor.
  const isFirefox = navigator.userAgent.includes("Firefox");
  $("importBtn").addEventListener("click", () => isFirefox ? openEditor({ import: "1" }) : $("importFile").click());
  let pending = null;
  const finishImport = async replace => {
    if (!pending) return;
    if (replace) {
      const now = Date.now();
      state.trash = [...state.rules.map((rule, index) => ({ rule, deletedAt: now, index })), ...(state.trash || [])];
    }
    state.rules = replace ? pending : [...state.rules, ...pending];
    const n = pending.length;
    pending = null;
    $("importAsk").classList.add("hidden");
    render();
    const res = await RT.saveAndApply(state);
    setStatus(res.ok ? { ok: true, msg: `⬆ Importadas ${n} regla(s)` } : res);
  };
  $("importFile").addEventListener("change", async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      pending = RT.parseImport(await f.text());
      if (!pending.length) throw new Error("El fichero no tiene reglas.");
      if (!state.rules.length) return finishImport(true);
      $("importAskText").textContent = `${pending.length} regla(s) en «${f.name}». ¿Reemplazar las ${state.rules.length} actuales (irán a la papelera) o añadirlas?`;
      $("importAsk").classList.remove("hidden");
    } catch (err) {
      pending = null;
      setStatus({ ok: false, error: err.message });
    }
  });
  $("impReplace").addEventListener("click", () => finishImport(true));
  $("impAppend").addEventListener("click", () => finishImport(false));
  $("impCancel").addEventListener("click", () => { pending = null; $("importAsk").classList.add("hidden"); });
  $("newHereBtn").addEventListener("click", () => openEditor(currentHost ? { newFor: currentHost } : { new: "1" }));
}

init();
