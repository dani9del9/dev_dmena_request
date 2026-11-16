let state;
let currentHost = "";

const $ = id => document.getElementById(id);

function ruleMatchesHost(rule, host) {
  if (!host) return false;
  const m = rule.match || {};
  if (m.type === "all") return true;
  if (m.type === "domain") {
    return m.value.split(/[\s,]+/).filter(Boolean).some(d => host === d || host.endsWith("." + d));
  }
  if (m.type === "url") return m.value.includes(host);
  return false;
}

function setStatus(res) {
  const el = $("status");
  if (!res) { el.textContent = ""; el.className = "status"; return; }
  if (res.ok) { el.textContent = `✓ ${res.count} regla(s) del navegador activas`; el.className = "status ok"; }
  else { el.textContent = "Error: " + res.error; el.className = "status err"; }
}

function render() {
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
    row.className = "rule" + (ruleMatchesHost(rule, currentHost) ? " match" : "");
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
  $("newHereBtn").addEventListener("click", () => openEditor(currentHost ? { newFor: currentHost } : { new: "1" }));
}

init();
