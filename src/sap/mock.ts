import { readFileSync } from "node:fs"
import { agregarLinea, existe, rutas } from "../dominio/archivos.ts"
import type { OrdenCompra, Proveedor } from "../dominio/tipos.ts"
import type { SapAdapter } from "./adapter.ts"

type Registro = { numero_oc: string; fecha: string; orden: OrdenCompra }

const PRIMER_NUMERO = 4500000001

/** SAP simulado: escribe una línea por OC en out/sap/ordenes.jsonl y numera desde 4500000001. */
export class SapMock implements SapAdapter {
  private readonly archivo: string

  constructor(raiz: string, private readonly proveedores: Proveedor[]) {
    this.archivo = rutas.out(raiz, "sap", "ordenes.jsonl")
  }

  private registros(): Registro[] {
    if (!existe(this.archivo)) return []
    return readFileSync(this.archivo, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Registro)
  }

  async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const p = this.proveedores.find((x) => x.nit === nit)
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null
  }

  async buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null> {
    const r = this.registros().find((x) => x.orden.referencia.solicitud_id === solicitud_id)
    return r ? { numero_oc: r.numero_oc } : null
  }

  async crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    // Idempotencia también en el adaptador: un reintento con la misma referencia devuelve la OC existente.
    const previa = this.registros().find((x) => x.orden.referencia.solicitud_id === orden.referencia.solicitud_id)
    if (previa) return { numero_oc: previa.numero_oc, fecha: previa.fecha }
    const registro: Registro = {
      numero_oc: String(PRIMER_NUMERO + this.registros().length),
      fecha: new Date().toISOString().slice(0, 10),
      orden,
    }
    agregarLinea(this.archivo, JSON.stringify(registro))
    return { numero_oc: registro.numero_oc, fecha: registro.fecha }
  }
}
