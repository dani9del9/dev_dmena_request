# ReqTweak

Extensión para Chrome y Firefox, al estilo de Requestly:

- **Cabeceras de la petición**: poner o quitar (Authorization, Cookie, User-Agent, Origin, cabeceras propias…).
- **Cabeceras de la respuesta**: poner, agregar o quitar (CORS abierto, quitar CSP o X-Frame-Options…).
- **Parámetros de URL**: añadir, reemplazar o quitar parámetros de la query.
- Reglas por **dominio**, por **URL con comodín** o por **regex**, filtradas por tipo de recurso.
- Interruptor general, interruptor por regla y por línea, prioridad (▲▼), duplicar, exportar e importar en JSON.
- Usa `declarativeNetRequest` (Manifest V3), así que no hace falta un script de fondo y las reglas siguen activas después de reiniciar el navegador.

## Instalar en Chrome / Edge / Brave
1. Abre `chrome://extensions`.
2. Activa el **Modo de desarrollador** (arriba a la derecha).
3. Pulsa **Cargar descomprimida** y elige la carpeta `ReqTweak`.
4. Fija el icono en la barra de herramientas.

> Chrome muestra un aviso sobre `browser_specific_settings`. Es la configuración de Firefox y se puede ignorar.

## Instalar en Firefox (versión 128 o superior)
**Temporal** (se quita al cerrar Firefox):
1. Abre `about:debugging#/runtime/this-firefox`.
2. Pulsa **Cargar complemento temporal…** y elige el `manifest.json`.

**Permanente**: comprime el contenido de la carpeta (sin la carpeta) en un .zip y fírmalo como "no listado" en https://addons.mozilla.org/developers/. Otra opción es usar Firefox Developer Edition con `xpinstall.signatures.required = false` en `about:config`.

**Importante en Firefox**: en Manifest V3, Firefox no concede automáticamente el permiso de acceso a los sitios. Si ves el aviso amarillo, pulsa **Conceder** (también puedes hacerlo en `about:addons` → ReqTweak → Permisos → "Acceder a tus datos de todos los sitios web").

## Uso
- **Popup**: interruptor general, activar o desactivar reglas y crear una "Regla para este sitio" con el dominio de la pestaña actual. Las reglas que afectan a la pestaña actual aparecen marcadas en verde.
- **Editor**: los cambios se guardan y se aplican al momento. En "Ver reglas generadas" ves el JSON exacto que se envía al navegador.

### Sintaxis de patrones
| Tipo | Ejemplo | Notas |
|---|---|---|
| Dominio(s) | `miweb.com, localhost` | Incluye los subdominios |
| URL contiene / comodín | `\|\|miweb.com/api/*` | `*` comodín, `\|\|` dominio, `\|` inicio/fin |
| Regex | `^https://(dev\|pre)\.miweb\.com/.*` | Sintaxis RE2 |

### Limitaciones del navegador (no se pueden evitar en MV3)
- En las cabeceras de petición solo existen las operaciones *poner* y *quitar*.
- No funciona en páginas internas (`chrome://`, `about:`) ni en las tiendas de extensiones.
- Para añadir parámetros se hace una redirección interna. En la página principal verás la URL cambiada. En las peticiones `fetch` o XHR a otros dominios, esa redirección puede afectar a CORS.
- Las cabeceras que cambias **no aparecen** en la pestaña Network de DevTools, pero sí llegan al servidor.
