import type { z } from "zod"
import type { Resultado } from "../dominio/resultado.ts"

/**
 * ctx.directory: raíz del proyecto (todas las rutas se resuelven desde aquí).
 * ctx.confirmacionUsuario: lo fija el ciclo del agente (no el modelo) cuando el último mensaje
 * del usuario es una confirmación explícita a una pregunta pendiente. Es la garantía de CA3.
 */
export type ContextoHerramienta = { directory: string; sessionId: string; confirmacionUsuario?: boolean }

/** Contrato de la sección 6.2: description + args (zod) + execute que devuelve JSON y nunca lanza. */
export type Herramienta<A extends z.ZodRawShape> = {
  description: string
  args: A
  execute(args: z.infer<z.ZodObject<A>>, ctx: ContextoHerramienta): Promise<string>
}

/** Identidad tipada: conserva la forma de objeto del contrato e infiere el tipo de los argumentos. */
export const herramienta = <A extends z.ZodRawShape>(h: Herramienta<A>): Herramienta<A> => h

export const responder = (r: Resultado<unknown>): string => JSON.stringify(r)
