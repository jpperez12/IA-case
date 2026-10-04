import type { EspecHerramienta } from "../tools/registro.ts"

/** Formato de conversación propio, independiente del proveedor. Cada adaptador lo traduce al suyo. */
export type BloqueTexto = { tipo: "texto"; texto: string }
/** meta: datos opacos del proveedor que deben reenviarse tal cual (p. ej. la firma de razonamiento de Gemini 3). */
export type BloqueLlamada = { tipo: "llamada"; id: string; nombre: string; args: unknown; meta?: Record<string, unknown> }
export type BloqueResultado = { tipo: "resultado"; id: string; contenido: string; esError: boolean }
export type Bloque = BloqueTexto | BloqueLlamada | BloqueResultado

export type Mensaje = { rol: "usuario" | "asistente"; bloques: Bloque[] }

export type RespuestaLlm = {
  bloques: (BloqueTexto | BloqueLlamada)[]
  /** herramientas: el modelo pidió ejecutar herramientas; final: terminó; limite: se cortó por max_tokens. */
  fin: "herramientas" | "final" | "limite"
  uso: { entrada: number; salida: number }
}

export type OpcionesEnvio = { system: string; maxTokens: number; soloTexto?: boolean }

/** Contrato: enviar(mensajes, herramientas) → respuesta. Cambiar de proveedor no toca el ciclo del agente. */
export interface LlmAdapter {
  readonly proveedor: string
  readonly modelo: string
  enviar(mensajes: Mensaje[], herramientas: EspecHerramienta[], opciones: OpcionesEnvio): Promise<RespuestaLlm>
}

/** Error del proveedor con un mensaje apto para mostrarse en el chat (sin claves ni trazas). */
export class ErrorLlm extends Error {}
