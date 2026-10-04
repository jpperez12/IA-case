/**
 * Genera modulo/ (bonus 9.4) a partir de las MISMAS fuentes que usa la aplicación:
 *   agent/prompt.md                 → modulo/agent.md (frontmatter + cuerpo idéntico)
 *   src/knowledge/ordenes-compra.md → modulo/skill/ordenes-compra/SKILL.md
 *   src/tools/oc.ts                 → modulo/tools/oc.ts (re-exporta, no copia)
 * Uso: bun run modulo. demo.ts llama verificarModulo() para detectar copias divergentes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const AGENTE = `---
description: Procesa paquetes de compra (solicitud, cotización, aprobación), valida contra maestros y crea órdenes de compra en SAP con confirmación humana.
mode: primary
permission:
  edit: deny
  bash: deny
---

`
const SKILL = `---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra de Periferia — campos SAP, reglas de control RC1–RC10 y cómo recomendar ante cada excepción.
---

`
const TOOLS = `// Mismas herramientas que usa la aplicación: se re-exportan, no se copian.
export * from "../../src/tools/oc.ts"
`

function piezas(raiz: string): { ruta: string; contenido: string }[] {
  const leer = (r: string) => readFileSync(join(raiz, r), "utf8")
  return [
    { ruta: "modulo/agent.md", contenido: AGENTE + leer("agent/prompt.md") },
    { ruta: "modulo/skill/ordenes-compra/SKILL.md", contenido: SKILL + leer("src/knowledge/ordenes-compra.md") },
    { ruta: "modulo/tools/oc.ts", contenido: TOOLS },
  ]
}

export function construirModulo(raiz: string): void {
  for (const p of piezas(raiz)) {
    mkdirSync(dirname(join(raiz, p.ruta)), { recursive: true })
    writeFileSync(join(raiz, p.ruta), p.contenido)
  }
}

/** Compara modulo/ con las fuentes; devuelve un mensaje legible. */
export function verificarModulo(raiz: string): string {
  const divergentes = piezas(raiz).filter((p) => !existsSync(join(raiz, p.ruta)) || readFileSync(join(raiz, p.ruta), "utf8") !== p.contenido)
  return divergentes.length === 0
    ? "modulo/ está sincronizado con agent/prompt.md, src/knowledge/ y src/tools/ ✓"
    : `modulo/ desactualizado en: ${divergentes.map((d) => d.ruta).join(", ")}. Ejecuta: bun run modulo`
}

if (import.meta.main) {
  construirModulo(join(import.meta.dir, ".."))
  console.log("modulo/ generado.")
}
