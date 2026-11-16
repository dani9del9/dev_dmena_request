// dmena_request - lógica compartida: almacenamiento y conversión a reglas declarativeNetRequest.
// Funciona en Chrome y Firefox (ambos exponen `chrome.*` con promesas en MV3).

const RT = (() => {
  const STORAGE_KEY = "reqtweak_state";

  // Tipos de recurso soportados por Chrome y Firefox a la vez.
  const RESOURCE_TYPES = [
    { id: "main_frame", label: "Página principal" },
    { id: "sub_frame", label: "Iframes" },
    { id: "xmlhttprequest", label: "XHR / fetch" },
    { id: "script", label: "Scripts" },
    { id: "stylesheet", label: "CSS" },
    { id: "image", label: "Imágenes" },
    { id: "font", label: "Fuentes" },
    { id: "media", label: "Media" },
    { id: "websocket", label: "WebSocket" },
    { id: "object", label: "Object" },
    { id: "ping", label: "Ping" },
    { id: "csp_report", label: "CSP report" },
    { id: "other", label: "Otros" }
  ];
  const ALL_TYPES = RESOURCE_TYPES.map(t => t.id);
  // No se puede redirigir un websocket.
  const NON_REDIRECTABLE = new Set(["websocket"]);

  const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function newRule(partial = {}) {
    return {
      id: uid(),
      name: "Nueva regla",
      enabled: true,
      match: { type: "all", value: "", resourceTypes: [] },
      queryParams: [],
      requestHeaders: [],
      responseHeaders: [],
      ...partial
    };
  }

  function normalizeRule(r) {
    const base = newRule();
    const out = { ...base, ...r, match: { ...base.match, ...(r.match || {}) } };
    if (!Array.isArray(out.queryParams)) out.queryParams = [];
    if (!Array.isArray(out.requestHeaders)) out.requestHeaders = [];
    if (!Array.isArray(out.responseHeaders)) out.responseHeaders = [];
    if (!Array.isArray(out.match.resourceTypes)) out.match.resourceTypes = [];
    if (!out.id) out.id = uid();
    return out;
  }

  function defaultState() {
    return { enabled: true, rules: [] };
  }

  async function load() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const st = data[STORAGE_KEY];
    if (!st || !Array.isArray(st.rules)) return defaultState();
    st.rules = st.rules.map(normalizeRule);
    return st;
  }

  async function save(state) {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  // ---------- Validación ----------
  function validateRule(r) {
    const errors = [];
    const m = r.match || {};
    if (m.type !== "all" && !String(m.value || "").trim()) {
      errors.push("Falta el patrón de URL / dominio.");
    }
    const checkHeaders = (list, where) => {
      for (const h of list || []) {
        if (h.enabled === false) continue;
        const name = String(h.name || "").trim();
        if (!name) { errors.push(`Cabecera de ${where} sin nombre.`); continue; }
        if (!HEADER_NAME_RE.test(name)) errors.push(`Nombre de cabecera no válido (${where}): "${name}"`);
        if (h.op !== "remove" && String(h.value ?? "") === "") errors.push(`La cabecera "${name}" (${where}) necesita un valor.`);
      }
    };
    checkHeaders(r.requestHeaders, "petición");
    checkHeaders(r.responseHeaders, "respuesta");
    for (const p of r.queryParams || []) {
      if (p.enabled !== false && !String(p.key || "").trim()) errors.push("Parámetro de URL sin nombre.");
    }
    return errors;
  }

  async function checkRegex(regex) {
    try {
      if (chrome.declarativeNetRequest.isRegexSupported) {
        const res = await chrome.declarativeNetRequest.isRegexSupported({ regex });
        if (!res.isSupported) return `Regex no soportada (${res.reason || "desconocido"}).`;
      } else {
        new RegExp(regex);
      }
    } catch (e) {
      return "Regex no válida: " + e.message;
    }
    return null;
  }

  // ---------- Conversión a DNR ----------
  function buildCondition(rule, forRedirect) {
    const m = rule.match || {};
    let types = (m.resourceTypes && m.resourceTypes.length) ? m.resourceTypes.slice() : ALL_TYPES.slice();
    if (forRedirect) types = types.filter(t => !NON_REDIRECTABLE.has(t));
    if (!types.length) return null;
    const cond = { resourceTypes: types };
    const value = String(m.value || "").trim();
    if (m.type === "url") cond.urlFilter = value;
    else if (m.type === "domain") cond.requestDomains = value.split(/[\s,]+/).filter(Boolean);
    else if (m.type === "regex") cond.regexFilter = value;
    return cond;
  }

  function mapHeaders(list) {
    return (list || [])
      .filter(h => h.enabled !== false && String(h.name || "").trim())
      .map(h => {
        const out = { header: h.name.trim(), operation: h.op || "set" };
        if (out.operation !== "remove") out.value = String(h.value ?? "");
        return out;
      });
  }

  // Convierte el estado completo en grupos de reglas DNR (un grupo por regla lógica).
  function toDnrGroups(state) {
    const groups = [];
    if (!state.enabled) return groups;
    let nextId = 1;
    const active = state.rules.filter(r => r.enabled && validateRule(r).length === 0);
    active.forEach((rule, idx) => {
      const out = [];
      groups.push({ rule, dnr: out });
      const priority = active.length - idx + 1; // las de arriba tienen más prioridad
      const req = mapHeaders(rule.requestHeaders);
      const res = mapHeaders(rule.responseHeaders);
      if (req.length || res.length) {
        const condition = buildCondition(rule, false);
        if (condition) {
          const action = { type: "modifyHeaders" };
          if (req.length) action.requestHeaders = req;
          if (res.length) action.responseHeaders = res;
          out.push({ id: nextId++, priority, action, condition });
        }
      }
      const qp = (rule.queryParams || []).filter(p => p.enabled !== false && String(p.key || "").trim());
      const add = qp.filter(p => p.op !== "remove")
        .map(p => {
          const o = { key: p.key.trim(), value: String(p.value ?? "") };
          if (p.replaceOnly) o.replaceOnly = true;
          return o;
        });
      const remove = qp.filter(p => p.op === "remove").map(p => p.key.trim());
      if (add.length || remove.length) {
        const condition = buildCondition(rule, true);
        if (condition) {
          const queryTransform = {};
          if (add.length) queryTransform.addOrReplaceParams = add;
          if (remove.length) queryTransform.removeParams = remove;
          out.push({
            id: nextId++,
            priority,
            action: { type: "redirect", redirect: { transform: { queryTransform } } },
            condition
          });
        }
      }
    });
    return groups;
  }

  function toDnrRules(state) {
    return toDnrGroups(state).flatMap(g => g.dnr);
  }

  // Aplica las reglas al navegador. Devuelve {ok, count, error, failed:[ruleId]}.
  // Si el lote completo falla, aplica regla a regla para que una mala no rompa las demás.
  async function apply(state) {
    const dnr = chrome.declarativeNetRequest;
    const groups = toDnrGroups(state);
    const skipped = state.enabled ? state.rules.filter(r => r.enabled && validateRule(r).length) : [];
    const removeAll = async () => {
      const existing = await dnr.getDynamicRules();
      if (existing.length) await dnr.updateDynamicRules({ removeRuleIds: existing.map(r => r.id) });
    };
    try {
      const existing = await dnr.getDynamicRules();
      const addRules = groups.flatMap(g => g.dnr);
      await dnr.updateDynamicRules({ removeRuleIds: existing.map(r => r.id), addRules });
      if (skipped.length) {
        return { ok: false, count: addRules.length, failed: skipped.map(r => r.id),
          error: `Reglas con errores ignoradas: ${skipped.map(r => r.name).join(", ")}` };
      }
      return { ok: true, count: addRules.length, failed: [] };
    } catch (bulkErr) {
      const failed = [];
      const messages = [];
      let count = 0;
      try { await removeAll(); } catch {}
      for (const g of groups) {
        try {
          await dnr.updateDynamicRules({ addRules: g.dnr });
          count += g.dnr.length;
        } catch (e) {
          failed.push(g.rule.id);
          messages.push(`"${g.rule.name}": ${e?.message || e}`);
        }
      }
      for (const r of skipped) { failed.push(r.id); messages.push(`"${r.name}": tiene errores`); }
      return { ok: false, count, failed, error: messages.join(" | ") || (bulkErr?.message || String(bulkErr)) };
    }
  }

  async function saveAndApply(state) {
    await save(state);
    return apply(state);
  }

  async function hasHostPermission() {
    try {
      return await chrome.permissions.contains({ origins: ["<all_urls>"] });
    } catch { return true; }
  }

  async function requestHostPermission() {
    try {
      return await chrome.permissions.request({ origins: ["<all_urls>"] });
    } catch { return false; }
  }

  function summarize(rule) {
    const parts = [];
    const on = l => (l || []).filter(x => x.enabled !== false).length;
    const nReq = on(rule.requestHeaders), nRes = on(rule.responseHeaders), nQp = on(rule.queryParams);
    if (nReq) parts.push(`${nReq} cab. petición`);
    if (nRes) parts.push(`${nRes} cab. respuesta`);
    if (nQp) parts.push(`${nQp} params`);
    return parts.join(" · ") || "sin acciones";
  }

  function describeMatch(rule) {
    const m = rule.match || {};
    if (m.type === "all") return "Todas las URLs";
    const label = { url: "URL", domain: "Dominio", regex: "Regex" }[m.type] || "";
    return `${label}: ${m.value}`;
  }

  // ---------- Coincidencias (para el contador del icono) ----------
  // Tipos de webRequest de Firefox que no existen en DNR -> equivalente.
  const TYPE_ALIAS = { beacon: "ping", imageset: "image", object_subrequest: "object", xml_dtd: "other",
    xslt: "other", web_manifest: "other", speculative: "other", json: "xmlhttprequest" };

  function urlFilterToRegex(f) {
    let src = "";
    let s = f;
    if (s.startsWith("||")) { src += "^[a-z][a-z0-9+.-]*://([^/?#]*\\.)?"; s = s.slice(2); }
    else if (s.startsWith("|")) { src += "^"; s = s.slice(1); }
    let end = "";
    if (s.endsWith("|")) { end = "$"; s = s.slice(0, -1); }
    for (const ch of s) {
      if (ch === "*") src += ".*";
      else if (ch === "^") src += "(?:[^a-zA-Z0-9_\\-.%]|$)";
      else src += ch.replace(/[.+?${}()|[\]\\\/]/g, "\\$&");
    }
    return new RegExp(src + end, "i");
  }

  // Devuelve una función (url, type) => bool, o null si la regla no hace nada.
  function compileMatcher(rule) {
    const m = rule.match || {};
    const types = new Set(m.resourceTypes?.length ? m.resourceTypes : ALL_TYPES);
    const value = String(m.value || "").trim();
    let test;
    try {
      if (m.type === "url") { const re = urlFilterToRegex(value); test = u => re.test(u); }
      else if (m.type === "regex") { const re = new RegExp(value, "i"); test = u => re.test(u); }
      else if (m.type === "domain") {
        const doms = value.split(/[\s,]+/).filter(Boolean).map(d => d.toLowerCase());
        test = u => { let h; try { h = new URL(u).hostname; } catch { return false; } return doms.some(d => h === d || h.endsWith("." + d)); };
      } else test = () => true;
    } catch { return null; }

    const on = l => (l || []).filter(x => x.enabled !== false && String(x.name || x.key || "").trim());
    const hasHeaders = on(rule.requestHeaders).length + on(rule.responseHeaders).length > 0;
    const params = on(rule.queryParams);
    if (!hasHeaders && !params.length) return null;

    // ¿Cambiarían los parámetros esta URL? (evita contar la URL ya redirigida)
    const paramsChange = url => {
      let u; try { u = new URL(url); } catch { return false; }
      return params.some(p => p.op === "remove"
        ? u.searchParams.has(p.key.trim())
        : (p.replaceOnly ? (u.searchParams.has(p.key.trim()) && u.searchParams.get(p.key.trim()) !== String(p.value ?? ""))
                         : u.searchParams.get(p.key.trim()) !== String(p.value ?? "")));
    };

    return (url, rawType) => {
      const type = TYPE_ALIAS[rawType] || rawType;
      if (!types.has(type) || !test(url)) return false;
      if (hasHeaders) return true;
      return type !== "websocket" && paramsChange(url);
    };
  }

  function compileState(state) {
    if (!state.enabled) return [];
    return state.rules
      .filter(r => r.enabled && validateRule(r).length === 0)
      .map(r => ({ id: r.id, fn: compileMatcher(r) }))
      .filter(x => x.fn);
  }

  return {
    RESOURCE_TYPES, ALL_TYPES, newRule, normalizeRule, defaultState, load, save, apply, saveAndApply,
    validateRule, checkRegex, toDnrRules, toDnrGroups, hasHostPermission, requestHostPermission,
    summarize, describeMatch, uid, compileState, urlFilterToRegex, STORAGE_KEY
  };
})();
