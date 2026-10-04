import { z } from "zod"
import { escribir, rutas } from "../dominio/archivos.ts"
import { registrarControl, type ResultadoControl } from "../dominio/control.ts"
import { contenidoEvidencia, generarEvidencia, sha256 } from "../dominio/evidencia.ts"
import { cargarMaestros } from "../dominio/maestros.ts"
import { CASO_VALIDO, leerAprobacionCruda, leerPaquete } from "../dominio/paquete.ts"
import { construirOrden, type OrdenConTrazas } from "../dominio/payload.ts"
import { exito, fallo, type Resultado } from "../dominio/resultado.ts"
import { jsonCanonico } from "../dominio/texto.ts"
import { OrdenCompraSchema, type Maestros, type OrdenCompra, type Paquete, type Validacion } from "../dominio/tipos.ts"
import { validar as aplicarReglas } from "../dominio/validar.ts"
import { SapMock } from "../sap/mock.ts"
import { herramienta, responder, type ContextoHerramienta } from "./herramienta.ts"

// Las herramientas releen siempre desde los fixtures: lo que el modelo envía en paquete/derivados/payload
// solo se verifica, nunca se usa como fuente. Así el modelo no puede "arreglar" un monto (riesgo de la sección 10).

const caso = z.string().regex(CASO_VALIDO, "nombre de caso inválido").describe("Carpeta del caso en fixtures/reto-03/solicitudes/, ej. sol-001")
const opcionalVerificado = (que: string) =>
  z.unknown().optional().describe(`Opcional. ${que}; si se envía, solo se compara con lo leído del disco. Puedes omitirlo.`)

type Estado = { paquete: Paquete; maestros: Maestros; validacion: Validacion }

function cargarEstado(raiz: string, nombreCaso: string): Resultado<Estado> {
  const paquete = leerPaquete(raiz, nombreCaso)
  if (!paquete.ok) return paquete
  const maestros = cargarMaestros(raiz)
  if (!maestros.ok) return maestros
  return exito({ paquete: paquete.data, maestros: maestros.data, validacion: aplicarReglas(paquete.data, maestros.data) })
}

const avisoSiDifiere = (enviado: unknown, real: unknown, nombre: string): string[] =>
  enviado !== undefined && jsonCanonico(enviado) !== jsonCanonico(real)
    ? [`El ${nombre} enviado no coincide con el leído del disco; se usó el del disco.`]
    : []

/** Construye la OC con su evidencia (el sha256 sale del mismo contenido que escribe oc_generar_evidencia). */
function ordenDelCaso(raiz: string, nombreCaso: string, e: Estado, confirmadoPor: string | null): Resultado<OrdenConTrazas> {
  const cruda = leerAprobacionCruda(raiz, nombreCaso)
  if (!cruda.ok) return cruda
  const hash = sha256(contenidoEvidencia(e.paquete.solicitud.solicitud_id, cruda.data))
  return construirOrden(e.paquete, e.maestros, e.validacion, hash, confirmadoPor)
}

const codigos = (hs: { codigo: string }[]): string[] => hs.map((x) => x.codigo)

function control(ctx: ContextoHerramienta, e: Estado, resultado: ResultadoControl, numero_oc: string | null): void {
  registrarControl(ctx.directory, {
    solicitud_id: e.paquete.solicitud.solicitud_id,
    resultado,
    numero_oc,
    retroactiva: e.validacion.retroactiva,
    bloqueos: codigos(e.validacion.bloqueos),
    confirmaciones: codigos(e.validacion.confirmaciones),
  })
}

/** Quita quién confirmó, para comparar el payload que envía el modelo con el construido. */
const sinConfirmador = (o: OrdenCompra): OrdenCompra => ({ ...o, excepciones: o.excepciones.map((x) => ({ ...x, confirmado_por: null })) })

export const leer_paquete = herramienta({
  description: "Lee el correo, la solicitud, la cotización, la aprobación y la factura (si existe) de un caso y los devuelve normalizados.",
  args: { caso },
  async execute(args, ctx) {
    const p = leerPaquete(ctx.directory, args.caso)
    if (!p.ok) return responder(p)
    const s = p.data.solicitud
    const resumen = `${s.solicitud_id}: ${s.proveedor_nombre}, ${s.moneda} ${s.valor_total}` +
      (p.data.faltantes.length ? `; faltan: ${p.data.faltantes.join(", ")}` : "") + (p.data.factura ? "; trae factura" : "")
    return responder(exito({ ...p.data, resumen }))
  },
})

export const validar = herramienta({
  description: "Aplica las reglas de control RC1–RC10 contra los maestros y devuelve si la OC es apta, sus bloqueos, confirmaciones, derivados y si es retroactiva.",
  args: { caso, paquete: opcionalVerificado("Paquete devuelto por oc_leer_paquete") },
  async execute(args, ctx) {
    const e = cargarEstado(ctx.directory, args.caso)
    if (!e.ok) return responder(e)
    const v = e.data.validacion
    const resumen = `apta=${v.apta}; bloqueos=[${codigos(v.bloqueos).join(",")}]; confirmaciones=[${codigos(v.confirmaciones).join(",")}]; retroactiva=${v.retroactiva}`
    return responder(exito({ ...v, avisos: avisoSiDifiere(args.paquete, e.data.paquete, "paquete"), resumen }))
  },
})

export const construir_payload = herramienta({
  description: "Construye la orden de compra exactamente como quedaría en SAP, validada con su esquema, y guarda la trazabilidad de cada campo.",
  args: { caso, paquete: opcionalVerificado("Paquete devuelto por oc_leer_paquete"), derivados: opcionalVerificado("Derivados devueltos por oc_validar") },
  async execute(args, ctx) {
    const e = cargarEstado(ctx.directory, args.caso)
    if (!e.ok) return responder(e)
    const r = ordenDelCaso(ctx.directory, args.caso, e.data, null)
    if (!r.ok) return responder(r)
    escribir(rutas.out(ctx.directory, args.caso, "payload.json"), JSON.stringify(r.data.orden, null, 2))
    escribir(rutas.out(ctx.directory, args.caso, "trazabilidad.json"), JSON.stringify(r.data.trazabilidad, null, 2))
    const avisos = [...avisoSiDifiere(args.paquete, e.data.paquete, "paquete"), ...avisoSiDifiere(args.derivados, e.data.validacion.derivados, "conjunto de derivados")]
    return responder(exito({
      orden: r.data.orden,
      ruta_trazabilidad: `out/${args.caso}/trazabilidad.json`,
      confirmaciones_pendientes: e.data.validacion.confirmaciones,
      avisos,
      resumen: `OC lista para ${r.data.orden.proveedor.nombre}; ${r.data.orden.excepciones.length} excepción(es) por confirmar`,
    }))
  },
})

export const generar_evidencia = herramienta({
  description: "Genera la evidencia de aprobación (aprobacion.txt con sha256 y aprobacion.pdf) en out/<caso>/.",
  args: { caso },
  async execute(args, ctx) {
    const p = leerPaquete(ctx.directory, args.caso)
    if (!p.ok) return responder(p)
    const cruda = leerAprobacionCruda(ctx.directory, args.caso)
    if (!cruda.ok) return responder(fallo("No hay correo de aprobación válido para generar la evidencia."))
    const ev = await generarEvidencia(ctx.directory, args.caso, p.data.solicitud.solicitud_id, cruda.data)
    return responder(ev.ok ? exito({ ...ev.data, resumen: `${ev.data.ruta} (sha256 ${ev.data.sha256.slice(0, 12)}…)` }) : ev)
  },
})

export const crear = herramienta({
  description: "Crea la OC en SAP (simulado) si es apta; si tiene confirmaciones exige confirmado=true tras la confirmación explícita del usuario. Idempotente por solicitud_id.",
  args: {
    caso,
    payload: opcionalVerificado("OC devuelta por oc_construir_payload; no se permite modificarla"),
    confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente en su último mensaje las excepciones mostradas"),
  },
  async execute(args, ctx) {
    const e = cargarEstado(ctx.directory, args.caso)
    if (!e.ok) return responder(e)
    const { paquete, maestros, validacion: v } = e.data
    const sap = new SapMock(ctx.directory, maestros.proveedores)

    const existente = await sap.buscarOrdenPorReferencia(paquete.solicitud.solicitud_id)
    if (existente) {
      control(ctx, e.data, "existente", existente.numero_oc)
      return responder(exito({ numero_oc: existente.numero_oc, idempotente: true, resumen: `Ya existía la OC ${existente.numero_oc}; no se creó otra` }))
    }
    if (!v.apta) {
      control(ctx, e.data, "bloqueada", null)
      return responder(fallo(`OC bloqueada por ${codigos(v.bloqueos).join(", ")}.`, { bloqueos: v.bloqueos }))
    }
    if (v.confirmaciones.length > 0 && args.confirmado !== true) {
      control(ctx, e.data, "pendiente_confirmacion", null)
      return responder(fallo(`Requiere confirmación explícita del usuario (${codigos(v.confirmaciones).join(", ")}).`, { confirmaciones: v.confirmaciones }))
    }
    if (args.confirmado === true && v.confirmaciones.length > 0 && ctx.confirmacionUsuario !== true) {
      control(ctx, e.data, "pendiente_confirmacion", null)
      return responder(fallo("confirmado=true solo es válido cuando el último mensaje del usuario confirma explícitamente. Pregunta primero."))
    }

    const confirmador = v.confirmaciones.length > 0 ? `analista (chat, sesión ${ctx.sessionId})` : null
    const r = ordenDelCaso(ctx.directory, args.caso, e.data, confirmador)
    if (!r.ok) return responder(r)
    if (args.payload !== undefined) {
      const enviado = OrdenCompraSchema.safeParse(args.payload)
      if (!enviado.success || jsonCanonico(sinConfirmador(enviado.data)) !== jsonCanonico(sinConfirmador(r.data.orden))) {
        control(ctx, e.data, "error", null)
        return responder(fallo("El payload enviado no coincide con el construido por oc_construir_payload. La OC no se puede modificar en el chat; se rechazó."))
      }
    }

    const cruda = leerAprobacionCruda(ctx.directory, args.caso)
    const ev = cruda.ok ? await generarEvidencia(ctx.directory, args.caso, paquete.solicitud.solicitud_id, cruda.data) : cruda
    if (!ev.ok) return responder(ev)
    const creada = await sap.crearOrden(r.data.orden)
    control(ctx, e.data, "creada", creada.numero_oc)
    return responder(exito({
      ...creada,
      idempotente: false,
      retroactiva: v.retroactiva,
      evidencia: ev.data.ruta_pdf,
      resumen: `OC ${creada.numero_oc} creada${v.retroactiva ? " (retroactiva)" : ""}; evidencia en ${ev.data.ruta_pdf}`,
    }))
  },
})
