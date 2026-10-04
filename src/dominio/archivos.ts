import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"
import { describirErrores } from "./tipos.ts"
import { exito, fallo, mensajeDe, type Resultado } from "./resultado.ts"

/** Rutas del proyecto. Todo se resuelve desde la raíz (ctx.directory), nunca con rutas absolutas fijas. */
export const rutas = {
  caso: (raiz: string, caso: string) => join(raiz, "fixtures", "reto-03", "solicitudes", caso),
  maestro: (raiz: string, nombre: string) => join(raiz, "fixtures", "reto-03", "maestros", nombre),
  out: (raiz: string, ...partes: string[]) => join(raiz, "out", ...partes),
}

export const existe = (ruta: string): boolean => existsSync(ruta)

export function leerTexto(ruta: string): Resultado<string> {
  try {
    return exito(readFileSync(ruta, "utf8"))
  } catch (e) {
    return fallo(`No se pudo leer ${ruta}: ${mensajeDe(e)}`)
  }
}

/** Lee un JSON y lo valida con su esquema; los errores salen en lenguaje claro. */
export function leerJson<T>(ruta: string, esquema: z.ZodType<T>, nombre: string): Resultado<T> {
  const texto = leerTexto(ruta)
  if (!texto.ok) return texto
  let crudo: unknown
  try {
    crudo = JSON.parse(texto.data)
  } catch {
    return fallo(`${nombre} no es un JSON válido. Pide al solicitante reenviar el archivo.`)
  }
  const parseado = esquema.safeParse(crudo)
  return parseado.success
    ? exito(parseado.data)
    : fallo(`${nombre} tiene datos inválidos (${describirErrores(parseado.error)}).`)
}

export function escribir(ruta: string, contenido: string | Uint8Array): void {
  mkdirSync(dirname(ruta), { recursive: true })
  writeFileSync(ruta, contenido)
}

export function agregarLinea(ruta: string, linea: string): void {
  mkdirSync(dirname(ruta), { recursive: true })
  appendFileSync(ruta, `${linea}\n`)
}
