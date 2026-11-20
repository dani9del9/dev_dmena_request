# dmena_request

Extensión para Chrome y Firefox, al estilo de Requestly:

- **Cabeceras de la petición**: poner o quitar (Authorization, Cookie, User-Agent, Origin, cabeceras propias…).
- **Cabeceras de la respuesta**: poner, agregar o quitar (CORS abierto, quitar CSP o X-Frame-Options…).
- **Redirecciones**: cambia una petición por otra URL. Por ejemplo, que `loquesea.com/libreria.js` se cargue desde `otracosa.com/libreria.lib.js`. Puede ser una URL fija o una sustitución con grupos de regex (`\1`, `\2`…). Avisa si el destino provocaría un bucle.
- **Inyectar JavaScript** (reglas azules): ejecuta tu código en las páginas que cumplen el patrón, **antes** o **después** de que carguen. Se escribe en un editor con resaltado de sintaxis o se carga desde un fichero `.js`. En Chrome hay que activar «Permitir scripts de usuario» en los detalles de la extensión; en Firefox, conceder el permiso de scripts de usuario (Firefox 136+).
- **Parámetros de URL**: añadir, reemplazar o quitar parámetros de la query.
- Reglas por **dominio**, por **URL con comodín** o por **regex**, filtradas por tipo de recurso.
- **Colores por tipo** en el listado: verde = cabeceras, rojo = redirección, azul = inyección JS, amarillo = parámetros. Si una regla hace varias cosas, aparece una etiqueta por cada una.
- **Exportar e importar reglas en JSON**: botones en el popup y arriba en el editor. En el editor también puedes arrastrar el .json a la ventana. Al importar te pregunta si quieres reemplazar las reglas actuales o añadirlas.
- **Reglas relacionadas (solo una activa)**: en el editor, en *⇄ Relacionadas → Relacionar con…*, enlaza reglas alternativas (por ejemplo, varias redirecciones de la misma URL a distintos entornos). La relación es mutua y en cadena: si relacionas R1 con R2 y R2 con R3, las tres forman un grupo. Al activar una, se desactivan las demás del grupo, da igual si lo haces desde la lista, el editor, el popup o el botón *Activar* de la tarjeta. Con ✕ sacas una regla del grupo. Al duplicar una regla relacionada, la copia queda en el mismo grupo pero inactiva. En la lista y en el popup, las reglas relacionadas llevan la marca ⇄.
- **Reglas ocultas**: con el ojo de cada regla la ocultas del popup, donde solo se ve un aviso con cuántas hay. Siguen funcionando si están activas. En el editor aparecen en una lista desplegable "🙈 Ocultas", debajo de las reglas. Al exportar te pregunta si quieres incluirlas.
- **Ordenar arrastrando**: arrastra las reglas por el asa ⋮⋮. Las de arriba tienen más prioridad.
- **Papelera**: al eliminar una regla, va a la papelera (debajo de la lista). Desde ahí puedes restaurarla (↺), borrarla definitivamente (✕) o vaciar la papelera entera. También puedes arrastrar una regla directamente sobre la papelera. Si haces clic en una regla de la papelera, se abre en el editor en modo solo lectura. Si al importar eliges "reemplazar", las reglas anteriores también van a la papelera.
- Interruptor general, interruptor por regla y por línea, y duplicar.
- **Aviso en el icono**: aparece un punto rojo en la esquina cuando dmena_request ha modificado alguna petición en la pestaña (se quita al navegar a una página donde no actúa). Con la extensión apagada el icono se ve gris. En el popup ves el total y cuántas peticiones ha tocado cada regla.
- Usa `declarativeNetRequest` (Manifest V3), así que no hace falta un script de fondo y las reglas siguen activas después de reiniciar el navegador.

> 📖 **Ayuda completa**: pulsa el botón **?** del popup o del editor (abre `help.html`).

## Instalar en Chrome / Edge / Brave
1. Abre `chrome://extensions`.
2. Activa el **Modo de desarrollador** (arriba a la derecha).
3. Pulsa **Cargar descomprimida** y elige la carpeta `dmena_request`.
4. Fija el icono en la barra de herramientas.

> `manifest.json` es el de Chrome. Firefox usa `manifest.firefox.json`, que va ya dentro de `dmena_request-firefox.zip`.

## Instalar en Firefox (versión 128 o superior)
Firefox no admite `service_worker`, así que usa su propio manifest. Usa el zip **`dmena_request-firefox.zip`**.

**Temporal** (se quita al cerrar Firefox):
1. Abre `about:debugging#/runtime/this-firefox`.
2. Pulsa **Cargar complemento temporal…** y elige `dmena_request-firefox.zip`.

**Permanente**: firma `dmena_request-firefox.zip` como "no listado" en https://addons.mozilla.org/developers/. Otra opción es usar Firefox Developer Edition con `xpinstall.signatures.required = false` en `about:config`.

**Importante en Firefox**: en Manifest V3, Firefox no concede automáticamente el permiso de acceso a los sitios. Si ves el aviso amarillo, pulsa **Conceder** (también puedes hacerlo en `about:addons` → dmena_request → Permisos → "Acceder a tus datos de todos los sitios web").

## Uso
- **Popup**: interruptor general, activar o desactivar reglas y crear una "Regla para este sitio" con el dominio de la pestaña actual. Las reglas que afectan a la pestaña actual aparecen marcadas en verde.
- **Editor**: los cambios se guardan y se aplican al momento. En "Ver reglas generadas" ves el JSON exacto que se envía al navegador.

### Sintaxis de patrones
| Tipo | Ejemplo | Notas |
|---|---|---|
| Dominio(s) | `miweb.com, localhost` | Incluye los subdominios |
| URL contiene / comodín | `\|\|miweb.com/api/*` | `*` comodín, `\|\|` dominio, `\|` inicio/fin |
| Regex | `^https://(dev\|pre)\.miweb\.com/.*` | Sintaxis RE2 |

### Redirecciones
1. Pulsa **↪ Nueva redirección**.
2. En el paso **1**, pon la URL original. Ej: `https://player.prisamedia.com/componentes/reels/reels.min.js`. También vale un trozo o un comodín, como `*/reels.min.js`.
3. En el paso **2**, en **Cargar en su lugar**, pon la URL que quieres que se cargue.

- **Avanzado → Sustitución regex**: el origen es una expresión regular y el destino puede usar sus grupos. Ej: `^https://loquesea\.com/(.*)\.js$` → `https://otracosa.com/\1.lib.js`.
- Si la regla tiene la redirección activa, sus parámetros de URL no se aplican, porque manda la redirección.
- Si la consola muestra un error de **CSP** al cargar el script redirigido, añade en esa web una regla con la plantilla de respuesta *"Quitar CSP y X-Frame-Options"*.

### Sobre el contador del popup
Cuenta toda petición de la pestaña que coincide con una regla activa: la página, los fetch/XHR, los scripts, las imágenes e incluso el `favicon.ico`. Si quieres que solo cuente las llamadas a la API, limita la regla a "XHR / fetch" en *Tipos de recurso*. Las peticiones redirigidas por los parámetros solo se cuentan una vez.

### Limitaciones del navegador (no se pueden evitar en MV3)
- En las cabeceras de petición solo existen las operaciones *poner* y *quitar*.
- No funciona en páginas internas (`chrome://`, `about:`) ni en las tiendas de extensiones.
- Para añadir parámetros se hace una redirección interna. En la página principal verás la URL cambiada. En las peticiones `fetch` o XHR a otros dominios, esa redirección puede afectar a CORS.
- Las cabeceras que cambias **no aparecen** en la pestaña Network de DevTools, pero sí llegan al servidor.
