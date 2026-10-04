/** Toda la configuración sale de variables de entorno (ver .env.example). Las claves nunca se exponen. */
const entero = (nombre: string, porDefecto: number): number => {
  const v = Number(process.env[nombre])
  return Number.isFinite(v) && v > 0 ? v : porDefecto
}

/** Modelo por defecto de cada proveedor; LLM_MODEL lo reemplaza. */
const MODELOS: Record<string, string> = { anthropic: "claude-sonnet-4-6", gemini: "gemini-flash-latest" }

export type Config = {
  proveedor: string
  modelo: string
  claveAnthropic: string | undefined
  claveGemini: string | undefined
  timeoutMs: number
  maxIteraciones: number
  maxTokensSesion: number
  maxTokensRespuesta: number
  puerto: number
  claveAcceso: string | undefined
}

export function leerConfig(): Config {
  const claveAnthropic = process.env.ANTHROPIC_API_KEY || undefined
  const claveGemini = process.env.GEMINI_API_KEY || undefined
  // Si no se fija LLM_PROVIDER, se usa el proveedor cuya clave esté configurada.
  const proveedor = process.env.LLM_PROVIDER || (claveAnthropic ? "anthropic" : claveGemini ? "gemini" : "anthropic")
  return {
    proveedor,
    modelo: process.env.LLM_MODEL || MODELOS[proveedor] || "",
    claveAnthropic,
    claveGemini,
    timeoutMs: entero("LLM_TIMEOUT_MS", 60_000),
    maxIteraciones: entero("MAX_ITERACIONES", 25),
    maxTokensSesion: entero("MAX_TOKENS_SESION", 300_000),
    maxTokensRespuesta: entero("MAX_TOKENS_RESPUESTA", 4_096),
    puerto: entero("PORT", 3000),
    claveAcceso: process.env.ACCESS_KEY || undefined,
  }
}
