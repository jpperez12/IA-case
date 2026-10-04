import type { EspecHerramienta } from "../tools/registro.ts"
import { ErrorLlm, type Bloque, type LlmAdapter, type Mensaje, type OpcionesEnvio, type RespuestaLlm } from "./adapter.ts"

// Tipos mínimos de la API de Mensajes de Anthropic que usamos (sin SDK: una dependencia menos).
type BloqueApi =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
type RespuestaApi = {
  content: BloqueApi[]
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "pause_turn" | "refusal"
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
}
type ErrorApi = { error?: { type?: string; message?: string } }

const URL_API = "https://api.anthropic.com/v1/messages"

function aApi(b: Bloque): BloqueApi {
  switch (b.tipo) {
    case "texto":
      return { type: "text", text: b.texto }
    case "llamada":
      return { type: "tool_use", id: b.id, name: b.nombre, input: b.args ?? {} }
    case "resultado":
      return { type: "tool_result", tool_use_id: b.id, content: b.contenido, is_error: b.esError }
  }
}

function mensajeDeError(estado: number, cuerpo: ErrorApi): string {
  if (estado === 401) return "La clave del proveedor de IA no es válida. Revisa ANTHROPIC_API_KEY en el servidor."
  if (estado === 429) return "El proveedor de IA está limitando las solicitudes. Espera unos segundos e intenta de nuevo."
  if (estado === 529 || estado >= 500) return "El proveedor de IA está temporalmente no disponible. Intenta de nuevo en un momento."
  return `El proveedor de IA rechazó la solicitud (${estado}): ${cuerpo.error?.message ?? "sin detalle"}`
}

export class AnthropicAdapter implements LlmAdapter {
  readonly proveedor = "anthropic"

  constructor(
    private readonly clave: string,
    readonly modelo: string,
    private readonly timeoutMs: number,
  ) {}

  async enviar(mensajes: Mensaje[], herramientas: EspecHerramienta[], opciones: OpcionesEnvio): Promise<RespuestaLlm> {
    const tools = herramientas.map((h, i) => ({
      name: h.nombre,
      description: h.descripcion,
      input_schema: h.esquema,
      // Caché de prompt: el system + herramientas no cambian entre llamadas y se cobran ~10 % al releerse.
      ...(i === herramientas.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
    }))
    const cuerpo = {
      model: this.modelo,
      max_tokens: opciones.maxTokens,
      system: [{ type: "text", text: opciones.system, cache_control: { type: "ephemeral" } }],
      messages: mensajes.map((m) => ({ role: m.rol === "usuario" ? "user" : "assistant", content: m.bloques.map(aApi) })),
      tools,
      ...(opciones.soloTexto ? { tool_choice: { type: "none" } } : {}),
    }

    let respuesta: Response
    try {
      respuesta = await fetch(URL_API, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.clave, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
      throw new ErrorLlm(timeout ? `El proveedor de IA no respondió en ${this.timeoutMs / 1000} s. Intenta de nuevo.` : "No hubo conexión con el proveedor de IA.")
    }
    if (!respuesta.ok) throw new ErrorLlm(mensajeDeError(respuesta.status, (await respuesta.json().catch(() => ({}))) as ErrorApi))

    const datos = (await respuesta.json()) as RespuestaApi
    const bloques = datos.content.flatMap((b): RespuestaLlm["bloques"] => {
      if (b.type === "text") return [{ tipo: "texto", texto: b.text }]
      if (b.type === "tool_use") return [{ tipo: "llamada", id: b.id, nombre: b.name, args: b.input }]
      return []
    })
    const u = datos.usage
    return {
      bloques,
      fin: datos.stop_reason === "tool_use" ? "herramientas" : datos.stop_reason === "max_tokens" ? "limite" : "final",
      uso: { entrada: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), salida: u.output_tokens },
    }
  }
}
