import { z } from "zod"

const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "debe tener formato YYYY-MM-DD")
const numero = (campo: string) => z.number({ error: `${campo} debe ser numérico` })

// ── Insumos del paquete (sección 7.1) ────────────────────────────────────────
export const CorreoSchema = z.object({
  id: z.string().min(1),
  de: z.string().min(1),
  asunto: z.string(),
  fecha: z.string().min(1),
})

export const SolicitudSchema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string(),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: z.string().optional(),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: numero("cantidad").positive(),
  valor_unitario: numero("valor_unitario").nonnegative(),
  valor_total: numero("valor_total").positive(),
  moneda: z.enum(["COP", "USD"]),
  indicador_iva: z.string().optional(),
  condiciones_pago: z.string().optional(),
  fecha_solicitud: fechaISO,
})

export const AprobacionCrudaSchema = z.object({
  de: z.string().min(1),
  para: z.string(),
  cc: z.array(z.string()).optional(),
  fecha: z.string().min(10),
  asunto: z.string(),
  cuerpo: z.string(),
})

export type Correo = z.infer<typeof CorreoSchema>
export type Solicitud = z.infer<typeof SolicitudSchema>
export type AprobacionCruda = z.infer<typeof AprobacionCrudaSchema>

// ── Paquete normalizado (sección 7.2) ────────────────────────────────────────
export type Cotizacion = {
  numero: string | null
  proveedor: string
  nit: string | null
  total: number
  moneda: string
  validez_hasta: string | null
  texto: string
}
export type Aprobacion = { de: string; fecha: string; aprobado: boolean; texto: string }
export type Factura = { numero: string; fecha: string; total: number }

export type Paquete = {
  correo: Correo
  solicitud: Solicitud
  cotizacion: Cotizacion | null
  aprobacion: Aprobacion | null
  factura: Factura | null
  faltantes: string[]
}

// ── Maestros ─────────────────────────────────────────────────────────────────
export const ProveedorSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
})
export const CentroCostoSchema = z.object({
  centro_costo: z.string(),
  nombre: z.string().optional(),
  subareas: z.array(z.string()),
  aprobadores: z.array(z.object({ email: z.string(), nombre: z.string().optional(), tope: z.number() })),
})
export const IndicadorIvaSchema = z.object({ codigo: z.string(), descripcion: z.string(), tasa: z.number() })
export const CondicionPagoSchema = z.object({ codigo: z.string(), descripcion: z.string(), dias: z.number() })

export type Proveedor = z.infer<typeof ProveedorSchema>
export type CentroCosto = z.infer<typeof CentroCostoSchema>
export type Maestros = {
  proveedores: Proveedor[]
  centros: CentroCosto[]
  indicadoresIva: z.infer<typeof IndicadorIvaSchema>[]
  condicionesPago: z.infer<typeof CondicionPagoSchema>[]
}

// ── Resultado de validación (HU-2) ───────────────────────────────────────────
export type Hallazgo = {
  codigo: string
  detalle: string
  accion_sugerida: string
  valores?: Record<string, string | number | null>
}
export type Derivado = { valor: string; fuente: string; nota: string }
export type Validacion = {
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Record<string, Derivado>
  retroactiva: boolean
  observaciones: string[]
}

// ── Orden de compra (sección 7.4) ────────────────────────────────────────────
export const OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({ email: z.string(), fecha_aprobacion: z.string(), evidencia_sha256: z.string().length(64) }),
  posiciones: z
    .array(
      z.object({
        numero: z.number().int(),
        descripcion: z.string().min(1).max(40),
        cantidad: z.number().positive(),
        unidad: z.enum(["UN", "H", "MES"]),
        precio_unitario: z.number().nonnegative(),
        centro_costo: z.string(),
        subarea: z.string(),
        indicador_iva: z.string(),
      }),
    )
    .min(1),
  excepciones: z.array(z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() })),
})
export type OrdenCompra = z.infer<typeof OrdenCompraSchema>

/** Convierte los errores de zod en una frase legible para la analista. */
export function describirErrores(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")
}
