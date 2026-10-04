import type { Config } from "../agent/config.ts"
import type { LlmAdapter } from "./adapter.ts"
import { AnthropicAdapter } from "./anthropic.ts"
import { OpenAiCompatibleAdapter } from "./openai-compatible.ts"

const URL_GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai"

/** Único punto que conoce las implementaciones. Agregar un proveedor = un caso aquí; el ciclo no cambia. */
export function crearLlm(c: Config): LlmAdapter | null {
  if (c.proveedor === "anthropic" && c.claveAnthropic) return new AnthropicAdapter(c.claveAnthropic, c.modelo, c.timeoutMs)
  if (c.proveedor === "gemini" && c.claveGemini) return new OpenAiCompatibleAdapter("gemini", URL_GEMINI, c.claveGemini, c.modelo, c.timeoutMs)
  return null
}
