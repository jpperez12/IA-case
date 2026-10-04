import type { Config } from "../agent/config.ts"
import type { LlmAdapter } from "./adapter.ts"
import { AnthropicAdapter } from "./anthropic.ts"

/** Único punto que conoce las implementaciones. Agregar OpenAI = un archivo nuevo + un caso aquí. */
export function crearLlm(c: Config): LlmAdapter | null {
  if (c.proveedor === "anthropic" && c.claveAnthropic) return new AnthropicAdapter(c.claveAnthropic, c.modelo, c.timeoutMs)
  return null
}
