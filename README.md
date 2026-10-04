# Reto 03 — Agente conversacional "Órdenes de Compra SAP"

Agente que lee el paquete de compra (solicitud, cotización, aprobación y factura si existe), lo valida contra los maestros con las reglas RC1–RC10, muestra la OC tal como quedaría en SAP, genera la evidencia de aprobación y crea la OC en un SAP simulado. Las excepciones se bloquean o se devuelven a la analista para su confirmación.

- **Link de prueba:** https://agente-ordenes-compra.onrender.com
- **Clave de acceso al link:** Periferia2026 — el front la pide al abrir

## Requisitos

[Bun](https://bun.sh) 1.1 o superior. No necesita base de datos ni servicios externos, salvo el proveedor del modelo para el chat.

## Levantar en local (un comando)

```bash
cp .env.example .env        # y escribe tu GEMINI_API_KEY (gratis) o ANTHROPIC_API_KEY
bun install && bun run dev  # front + backend en http://localhost:3000
```

Bun carga `.env` automáticamente. Sin clave, el servidor arranca igual y el chat responde con un mensaje claro; `demo.ts` funciona sin clave.

## Demo sin modelo

```bash
bun install && bun run demo.ts
```

El demo limpia `out/`, procesa los 6 casos llamando directamente a las herramientas e imprime por caso `apta`, bloqueos, confirmaciones, `retroactiva` y número de OC o motivo. Además muestra:

- los controles del ciclo: el modelo no puede auto-confirmarse ni alterar el precio de la OC;
- la confirmación explícita de `sol-004`, `sol-005` y `sol-006`;
- la idempotencia de `sol-001`;
- el contenido de `out/control.csv`;
- la verificación de que `modulo/` está sincronizado con la aplicación.

`bun run scripts/prueba-ciclo.ts` prueba el ciclo del agente con un modelo guionado: tope de iteraciones, confirmación humana y errores del proveedor.

## Variables de entorno

| Variable | Obligatoria | Uso |
|---|---|---|
| `GEMINI_API_KEY` | Para el chat (una de las dos) | Clave de Google Gemini, nivel gratuito. Se obtiene en aistudio.google.com |
| `ANTHROPIC_API_KEY` | Para el chat (una de las dos) | Clave de Anthropic, pago por uso. Se obtiene en console.anthropic.com |
| `LLM_PROVIDER` | No | `gemini` o `anthropic`. Si se omite, se usa el que tenga clave |
| `ACCESS_KEY` | Recomendada en el link | Si se define, la API exige esta clave (cabecera `x-access-key`) y el front la pide al abrir |
| `LLM_MODEL` | No | Por defecto `gemini-flash-latest` (Gemini) o `claude-sonnet-4-6` (Anthropic) |
| `MAX_ITERACIONES` | No | Tope de llamadas herramienta → modelo por turno (25) |
| `MAX_TOKENS_SESION` | No | Tope de tokens por sesión (300.000) |
| `MAX_TOKENS_RESPUESTA` | No | Máximo de tokens por respuesta del modelo (4.096) |
| `LLM_TIMEOUT_MS` | No | Timeout al proveedor (60.000 ms) |
| `PORT` | No | Puerto HTTP (3000) |

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId?, message }` → `{ sessionId, reply, toolCalls[], needsConfirmation, error? }` |
| `GET` | `/api/sessions/:id` | Historial visible de la sesión y si espera confirmación |
| `GET` | `/api/health` | `{ ok, provider, model, configurado, requiereClave }`, sin exponer claves |
| `GET` | `/api/casos` | Casos disponibles en `fixtures/reto-03/solicitudes/` |
| `GET` | `/api/archivo?ruta=out/...` | Lectura de archivos generados (solo dentro de `out/`) |

## Despliegue en Render

1. Sube este repositorio a GitHub.
2. En Render: **New → Blueprint** y elige el repositorio. Render lee `render.yaml` y construye el `Dockerfile`.
3. Render pide `GEMINI_API_KEY` y `ACCESS_KEY`: escríbelas ahí, nunca en el repositorio.
4. Copia la URL pública en este README.

El plan gratuito de Render apaga el servicio tras unos 15 minutos sin uso: el primer acceso tarda cerca de un minuto. Ábrelo antes de la defensa. Su disco no es persistente, así que `out/` se reinicia con cada despliegue.

## Estructura

```
agent/prompt.md                 comportamiento del agente (system prompt)
src/knowledge/ordenes-compra.md conocimiento del proceso
src/tools/oc.ts                 herramientas oc_* (zod, nunca lanzan)
src/tools/registro.ts           registro, validación de argumentos y log de llamadas
src/dominio/                    lectura del paquete, reglas RC1–RC10, payload, evidencia, control
src/sap/adapter.ts · mock.ts    interfaz SapAdapter y SAP simulado sobre out/sap/
src/llm/adapter.ts               interfaz del proveedor
src/llm/anthropic.ts · openai-compatible.ts  implementaciones (Claude; Gemini y compatibles)
src/agent/                      ciclo del agente, sesiones, configuración
src/server.ts                   API HTTP y front
web/index.html                  chat
modulo/                         agente empaquetado (bonus), generado con `bun run modulo`
demo.ts                         verificación sin modelo
```

## Archivos que genera

| Ruta | Contenido |
|---|---|
| `out/<caso>/payload.json` | OC tal como se envía a SAP |
| `out/<caso>/trazabilidad.json` | Fuente de cada campo de la OC |
| `out/<caso>/aprobacion.txt` · `.pdf` | Evidencia de aprobación con sha256 |
| `out/sap/ordenes.jsonl` | Órdenes creadas en el SAP simulado |
| `out/control.csv` | Un registro por intento de creación, con `retroactiva` |
| `out/log.jsonl` | Todas las llamadas a herramientas |

## Proveedor del modelo

El link público usa **Google Gemini** (`gemini-3.1-flash-lite`) en su nivel gratuito, que permite unas 15 solicitudes por minuto. Un caso usa entre 4 y 6, así que si se procesan varios casos seguidos el agente puede pedir esperar un minuto. Con `ANTHROPIC_API_KEY` y `LLM_PROVIDER=anthropic` usa Claude, sin tocar el código del agente.
