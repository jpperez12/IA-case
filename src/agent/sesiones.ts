import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { escribir, existe, rutas } from "../dominio/archivos.ts"
import type { Mensaje } from "../llm/adapter.ts"

export type LlamadaVisible = { nombre: string; args: unknown; ok: boolean; resumen: string }
export type TurnoVisible = {
  rol: "usuario" | "asistente"
  texto: string
  llamadas?: LlamadaVisible[]
  pideConfirmacion?: boolean
  error?: boolean
  ts: string
}
export type Sesion = {
  id: string
  mensajes: Mensaje[] // historial que ve el modelo
  visibles: TurnoVisible[] // historial que ve la persona
  tokens: number
  esperaConfirmacion: boolean
}

const ID_VALIDO = /^[a-zA-Z0-9-]{8,64}$/
const memoria = new Map<string, Sesion>()

const archivo = (raiz: string, id: string) => rutas.out(raiz, "sesiones", `${id}.json`)

export function nuevaSesion(): Sesion {
  return { id: randomUUID(), mensajes: [], visibles: [], tokens: 0, esperaConfirmacion: false }
}

/** Memoria primero; si el proceso se reinició, se recupera del archivo. */
export function obtenerSesion(raiz: string, id: string): Sesion | null {
  if (!ID_VALIDO.test(id)) return null
  const enMemoria = memoria.get(id)
  if (enMemoria) return enMemoria
  if (!existe(archivo(raiz, id))) return null
  const s = JSON.parse(readFileSync(archivo(raiz, id), "utf8")) as Sesion
  memoria.set(id, s)
  return s
}

export function guardarSesion(raiz: string, s: Sesion): void {
  memoria.set(s.id, s)
  escribir(archivo(raiz, s.id), JSON.stringify(s))
}
