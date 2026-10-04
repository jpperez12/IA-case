import { agregarLinea, existe, rutas } from "./archivos.ts"

export type ResultadoControl = "creada" | "existente" | "bloqueada" | "pendiente_confirmacion" | "error"

export type FilaControl = {
  solicitud_id: string
  resultado: ResultadoControl
  numero_oc: string | null
  retroactiva: boolean
  bloqueos: string[]
  confirmaciones: string[]
}

const ENCABEZADO = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts"

/** Escapa un valor para CSV (comillas si trae coma, comilla o salto de línea). */
const celda = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** HU-5: cada intento de crear una OC (exitoso, bloqueado o pendiente) agrega una fila a out/control.csv. */
export function registrarControl(raiz: string, fila: FilaControl): void {
  const ruta = rutas.out(raiz, "control.csv")
  if (!existe(ruta)) agregarLinea(ruta, ENCABEZADO)
  const valores = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc ?? "",
    String(fila.retroactiva),
    fila.bloqueos.join("|"),
    fila.confirmaciones.join("|"),
    new Date().toISOString(),
  ]
  agregarLinea(ruta, valores.map(celda).join(","))
}
