/** Contrato de salida común: las funciones del dominio nunca lanzan, devuelven éxito o fallo. */
export type Exito<T> = { ok: true; data: T }
export type Fallo = { ok: false; error: string; detalle?: unknown }
export type Resultado<T> = Exito<T> | Fallo

export const exito = <T>(data: T): Exito<T> => ({ ok: true, data })

export const fallo = (error: string, detalle?: unknown): Fallo =>
  detalle === undefined ? { ok: false, error } : { ok: false, error, detalle }

/** Convierte cualquier valor lanzado en un mensaje legible. */
export const mensajeDe = (e: unknown): string => (e instanceof Error ? e.message : String(e))
