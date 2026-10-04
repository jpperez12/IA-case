import type { EspecHerramienta } from "../tools/registro.ts"
import { ErrorLlm, type LlmAdapter, type Mensaje, type OpcionesEnvio, type RespuestaLlm } from "./adapter.ts"

/**
 * Adaptador para APIs compatibles con "chat/completions" de OpenAI.
 * Sirve para Google Gemini (endpoint de compatibilidad, con nivel gratuito), OpenAI, Groq u OpenRouter:
 * solo cambian la URL base, la clave y el modelo.
 */

type LlamadaApi = { id?: string; type: "function"; function: { name: string; arguments: string } }
type MensajeApi =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: LlamadaApi[] }
  | { role: "tool"; tool_call_id: string; content: string }
type RespuestaApi = {
  choices?: { message?: { content?: string | null; tool_calls?: LlamadaApi[] }; finish_reason?: string }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}
type Esquema = Record<string, unknown>

const CLAVES_ESQUEMA = new Set(["type", "description", "properties", "required", "items", "enum"])

/**
 * Algunos proveedores (Gemini) aceptan solo un subconjunto de JSON Schema. Se dejan los campos básicos y se quitan
 * las propiedades sin tipo (los argumentos opcionales "verificados", que el agente no necesita enviar).
 * La validación completa la sigue haciendo zod en el backend.
 */
export function simplificarEsquema(e: Esquema): Esquema {
  const salida: Esquema = {}
  for (const [k, v] of Object.entries(e)) if (CLAVES_ESQUEMA.has(k)) salida[k] = v
  if (salida.properties && typeof salida.properties === "object") {
    const props = Object.entries(salida.properties as Record<string, Esquema>).filter(([, p]) => typeof p.type === "string")
    salida.properties = Object.fromEntries(props.map(([n, p]) => [n, simplificarEsquema(p)]))
    if (Array.isArray(salida.required)) salida.required = (salida.required as string[]).filter((r) => props.some(([n]) => n === r))
  }
  if (salida.items && typeof salida.items === "object") salida.items = simplificarEsquema(salida.items as Esquema)
  return salida
}

function aApi(system: string, mensajes: Mensaje[]): MensajeApi[] {
  const salida: MensajeApi[] = [{ role: "system", content: system }]
  for (const m of mensajes) {
    if (m.rol === "asistente") {
      const texto = m.bloques.flatMap((b) => (b.tipo === "texto" ? [b.texto] : [])).join("\n")
      const llamadas = m.bloques.flatMap((b) => (b.tipo === "llamada" ? [b] : []))
      salida.push({
        role: "assistant",
        content: texto || null,
        ...(llamadas.length ? { tool_calls: llamadas.map((l) => ({ id: l.id, type: "function" as const, function: { name: l.nombre, arguments: JSON.stringify(l.args ?? {}) } })) } : {}),
      })
      continue
    }
    // Los resultados de herramientas van primero (deben seguir a la llamada); el texto del usuario, después.
    for (const b of m.bloques) if (b.tipo === "resultado") salida.push({ role: "tool", tool_call_id: b.id, content: b.contenido })
    const texto = m.bloques.flatMap((b) => (b.tipo === "texto" ? [b.texto] : [])).join("\n")
    if (texto) salida.push({ role: "user", content: texto })
  }
  return salida
}

function leerArgs(texto: string): unknown {
  try {
    return JSON.parse(texto || "{}")
  } catch {
    return {}
  }
}

function mensajeDeError(estado: number): string {
  if (estado === 401 || estado === 403) return "La clave del proveedor de IA no es válida. Revisa la variable de la clave en el servidor."
  if (estado === 429) return "Se alcanzó el límite de solicitudes por minuto del proveedor de IA (nivel gratuito). Espera un minuto e intenta de nuevo."
  if (estado >= 500) return "El proveedor de IA está temporalmente no disponible. Intenta de nuevo en un momento."
  return `El proveedor de IA rechazó la solicitud (${estado}).`
}

export class OpenAiCompatibleAdapter implements LlmAdapter {
  constructor(
    readonly proveedor: string,
    private readonly urlBase: string,
    private readonly clave: string,
    readonly modelo: string,
    private readonly timeoutMs: number,
  ) {}

  async enviar(mensajes: Mensaje[], herramientas: EspecHerramienta[], opciones: OpcionesEnvio): Promise<RespuestaLlm> {
    const cuerpo = {
      model: this.modelo,
      max_tokens: opciones.maxTokens,
      messages: aApi(opciones.system, mensajes),
      tools: herramientas.map((h) => ({ type: "function", function: { name: h.nombre, description: h.descripcion, parameters: simplificarEsquema(h.esquema) } })),
      ...(opciones.soloTexto ? { tool_choice: "none" } : {}),
    }
    let respuesta: Response
    try {
      respuesta = await fetch(`${this.urlBase}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.clave}` },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
      throw new ErrorLlm(timeout ? `El proveedor de IA no respondió en ${this.timeoutMs / 1000} s. Intenta de nuevo.` : "No hubo conexión con el proveedor de IA.")
    }
    if (!respuesta.ok) throw new ErrorLlm(mensajeDeError(respuesta.status))

    const datos = (await respuesta.json()) as RespuestaApi
    const eleccion = datos.choices?.[0]
    const llamadas = eleccion?.message?.tool_calls ?? []
    const bloques: RespuestaLlm["bloques"] = [
      ...(eleccion?.message?.content ? [{ tipo: "texto" as const, texto: eleccion.message.content }] : []),
      ...llamadas.map((l, i) => ({ tipo: "llamada" as const, id: l.id || `llamada_${Date.now()}_${i}`, nombre: l.function.name, args: leerArgs(l.function.arguments) })),
    ]
    return {
      bloques,
      fin: llamadas.length > 0 ? "herramientas" : eleccion?.finish_reason === "length" ? "limite" : "final",
      uso: { entrada: datos.usage?.prompt_tokens ?? 0, salida: datos.usage?.completion_tokens ?? 0 },
    }
  }
}
