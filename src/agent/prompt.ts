import { readFileSync } from "node:fs"
import { join } from "node:path"

/** Comportamiento (agent/prompt.md) + conocimiento (src/knowledge/*.md). Ninguno vive en el código. */
export function cargarSystemPrompt(raiz: string): string {
  const leer = (ruta: string) => readFileSync(join(raiz, ruta), "utf8")
  return `${leer("agent/prompt.md")}\n\n${leer("src/knowledge/ordenes-compra.md")}`
}
