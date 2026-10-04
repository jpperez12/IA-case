/** Utilidades de normalización de texto, números y fechas. Funciones puras. */

/** "TecnoSuministros S.A.S." → "tecnosuministros" (sin tildes, puntuación ni sufijo societario). */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(sas|ltda|sa|s a s|s a)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** "900.555.111-2" → "900555111" (sin puntos ni dígito de verificación). */
export function normalizarNit(nit: string): string {
  return nit.split("-")[0]!.replace(/\D/g, "")
}

/** "11.400.000" o "11.400.000,50" (formato colombiano) → 11400000 / 11400000.5 */
export function leerMontoCop(texto: string): number {
  const limpio = texto.trim().replace(/\./g, "").replace(",", ".")
  return limpio === "" ? Number.NaN : Number(limpio)
}

/** Parte de fecha de un ISO con zona: "2026-08-21T10:02:00-05:00" → "2026-08-21" (fecha local del correo). */
export const fechaDe = (iso: string): string => iso.slice(0, 10)

/** Suma días a una fecha YYYY-MM-DD. */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export const mismoTexto = (a: string, b: string): boolean => normalizarNombre(a) === normalizarNombre(b)

export const formatoCop = (n: number): string => `$${n.toLocaleString("es-CO")}`

/** JSON con llaves ordenadas: permite comparar objetos sin depender del orden de las propiedades. */
export function jsonCanonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(",")}]`
  if (valor !== null && typeof valor === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entradas.map(([k, v]) => `${JSON.stringify(k)}:${jsonCanonico(v)}`).join(",")}}`
  }
  return JSON.stringify(valor)
}
