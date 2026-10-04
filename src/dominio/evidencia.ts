import { createHash } from "node:crypto"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import { escribir, rutas } from "./archivos.ts"
import { exito, fallo, mensajeDe, type Resultado } from "./resultado.ts"
import type { AprobacionCruda } from "./tipos.ts"

/** Contenido canónico de la evidencia. El sha256 se calcula sobre este texto exacto. */
export function contenidoEvidencia(solicitudId: string, a: AprobacionCruda): string {
  return [
    `EVIDENCIA DE APROBACIÓN - ${solicitudId}`,
    `De: ${a.de}`,
    `Para: ${a.para}`,
    ...(a.cc?.length ? [`CC: ${a.cc.join(", ")}`] : []),
    `Fecha: ${a.fecha}`,
    `Asunto: ${a.asunto}`,
    "",
    a.cuerpo,
  ].join("\n")
}

export const sha256 = (texto: string): string => createHash("sha256").update(texto, "utf8").digest("hex")

/** Helvetica estándar solo codifica WinAnsi: se reemplaza lo que no cabe para que el PDF nunca falle. */
const aWinAnsi = (t: string): string => t.replace(/[^\u0009\u000a\u0020-\u007e\u00a0-\u00ff]/g, "?")

function partirLinea(linea: string, ancho: number): string[] {
  if (linea.length <= ancho) return [linea]
  const partes: string[] = []
  let resto = linea
  while (resto.length > ancho) {
    const corte = resto.lastIndexOf(" ", ancho) > 0 ? resto.lastIndexOf(" ", ancho) : ancho
    partes.push(resto.slice(0, corte))
    resto = resto.slice(corte).trimStart()
  }
  return [...partes, resto]
}

async function generarPdf(contenido: string, hash: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const fuente = await pdf.embedFont(StandardFonts.Helvetica)
  const pagina = pdf.addPage([595, 842]) // A4
  const lineas = [...contenido.split("\n"), "", "---", `sha256: ${hash}`].flatMap((l) => partirLinea(aWinAnsi(l), 90))
  lineas.forEach((linea, i) => {
    pagina.drawText(linea, { x: 50, y: 790 - i * 16, size: i === 0 ? 13 : 10, font: fuente, color: rgb(0.1, 0.1, 0.1) })
  })
  return pdf.save({ useObjectStreams: false })
}

export type Evidencia = { ruta: string; ruta_pdf: string; sha256: string }

/** HU-4: escribe out/<caso>/aprobacion.txt (P0) y aprobacion.pdf (P1). Devuelve rutas relativas a la raíz. */
export async function generarEvidencia(raiz: string, caso: string, solicitudId: string, a: AprobacionCruda): Promise<Resultado<Evidencia>> {
  try {
    const contenido = contenidoEvidencia(solicitudId, a)
    const hash = sha256(contenido)
    escribir(rutas.out(raiz, caso, "aprobacion.txt"), `${contenido}\n\n---\nsha256: ${hash}\n`)
    escribir(rutas.out(raiz, caso, "aprobacion.pdf"), await generarPdf(contenido, hash))
    return exito({ ruta: `out/${caso}/aprobacion.txt`, ruta_pdf: `out/${caso}/aprobacion.pdf`, sha256: hash })
  } catch (e) {
    return fallo(`No se pudo generar la evidencia: ${mensajeDe(e)}`)
  }
}
