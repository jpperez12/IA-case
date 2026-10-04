import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join, normalize, resolve, sep } from "node:path"
import { ejecutarTurno } from "./agent/ciclo.ts"
import { leerConfig } from "./agent/config.ts"
import { cargarSystemPrompt } from "./agent/prompt.ts"
import { guardarSesion, nuevaSesion, obtenerSesion } from "./agent/sesiones.ts"
import { crearLlm } from "./llm/index.ts"

const raiz = resolve(import.meta.dir, "..")
const config = leerConfig()
const llm = crearLlm(config)
const system = cargarSystemPrompt(raiz)
const enCurso = new Set<string>()

const MAX_CUERPO = 64 * 1024
const MAX_MENSAJE = 4000
const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".jsonl": "text/plain; charset=utf-8",
  ".csv": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".pdf": "application/pdf",
}

function json(res: ServerResponse, estado: number, cuerpo: unknown): void {
  res.writeHead(estado, { "content-type": TIPOS[".json"], "cache-control": "no-store" })
  res.end(JSON.stringify(cuerpo))
}

async function leerCuerpo(req: IncomingMessage): Promise<unknown> {
  let total = 0
  const partes: Buffer[] = []
  for await (const parte of req) {
    total += (parte as Buffer).length
    if (total > MAX_CUERPO) throw new Error("cuerpo demasiado grande")
    partes.push(parte as Buffer)
  }
  return JSON.parse(Buffer.concat(partes).toString("utf8") || "{}")
}

/** Si ACCESS_KEY está definida, la API la exige (cabecera x-access-key). Protege tu clave del modelo en un link público. */
const autorizado = (req: IncomingMessage): boolean => !config.claveAcceso || req.headers["x-access-key"] === config.claveAcceso

async function chat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!llm) return json(res, 503, { error: "El servidor no tiene configurada la clave del modelo (ANTHROPIC_API_KEY)." })
  let cuerpo: { sessionId?: unknown; message?: unknown }
  try {
    cuerpo = (await leerCuerpo(req)) as typeof cuerpo
  } catch {
    return json(res, 400, { error: "El cuerpo debe ser JSON válido de máximo 64 KB." })
  }
  const mensaje = typeof cuerpo.message === "string" ? cuerpo.message.trim() : ""
  if (!mensaje || mensaje.length > MAX_MENSAJE) return json(res, 400, { error: `El mensaje debe tener entre 1 y ${MAX_MENSAJE} caracteres.` })
  const sesion = (typeof cuerpo.sessionId === "string" && obtenerSesion(raiz, cuerpo.sessionId)) || nuevaSesion()
  if (enCurso.has(sesion.id)) return json(res, 409, { error: "Esta sesión ya está procesando un mensaje." })

  enCurso.add(sesion.id)
  try {
    sesion.visibles.push({ rol: "usuario", texto: mensaje, ts: new Date().toISOString() })
    const r = await ejecutarTurno(sesion, mensaje, { llm, config, system, raiz })
    sesion.visibles.push({ rol: "asistente", texto: r.reply, llamadas: r.toolCalls, pideConfirmacion: r.needsConfirmation, error: r.error, ts: new Date().toISOString() })
    guardarSesion(raiz, sesion)
    json(res, 200, { sessionId: sesion.id, ...r })
  } finally {
    enCurso.delete(sesion.id)
  }
}

/** Sirve solo archivos dentro de out/ (evidencias, control.csv, payloads). Nada fuera de esa carpeta. */
function archivoOut(res: ServerResponse, ruta: string): void {
  const base = join(raiz, "out")
  const destino = normalize(join(raiz, ruta))
  if (!destino.startsWith(base + sep) || destino.includes(`${sep}sesiones${sep}`)) return json(res, 403, { error: "Ruta no permitida." })
  try {
    if (!statSync(destino).isFile()) throw new Error()
    res.writeHead(200, { "content-type": TIPOS[extname(destino)] ?? "application/octet-stream", "cache-control": "no-store" })
    res.end(readFileSync(destino))
  } catch {
    json(res, 404, { error: "El archivo aún no existe." })
  }
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost")
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": TIPOS[".html"] })
      return void res.end(readFileSync(join(raiz, "web", "index.html")))
    }
    if (req.method === "GET" && url.pathname === "/api/health")
      return json(res, 200, { ok: true, provider: config.proveedor, model: config.modelo, configurado: llm !== null, requiereClave: Boolean(config.claveAcceso) })
    if (url.pathname.startsWith("/api/") && !autorizado(req)) return json(res, 401, { error: "Clave de acceso inválida." })
    if (req.method === "POST" && url.pathname === "/api/chat") return await chat(req, res)
    if (req.method === "GET" && url.pathname.startsWith("/api/sessions/")) {
      const s = obtenerSesion(raiz, decodeURIComponent(url.pathname.slice("/api/sessions/".length)))
      return s ? json(res, 200, { sessionId: s.id, historial: s.visibles, esperaConfirmacion: s.esperaConfirmacion }) : json(res, 404, { error: "Sesión no encontrada." })
    }
    if (req.method === "GET" && url.pathname === "/api/casos")
      return json(res, 200, { casos: readdirSync(join(raiz, "fixtures", "reto-03", "solicitudes")).sort() })
    if (req.method === "GET" && url.pathname === "/api/archivo") return archivoOut(res, url.searchParams.get("ruta") ?? "")
    json(res, 404, { error: "Ruta no encontrada." })
  } catch {
    json(res, 500, { error: "Error interno del servidor." })
  }
})

servidor.listen(config.puerto, () => {
  console.log(`Agente OC escuchando en http://localhost:${config.puerto} · proveedor ${config.proveedor} · modelo ${config.modelo}`)
  if (!llm) console.warn("Sin ANTHROPIC_API_KEY: el chat responderá 503 hasta configurarla. demo.ts funciona sin clave.")
})
