import { z } from "zod"
import { agregarLinea, rutas } from "../dominio/archivos.ts"
import { describirErrores } from "../dominio/tipos.ts"
import { mensajeDe } from "../dominio/resultado.ts"
import type { ContextoHerramienta, Herramienta } from "./herramienta.ts"
import * as oc from "./oc.ts"

type Ejecutable = Herramienta<z.ZodRawShape>
type EjecutarCrudo = (args: unknown, ctx: ContextoHerramienta) => Promise<string>

/** Nombre que ve el modelo: <archivo>_<export>. Agregar un archivo de herramientas = una línea aquí. */
const ARCHIVOS: Record<string, Record<string, Ejecutable>> = { oc }

export const HERRAMIENTAS: Record<string, Ejecutable> = Object.fromEntries(
  Object.entries(ARCHIVOS).flatMap(([archivo, exports]) =>
    Object.entries(exports).map(([nombre, h]) => [`${archivo}_${nombre}`, h] as const)),
)

export type EspecHerramienta = { nombre: string; descripcion: string; esquema: Record<string, unknown> }

/** Esquemas JSON derivados de los mismos zod que valida el backend: una sola fuente de verdad. */
export function especificaciones(): EspecHerramienta[] {
  return Object.entries(HERRAMIENTAS).map(([nombre, h]) => {
    const { $schema: _omitido, ...esquema } = z.toJSONSchema(z.object(h.args)) as Record<string, unknown>
    return { nombre, descripcion: h.description, esquema }
  })
}

export type Ejecucion = { nombre: string; args: unknown; ok: boolean; resumen: string; resultado: string }

function resumir(resultado: string): { ok: boolean; resumen: string } {
  try {
    const r = JSON.parse(resultado) as { ok?: boolean; error?: string; data?: { resumen?: string } }
    return r.ok ? { ok: true, resumen: r.data?.resumen ?? "ok" } : { ok: false, resumen: r.error ?? "error" }
  } catch {
    return { ok: false, resumen: "respuesta no JSON" }
  }
}

const recortar = (v: unknown): unknown => {
  const s = JSON.stringify(v) ?? ""
  return s.length > 2000 ? `${s.slice(0, 2000)}…` : v
}

/** Valida los argumentos con zod, ejecuta, y deja la llamada en out/log.jsonl (CA4). Nunca lanza. */
export async function ejecutar(nombre: string, args: unknown, ctx: ContextoHerramienta): Promise<Ejecucion> {
  const h = HERRAMIENTAS[nombre]
  let resultado: string
  if (!h) {
    resultado = JSON.stringify({ ok: false, error: `La herramienta ${nombre} no existe.` })
  } else {
    const parseo = z.object(h.args).safeParse(args ?? {})
    if (!parseo.success) {
      resultado = JSON.stringify({ ok: false, error: `Argumentos inválidos: ${describirErrores(parseo.error)}` })
    } else {
      try {
        resultado = await (h.execute as EjecutarCrudo)(parseo.data, ctx)
      } catch (e) {
        resultado = JSON.stringify({ ok: false, error: `Error inesperado en ${nombre}: ${mensajeDe(e)}` })
      }
    }
  }
  const { ok, resumen } = resumir(resultado)
  agregarLinea(rutas.out(ctx.directory, "log.jsonl"),
    JSON.stringify({ ts: new Date().toISOString(), sessionId: ctx.sessionId, herramienta: nombre, args: recortar(args), ok, resumen }))
  return { nombre, args, ok, resumen, resultado }
}
