import { join } from "node:path"
import { existe, leerJson, leerTexto, rutas } from "./archivos.ts"
import { exito, fallo, type Resultado } from "./resultado.ts"
import { fechaDe, leerMontoCop, normalizarNit, sumarDias } from "./texto.ts"
import {
  AprobacionCrudaSchema,
  CorreoSchema,
  SolicitudSchema,
  type Aprobacion,
  type AprobacionCruda,
  type Cotizacion,
  type Factura,
  type Paquete,
} from "./tipos.ts"

/** Solo nombres de carpeta simples: evita que un argumento del modelo salga de fixtures/ (path traversal). */
export const CASO_VALIDO = /^[a-z0-9][a-z0-9-]{0,63}$/

const buscar = (texto: string, patron: RegExp): string | null => patron.exec(texto)?.[1]?.trim() ?? null

/** Extrae los datos de la cotización en texto. Devuelve fallo si el total no es legible. */
export function parsearCotizacion(texto: string): Resultado<Cotizacion> {
  const total = /TOTAL[^:\n]*:\s*(COP|USD)\s*([\d.,]+)/i.exec(texto)
  const monto = total ? leerMontoCop(total[2]!) : Number.NaN
  if (!total || Number.isNaN(monto)) return fallo("La cotización no tiene un TOTAL numérico legible.")
  const fecha = buscar(texto, /^Fecha:\s*(\d{4}-\d{2}-\d{2})/m)
  const dias = buscar(texto, /Validez[^:\n]*:\s*(\d+)\s*d[ií]as/i)
  const nit = buscar(texto, /^NIT:\s*([\d.\-]+)/m)
  return exito({
    numero: buscar(texto, /COTIZACI[ÓO]N\s+(\S+)/i),
    proveedor: buscar(texto, /^Proveedor:\s*(.+)$/m) ?? "",
    nit: nit ? normalizarNit(nit) : null,
    total: monto,
    moneda: total[1]!.toUpperCase(),
    validez_hasta: fecha && dias ? sumarDias(fecha, Number(dias)) : null,
    texto,
  })
}

export function parsearFactura(texto: string): Resultado<Factura> {
  const numero = buscar(texto, /No\.\s*(\S+)/)
  const fecha = buscar(texto, /Fecha de emisi[óo]n:\s*(\d{4}-\d{2}-\d{2})/i)
  const total = buscar(texto, /^TOTAL:\s*(?:COP|USD)\s*([\d.,]+)/m)
  if (!numero || !fecha || !total) return fallo("La factura no tiene número, fecha de emisión o total legibles.")
  return exito({ numero, fecha, total: leerMontoCop(total) })
}

/** "Aprobado" como palabra, sin estar negado ("no aprobado"). */
export function contieneAprobado(cuerpo: string): boolean {
  return /\baprobad[oa]\b/i.test(cuerpo) && !/\bno\s+(ha\s+sido\s+|est[aá]\s+)?aprobad[oa]\b/i.test(cuerpo)
}

export function normalizarAprobacion(cruda: AprobacionCruda): Aprobacion {
  return { de: cruda.de.toLowerCase(), fecha: cruda.fecha, aprobado: contieneAprobado(cruda.cuerpo), texto: cruda.cuerpo }
}

/** Lee un adjunto opcional: si no existe es null y se anota como faltante; si existe pero es inválido, fallo. */
function opcional<T>(ruta: string, nombre: string, faltantes: string[], leer: () => Resultado<T>): Resultado<T | null> {
  if (!existe(ruta)) {
    faltantes.push(nombre)
    return exito(null)
  }
  return leer()
}

export function leerAprobacionCruda(raiz: string, caso: string): Resultado<AprobacionCruda> {
  return leerJson(join(rutas.caso(raiz, caso), "aprobacion.json"), AprobacionCrudaSchema, "aprobacion.json")
}

/** HU-1: lee correo, solicitud, cotización, aprobación y factura (si hay) y los normaliza. */
export function leerPaquete(raiz: string, caso: string): Resultado<Paquete> {
  if (!CASO_VALIDO.test(caso)) return fallo(`"${caso}" no es un nombre de caso válido (ej. sol-001).`)
  const dir = rutas.caso(raiz, caso)
  if (!existe(dir)) return fallo(`No existe el caso "${caso}". Revisa el nombre o pide el paquete al solicitante.`)

  const faltantes: string[] = []
  const correo = existe(join(dir, "correo.json"))
    ? leerJson(join(dir, "correo.json"), CorreoSchema, "correo.json")
    : fallo("Paquete incompleto: falta correo.json. Pide al solicitante reenviar el correo original.")
  if (!correo.ok) return correo
  const solicitud = existe(join(dir, "solicitud.json"))
    ? leerJson(join(dir, "solicitud.json"), SolicitudSchema, "solicitud.json")
    : fallo("Paquete incompleto: falta la solicitud (Excel). Pide al solicitante adjuntarla.")
  if (!solicitud.ok) return solicitud

  const cotizacion = opcional(join(dir, "cotizacion.txt"), "cotizacion", faltantes, () => {
    const texto = leerTexto(join(dir, "cotizacion.txt"))
    return texto.ok ? parsearCotizacion(texto.data) : texto
  })
  if (!cotizacion.ok) return cotizacion
  const aprobacion = opcional(join(dir, "aprobacion.json"), "aprobacion", faltantes, () => {
    const cruda = leerAprobacionCruda(raiz, caso)
    return cruda.ok ? exito(normalizarAprobacion(cruda.data)) : cruda
  })
  if (!aprobacion.ok) return aprobacion
  // La factura solo existe en casos retroactivos: su ausencia es lo normal, no un faltante.
  const rutaFactura = join(dir, "factura.txt")
  const factura = existe(rutaFactura) ? leerTexto(rutaFactura) : null
  const facturaParseada = factura && factura.ok ? parsearFactura(factura.data) : null
  if (facturaParseada && !facturaParseada.ok) return facturaParseada

  return exito({
    correo: correo.data,
    solicitud: solicitud.data,
    cotizacion: cotizacion.data,
    aprobacion: aprobacion.data,
    factura: facturaParseada ? facturaParseada.data : null,
    faltantes,
  })
}

export const fechaAprobacion = (a: Aprobacion): string => fechaDe(a.fecha)
