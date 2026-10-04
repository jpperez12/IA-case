import { z } from "zod"
import { leerJson, rutas } from "./archivos.ts"
import { exito, type Resultado } from "./resultado.ts"
import { normalizarNombre, normalizarNit } from "./texto.ts"
import {
  CentroCostoSchema,
  CondicionPagoSchema,
  IndicadorIvaSchema,
  ProveedorSchema,
  type Maestros,
  type Proveedor,
  type Solicitud,
} from "./tipos.ts"

/** Carga y valida los cuatro maestros. En producción se consultarían en SAP en tiempo real. */
export function cargarMaestros(raiz: string): Resultado<Maestros> {
  const proveedores = leerJson(rutas.maestro(raiz, "proveedores.json"), z.array(ProveedorSchema), "proveedores.json")
  if (!proveedores.ok) return proveedores
  const centros = leerJson(rutas.maestro(raiz, "centros-costo.json"), z.array(CentroCostoSchema), "centros-costo.json")
  if (!centros.ok) return centros
  const iva = leerJson(rutas.maestro(raiz, "indicadores-iva.json"), z.array(IndicadorIvaSchema), "indicadores-iva.json")
  if (!iva.ok) return iva
  const pago = leerJson(rutas.maestro(raiz, "condiciones-pago.json"), z.array(CondicionPagoSchema), "condiciones-pago.json")
  if (!pago.ok) return pago
  return exito({ proveedores: proveedores.data, centros: centros.data, indicadoresIva: iva.data, condicionesPago: pago.data })
}

/** RC1: busca por NIT; si la solicitud no trae NIT, por nombre normalizado. */
export function buscarProveedor(s: Solicitud, proveedores: Proveedor[]): Proveedor | null {
  if (s.proveedor_nit) {
    const nit = normalizarNit(s.proveedor_nit)
    return proveedores.find((p) => p.nit === nit) ?? null
  }
  const nombre = normalizarNombre(s.proveedor_nombre)
  return proveedores.find((p) => normalizarNombre(p.nombre) === nombre) ?? null
}
