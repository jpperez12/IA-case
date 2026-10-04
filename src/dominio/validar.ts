import { buscarProveedor } from "./maestros.ts"
import { fechaAprobacion } from "./paquete.ts"
import { formatoCop, mismoTexto } from "./texto.ts"
import type { CentroCosto, Derivado, Hallazgo, Maestros, Paquete, Proveedor, Validacion } from "./tipos.ts"

/** Parámetros de las reglas. Cambiar un umbral no toca ni el servidor ni el agente. */
export const PARAMETROS = { toleranciaCotizacion: 0.02, toleranciaRedondeo: 1 } as const

type Contexto = { p: Paquete; m: Maestros; proveedor: Proveedor | null; centro: CentroCosto | null }
type Aporte = { bloqueos?: Hallazgo[]; confirmaciones?: Hallazgo[]; derivados?: Record<string, Derivado> }

const h = (codigo: string, detalle: string, accion_sugerida: string, valores?: Hallazgo["valores"]): Hallazgo =>
  valores ? { codigo, detalle, accion_sugerida, valores } : { codigo, detalle, accion_sugerida }

/** RC1 · El proveedor existe (por NIT o nombre) y está activo. */
function rc1Proveedor({ p, proveedor }: Contexto): Aporte {
  const s = p.solicitud
  const id = s.proveedor_nit ? `NIT ${s.proveedor_nit}` : `nombre "${s.proveedor_nombre}"`
  if (!proveedor)
    return { bloqueos: [h("RC1", `El proveedor ${s.proveedor_nombre} (${id}) no existe en el maestro de proveedores.`,
      "Solicitar a compras la creación del proveedor en SAP (RUT, certificación bancaria, Cámara de Comercio) y reprocesar la solicitud.")] }
  if (!proveedor.activo)
    return { bloqueos: [h("RC1", `El proveedor ${proveedor.nombre} (código ${proveedor.codigo_sap}) está inactivo.`,
      "Pedir a compras reactivar el proveedor o cotizar con un proveedor activo.")] }
  return {}
}

/** RC4 · La subárea pertenece al centro de costo. */
function rc4Subarea({ p, centro }: Contexto): Aporte {
  const s = p.solicitud
  if (!centro)
    return { bloqueos: [h("RC4", `El centro de costo ${s.centro_costo} no existe en el maestro.`,
      "Confirmar con el solicitante el centro de costo correcto.")] }
  if (!centro.subareas.some((sa) => mismoTexto(sa, s.subarea)))
    return { bloqueos: [h("RC4", `La subárea "${s.subarea}" no pertenece a ${centro.centro_costo}. Subáreas válidas: ${centro.subareas.join(", ")}.`,
      "Corregir la subárea con el solicitante.")] }
  return {}
}

/** Dónde sí puede aprobar un correo y si su tope cubre el valor: sirve para sugerir la corrección más probable. */
function dondeApruebaCorreo(email: string, valor: number, m: Maestros): string {
  const lugares = m.centros.flatMap((c) =>
    c.aprobadores.filter((a) => a.email.toLowerCase() === email).map((a) =>
      `${c.centro_costo} ${c.nombre ?? ""} (tope ${formatoCop(a.tope)}, ${a.tope >= valor ? "cubre" : "no cubre"} el valor)`.replace("  ", " ")))
  return lugares.length ? `${email} solo aprueba en: ${lugares.join("; ")}.` : `${email} no es aprobador en ningún centro de costo.`
}

/** RC2 + RC3 · Aprobación existe, dice "Aprobado", viene de un aprobador del centro y el monto cabe en su tope. */
function rc2rc3Aprobacion({ p, m, centro }: Contexto): Aporte {
  const { aprobacion: ap, solicitud: s } = p
  if (!ap) return { bloqueos: [h("RC2", "No hay correo de aprobación en el paquete.", "Pedir al solicitante el correo de aprobación de su líder.")] }
  if (!ap.aprobado) return { bloqueos: [h("RC2", `El correo de ${ap.de} no contiene la palabra "Aprobado".`, "Pedir al líder una aprobación explícita.")] }
  if (!centro) return {}
  const conTope = centro.aprobadores.filter((a) => a.tope >= s.valor_total).map((a) => `${a.email} (tope ${formatoCop(a.tope)})`)
  const escalar = conTope.length ? `Obtener la aprobación de: ${conTope.join(", ")}` :
    `Ningún aprobador de ${centro.centro_costo} tiene tope para ${formatoCop(s.valor_total)} (${centro.aprobadores.map((a) => `${a.email}: ${formatoCop(a.tope)}`).join(", ")}); escalar a dirección`
  const aprobador = centro.aprobadores.find((a) => a.email.toLowerCase() === ap.de)
  if (!aprobador)
    return { bloqueos: [h("RC2", `${ap.de} no es aprobador de ${centro.centro_costo}. ${dondeApruebaCorreo(ap.de, s.valor_total, m)}`,
      `${escalar}. Si el gasto realmente corresponde a otro centro de costo, el solicitante debe corregir la solicitud y reprocesarla.`,
      { aprobador: ap.de, centro_costo: centro.centro_costo, valor_total: s.valor_total })] }
  if (s.valor_total > aprobador.tope)
    return { bloqueos: [h("RC3", `El valor ${formatoCop(s.valor_total)} supera el tope de ${aprobador.email} (${formatoCop(aprobador.tope)}).`,
      `${escalar}.`, { valor_total: s.valor_total, tope: aprobador.tope })] }
  return {}
}

/** RC5 · Cotización vs. solicitud dentro del 2 %. */
function rc5Cotizacion({ p }: Contexto): Aporte {
  const { cotizacion: c, solicitud: s } = p
  if (!c) return { confirmaciones: [h("RC5", "La solicitud no trae cotización del proveedor.", "Confirmar que se crea la OC sin cotización o pedirla al solicitante.")] }
  const diferencia = Math.abs(c.total - s.valor_total) / s.valor_total
  const aportes: Hallazgo[] = []
  if (c.moneda !== s.moneda)
    aportes.push(h("RC5", `La cotización está en ${c.moneda} y la solicitud en ${s.moneda}.`, "Confirmar la moneda con el solicitante.",
      { moneda_solicitud: s.moneda, moneda_cotizacion: c.moneda }))
  if (diferencia > PARAMETROS.toleranciaCotizacion)
    aportes.push(h("RC5", `La cotización (${formatoCop(c.total)}) difiere ${(diferencia * 100).toFixed(1)} % de la solicitud (${formatoCop(s.valor_total)}); el máximo es ${PARAMETROS.toleranciaCotizacion * 100} %.`,
      "Confirmar con qué valor se crea la OC. La OC se crea con el valor de la solicitud (el aprobado); si el proveedor facturará el valor cotizado, pedir nueva aprobación.",
      { valor_solicitud: s.valor_total, valor_cotizacion: c.total, diferencia_pct: Number((diferencia * 100).toFixed(2)) }))
  return { confirmaciones: aportes }
}

/** RC6 + RC7 · IVA y condiciones de pago: si faltan se derivan del proveedor; si vienen, deben existir en el maestro. */
function rc6rc7Derivados({ p, m, proveedor }: Contexto): Aporte {
  const s = p.solicitud
  const aporte: Required<Aporte> = { bloqueos: [], confirmaciones: [], derivados: {} }
  if (!s.indicador_iva && proveedor) {
    aporte.derivados.indicador_iva = { valor: proveedor.indicador_iva_default, fuente: "maestro.proveedores", nota: "indicador_iva_default del proveedor" }
    aporte.confirmaciones.push(h("RC6", `La solicitud no informa indicador de IVA; se propone ${proveedor.indicador_iva_default} (default del proveedor).`,
      "Confirmar el indicador de IVA propuesto.", { indicador_iva_propuesto: proveedor.indicador_iva_default }))
  } else if (s.indicador_iva && !m.indicadoresIva.some((i) => i.codigo === s.indicador_iva)) {
    aporte.bloqueos.push(h("RC6", `El indicador de IVA ${s.indicador_iva} no existe en el maestro.`, "Corregir el indicador de IVA con el solicitante."))
  }
  if (!s.condiciones_pago && proveedor) {
    aporte.derivados.condiciones_pago = { valor: proveedor.condiciones_pago_default, fuente: "maestro.proveedores", nota: "condiciones_pago_default del proveedor (RC7, solo se informa)" }
  } else if (s.condiciones_pago && !m.condicionesPago.some((c) => c.codigo === s.condiciones_pago)) {
    aporte.bloqueos.push(h("RC7", `La condición de pago ${s.condiciones_pago} no existe en el maestro.`, "Corregir la condición de pago con el solicitante."))
  }
  return aporte
}

/** RC8 · Factura con fecha anterior a la solicitud → OC retroactiva. */
function rc8Retroactiva({ p }: Contexto): Aporte {
  const { factura: f, solicitud: s } = p
  if (!f || f.fecha >= s.fecha_solicitud) return {}
  return { confirmaciones: [h("RC8", `OC retroactiva: la factura ${f.numero} es del ${f.fecha}, anterior a la solicitud del ${s.fecha_solicitud}.`,
    "Confirmar la creación; quedará marcada retroactiva = true en el log de control.",
    { factura: f.numero, fecha_factura: f.fecha, fecha_solicitud: s.fecha_solicitud })] }
}

/** RC9 · La aprobación no puede ser anterior a la solicitud. */
function rc9FechaAprobacion({ p }: Contexto): Aporte {
  const { aprobacion: ap, solicitud: s } = p
  if (!ap || fechaAprobacion(ap) >= s.fecha_solicitud) return {}
  return { confirmaciones: [h("RC9", `La aprobación (${fechaAprobacion(ap)}) es anterior a la solicitud (${s.fecha_solicitud}).`,
    "Confirmar que la aprobación corresponde a esta solicitud.", { fecha_aprobacion: fechaAprobacion(ap), fecha_solicitud: s.fecha_solicitud })] }
}

/** RC10 · cantidad × valor unitario = valor total (± 1). */
function rc10Aritmetica({ p }: Contexto): Aporte {
  const s = p.solicitud
  const calculado = s.cantidad * s.valor_unitario
  if (Math.abs(calculado - s.valor_total) <= PARAMETROS.toleranciaRedondeo) return {}
  return { bloqueos: [h("RC10", `${s.cantidad} × ${formatoCop(s.valor_unitario)} = ${formatoCop(calculado)}, pero el valor total dice ${formatoCop(s.valor_total)}.`,
    "Pedir al solicitante corregir cantidades o valores en el Excel.", { calculado, valor_total: s.valor_total })] }
}

/** Hallazgos informativos: no bloquean ni piden confirmación. */
function observaciones({ p, proveedor }: Contexto): string[] {
  const { cotizacion: c, solicitud: s } = p
  const notas: string[] = []
  if (c?.nit && proveedor && c.nit !== proveedor.nit) notas.push(`El NIT de la cotización (${c.nit}) no coincide con el del proveedor (${proveedor.nit}).`)
  if (c?.validez_hasta && c.validez_hasta < s.fecha_solicitud) notas.push(`La cotización venció el ${c.validez_hasta}, antes de la solicitud.`)
  if (p.faltantes.length) notas.push(`Adjuntos faltantes: ${p.faltantes.join(", ")}.`)
  return notas
}

const REGLAS = [rc1Proveedor, rc4Subarea, rc2rc3Aprobacion, rc5Cotizacion, rc6rc7Derivados, rc8Retroactiva, rc9FechaAprobacion, rc10Aritmetica]

/** HU-2: aplica RC1–RC10. Función pura: mismo paquete y maestros → mismo resultado. */
export function validar(p: Paquete, m: Maestros): Validacion {
  const ctx: Contexto = {
    p,
    m,
    proveedor: buscarProveedor(p.solicitud, m.proveedores),
    centro: m.centros.find((c) => c.centro_costo === p.solicitud.centro_costo) ?? null,
  }
  const aportes = REGLAS.map((regla) => regla(ctx))
  const bloqueos = aportes.flatMap((a) => a.bloqueos ?? [])
  return {
    apta: bloqueos.length === 0,
    bloqueos,
    confirmaciones: aportes.flatMap((a) => a.confirmaciones ?? []),
    derivados: Object.assign({}, ...aportes.map((a) => a.derivados ?? {})),
    retroactiva: rc8Retroactiva(ctx).confirmaciones !== undefined,
    observaciones: observaciones(ctx),
  }
}
