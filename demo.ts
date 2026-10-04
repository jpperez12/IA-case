/**
 * Verificación sin modelo (sección 6.6): procesa los 6 casos llamando directamente a las herramientas.
 * Uso: bun install && bun run demo.ts   (no requiere ninguna clave)
 */
import { readFileSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { ejecutar } from "./src/tools/registro.ts"
import type { ContextoHerramienta } from "./src/tools/herramienta.ts"
import { verificarModulo } from "./scripts/build-modulo.ts"

const raiz = import.meta.dir
const ctx: ContextoHerramienta = { directory: raiz, sessionId: "demo" }
const conConfirmacion: ContextoHerramienta = { ...ctx, confirmacionUsuario: true }

type Respuesta = { ok: boolean; error?: string; detalle?: unknown; data?: Record<string, unknown> }

async function llamar(nombre: string, args: Record<string, unknown>, c = ctx): Promise<Respuesta> {
  return JSON.parse((await ejecutar(nombre, args, c)).resultado) as Respuesta
}

const codigos = (lista: unknown): string => (Array.isArray(lista) ? lista.map((x: { codigo: string }) => x.codigo).join(", ") || "—" : "—")
const titulo = (t: string) => console.log(`\n${"═".repeat(72)}\n${t}\n${"═".repeat(72)}`)

async function procesar(caso: string): Promise<void> {
  const paquete = await llamar("oc_leer_paquete", { caso })
  if (!paquete.ok) return console.log(`${caso}  ✗ ${paquete.error}`)
  const v = await llamar("oc_validar", { caso })
  const d = v.data ?? {}
  console.log(`\n▸ ${caso}  ${String(paquete.data?.resumen)}`)
  console.log(`  apta=${d.apta}  retroactiva=${d.retroactiva}`)
  console.log(`  bloqueos:       ${codigos(d.bloqueos)}`)
  console.log(`  confirmaciones: ${codigos(d.confirmaciones)}`)
  if (d.derivados && Object.keys(d.derivados).length) console.log(`  derivados:      ${JSON.stringify(d.derivados)}`)
  for (const b of (d.bloqueos as { detalle: string; accion_sugerida: string }[]) ?? []) console.log(`    ⛔ ${b.detalle}\n       → ${b.accion_sugerida}`)
  if (d.apta) {
    await llamar("oc_construir_payload", { caso })
    await llamar("oc_generar_evidencia", { caso })
  }
  const r = await llamar("oc_crear", { caso })
  console.log(r.ok ? `  ✓ OC ${String(r.data?.numero_oc)} creada` : `  · No creada: ${r.error}`)
}

async function main(): Promise<void> {
  rmSync(join(raiz, "out"), { recursive: true, force: true })
  const casos = readdirSync(join(raiz, "fixtures", "reto-03", "solicitudes")).sort()

  titulo("1. Procesamiento de los casos (sin confirmaciones)")
  for (const caso of casos) await procesar(caso)

  titulo("2. Controles de seguridad del ciclo")
  const sinUsuario = await llamar("oc_crear", { caso: "sol-006", confirmado: true })
  console.log(`sol-006 con confirmado=true pero sin confirmación del usuario → ${sinUsuario.ok ? "CREADA (error)" : `rechazado: ${sinUsuario.error}`}`)
  const payload = await llamar("oc_construir_payload", { caso: "sol-004" })
  const alterado = structuredClone(payload.data?.orden) as { posiciones: { precio_unitario: number }[] }
  alterado.posiciones[0]!.precio_unitario = 265000
  const manipulado = await llamar("oc_crear", { caso: "sol-004", payload: alterado, confirmado: true }, conConfirmacion)
  console.log(`sol-004 con precio alterado a 265.000 → ${manipulado.ok ? "CREADA (error)" : `rechazado: ${manipulado.error}`}`)

  titulo("3. Confirmación explícita del usuario")
  for (const caso of ["sol-004", "sol-005", "sol-006"]) {
    const r = await llamar("oc_crear", { caso, payload: caso === "sol-004" ? payload.data?.orden : undefined, confirmado: true }, conConfirmacion)
    console.log(`${caso} confirmado → ${r.ok ? `OC ${String(r.data?.numero_oc)}${r.data?.retroactiva ? " (retroactiva=true)" : ""}, evidencia ${String(r.data?.evidencia)}` : r.error}`)
  }

  titulo("4. Idempotencia: sol-001 por segunda vez")
  const repetida = await llamar("oc_crear", { caso: "sol-001" })
  console.log(`sol-001 → OC ${String(repetida.data?.numero_oc)}, idempotente=${String(repetida.data?.idempotente)}`)

  titulo("5. out/control.csv")
  console.log(readFileSync(join(raiz, "out", "control.csv"), "utf8").replace(/,\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, ",<ts>"))

  titulo("6. Módulo reutilizable")
  console.log(verificarModulo(raiz))
}

await main()
