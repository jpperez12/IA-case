/** Toda la configuración sale de variables de entorno (ver .env.example). La clave nunca se expone. */
const entero = (nombre: string, porDefecto: number): number => {
  const v = Number(process.env[nombre])
  return Number.isFinite(v) && v > 0 ? v : porDefecto
}

export type Config = {
  proveedor: string
  modelo: string
  claveAnthropic: string | undefined
  timeoutMs: number
  maxIteraciones: number
  maxTokensSesion: number
  maxTokensRespuesta: number
  puerto: number
  claveAcceso: string | undefined
}

export function leerConfig(): Config {
  return {
    proveedor: process.env.LLM_PROVIDER ?? "anthropic",
    modelo: process.env.LLM_MODEL ?? "claude-sonnet-4-6",
    claveAnthropic: process.env.ANTHROPIC_API_KEY || undefined,
    timeoutMs: entero("LLM_TIMEOUT_MS", 60_000),
    maxIteraciones: entero("MAX_ITERACIONES", 25),
    maxTokensSesion: entero("MAX_TOKENS_SESION", 300_000),
    maxTokensRespuesta: entero("MAX_TOKENS_RESPUESTA", 4_096),
    puerto: entero("PORT", 3000),
    claveAcceso: process.env.ACCESS_KEY || undefined,
  }
}
