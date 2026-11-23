// dmena_request - editor de código JS ligero con resaltado de sintaxis.
// Técnica: un <textarea> con el texto transparente encima de un <pre> coloreado.
const CodeEditor = (() => {
  const KEYWORDS = "const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|import|export|from|as|async|await|try|catch|finally|throw|typeof|instanceof|in|of|this|super|delete|void|yield|default|static|get|set|debugger|with";
  const LITERALS = "true|false|null|undefined|NaN|Infinity";
  const GLOBALS = "window|document|console|location|navigator|localStorage|sessionStorage|fetch|XMLHttpRequest|JSON|Math|Date|Promise|Object|Array|String|Number|Boolean|RegExp|Map|Set|Symbol|Error|setTimeout|setInterval|clearTimeout|clearInterval|globalThis";

  const TOKEN_RE = new RegExp([
    "(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$))",                                   // 1 comentario
    "(`(?:\\\\[\\s\\S]|[^\\\\`])*`?|\"(?:\\\\.|[^\\\\\"\\n])*\"?|'(?:\\\\.|[^\\\\'\\n])*'?)", // 2 cadena
    "\\b(0[xX][\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?n?)\\b",          // 3 número
    `\\b(${KEYWORDS})\\b`,                                                              // 4 palabra clave
    `\\b(${LITERALS})\\b`,                                                              // 5 literal
    `\\b(${GLOBALS})\\b`,                                                               // 6 global
    "([A-Za-z_$][\\w$]*)(?=\\s*\\()",                                                   // 7 llamada a función
    "(=>|[{}()[\\];,.]|[-+*/%=!<>&|^~?:]+)"                                             // 8 puntuación / operador
  ].join("|"), "g");

  const CLASSES = [null, "c-com", "c-str", "c-num", "c-kw", "c-lit", "c-glob", "c-fn", "c-op"];

  const esc = t => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function highlight(code) {
    let out = "";
    let last = 0;
    TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = TOKEN_RE.exec(code))) {
      if (m[0] === "") { TOKEN_RE.lastIndex++; continue; }
      out += esc(code.slice(last, m.index));
      const g = m.findIndex((x, i) => i > 0 && x !== undefined);
      out += `<span class="${CLASSES[g]}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    out += esc(code.slice(last));
    return out;
  }

  // ---------- Formatear con Prettier (se carga solo la primera vez que hace falta) ----------
  let prettierLoading = null;
  function loadScript(src) {
    return new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = () => ko(new Error("No se pudo cargar " + src));
      document.head.append(s);
    });
  }
  function loadPrettier() {
    if (window.prettier && window.prettierPlugins?.babel) return Promise.resolve();
    prettierLoading ||= (async () => {
      await loadScript("vendor/prettier/standalone.js");
      await loadScript("vendor/prettier/babel.js");
      await loadScript("vendor/prettier/estree.js");
    })();
    return prettierLoading;
  }
  // Devuelve el código formateado. Si hay un error de sintaxis lanza un Error con mensaje en español.
  async function format(code) {
    await loadPrettier();
    try {
      return await window.prettier.format(code, {
        parser: "babel",
        plugins: [window.prettierPlugins.babel, window.prettierPlugins.estree],
        printWidth: 100,
        tabWidth: 2
      });
    } catch (e) {
      const loc = e.loc?.start;
      const msg = String(e.message || e).split("\n")[0].replace(/\s*\(\d+:\d+\)\s*$/, "");
      throw new Error(loc ? `Error de sintaxis en la línea ${loc.line}, columna ${loc.column}: ${msg}` : msg);
    }
  }

  // Monta el editor dentro de "root". Devuelve { getValue, setValue, setDisabled, onChange }.
  function create(root, { placeholder = "" } = {}) {
    root.classList.add("code-editor");
    root.innerHTML = `<div class="ce-gutter" aria-hidden="true"></div>
      <div class="ce-body">
        <pre class="ce-pre" aria-hidden="true"><code></code></pre>
        <textarea class="ce-input" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea>
      </div>`;
    const gutter = root.querySelector(".ce-gutter");
    const pre = root.querySelector(".ce-pre");
    const codeEl = pre.querySelector("code");
    const ta = root.querySelector(".ce-input");
    ta.placeholder = placeholder;
    const listeners = [];
    let lineCount = -1;

    const render = () => {
      const v = ta.value;
      // El salto de línea final necesita un carácter para que el <pre> tenga la misma altura.
      codeEl.innerHTML = highlight(v) + (v.endsWith("\n") || v === "" ? " " : "");
      const lines = v.split("\n").length;
      if (lines !== lineCount) {
        lineCount = lines;
        gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join("\n");
      }
      syncScroll();
    };
    const syncScroll = () => {
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
      gutter.scrollTop = ta.scrollTop;
    };

    ta.addEventListener("input", () => { render(); listeners.forEach(fn => fn(ta.value)); });
    ta.addEventListener("scroll", syncScroll);
    ta.addEventListener("keydown", e => {
      // Tab inserta 2 espacios (Shift+Tab quita sangría de la línea).
      if (e.key === "Tab") {
        e.preventDefault();
        const { selectionStart: a, selectionEnd: b, value } = ta;
        if (e.shiftKey) {
          const lineStart = value.lastIndexOf("\n", a - 1) + 1;
          if (value.startsWith("  ", lineStart)) {
            ta.setRangeText("", lineStart, lineStart + 2, "end");
            ta.selectionStart = ta.selectionEnd = Math.max(lineStart, a - 2);
          }
        } else {
          ta.setRangeText("  ", a, b, "end");
        }
        ta.dispatchEvent(new Event("input"));
      }
      // Enter mantiene la sangría de la línea anterior.
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
        const { selectionStart: a, value } = ta;
        const lineStart = value.lastIndexOf("\n", a - 1) + 1;
        const indent = (value.slice(lineStart, a).match(/^\s*/) || [""])[0];
        const extra = /[{([]\s*$/.test(value.slice(lineStart, a)) ? "  " : "";
        e.preventDefault();
        ta.setRangeText("\n" + indent + extra, a, ta.selectionEnd, "end");
        ta.dispatchEvent(new Event("input"));
      }
    });

    // Sustituye todo el texto conservando el historial de deshacer (Ctrl+Z).
    const replaceAll = v => {
      ta.focus();
      ta.select();
      const ok = document.execCommand && document.execCommand("insertText", false, v);
      if (!ok || ta.value !== v) { ta.value = v; ta.dispatchEvent(new Event("input")); }
      ta.setSelectionRange(0, 0);
      ta.scrollTop = 0;
      ta.scrollLeft = 0;
      syncScroll();
    };

    let formatHandler = null;
    ta.addEventListener("keydown", e => {
      // Shift+Alt+F, como en VS Code
      if (e.key.toLowerCase() === "f" && e.shiftKey && e.altKey && formatHandler) {
        e.preventDefault();
        formatHandler();
      }
    });

    render();
    return {
      getValue: () => ta.value,
      replaceAll,
      onFormatShortcut: fn => { formatHandler = fn; },
      setValue: v => { ta.value = v || ""; ta.scrollTop = 0; render(); },
      setDisabled: d => { ta.readOnly = !!d; root.classList.toggle("ce-disabled", !!d); },
      onChange: fn => listeners.push(fn),
      focus: () => ta.focus(),
      textarea: ta
    };
  }

  return { create, highlight, format };
})();
