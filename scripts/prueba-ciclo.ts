/**
 * Prueba del ciclo del agente sin proveedor real: un "modelo" guionado pide herramientas en orden.
 * Verifica el tope de iteraciones, la confirmación humana (CA3) y que el ciclo no muere ante errores (CA5).
 * Uso: bun run scripts/prueba-ciclo.ts
 */
import { rmSync } from "node:fs"
import { join } from "node:path"
import { esConfirmacion, ejecutarTurno, type Dependencias } from "../src/agent/ciclo.ts"
import { leerConfig } from "../src/agent/config.ts"
import { nuevaSesion } from "../src/agent/sesiones.ts"
import { ErrorLlm, type LlmAdapter, type RespuestaLlm } from "../src/llm/adapter.ts"

const raiz = join(import.meta.dir, "..")
let n = 0
const llamada = (nombre: string, args: unknown): RespuestaLlm => ({ bloques: [{ tipo: "llamada", id: `t${++n}`, nombre, args }], fin: "herramientas", uso: { entrada: 10, salida: 5 } })
const texto = (t: string): RespuestaLlm => ({ bloques: [{ tipo: "texto", texto: t }], fin: "final", uso: { entrada: 10, salida: 5 } })

function guion(pasos: (RespuestaLlm | Error)[]): LlmAdapter {
  return {
    proveedor: "guion",
    modelo: "guion",
    async enviar() {
      const paso = pasos.shift() ?? texto("(fin del guion)")
      if (paso instanceof Error) throw paso
      return paso
    },
  }
}

function verificar(condicion: boolean, mensaje: string): void {
  console.log(`${condicion ? "✓" : "✗"} ${mensaje}`)
  if (!condicion) process.exitCode = 1
}

rmSync(join(raiz, "out"), { recursive: true, force: true })
const config = { ...leerConfig(), maxIteraciones: 6 }
const sesion = nuevaSesion()
const caso = { caso: "sol-004" }
const deps = (pasos: (RespuestaLlm | Error)[]): Dependencias => ({ llm: guion(pasos), config, system: "prueba", raiz })

// Turno 1: procesa y pide confirmación. El modelo "intenta" confirmarse solo: el backend lo impide.
const t1 = await ejecutarTurno(sesion, "Procesa la sol-004 y no la crees hasta que confirme", deps([
  llamada("oc_leer_paquete", caso), llamada("oc_validar", caso), llamada("oc_construir_payload", caso),
  llamada("oc_crear", { ...caso, confirmado: true }), texto("La cotización difiere 6 %. ¿Confirmas la creación con $25.000.000?"),
]))
verificar(t1.toolCalls.at(-1)?.ok === false, "el modelo no puede confirmarse a sí mismo (oc_crear rechazado)")
verificar(t1.needsConfirmation, "el turno queda esperando confirmación")

// Turno 2: la usuaria responde "Sí" (con tilde) → cuenta como confirmación y se crea.
const t2 = await ejecutarTurno(sesion, "Sí", deps([llamada("oc_crear", { ...caso, confirmado: true }), texto("OC 4500000001 creada.")]))
verificar(t2.toolCalls[0]?.ok === true && /4500000001/.test(t2.toolCalls[0].resumen), "\"Sí\" con tilde cuenta como confirmación: se crea la OC 4500000001")
verificar(!t2.needsConfirmation, "ya no espera confirmación")

// Turno 2b: el modelo afirma haber creado una OC que la herramienta rechazó → el backend corrige el texto.
const s2 = nuevaSesion()
const falso = await ejecutarTurno(s2, "Procesa la sol-006", deps([llamada("oc_crear", { caso: "sol-006", confirmado: true }), texto("OC creada. Número de OC: 4500000009.")]))
verificar(falso.reply.startsWith("**La OC no se creó.**") && !/4500000009/.test(falso.reply), "el agente no puede afirmar una OC que no se creó")
verificar(["sí", "Sí, créala", "¡Sí!", "si", "confirmo"].every(esConfirmacion) && !["sí, pero todavía no", "no", "Sinceramente no"].some(esConfirmacion), "reconoce confirmaciones con tilde y rechaza negaciones")

// Turno 3: el proveedor falla → mensaje claro y la sesión sigue viva.
const largo = sesion.mensajes.length
const t3 = await ejecutarTurno(sesion, "Procesa la sol-001", deps([new ErrorLlm("El proveedor de IA no respondió en 60 s. Intenta de nuevo.")]))
verificar(t3.error === true && /no respondió/.test(t3.reply), "error del proveedor se informa en lenguaje claro")
verificar(sesion.mensajes.length === largo, "el historial queda consistente para el siguiente turno")

// Turno 4: un modelo que nunca deja de pedir herramientas se corta en el tope.
const infinito = Array.from({ length: 20 }, () => llamada("oc_leer_paquete", { caso: "sol-001" }))
const t4 = await ejecutarTurno(sesion, "Procesa la sol-001", deps([...infinito.slice(0, 6), texto("Llegué al tope; esto es lo que tengo."), ...infinito]))
verificar(t4.toolCalls.length === 6, `tope de iteraciones respetado (${t4.toolCalls.length} llamadas, máximo ${config.maxIteraciones})`)
