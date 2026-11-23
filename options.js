let state;
let selectedId = null;
let lastFailed = [];
let saveTimer = null;
const autoNamed = new Set(); // reglas cuyo nombre se genera solo desde la URL

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

let viewTrashId = null; // regla de la papelera que se está viendo (solo lectura)
const current = () => viewTrashId
  ? state.trash.find(t => t.rule.id === viewTrashId)?.rule
  : state.rules.find(r => r.id === selectedId);

// ---------------- Guardado ----------------
function setStatus(res) {
  const s = $("status");
  if (res === "saving") { s.textContent = "Guardando…"; s.className = "status"; return; }
  if (res.ok && res.msg) { s.textContent = res.msg; s.className = "status ok"; return; }
  if (res.ok) { s.textContent = `✓ Guardado y aplicado — ${res.count} regla(s) del navegador activas${res.scripts ? ` · ${res.scripts} script(s) de inyección` : ""}${state.enabled ? "" : " (dmena_request desactivado)"}`; s.className = "status ok"; }
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
  setStatus(res.ok && pendingMsg ? { ...res, msg: pendingMsg } : res);
  pendingMsg = null;
  renderList();
  await renderErrors();
  renderPreview();
}

// ---------------- Lista lateral ----------------
function renderList() {
  $("globalToggle").checked = state.enabled;
  const list = $("ruleList");
  const hiddenList = $("hiddenList");
  list.innerHTML = "";
  hiddenList.innerHTML = "";
  state.rules.forEach((rule, i) => {
    const hasErr = RT.validateRule(rule).length > 0 || lastFailed.includes(rule.id);
    const kinds = RT.ruleKinds(rule);
    const item = el("div", {
      className: "rule-item kind-bar-" + (kinds[0] || "none") + (rule.id === selectedId ? " active" : "") + (rule.enabled ? "" : " disabled") + (hasErr ? " has-error" : "")
    });
    const sw = el("label", { className: "switch", title: "Activar / desactivar" });
    const cb = el("input", { type: "checkbox", checked: rule.enabled });
    sw.append(cb, el("span"));
    sw.addEventListener("click", e => e.stopPropagation());
    cb.addEventListener("change", () => toggleRule(rule, cb.checked));
    const info = el("div", { className: "ri-info" },
      el("div", { className: "ri-name", textContent: rule.name || "(sin nombre)" }),
      el("div", { className: "ri-sub", textContent: `${RT.describeMatch(rule)} — ${RT.summarize(rule)}` }),
      kindChips(kinds, RT.relatedOf(state, rule))
    );
    const grip = el("div", { className: "ri-grip", textContent: "⋮⋮", title: "Arrastra para cambiar el orden (arriba = más prioridad)" });
    const eye = el("button", { type: "button", className: "eye-btn" + (rule.hidden ? " is-hidden" : ""),
      title: rule.hidden ? "Mostrar en el popup" : "Ocultar en el popup" });
    eye.innerHTML = rule.hidden ? RT.EYE_OFF : RT.EYE_OPEN;
    eye.addEventListener("click", e => { e.stopPropagation(); setHidden(rule, !rule.hidden); });
    item.append(grip, sw, info, eye);
    item.addEventListener("click", () => select(rule.id));
    makeDraggable(item, rule.id);
    (rule.hidden ? hiddenList : list).append(item);
  });
  const nHidden = state.rules.filter(r => r.hidden).length;
  if (state.rules.length === nHidden) list.append(el("p", { className: "muted small", textContent: nHidden ? "Todas las reglas están ocultas." : "No hay reglas." }));
  $("hiddenCount").textContent = nHidden;
  $("hiddenBox").classList.toggle("hidden", !nHidden);
  updateHideBtn();
  renderTrash();
}

// ---------------- Ocultar ----------------
function setHidden(rule, hidden) {
  rule.hidden = !!hidden;
  if (hidden) $("hiddenBox").open = true;
  pendingMsg = hidden ? `🙈 «${rule.name}» oculta en el popup (sigue funcionando si está activa)` : `👁 «${rule.name}» vuelve a verse en el popup`;
  renderList();
  scheduleSave();
}

function updateHideBtn() {
  const btn = $("hideRuleBtn");
  const rule = current();
  if (!btn || !rule) return;
  btn.innerHTML = (rule.hidden ? RT.EYE_OFF : RT.EYE_OPEN) + `<span>${rule.hidden ? "Oculta" : "Visible"}</span>`;
  btn.classList.toggle("is-hidden", !!rule.hidden);
  btn.title = rule.hidden ? "Oculta en el popup. Pulsa para mostrarla" : "Visible en el popup. Pulsa para ocultarla";
}

// ---------------- Arrastrar para ordenar ----------------
let dragId = null;

function clearDropMarks() {
  document.querySelectorAll(".drop-before, .drop-after, .dragging, .trash-hover")
    .forEach(n => n.classList.remove("drop-before", "drop-after", "dragging", "trash-hover"));
}

function makeDraggable(item, id) {
  item.draggable = true;
  item.addEventListener("dragstart", e => {
    dragId = id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-dmena-rule", id);
    requestAnimationFrame(() => item.classList.add("dragging"));
  });
  item.addEventListener("dragend", () => { dragId = null; clearDropMarks(); });
  item.addEventListener("dragover", e => {
    if (!dragId || dragId === id) return;
    e.preventDefault();
    e.stopPropagation();
    const r = item.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    item.classList.toggle("drop-after", after);
    item.classList.toggle("drop-before", !after);
  });
  item.addEventListener("dragleave", () => item.classList.remove("drop-before", "drop-after"));
  item.addEventListener("drop", e => {
    if (!dragId || dragId === id) return;
    e.preventDefault();
    e.stopPropagation();
    const after = item.classList.contains("drop-after");
    const from = state.rules.findIndex(r => r.id === dragId);
    const [moved] = state.rules.splice(from, 1);
    // Soltar entre las ocultas la oculta; soltar entre las visibles la muestra.
    moved.hidden = !!state.rules.find(r => r.id === id)?.hidden;
    let to = state.rules.findIndex(r => r.id === id);
    if (after) to++;
    state.rules.splice(to, 0, moved);
    dragId = null;
    clearDropMarks();
    renderList();
    scheduleSave();
  });
}

// ---------------- Papelera ----------------
function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "hace un momento";
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

function moveToTrash(id) {
  const idx = state.rules.findIndex(r => r.id === id);
  if (idx < 0) return;
  const [rule] = state.rules.splice(idx, 1);
  state.trash.unshift({ rule, deletedAt: Date.now(), index: idx });
  autoNamed.delete(id);
  if (selectedId === id) select(state.rules[Math.min(idx, state.rules.length - 1)]?.id || null);
  else renderList();
  scheduleSave();
  $("trashBox").open = true;
}

function restoreFromTrash(i) {
  const [t] = state.trash.splice(i, 1);
  const at = Math.min(Math.max(t.index ?? state.rules.length, 0), state.rules.length);
  state.rules.splice(at, 0, t.rule);
  if (t.rule.enabled && RT.relatedOf(state, t.rule).some(r => r.enabled)) t.rule.enabled = false;
  select(t.rule.id);
  scheduleSave();
}

function deleteFromTrash(i) {
  const t = state.trash[i];
  if (!confirm(`¿Borrar definitivamente «${t.rule.name}»? No se puede deshacer.`)) return;
  state.trash.splice(i, 1);
  if (viewTrashId === t.rule.id) { viewTrashId = null; renderEditor(); }
  renderTrash();
  scheduleSave();
}

function emptyTrash() {
  if (!state.trash.length) return;
  if (!confirm(`¿Vaciar la papelera? Se borrarán definitivamente ${state.trash.length} regla(s).`)) return;
  state.trash = [];
  if (viewTrashId) { viewTrashId = null; renderEditor(); }
  renderTrash();
  scheduleSave();
}

function renderTrash() {
  const box = $("trashList");
  box.innerHTML = "";
  $("trashCount").textContent = state.trash.length;
  $("emptyTrashBtn").disabled = !state.trash.length;
  if (!state.trash.length) {
    box.append(el("p", { className: "trash-empty", textContent: "Vacía. Arrastra aquí una regla para borrarla." }));
    return;
  }
  state.trash.forEach((t, i) => {
    const kinds = RT.ruleKinds(t.rule);
    const restore = el("button", { type: "button", className: "small-btn", textContent: "↺ Restaurar", title: "Volver a poner la regla en la lista" });
    const del = el("button", { type: "button", className: "small-btn danger", textContent: "✕", title: "Borrar definitivamente" });
    restore.addEventListener("click", e => { e.stopPropagation(); restoreFromTrash(i); });
    del.addEventListener("click", e => { e.stopPropagation(); deleteFromTrash(i); });
    const row = el("div", { className: "trash-item kind-bar-" + (kinds[0] || "none") + (t.rule.id === viewTrashId ? " active" : ""), title: "Ver la regla" },
      el("div", { className: "ri-info" },
        el("div", { className: "ti-name", textContent: t.rule.name || "(sin nombre)" }),
        el("div", { className: "ri-sub", textContent: `${RT.describeMatch(t.rule)} · ${timeAgo(t.deletedAt)}` })),
      restore, del);
    row.addEventListener("click", () => selectTrash(t.rule.id));
    box.append(row);
  });
}

const KIND_LABEL = { headers: "Cabeceras", redirect: "Redirección", params: "Parámetros", inject: "Inyección JS" };
function kindChips(kinds, related = []) {
  const box = el("div", { className: "ri-chips" });
  kinds.forEach(k => box.append(el("span", { className: "chip " + k, textContent: KIND_LABEL[k] })));
  if (related.length) box.append(el("span", { className: "chip rel", textContent: "⇄ " + related.length,
    title: "Relacionada con: " + related.map(r => r.name).join(", ") }));
  return box;
}

// ---------------- Relacionadas ----------------
let pendingMsg = null;

function toggleRule(rule, on) {
  const off = RT.setEnabled(state, rule, on);
  if (off.length) pendingMsg = `✓ Activada «${rule.name}» · desactivada${off.length > 1 ? "s" : ""}: ${off.map(r => "«" + r.name + "»").join(", ")}`;
  renderList();
  if (current()) { $("ruleEnabled").checked = current().enabled; renderRelated(); }
  scheduleSave();
}

function renderRelated() {
  const rule = current();
  const inTrash = !!viewTrashId;
  const list = $("relatedList");
  list.innerHTML = "";
  for (const r of RT.relatedOf(state, rule)) {
    const kinds = RT.ruleKinds(r);
    const name = el("span", { className: "rel-name", textContent: r.name || "(sin nombre)", title: "Abrir esta regla" });
    name.addEventListener("click", () => select(r.id));
    const chip = el("span", { className: "rel-chip kind-bar-" + (kinds[0] || "none") + (r.enabled ? " on" : "") },
      name, el("span", { className: "rel-state", textContent: r.enabled ? "● activa" : "○ inactiva" }));
    if (!inTrash) {
      if (!r.enabled) {
        const use = el("button", { type: "button", textContent: "Activar", title: "Activar esta y desactivar las demás relacionadas" });
        use.addEventListener("click", () => toggleRule(r, true));
        chip.append(use);
      }
      const x = el("button", { type: "button", className: "danger", textContent: "✕", title: "Quitar la relación" });
      x.addEventListener("click", () => { RT.unrelate(state, r); renderList(); renderRelated(); scheduleSave(); });
      chip.append(x);
    }
    list.append(chip);
  }
  // Desplegable con las reglas que se pueden relacionar
  const sel = $("relateSelect");
  sel.innerHTML = "";
  sel.append(el("option", { value: "", textContent: "+ Relacionar con…" }));
  const candidates = state.rules.filter(r => r.id !== rule.id && !(rule.relGroup && r.relGroup === rule.relGroup));
  for (const r of candidates) sel.append(el("option", { value: r.id, textContent: r.name || "(sin nombre)" }));
  sel.disabled = inTrash || !candidates.length;
}


function select(id) {
  selectedId = id;
  viewTrashId = null;
  const url = new URL(location.href);
  url.search = id ? "?rule=" + id : "";
  history.replaceState(null, "", url);
  renderList();
  renderEditor();
}

// ---------------- Editor ----------------
function selectTrash(id) {
  viewTrashId = id;
  selectedId = null;
  history.replaceState(null, "", location.pathname);
  renderList();
  renderEditor();
}

function renderEditor() {
  const rule = current();
  $("editor").classList.toggle("hidden", !rule);
  $("emptyState").classList.toggle("hidden", !!rule);
  if (!rule) return;
  const inTrash = !!viewTrashId;
  $("editorFields").disabled = inTrash;
  $("trashBanner").classList.toggle("hidden", !inTrash);
  if (inTrash) {
    const t = state.trash.find(x => x.rule.id === viewTrashId);
    $("trashBannerWhen").textContent = "(eliminada " + timeAgo(t.deletedAt) + ")";
  }
  $("ruleName").value = rule.name;
  $("ruleEnabled").checked = rule.enabled;
  $("matchType").value = rule.match.type;
  $("matchValue").value = rule.match.value || "";
  updateMatchUi();
  renderTypes();
  renderHeaderList("reqHeaders", rule.requestHeaders, ["set", "remove"], "reqHeaderNames");
  renderHeaderList("resHeaders", rule.responseHeaders, ["set", "append", "remove"], "resHeaderNames");
  renderParams();
  renderRedirect();
  renderInject();
  renderRelated();
  renderErrors();
  renderPreview();
}

function renderRedirect() {
  const rule = current();
  const rd = rule.redirect;
  $("redirectEnabled").checked = !!rd.enabled;
  $("redirectMode").value = rd.mode || "url";
  $("redirectUrl").value = rd.mode === "regex" ? (rd.regexSub || "") : (rd.url || "");
  $("redirectUrl").placeholder = rd.mode === "regex" ? "https://otro-servidor.com/\\1.min.js" : "https://otro-servidor.com/reels.min.js";
  if (rd.mode === "regex") $("adv").open = true;
  $("redirectBody").classList.toggle("off", !rd.enabled);
  updateParamsDim();
}

// ---------------- Inyección de JS ----------------
let codeEd = null;
const WHEN_HELP = {
  start: "Se ejecuta <b>antes</b> de que cargue la página, antes que sus propios scripts. Útil para sustituir funciones (<code>window.fetch</code>, <code>console.log</code>…) o preparar variables. El <code>document.body</code> aún no existe.",
  end: "Se ejecuta <b>después</b> de que la página haya cargado del todo (evento <code>load</code>). Útil para tocar el DOM, añadir estilos o pulsar botones."
};

function renderInject() {
  const rule = current();
  const inj = rule.inject;
  $("injectEnabled").checked = !!inj.enabled;
  document.querySelectorAll('input[name="injectWhen"]').forEach(r => { r.checked = r.value === (inj.when || "start"); });
  $("injectWhenHelp").innerHTML = WHEN_HELP[inj.when || "start"];
  $("injectFileName").textContent = inj.fileName ? "📄 " + inj.fileName : "";
  $("injectBody").classList.toggle("off", !inj.enabled);
  codeEd.setValue(inj.code || "");
  checkUserScripts();
}

function enableInject(rule) {
  if (rule.inject.enabled) return;
  rule.inject.enabled = true;
  $("injectEnabled").checked = true;
  $("injectBody").classList.remove("off");
}

let usOk = null;
async function checkUserScripts() {
  const st = await RT.userScriptsStatus();
  const needs = state.rules.some(r => r.inject?.enabled) || !!current()?.inject?.enabled;
  const banner = $("usBanner");
  if (st.ok || !needs) {
    banner.classList.add("hidden");
  } else {
    banner.classList.remove("hidden");
    if (st.reason === "chrome-reload") {
      $("usBannerText").innerHTML = `Chrome tiene cargada una versión antigua de la extensión (<b>${chrome.runtime.getManifest().version}</b>) que no incluye el permiso para inyectar código. Recárgala y después activa <b>«Permitir scripts de usuario»</b> en sus detalles.`;
      $("usBannerBtn").textContent = "↻ Recargar extensión";
      $("usBannerBtn").dataset.action = "reload";
    } else if (st.reason === "firefox-permission") {
      $("usBannerText").textContent = "Firefox necesita tu permiso para ejecutar scripts de usuario en las páginas.";
      $("usBannerBtn").textContent = "Conceder permiso";
      $("usBannerBtn").dataset.action = "firefox";
    } else {
      $("usBannerText").innerHTML = "Para inyectar código, Chrome exige activar <b>«Permitir scripts de usuario»</b> en los detalles de la extensión. Actívalo y vuelve a esta pestaña.";
      $("usBannerBtn").textContent = "Abrir ajustes de la extensión";
      $("usBannerBtn").dataset.action = "chrome";
    }
  }
  // Si el permiso acaba de activarse, se vuelven a aplicar las reglas.
  if (usOk === false && st.ok) saveNow();
  usOk = st.ok;
}

function updateParamsDim() {
  const active = RT.hasRedirect(current());
  $("paramsCard").classList.toggle("dimmed", active);
  $("paramsDisabledNote").classList.toggle("hidden", !active);
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
  const nHidden = state.rules.filter(r => r.hidden).length;
  let includeHidden = true;
  if (nHidden) {
    includeHidden = confirm(`Tienes ${nHidden} regla(s) oculta(s).\n\n¿Quieres incluirlas en la exportación?\n\nAceptar = incluir las ocultas\nCancelar = exportar solo las visibles`);
  }
  const n = RT.downloadJson(state, { includeHidden });
  setStatus({ ok: true, count: n, msg: `⬇ Exportadas ${n} regla(s) a JSON${nHidden ? (includeHidden ? " (incluidas las ocultas)" : " (sin las ocultas)") : ""}` });
}

async function importRules(file) {
  try {
    const imported = RT.parseImport(await file.text());
    if (!imported.length) throw new Error("El fichero no tiene reglas.");
    let replace = false;
    if (state.rules.length) {
      replace = confirm(`Se van a importar ${imported.length} regla(s) de «${file.name}».\n\nAceptar = REEMPLAZAR las ${state.rules.length} actuales (irán a la papelera)\nCancelar = AÑADIRLAS a las actuales`);
    }
    if (replace) {
      const now = Date.now();
      state.trash = [...state.rules.map((rule, index) => ({ rule, deletedAt: now, index })), ...(state.trash || [])];
    }
    state.rules = replace ? imported : [...state.rules, ...imported];
    selectedId = imported[0]?.id || state.rules[0]?.id || null;
    renderList();
    renderEditor();
    await saveNow();
    setStatus({ ok: true, count: imported.length, msg: `⬆ Importadas ${imported.length} regla(s) desde ${file.name}` });
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
  $("addInjectBtn").addEventListener("click", () => {
    addRule({ name: "Nueva inyección JS", match: { type: "url", value: "", resourceTypes: [] },
      inject: { enabled: true, when: "end", code: "", fileName: "" } });
    $("matchValue").focus();
  });

  // Editor de código
  codeEd = CodeEditor.create($("injectCode"), { placeholder: "// Escribe aquí tu JavaScript o carga un fichero .js\nconsole.log('Hola desde dmena_request');" });
  codeEd.onChange(v => {
    const rule = current();
    if (!rule) return;
    rule.inject.code = v;
    if (v.trim()) enableInject(rule);
    scheduleSave();
  });
  $("injectEnabled").addEventListener("change", e => {
    current().inject.enabled = e.target.checked;
    $("injectBody").classList.toggle("off", !e.target.checked);
    if (e.target.checked) codeEd.focus();
    checkUserScripts();
    scheduleSave();
  });
  document.querySelectorAll('input[name="injectWhen"]').forEach(r => r.addEventListener("change", () => {
    current().inject.when = r.value;
    $("injectWhenHelp").innerHTML = WHEN_HELP[r.value];
    scheduleSave();
  }));
  let fmtTimer = null;
  const showFormatMsg = (ok, text) => {
    const m = $("injectFormatMsg");
    clearTimeout(fmtTimer);
    m.textContent = text;
    m.className = "format-msg " + (ok ? "ok" : "err");
    if (ok) fmtTimer = setTimeout(() => m.classList.add("hidden"), 4000);
  };
  // Al seguir escribiendo desaparece el aviso de error.
  codeEd.onChange(() => { if ($("injectFormatMsg").classList.contains("err")) $("injectFormatMsg").classList.add("hidden"); });
  const formatCode = async () => {
    const code = codeEd.getValue();
    if (!code.trim()) return;
    const btn = $("injectFormatBtn");
    btn.disabled = true;
    btn.textContent = "⏳ Formateando…";
    try {
      const out = await CodeEditor.format(code);
      if (out !== code) codeEd.replaceAll(out);
      showFormatMsg(true, out !== code ? "✨ Código formateado. Ctrl+Z para deshacer." : "✨ El código ya tenía buen formato.");
    } catch (e) {
      showFormatMsg(false, "No se puede formatear. " + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "✨ Formatear";
    }
  };
  $("injectFormatBtn").addEventListener("click", formatCode);
  codeEd.onFormatShortcut(formatCode);
  $("injectFileBtn").addEventListener("click", () => $("injectFile").click());
  $("injectFile").addEventListener("change", async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const rule = current();
    if (rule.inject.code.trim() && !confirm(`¿Sustituir el código actual por el contenido de «${f.name}»?`)) return;
    rule.inject.code = await f.text();
    rule.inject.fileName = f.name;
    enableInject(rule);
    if (/^(Nueva regla|Nueva inyección JS)$/.test(rule.name)) { rule.name = "Inyectar " + f.name; $("ruleName").value = rule.name; }
    codeEd.setValue(rule.inject.code);
    $("injectFileName").textContent = "📄 " + f.name;
    scheduleSave();
  });
  $("usBannerBtn").addEventListener("click", async e => {
    if (e.currentTarget.dataset.action === "reload") {
      // Al recargar se cierra esta pestaña; se abren los detalles para activar el interruptor.
      await chrome.tabs.create({ url: "chrome://extensions/?id=" + chrome.runtime.id });
      chrome.runtime.reload();
    } else if (e.currentTarget.dataset.action === "firefox") {
      try { await chrome.permissions.request({ permissions: ["userScripts"] }); } catch {}
      checkUserScripts();
    } else {
      chrome.tabs.create({ url: "chrome://extensions/?id=" + chrome.runtime.id });
    }
  });
  window.addEventListener("focus", () => { if (current()) checkUserScripts(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && current()) checkUserScripts(); });

  $("addRedirectBtn").addEventListener("click", () => {
    addRule({ name: "Nueva redirección", match: { type: "url", value: "", resourceTypes: [] },
      redirect: { enabled: true, mode: "url", url: "", regexSub: "" } });
    $("matchValue").focus();
  });
  $("ruleName").addEventListener("input", e => { current().name = e.target.value; autoNamed.delete(current().id); scheduleSave(); });
  $("ruleEnabled").addEventListener("change", e => toggleRule(current(), e.target.checked));
  $("relateSelect").addEventListener("change", e => {
    const other = state.rules.find(r => r.id === e.target.value);
    e.target.value = "";
    if (!other) return;
    const rule = current();
    RT.relate(state, rule, other);
    $("ruleEnabled").checked = rule.enabled;
    renderList();
    renderRelated();
    scheduleSave();
  });
  $("matchType").addEventListener("change", e => { current().match.type = e.target.value; updateMatchUi(); scheduleSave(); });
  $("matchValue").addEventListener("input", e => {
    const rule = current();
    rule.match.value = e.target.value;
    // En reglas de redirección recién creadas, el nombre se genera solo con el fichero de la URL.
    if (rule.redirect.enabled && (/^(Nueva regla|Nueva redirección)$/.test(rule.name) || autoNamed.has(rule.id))) {
      const file = e.target.value.split(/[?#]/)[0].split("/").filter(Boolean).pop();
      if (file) { rule.name = "Redirigir " + file; $("ruleName").value = rule.name; autoNamed.add(rule.id); }
    }
    scheduleSave();
  });

  $("redirectEnabled").addEventListener("change", e => {
    const rd = current().redirect;
    rd.enabled = e.target.checked;
    if (rd.enabled) setTimeout(() => $("redirectUrl").focus(), 0);
    renderRedirect(); scheduleSave();
  });
  $("redirectMode").addEventListener("change", e => {
    const rd = current().redirect;
    rd.mode = e.target.value;
    if (rd.mode === "regex" && current().match.type !== "regex") {
      current().match.type = "regex";
      $("matchType").value = "regex";
      updateMatchUi();
    }
    renderRedirect(); scheduleSave();
  });
  $("redirectUrl").addEventListener("input", e => {
    const rd = current().redirect;
    if (rd.mode === "regex") rd.regexSub = e.target.value; else rd.url = e.target.value;
    if (!rd.enabled && e.target.value.trim()) { rd.enabled = true; $("redirectEnabled").checked = true; $("redirectBody").classList.remove("off"); }
    updateParamsDim();
    scheduleSave();
  });

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
    if (copy.relGroup) copy.enabled = false; // sigue en el mismo grupo de relacionadas, pero inactiva
    const idx = state.rules.findIndex(r => r.id === selectedId);
    state.rules.splice(idx + 1, 0, copy);
    select(copy.id);
    scheduleSave();
  });
  $("delRuleBtn").addEventListener("click", () => moveToTrash(selectedId));
  $("hideRuleBtn").addEventListener("click", () => { const r = current(); if (r) setHidden(r, !r.hidden); });
  const trashIdx = () => state.trash.findIndex(t => t.rule.id === viewTrashId);
  $("bannerRestore").addEventListener("click", () => { const i = trashIdx(); if (i >= 0) restoreFromTrash(i); });
  $("bannerDelete").addEventListener("click", () => { const i = trashIdx(); if (i >= 0) deleteFromTrash(i); });
  $("emptyTrashBtn").addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); emptyTrash(); });
  // Soltar una regla sobre la papelera la borra.
  const trashBox = $("trashBox");
  trashBox.addEventListener("dragover", e => { if (!dragId) return; e.preventDefault(); trashBox.classList.add("trash-hover"); });
  trashBox.addEventListener("dragleave", e => { if (!trashBox.contains(e.relatedTarget)) trashBox.classList.remove("trash-hover"); });
  trashBox.addEventListener("drop", e => {
    if (!dragId) return;
    e.preventDefault();
    const id = dragId; dragId = null; clearDropMarks();
    moveToTrash(id);
  });

  $("exportBtn").addEventListener("click", exportRules);
  $("importBtn").addEventListener("click", () => $("importFile").click());
  // Arrastrar un .json sobre el editor también importa.
  const isFileDrag = e => !dragId && [...(e.dataTransfer?.types || [])].includes("Files");
  document.addEventListener("dragover", e => { if (!isFileDrag(e)) return; e.preventDefault(); document.body.classList.add("dropping"); });
  document.addEventListener("dragleave", e => { if (!e.relatedTarget) document.body.classList.remove("dropping"); });
  document.addEventListener("drop", e => {
    if (!isFileDrag(e)) return;
    e.preventDefault(); document.body.classList.remove("dropping");
    const f = e.dataTransfer?.files?.[0]; if (f) importRules(f);
  });
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
    if (!current()) { viewTrashId = null; selectedId = state.rules[0]?.id || null; }
    renderList();
    renderEditor();
  });

  const params = new URLSearchParams(location.search);
  if (params.get("import")) {
    $("importBtn").classList.add("pulse");
    setTimeout(() => setStatus({ ok: true, msg: "Pulsa «⬆ Importar JSON» o arrastra aquí el fichero .json" }), 300);
  }
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
