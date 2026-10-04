import { ErrorLlm, type BloqueResultado, type LlmAdapter, type Mensaje } from "../llm/adapter.ts"
import { mensajeDe } from "../dominio/resultado.ts"
import { ejecutar, especificaciones, type Ejecucion } from "../tools/registro.ts"
import type { Config } from "./config.ts"
import type { LlamadaVisible, Sesion } from "./sesiones.ts"

export type RespuestaTurno = { reply: string; toolCalls: LlamadaVisible[]; needsConfirmation: boolean; error?: boolean }
export type Dependencias = { llm: LlmAdapter; config: Config; system: string; raiz: string }

// Límites de palabra con soporte Unicode: \b de JavaScript no trata "í" como letra y fallaba con "Sí".
const POSITIVO = /^\s*¡?(s[ií]|confirmo|confirmada?|confirmado|adelante|procede|proceder|dale|ok|okay|de acuerdo|cr[eé]ala|cr[eé]alas|autorizo|apruebo)(?![\p{L}\p{N}])/iu
const NEGATIVO = /(?<![\p{L}\p{N}])(no|espera|todav[ií]a|cancela|cancelar|detente)(?![\p{L}\p{N}])/iu

/** CA3: solo cuenta como confirmación una respuesta afirmativa explícita a una pregunta pendiente. */
export const esConfirmacion = (texto: string): boolean => POSITIVO.test(texto) && !NEGATIVO.test(texto)

type Leido = { ok?: boolean; error?: string; data?: { apta?: boolean } }
const leer = (e: Ejecucion): Leido => {
  try {
    return JSON.parse(e.resultado) as Leido
  } catch {
    return {}
  }
}

/** El turno queda "esperando confirmación" si oc_crear quedó pendiente, o si había una OC apta sin crear y el agente preguntó. */
function pideConfirmacion(ejecuciones: Ejecucion[], textoFinal: string): boolean {
  const creo = ejecuciones.some((e) => e.nombre === "oc_crear" && e.ok)
  const pendiente = ejecuciones.some((e) => e.nombre === "oc_crear" && !e.ok && /confirmaci[oó]n|confirmado=true/i.test(leer(e).error ?? ""))
  const aptaSinCrear = !creo && ejecuciones.some((e) => e.nombre === "oc_validar" && leer(e).data?.apta === true)
  return !creo && (pendiente || (aptaSinCrear && textoFinal.trim().endsWith("?")))
}

/**
 * CA2 en el backend: si en este turno oc_crear falló y ninguna llamada creó la OC, el texto del modelo no puede
 * afirmar que la OC fue creada. Si lo hace, se reemplaza por lo que realmente devolvió la herramienta.
 */
function sinAfirmacionesFalsas(ejecuciones: Ejecucion[], texto: string): string {
  const crear = ejecuciones.filter((e) => e.nombre === "oc_crear")
  if (crear.length === 0 || crear.some((e) => e.ok)) return texto
  if (!/(cread[ao]|generad[ao]|registrad[ao] en sap|n[uú]mero de oc|\b45\d{8}\b)/i.test(texto)) return texto
  const ultimo = leer(crear[crear.length - 1]!).error ?? "la herramienta no creó la OC"
  return `**La OC no se creó.** ${ultimo}\n\n¿Confirmas la creación? Responde "sí" o "confirmo".`
}

const AVISO_TOPE = "[Sistema] Se alcanzó el tope de iteraciones de este turno. Responde con lo que ya tienes y di qué falta, sin llamar más herramientas."

/** Un turno: mensaje del usuario → (modelo → herramientas)* → respuesta. Nunca deja la sesión inutilizable. */
export async function ejecutarTurno(sesion: Sesion, texto: string, d: Dependencias): Promise<RespuestaTurno> {
  const confirmacionUsuario = sesion.esperaConfirmacion && esConfirmacion(texto)
  const respaldo = sesion.mensajes.length
  const ejecuciones: Ejecucion[] = []
  const herramientas = especificaciones()
  sesion.mensajes.push({ rol: "usuario", bloques: [{ tipo: "texto", texto }] })

  try {
    let final = ""
    for (let i = 0; ; i++) {
      if (sesion.tokens >= d.config.maxTokensSesion)
        throw new ErrorLlm("Esta sesión alcanzó su tope de tokens. Abre una sesión nueva para continuar.")
      const soloTexto = i >= d.config.maxIteraciones
      const r = await d.llm.enviar(sesion.mensajes, herramientas, { system: d.system, maxTokens: d.config.maxTokensRespuesta, soloTexto })
      sesion.tokens += r.uso.entrada + r.uso.salida
      // La API rechaza mensajes de asistente vacíos: se guarda un marcador para no romper el historial.
      sesion.mensajes.push({ rol: "asistente", bloques: r.bloques.length ? r.bloques : [{ tipo: "texto", texto: "(sin contenido)" }] })
      final = r.bloques.flatMap((b) => (b.tipo === "texto" ? [b.texto] : [])).join("\n").trim()

      const llamadas = r.bloques.flatMap((b) => (b.tipo === "llamada" ? [b] : []))
      if (r.fin !== "herramientas" || llamadas.length === 0 || soloTexto) break

      const resultados: Mensaje["bloques"] = []
      for (const ll of llamadas) {
        const e = await ejecutar(ll.nombre, ll.args, { directory: d.raiz, sessionId: sesion.id, confirmacionUsuario })
        ejecuciones.push(e)
        resultados.push({ tipo: "resultado", id: ll.id, contenido: e.resultado, esError: !e.ok } satisfies BloqueResultado)
      }
      if (i + 1 >= d.config.maxIteraciones) resultados.push({ tipo: "texto", texto: AVISO_TOPE })
      sesion.mensajes.push({ rol: "usuario", bloques: resultados })
    }
    final = sinAfirmacionesFalsas(ejecuciones, final)
    const needsConfirmation = pideConfirmacion(ejecuciones, final)
    sesion.esperaConfirmacion = needsConfirmation
    return { reply: final || "(sin respuesta del modelo)", toolCalls: ejecuciones.map(visible), needsConfirmation }
  } catch (e) {
    // Se descarta el turno incompleto del historial del modelo para que la siguiente pregunta funcione (CA5).
    sesion.mensajes.length = respaldo
    const motivo = e instanceof ErrorLlm ? e.message : `Error inesperado: ${mensajeDe(e)}`
    const hechas = ejecuciones.length ? " Las acciones que alcanzaron a ejecutarse quedaron registradas arriba." : ""
    return { reply: `No pude completar la respuesta. ${motivo}${hechas}`, toolCalls: ejecuciones.map(visible), needsConfirmation: false, error: true }
  }
}

const visible = (e: Ejecucion): LlamadaVisible => ({ nombre: e.nombre, args: e.args, ok: e.ok, resumen: e.resumen })
