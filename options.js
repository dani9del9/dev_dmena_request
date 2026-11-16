let state;
let selectedId = null;
let lastFailed = [];
let saveTimer = null;

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) e.append(c);
  return e;
};

const MATCH_HELP = {
  all: "Se aplica a cualquier petición.",
  domain: "Uno o varios dominios separados por coma. Incluye subdominios. Ej: <code>api.miweb.com, localhost</code>",
  url: "Texto que debe contener la URL. Comodín <code>*</code>, <code>|</code> ancla inicio/fin, <code>||</code> dominio. Ej: <code>||miweb.com/api/*</code> o <code>/graphql</code>",
  regex: "Expresión regular RE2 sobre la URL completa. Ej: <code>^https://(dev|pre)\\.miweb\\.com/.*</code>"
};
const MATCH_PH = { all: "", domain: "miweb.com, api.miweb.com", url: "||miweb.com/api/*", regex: "^https://.*\\.miweb\\.com/.*" };

const current = () => state.rules.find(r => r.id === selectedId);

// ---------------- Guardado ----------------
function setStatus(res) {
  const s = $("status");
  if (res === "saving") { s.textContent = "Guardando…"; s.className = "status"; return; }
  if (res.ok) { s.textContent = `✓ Guardado y aplicado — ${res.count} regla(s) del navegador activas${state.enabled ? "" : " (dmena_request desactivado)"}`; s.className = "status ok"; }
  else { s.textContent = "⚠ " + res.error; s.className = "status err"; }
}

function scheduleSave() {
  setStatus("saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 350);
}

async function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const res = await RT.saveAndApply(state);
  lastFailed = res.failed || [];
  setStatus(res);
  renderList();
  await renderErrors();
  renderPreview();
}

// ---------------- Lista lateral ----------------
function renderList() {
  $("globalToggle").checked = state.enabled;
  const list = $("ruleList");
  list.innerHTML = "";
  state.rules.forEach((rule, i) => {
    const hasErr = RT.validateRule(rule).length > 0 || lastFailed.includes(rule.id);
    const item = el("div", {
      className: "rule-item" + (rule.id === selectedId ? " active" : "") + (rule.enabled ? "" : " disabled") + (hasErr ? " has-error" : "")
    });
    const sw = el("label", { className: "switch", title: "Activar / desactivar" });
    const cb = el("input", { type: "checkbox", checked: rule.enabled });
    sw.append(cb, el("span"));
    sw.addEventListener("click", e => e.stopPropagation());
    cb.addEventListener("change", () => {
      rule.enabled = cb.checked;
      if (rule.id === selectedId) $("ruleEnabled").checked = cb.checked;
      scheduleSave();
    });
    const info = el("div", { className: "ri-info" },
      el("div", { className: "ri-name", textContent: rule.name || "(sin nombre)" }),
      el("div", { className: "ri-sub", textContent: `${RT.describeMatch(rule)} — ${RT.summarize(rule)}` })
    );
    const up = el("button", { type: "button", textContent: "▲", title: "Subir (más prioridad)", disabled: i === 0 });
    const down = el("button", { type: "button", textContent: "▼", title: "Bajar", disabled: i === state.rules.length - 1 });
    up.addEventListener("click", e => { e.stopPropagation(); move(i, -1); });
    down.addEventListener("click", e => { e.stopPropagation(); move(i, 1); });
    item.append(sw, info, el("div", { className: "ri-move" }, up, down));
    item.addEventListener("click", () => select(rule.id));
    list.append(item);
  });
  if (!state.rules.length) list.append(el("p", { className: "muted small", textContent: "No hay reglas." }));
}

function move(i, dir) {
  const j = i + dir;
  [state.rules[i], state.rules[j]] = [state.rules[j], state.rules[i]];
  scheduleSave();
  renderList();
}

function select(id) {
  selectedId = id;
  const url = new URL(location.href);
  url.search = id ? "?rule=" + id : "";
  history.replaceState(null, "", url);
  renderList();
  renderEditor();
}

// ---------------- Editor ----------------
function renderEditor() {
  const rule = current();
  $("editor").classList.toggle("hidden", !rule);
  $("emptyState").classList.toggle("hidden", !!rule);
  if (!rule) return;
  $("ruleName").value = rule.name;
  $("ruleEnabled").checked = rule.enabled;
  $("matchType").value = rule.match.type;
  $("matchValue").value = rule.match.value || "";
  updateMatchUi();
  renderTypes();
  renderHeaderList("reqHeaders", rule.requestHeaders, ["set", "remove"], "reqHeaderNames");
  renderHeaderList("resHeaders", rule.responseHeaders, ["set", "append", "remove"], "resHeaderNames");
  renderParams();
  renderErrors();
  renderPreview();
}

function updateMatchUi() {
  const t = $("matchType").value;
  $("matchValue").classList.toggle("hidden", t === "all");
  $("matchValue").placeholder = MATCH_PH[t];
  $("matchHelp").innerHTML = MATCH_HELP[t];
}

function renderTypes() {
  const rule = current();
  const box = $("typesBox");
  box.innerHTML = "";
  for (const t of RT.RESOURCE_TYPES) {
    const cb = el("input", { type: "checkbox", checked: rule.match.resourceTypes.includes(t.id) });
    cb.addEventListener("change", () => {
      const set = new Set(rule.match.resourceTypes);
      cb.checked ? set.add(t.id) : set.delete(t.id);
      rule.match.resourceTypes = RT.ALL_TYPES.filter(x => set.has(x));
      updateTypesSummary();
      scheduleSave();
    });
    box.append(el("label", {}, cb, t.label));
  }
  updateTypesSummary();
}

function updateTypesSummary() {
  const rt = current().match.resourceTypes;
  $("typesSummary").textContent = rt.length
    ? RT.RESOURCE_TYPES.filter(t => rt.includes(t.id)).map(t => t.label).join(", ")
    : "todos";
}

const OP_LABELS = { set: "Poner", append: "Agregar", remove: "Quitar", add: "Añadir" };

function toggleCell(item, onChange) {
  const sw = el("label", { className: "switch", title: "Activar / desactivar esta línea" });
  const cb = el("input", { type: "checkbox", checked: item.enabled !== false });
  cb.addEventListener("change", () => { item.enabled = cb.checked; onChange(); });
  sw.append(cb, el("span"));
  return el("div", { className: "on" }, sw);
}

function renderHeaderList(containerId, list, ops, datalistId) {
  const box = $(containerId);
  box.innerHTML = "";
  list.forEach((h, idx) => {
    const op = el("select");
    ops.forEach(o => op.append(el("option", { value: o, textContent: OP_LABELS[o] })));
    op.value = h.op || "set";
    const name = el("input", { type: "text", className: "mono", placeholder: "Nombre de cabecera", value: h.name || "" });
    name.setAttribute("list", datalistId);
    const value = el("input", { type: "text", className: "mono", placeholder: "Valor", value: h.value || "", disabled: h.op === "remove" });
    const del = el("button", { type: "button", className: "icon danger", textContent: "✕", title: "Eliminar" });
    op.addEventListener("change", () => { h.op = op.value; value.disabled = h.op === "remove"; scheduleSave(); });
    name.addEventListener("input", () => { h.name = name.value; scheduleSave(); });
    value.addEventListener("input", () => { h.value = value.value; scheduleSave(); });
    del.addEventListener("click", () => { list.splice(idx, 1); renderHeaderList(containerId, list, ops, datalistId); scheduleSave(); });
    box.append(el("div", { className: "kv" }, toggleCell(h, scheduleSave), op, name, value, del));
  });
}

function renderParams() {
  const rule = current();
  const box = $("params");
  box.innerHTML = "";
  rule.queryParams.forEach((p, idx) => {
    const op = el("select");
    ["add", "remove"].forEach(o => op.append(el("option", { value: o, textContent: OP_LABELS[o] })));
    op.value = p.op || "add";
    const key = el("input", { type: "text", className: "mono", placeholder: "parametro", value: p.key || "" });
    const value = el("input", { type: "text", className: "mono", placeholder: "valor", value: p.value || "" });
    const only = el("input", { type: "checkbox", checked: !!p.replaceOnly });
    const onlyLbl = el("label", { className: "opt", title: "Solo reemplaza si el parámetro ya existe en la URL" }, only, "solo si existe");
    const valCell = el("div", { className: "row" }, value, onlyLbl);
    const sync = () => { const rem = p.op === "remove"; value.disabled = rem; onlyLbl.classList.toggle("hidden", rem); };
    sync();
    const del = el("button", { type: "button", className: "icon danger", textContent: "✕", title: "Eliminar" });
    op.addEventListener("change", () => { p.op = op.value; sync(); scheduleSave(); });
    key.addEventListener("input", () => { p.key = key.value; scheduleSave(); });
    value.addEventListener("input", () => { p.value = value.value; scheduleSave(); });
    only.addEventListener("change", () => { p.replaceOnly = only.checked; scheduleSave(); });
    del.addEventListener("click", () => { rule.queryParams.splice(idx, 1); renderParams(); scheduleSave(); });
    box.append(el("div", { className: "kv param" }, toggleCell(p, scheduleSave), op, key, valCell, del));
  });
}

async function renderErrors() {
  const rule = current();
  const box = $("ruleErrors");
  if (!rule) return;
  const errs = RT.validateRule(rule);
  if (rule.match.type === "regex" && rule.match.value) {
    const e = await RT.checkRegex(rule.match.value);
    if (e) errs.push(e);
  }
  box.innerHTML = "";
  errs.forEach(e => box.append(el("div", { textContent: "• " + e })));
  box.classList.toggle("hidden", !errs.length);
}

function renderPreview() {
  const rule = current();
  if (!rule) return;
  const dnr = RT.toDnrRules({ enabled: true, rules: [{ ...rule, enabled: true }] });
  $("dnrPreview").textContent = dnr.length ? JSON.stringify(dnr, null, 2) : "(esta regla no genera nada todavía)";
}

// ---------------- Acciones ----------------
function addRule(partial) {
  const rule = RT.newRule(partial);
  state.rules.unshift(rule);
  select(rule.id);
  scheduleSave();
  $("ruleName").focus();
  $("ruleName").select();
}

function applyPreset(selectEl, list, containerId, ops, datalistId) {
  const v = selectEl.value;
  selectEl.value = "";
  if (!v) return;
  if (v === "__cors") {
    list.push(
      { enabled: true, op: "set", name: "Access-Control-Allow-Origin", value: "*" },
      { enabled: true, op: "set", name: "Access-Control-Allow-Methods", value: "GET, POST, PUT, PATCH, DELETE, OPTIONS" },
      { enabled: true, op: "set", name: "Access-Control-Allow-Headers", value: "*" },
      { enabled: true, op: "set", name: "Access-Control-Expose-Headers", value: "*" }
    );
  } else if (v === "__removecsp") {
    list.push(
      { enabled: true, op: "remove", name: "Content-Security-Policy", value: "" },
      { enabled: true, op: "remove", name: "X-Frame-Options", value: "" }
    );
  } else {
    const [name, value] = v.split("|");
    list.push({ enabled: true, op: "set", name, value });
  }
  renderHeaderList(containerId, list, ops, datalistId);
  scheduleSave();
}

function exportRules() {
  const blob = new Blob([JSON.stringify({ app: "dmena_request", version: 1, ...state }, null, 2)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `dmena_request-reglas-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

async function importRules(file) {
  try {
    const data = JSON.parse(await file.text());
    const rules = Array.isArray(data) ? data : data.rules;
    if (!Array.isArray(rules)) throw new Error("El archivo no contiene una lista de reglas.");
    const replace = confirm(`Se van a importar ${rules.length} regla(s).\n\nAceptar = reemplazar las actuales\nCancelar = añadirlas a las actuales`);
    const imported = rules.map(r => RT.normalizeRule({ ...r, id: RT.uid() }));
    state.rules = replace ? imported : [...state.rules, ...imported];
    selectedId = state.rules[0]?.id || null;
    renderList();
    renderEditor();
    await saveNow();
  } catch (e) {
    setStatus({ ok: false, error: "Error al importar: " + e.message });
  }
}

// ---------------- Init ----------------
async function init() {
  state = await RT.load();

  $("editor").addEventListener("submit", e => e.preventDefault());
  $("globalToggle").addEventListener("change", e => { state.enabled = e.target.checked; scheduleSave(); });
  $("addRuleBtn").addEventListener("click", () => addRule());
  $("ruleName").addEventListener("input", e => { current().name = e.target.value; scheduleSave(); });
  $("ruleEnabled").addEventListener("change", e => { current().enabled = e.target.checked; scheduleSave(); });
  $("matchType").addEventListener("change", e => { current().match.type = e.target.value; updateMatchUi(); scheduleSave(); });
  $("matchValue").addEventListener("input", e => { current().match.value = e.target.value; scheduleSave(); });

  $("addReqHeader").addEventListener("click", () => {
    current().requestHeaders.push({ enabled: true, op: "set", name: "", value: "" });
    renderHeaderList("reqHeaders", current().requestHeaders, ["set", "remove"], "reqHeaderNames");
    $("reqHeaders").lastElementChild?.querySelector("input[type=text]")?.focus();
  });
  $("addResHeader").addEventListener("click", () => {
    current().responseHeaders.push({ enabled: true, op: "set", name: "", value: "" });
    renderHeaderList("resHeaders", current().responseHeaders, ["set", "append", "remove"], "resHeaderNames");
    $("resHeaders").lastElementChild?.querySelector("input[type=text]")?.focus();
  });
  $("reqPreset").addEventListener("change", e => applyPreset(e.target, current().requestHeaders, "reqHeaders", ["set", "remove"], "reqHeaderNames"));
  $("resPreset").addEventListener("change", e => applyPreset(e.target, current().responseHeaders, "resHeaders", ["set", "append", "remove"], "resHeaderNames"));
  $("addParam").addEventListener("click", () => {
    current().queryParams.push({ enabled: true, op: "add", key: "", value: "" });
    renderParams();
    $("params").lastElementChild?.querySelector("input[type=text]")?.focus();
  });
  $("addRemoveParam").addEventListener("click", () => {
    current().queryParams.push({ enabled: true, op: "remove", key: "", value: "" });
    renderParams();
    $("params").lastElementChild?.querySelector("input[type=text]")?.focus();
  });

  $("dupRuleBtn").addEventListener("click", () => {
    const copy = RT.normalizeRule(JSON.parse(JSON.stringify(current())));
    copy.id = RT.uid();
    copy.name += " (copia)";
    const idx = state.rules.findIndex(r => r.id === selectedId);
    state.rules.splice(idx + 1, 0, copy);
    select(copy.id);
    scheduleSave();
  });
  $("delRuleBtn").addEventListener("click", () => {
    const rule = current();
    if (!confirm(`¿Eliminar la regla "${rule.name}"?`)) return;
    const idx = state.rules.indexOf(rule);
    state.rules.splice(idx, 1);
    select(state.rules[Math.min(idx, state.rules.length - 1)]?.id || null);
    scheduleSave();
  });

  $("exportBtn").addEventListener("click", exportRules);
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", e => { const f = e.target.files[0]; if (f) importRules(f); e.target.value = ""; });

  // Permisos (Firefox pide al usuario conceder acceso a los sitios)
  const checkPerm = async () => $("permBanner").classList.toggle("hidden", await RT.hasHostPermission());
  $("grantBtn").addEventListener("click", async () => { await RT.requestHostPermission(); await checkPerm(); saveNow(); });
  checkPerm();

  // Sincroniza si se cambia algo desde el popup
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !changes.reqtweak_state || saveTimer) return;
    const fresh = await RT.load();
    if (JSON.stringify(fresh) === JSON.stringify(state)) return;
    state = fresh;
    if (!current()) selectedId = state.rules[0]?.id || null;
    renderList();
    renderEditor();
  });

  const params = new URLSearchParams(location.search);
  if (params.get("newFor")) {
    const host = params.get("newFor").replace(/^www\./, "");
    addRule({ name: host, match: { type: "domain", value: host, resourceTypes: [] } });
  } else if (params.get("new")) {
    addRule();
  } else {
    select(state.rules.find(r => r.id === params.get("rule"))?.id || state.rules[0]?.id || null);
  }
  const res = await RT.apply(state);
  lastFailed = res.failed || [];
  setStatus(res);
  renderList();
}

init();
