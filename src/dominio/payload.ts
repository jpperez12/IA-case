import { buscarProveedor } from "./maestros.ts"
import { fechaAprobacion } from "./paquete.ts"
import { exito, fallo, type Resultado } from "./resultado.ts"
import { describirErrores, OrdenCompraSchema, type Maestros, type OrdenCompra, type Paquete, type Validacion } from "./tipos.ts"

export type Fuente =
  | "solicitud"
  | "cotizacion"
  | "derivado"
  | "constante"
  | "paquete.correo"
  | "paquete.aprobacion"
  | `maestro.${string}`
export type Traza = { campo: string; valor: string | number | null; fuente: Fuente; detalle: string }

const LIMITE_TEXTO_BREVE = 40

/** SAP limita el texto breve a 40 caracteres: se corta en el último espacio para no partir palabras. */
export function textoBreve(descripcion: string): string {
  if (descripcion.length <= LIMITE_TEXTO_BREVE) return descripcion
  const corte = descripcion.slice(0, LIMITE_TEXTO_BREVE)
  const espacio = corte.lastIndexOf(" ")
  let texto = (espacio > 20 ? corte.slice(0, espacio) : corte).replace(/[\s,;:.-]+$/, "")
  // Que no termine en un conector ("…para la mesa de"): se quitan al final, sin bajar de 20 caracteres.
  while (/\s(de|del|la|las|el|los|y|e|o|con|para|por|en|a|al)$/i.test(texto) && texto.length > 20) texto = texto.replace(/\s\S+$/, "")
  return texto
}

/** Unidad de medida a partir de la descripción: horas → H, mensual → MES, resto → UN. */
export function unidadDe(descripcion: string): "UN" | "H" | "MES" {
  if (/\bhoras?\b/i.test(descripcion)) return "H"
  if (/\b(mensual|mensualidad|por mes)\b/i.test(descripcion)) return "MES"
  return "UN"
}

export type OrdenConTrazas = { orden: OrdenCompra; trazabilidad: Traza[] }

/**
 * HU-3: arma la OC desde el paquete, los maestros y los derivados. Ningún valor viene del modelo de lenguaje:
 * cada campo queda registrado con su fuente en la trazabilidad.
 */
export function construirOrden(p: Paquete, m: Maestros, v: Validacion, evidenciaSha256: string, confirmadoPor: string | null): Resultado<OrdenConTrazas> {
  if (!v.apta) return fallo(`No se puede construir la OC: tiene bloqueos (${v.bloqueos.map((b) => b.codigo).join(", ")}).`, { bloqueos: v.bloqueos })
  const s = p.solicitud
  const proveedor = buscarProveedor(s, m.proveedores)
  if (!proveedor || !p.aprobacion) return fallo("No se puede construir la OC: falta proveedor o aprobación.")

  const trazas: Traza[] = []
  const t = <T extends string | number | null>(campo: string, valor: T, fuente: Fuente, detalle: string): T => {
    trazas.push({ campo, valor, fuente, detalle })
    return valor
  }
  const derivadoO = (campo: "indicador_iva" | "condiciones_pago", ruta: string): string => {
    const d = v.derivados[campo]
    return d ? t(ruta, d.valor, "derivado", `${d.fuente}: ${d.nota}`) : t(ruta, s[campo] ?? "", "solicitud", `solicitud.${campo}`)
  }
  const descripcion = textoBreve(s.descripcion)

  const orden: OrdenCompra = {
    referencia: {
      solicitud_id: t("referencia.solicitud_id", s.solicitud_id, "solicitud", "solicitud.solicitud_id"),
      correo_id: t("referencia.correo_id", p.correo.id, "paquete.correo", "correo.id"),
      cotizacion_ref: t("referencia.cotizacion_ref", p.cotizacion?.numero ?? null, "cotizacion", "número de la cotización"),
    },
    sociedad: t("sociedad", "1000", "constante", "sociedad fija del reto"),
    organizacion_compras: t("organizacion_compras", "1000", "constante", "organización de compras fija del reto"),
    proveedor: {
      codigo_sap: t("proveedor.codigo_sap", proveedor.codigo_sap, "maestro.proveedores", "proveedores.codigo_sap"),
      nit: t("proveedor.nit", proveedor.nit, "maestro.proveedores", "proveedores.nit"),
      nombre: t("proveedor.nombre", proveedor.nombre, "maestro.proveedores", "proveedores.nombre"),
    },
    moneda: t("moneda", s.moneda, "solicitud", "solicitud.moneda"),
    condiciones_pago: derivadoO("condiciones_pago", "condiciones_pago"),
    aprobador: {
      email: t("aprobador.email", p.aprobacion.de, "paquete.aprobacion", "remitente del correo de aprobación"),
      fecha_aprobacion: t("aprobador.fecha_aprobacion", fechaAprobacion(p.aprobacion), "paquete.aprobacion", "fecha del correo de aprobación"),
      evidencia_sha256: t("aprobador.evidencia_sha256", evidenciaSha256, "derivado", "sha256 del contenido de out/<caso>/aprobacion.txt"),
    },
    posiciones: [
      {
        numero: t("posiciones[0].numero", 10, "constante", "primera posición SAP"),
        descripcion: t("posiciones[0].descripcion", descripcion, descripcion === s.descripcion ? "solicitud" : "derivado",
          descripcion === s.descripcion ? "solicitud.descripcion" : `solicitud.descripcion recortada a 40 caracteres; texto completo: "${s.descripcion}"`),
        cantidad: t("posiciones[0].cantidad", s.cantidad, "solicitud", "solicitud.cantidad"),
        unidad: t("posiciones[0].unidad", unidadDe(s.descripcion), "derivado", "inferida de la descripción (horas → H, mensual → MES, otro → UN)"),
        precio_unitario: t("posiciones[0].precio_unitario", s.valor_unitario, "solicitud", "solicitud.valor_unitario (IVA incluido, como en la cotización)"),
        centro_costo: t("posiciones[0].centro_costo", s.centro_costo, "solicitud", "solicitud.centro_costo"),
        subarea: t("posiciones[0].subarea", s.subarea, "solicitud", "solicitud.subarea"),
        indicador_iva: derivadoO("indicador_iva", "posiciones[0].indicador_iva"),
      },
    ],
    excepciones: v.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: confirmadoPor })),
  }

  const valida = OrdenCompraSchema.safeParse(orden)
  return valida.success ? exito({ orden: valida.data, trazabilidad: trazas }) : fallo(`La OC no cumple el esquema: ${describirErrores(valida.error)}`)
}
