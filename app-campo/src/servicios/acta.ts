// SPDX-FileCopyrightText: 2026 GoDoWorks
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generacion del acta de inspeccion en PDF, dentro del dispositivo.
 *
 * El acta es un documento administrativo: sobrio, en blanco y negro, imprimible
 * en A4 y legible por alguien que la recibe pegada en la puerta de su local. No
 * es un folleto. Por eso aca no hay colores: solo negro, grises y filetes.
 *
 * Tres cuidados que no son opcionales:
 *
 *  1. Las fuentes estandar de PDF usan WinAnsi. Latin-1 entra entero (acentos y
 *     ñ salen bien) pero hay que normalizar a NFC antes: si el texto viene con
 *     acentos combinantes, "inspección" se rompe. Ver `sanitizar`.
 *  2. El documento se pagina solo. Si el checklist es largo, sigue en la hoja
 *     siguiente con su encabezado de continuacion.
 *  3. El pie lleva el hash de verificacion. Se calcula sobre el contenido del
 *     acta, no sobre los bytes del PDF, porque el hash viaja adentro del propio
 *     documento y no puede depender de si mismo.
 */

import {
  PDFDocument, StandardFonts, rgb,
  type Color, type PDFFont, type PDFImage, type PDFPage,
} from 'pdf-lib'
import type {
  Evidencia, FechaHora, Firma, FormularioVersion, Incumplimiento, Inspeccion,
  ObjetoInspeccionable, Organismo, Respuesta, TipoInspeccion,
} from '@/dominio/tipos'
import { calcularHash, formatearFecha, formatearFechaHora } from '@/dominio/utilidades'

// ── Medidas de la hoja ────────────────────────────────────────────────

/** A4 en puntos. */
const ANCHO_PAGINA = 595.28
const ALTO_PAGINA = 841.89
const MARGEN = 48
const ANCHO_UTIL = ANCHO_PAGINA - MARGEN * 2
/** Por debajo de esta altura empieza el pie: nada de contenido ahi. */
const PISO = 66

const NEGRO = rgb(0, 0, 0)
const TINTA = rgb(0.07, 0.13, 0.18)
const GRIS = rgb(0.36, 0.42, 0.45)
const FILETE = rgb(0.78, 0.81, 0.80)
const FONDO_SUAVE = rgb(0.93, 0.94, 0.94)

const MAXIMO_FOTOS = 4

// ── Texto seguro para WinAnsi ─────────────────────────────────────────

/**
 * Caracteres que se usan seguido en la interfaz y conviene bajar a un
 * equivalente simple antes de imprimirlos.
 */
const EQUIVALENCIAS: Record<string, string> = {
  // Espacios que no son el espacio comun.
  '\u00a0': ' ', '\u2007': ' ', '\u2009': ' ', '\u202f': ' ',
  // Guiones y rayas tipograficas.
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-',
  '\u2014': '-', '\u2015': '-', '\u2212': '-',
  // Comillas tipograficas.
  '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'",
  '\u201c': '"', '\u201d': '"', '\u201e': '"',
  // Signos que aparecen en la interfaz pero no existen en WinAnsi.
  // El punto medio (\u00b7) NO se toca: existe en Latin-1 y se usa como
  // separador en todo el acta.
  '\u2022': '-', '\u2026': '...',
  '\u2713': 'SI', '\u2714': 'SI', '\u2717': 'NO', '\u2718': 'NO',
  '\u2192': '->', '\u2190': '<-',
}

/**
 * Deja el texto dentro de lo que las fuentes estandar saben dibujar.
 *
 * La normalizacion a NFC es la parte importante: "inspección" escrito con
 * acento combinante son dos codepoints y el segundo no existe en WinAnsi.
 * Normalizado es uno solo (U+00F3) y entra sin problemas, igual que la ñ.
 */
function sanitizar(texto: string): string {
  let salida = ''
  for (const caracter of texto.normalize('NFC')) {
    const equivalente = EQUIVALENCIAS[caracter]
    if (equivalente !== undefined) {
      salida += equivalente
      continue
    }
    const codigo = caracter.codePointAt(0) ?? 0
    if (codigo === 9) { salida += ' '; continue }
    if (codigo < 32) continue
    // ASCII imprimible y Latin-1: todo esto lo cubre WinAnsi.
    if (codigo <= 0x7e || (codigo >= 0xa0 && codigo <= 0xff)) {
      salida += caracter
      continue
    }
    // Lo que quedo afuera no se puede dibujar: se descarta antes de que
    // pdf-lib lance y deje al inspector sin acta.
  }
  return salida
}

/** Parte una palabra que no entra ni sola en el ancho disponible. */
function partirPalabra(palabra: string, fuente: PDFFont, tamano: number, ancho: number): string[] {
  const partes: string[] = []
  let actual = ''
  for (const caracter of palabra) {
    if (actual && fuente.widthOfTextAtSize(actual + caracter, tamano) > ancho) {
      partes.push(actual)
      actual = caracter
    } else {
      actual += caracter
    }
  }
  if (actual) partes.push(actual)
  return partes
}

/** Corta el texto en lineas que entran en `ancho`. */
function envolver(texto: string, fuente: PDFFont, tamano: number, ancho: number): string[] {
  const lineas: string[] = []
  for (const parrafo of sanitizar(texto).split('\n')) {
    let linea = ''
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
      const tentativa = linea ? `${linea} ${palabra}` : palabra
      if (fuente.widthOfTextAtSize(tentativa, tamano) <= ancho) {
        linea = tentativa
        continue
      }
      if (linea) { lineas.push(linea); linea = '' }
      const partes = fuente.widthOfTextAtSize(palabra, tamano) > ancho
        ? partirPalabra(palabra, fuente, tamano, ancho)
        : [palabra]
      linea = partes.pop() ?? ''
      lineas.push(...partes)
    }
    lineas.push(linea)
  }
  return lineas.length ? lineas : ['']
}

/** Recorta una linea agregando puntos suspensivos si no entra. */
function recortar(texto: string, fuente: PDFFont, tamano: number, ancho: number): string {
  const limpio = sanitizar(texto)
  if (fuente.widthOfTextAtSize(limpio, tamano) <= ancho) return limpio
  let corte = limpio
  while (corte.length > 1 && fuente.widthOfTextAtSize(`${corte}...`, tamano) > ancho) {
    corte = corte.slice(0, -1)
  }
  return `${corte}...`
}

// ── Etiquetas legibles ────────────────────────────────────────────────

const GRAVEDADES: Record<Incumplimiento['gravedad'], string> = {
  leve: 'Leve',
  grave: 'Grave',
  muy_grave: 'Muy grave',
}

const PESO_GRAVEDAD: Record<Incumplimiento['gravedad'], number> = {
  leve: 1,
  grave: 2,
  muy_grave: 3,
}

const ORIGENES: Record<Inspeccion['origen'], string> = {
  plan: 'Plan de inspecciones',
  reclamo: 'Reclamo',
  oficio: 'De oficio',
}

const RESULTADOS: Record<NonNullable<Inspeccion['resultado']>, string> = {
  conforme: 'Conforme',
  con_observaciones: 'Con observaciones',
  no_conforme: 'No conforme',
}

export function etiquetaGravedad(gravedad: Incumplimiento['gravedad']): string {
  return GRAVEDADES[gravedad]
}

export function etiquetaResultado(resultado: Inspeccion['resultado']): string {
  return resultado ? RESULTADOS[resultado] : 'Sin resultado'
}

// ── Lectura de las respuestas ─────────────────────────────────────────

/** Quita acentos y mayusculas para poder comparar respuestas escritas a mano. */
function llave(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

type ValorRespuesta = string | number | boolean | null | undefined

/** Como se lee una respuesta en el acta. */
export function textoRespuesta(valor: ValorRespuesta): string {
  if (valor === null || valor === undefined) return 'Sin responder'
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  if (typeof valor === 'number') return String(valor)
  const texto = valor.trim()
  if (!texto) return 'Sin responder'
  switch (llave(texto)) {
    case 'si': return 'Sí'
    case 'no': return 'No'
    case 'na':
    case 'n/a':
    case 'no aplica':
    case 'no_aplica': return 'No aplica'
    default: return texto
  }
}

/** Si la respuesta dada es justamente la que constata la falta. */
function respondioLoQueIncumple(valor: ValorRespuesta, esperado: string | undefined): boolean {
  if (!esperado || valor === null || valor === undefined) return false
  const dado = typeof valor === 'boolean' ? (valor ? 'si' : 'no') : String(valor)
  return llave(dado) === llave(esperado)
}

/**
 * Los incumplimientos que quedan constatados: los que la respuesta trae
 * declarados mas los que se deducen del checklist. Se devuelven en el orden del
 * formulario y sin repetir.
 */
export function incumplimientosConstatados(
  formulario: FormularioVersion,
  respuesta: Respuesta | undefined,
): Incumplimiento[] {
  if (!respuesta) return []
  const ids = new Set<string>(respuesta.incumplimientoIds ?? [])
  for (const seccion of formulario.secciones) {
    for (const pregunta of seccion.preguntas) {
      if (!pregunta.incumplimientoId) continue
      if (respondioLoQueIncumple(respuesta.datos[pregunta.id], pregunta.respuestaQueIncumple)) {
        ids.add(pregunta.incumplimientoId)
      }
    }
  }
  return formulario.incumplimientos.filter((i) => ids.has(i.id))
}

/**
 * Dias de plazo del acta: los del incumplimiento mas grave. Con igual gravedad
 * manda el plazo mas corto, que es el que primero vence. Sin incumplimientos,
 * el plazo que fija el tipo de inspeccion.
 */
export function diasDePlazo(incumplimientos: Incumplimiento[], plazoPorDefecto: number): number {
  if (!incumplimientos.length) return plazoPorDefecto
  let elegido = incumplimientos[0]
  for (const candidato of incumplimientos.slice(1)) {
    const masGrave = PESO_GRAVEDAD[candidato.gravedad] > PESO_GRAVEDAD[elegido.gravedad]
    const igualPeroMasCorto =
      PESO_GRAVEDAD[candidato.gravedad] === PESO_GRAVEDAD[elegido.gravedad] &&
      candidato.plazoSubsanacionDias < elegido.plazoSubsanacionDias
    if (masGrave || igualPeroMasCorto) elegido = candidato
  }
  return elegido.plazoSubsanacionDias
}

/** Nombre con el que se descarga el acta. */
export function nombreArchivoActa(numero: string): string {
  const limpio = sanitizar(numero).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `acta-${limpio || 's-n'}.pdf`
}

// ── Lienzo con paginado ───────────────────────────────────────────────

interface OpcionesTexto {
  tamano?: number
  negrita?: boolean
  color?: Color
}

/**
 * Hoja con cursor vertical. Todo el dibujo pasa por aca para que el paginado y
 * el saneado del texto ocurran en un solo lugar.
 */
class Hoja {
  private readonly paginas: PDFPage[] = []
  private pagina!: PDFPage
  /** Cursor: borde superior de lo proximo que se dibuje. */
  y = 0

  constructor(
    private readonly doc: PDFDocument,
    private readonly normal: PDFFont,
    private readonly negrita: PDFFont,
    private readonly rotulo: string,
  ) {
    this.abrir()
  }

  private fuente(esNegrita?: boolean): PDFFont {
    return esNegrita ? this.negrita : this.normal
  }

  /** Abre una pagina nueva. De la segunda en adelante lleva continuacion. */
  abrir(): void {
    this.pagina = this.doc.addPage([ANCHO_PAGINA, ALTO_PAGINA])
    this.paginas.push(this.pagina)
    this.y = ALTO_PAGINA - MARGEN
    if (this.paginas.length > 1) this.encabezadoContinuacion()
  }

  private encabezadoContinuacion(): void {
    this.escribir(this.rotulo, MARGEN, this.y - 9, { tamano: 9, negrita: true, color: GRIS })
    this.avanzar(16)
    this.regla(FILETE)
    this.avanzar(14)
  }

  /** Reserva alto: si no entra en la hoja, sigue en la siguiente. */
  espacio(alto: number): void {
    if (this.y - alto < PISO) this.abrir()
  }

  avanzar(alto: number): void {
    this.y -= alto
  }

  // Dibujo absoluto: `y` es la linea de base del texto.

  escribir(texto: string, x: number, y: number, opciones: OpcionesTexto = {}): void {
    this.pagina.drawText(sanitizar(texto), {
      x,
      y,
      size: opciones.tamano ?? 9.5,
      font: this.fuente(opciones.negrita),
      color: opciones.color ?? TINTA,
    })
  }

  escribirDerecha(texto: string, xDerecha: number, y: number, opciones: OpcionesTexto = {}): void {
    const tamano = opciones.tamano ?? 9.5
    const limpio = sanitizar(texto)
    const ancho = this.fuente(opciones.negrita).widthOfTextAtSize(limpio, tamano)
    this.escribir(limpio, xDerecha - ancho, y, opciones)
  }

  escribirCentrado(texto: string, xCentro: number, y: number, opciones: OpcionesTexto = {}): void {
    const tamano = opciones.tamano ?? 9.5
    const limpio = sanitizar(texto)
    const ancho = this.fuente(opciones.negrita).widthOfTextAtSize(limpio, tamano)
    this.escribir(limpio, xCentro - ancho / 2, y, opciones)
  }

  rectangulo(
    x: number, y: number, ancho: number, alto: number,
    opciones: { borde?: Color; grosor?: number; relleno?: Color } = {},
  ): void {
    this.pagina.drawRectangle({
      x, y, width: ancho, height: alto,
      borderColor: opciones.borde,
      borderWidth: opciones.borde ? (opciones.grosor ?? 0.8) : 0,
      color: opciones.relleno,
    })
  }

  imagen(imagen: PDFImage, x: number, y: number, ancho: number, alto: number): void {
    this.pagina.drawImage(imagen, { x, y, width: ancho, height: alto })
  }

  /** Filete horizontal a la altura del cursor. */
  regla(color: Color = FILETE, grosor = 0.8): void {
    this.pagina.drawLine({
      start: { x: MARGEN, y: this.y },
      end: { x: MARGEN + ANCHO_UTIL, y: this.y },
      thickness: grosor,
      color,
    })
  }

  // Dibujo con cursor.

  /** Una linea de texto que avanza el cursor. */
  linea(texto: string, opciones: OpcionesTexto & { x?: number } = {}): void {
    const tamano = opciones.tamano ?? 9.5
    this.espacio(tamano * 1.45)
    this.escribir(texto, opciones.x ?? MARGEN, this.y - tamano, opciones)
    this.avanzar(tamano * 1.45)
  }

  /** Parrafo envuelto, con corte de pagina entre lineas. */
  parrafo(
    texto: string,
    opciones: OpcionesTexto & { x?: number; ancho?: number } = {},
  ): void {
    const tamano = opciones.tamano ?? 9.5
    const x = opciones.x ?? MARGEN
    const ancho = opciones.ancho ?? MARGEN + ANCHO_UTIL - x
    for (const linea of envolver(texto, this.fuente(opciones.negrita), tamano, ancho)) {
      this.espacio(tamano * 1.4)
      this.escribir(linea, x, this.y - tamano, opciones)
      this.avanzar(tamano * 1.4)
    }
  }

  /** Titulo de bloque: version chica, en mayusculas, con filete abajo. */
  titulo(texto: string): void {
    this.espacio(46)
    this.avanzar(14)
    this.escribir(texto.toUpperCase(), MARGEN, this.y - 8.5, {
      tamano: 8.5, negrita: true, color: GRIS,
    })
    this.avanzar(13)
    this.regla(FILETE)
    this.avanzar(11)
  }

  /** Fila de dato: etiqueta a la izquierda, valor a la derecha de la etiqueta. */
  dato(etiqueta: string, valor: string): void {
    const anchoEtiqueta = 148
    const xValor = MARGEN + anchoEtiqueta
    const anchoValor = ANCHO_UTIL - anchoEtiqueta
    const lineas = envolver(valor, this.normal, 9.5, anchoValor)
    this.espacio(lineas.length * 13.5)
    const yInicio = this.y
    this.escribir(etiqueta, MARGEN, yInicio - 9.5, { tamano: 9.5, color: GRIS })
    lineas.forEach((linea, indice) => {
      this.escribir(linea, xValor, yInicio - 9.5 - indice * 13.5, { tamano: 9.5, negrita: true })
    })
    this.avanzar(lineas.length * 13.5)
  }

  /** Envuelve midiendo con las fuentes del documento. */
  envolverTexto(texto: string, tamano: number, ancho: number, esNegrita = false): string[] {
    return envolver(texto, this.fuente(esNegrita), tamano, ancho)
  }

  /** Recorta a una linea midiendo con las fuentes del documento. */
  recortarTexto(texto: string, tamano: number, ancho: number, esNegrita = false): string {
    return recortar(texto, this.fuente(esNegrita), tamano, ancho)
  }

  /** Pie de todas las paginas. Se dibuja al final, cuando ya se sabe cuantas son. */
  cerrarPie(hash: string): void {
    const total = this.paginas.length
    this.paginas.forEach((pagina, indice) => {
      pagina.drawLine({
        start: { x: MARGEN, y: 56 },
        end: { x: MARGEN + ANCHO_UTIL, y: 56 },
        thickness: 0.8,
        color: FILETE,
      })
      pagina.drawText(sanitizar(
        'Documento generado digitalmente por Tero en el dispositivo del inspector.',
      ), { x: MARGEN, y: 44, size: 7, font: this.normal, color: GRIS })
      pagina.drawText(sanitizar(`Hash de verificación SHA-256: ${hash}`), {
        x: MARGEN, y: 34, size: 6.5, font: this.normal, color: GRIS,
      })
      const paginado = `Página ${indice + 1} de ${total}`
      const ancho = this.normal.widthOfTextAtSize(sanitizar(paginado), 7)
      pagina.drawText(sanitizar(paginado), {
        x: MARGEN + ANCHO_UTIL - ancho, y: 44, size: 7, font: this.normal, color: GRIS,
      })
    })
  }
}

// ── Imagenes ──────────────────────────────────────────────────────────

/** Embebe una imagen mirando su firma binaria. Nunca lanza: una foto rota no puede tumbar el acta. */
async function embeberImagen(doc: PDFDocument, contenido: Blob): Promise<PDFImage | undefined> {
  try {
    const datos = new Uint8Array(await contenido.arrayBuffer())
    if (datos.length < 4) return undefined
    const esPng = datos[0] === 0x89 && datos[1] === 0x50 && datos[2] === 0x4e && datos[3] === 0x47
    const esJpg = datos[0] === 0xff && datos[1] === 0xd8
    if (esPng) return await doc.embedPng(datos)
    if (esJpg) return await doc.embedJpg(datos)
    if (contenido.type.includes('png')) return await doc.embedPng(datos)
    return await doc.embedJpg(datos)
  } catch {
    return undefined
  }
}

/** Escala manteniendo proporcion para que entre en la caja. */
function encajar(
  imagen: PDFImage, anchoCaja: number, altoCaja: number,
): { ancho: number; alto: number } {
  const escala = Math.min(anchoCaja / imagen.width, altoCaja / imagen.height, 1)
  return { ancho: imagen.width * escala, alto: imagen.height * escala }
}

// ── Datos de entrada ──────────────────────────────────────────────────

export interface DatosActa {
  organismo: Organismo
  inspeccion: Inspeccion
  objeto: ObjetoInspeccionable
  tipoInspeccion: TipoInspeccion
  /** La version exacta contra la que se completo. Nunca la vigente. */
  formulario: FormularioVersion
  respuesta?: Respuesta
  evidencias: Evidencia[]
  firma?: Firma
  /** Correlativo ya reservado por el almacen. */
  numero: string
  emitidaEn: FechaHora
  plazoSubsanacion?: FechaHora
  diasPlazo: number
}

/**
 * Huella del contenido del acta. Va impresa en el pie para que cualquiera pueda
 * verificar despues que el documento corresponde a esta inspeccion y no a otra.
 */
async function hashDeVerificacion(datos: DatosActa, incumplimientos: Incumplimiento[]): Promise<string> {
  const partes = [
    datos.numero,
    datos.inspeccion.uuid,
    datos.emitidaEn,
    datos.plazoSubsanacion ?? '',
    datos.organismo.id,
    datos.objeto.id,
    datos.formulario.id,
    JSON.stringify(datos.respuesta?.datos ?? {}),
    incumplimientos.map((i) => i.id).join(','),
    datos.evidencias.map((e) => e.hash).join(','),
    datos.firma ? `${datos.firma.firmante}|${datos.firma.documento}|${datos.firma.seNegoAFirmar}` : '',
  ]
  return calcularHash(new Blob([partes.join('|')], { type: 'text/plain' }))
}

// ── Bloques del acta ──────────────────────────────────────────────────

function encabezado(hoja: Hoja, datos: DatosActa): void {
  const anchoCaja = 168
  const xCaja = MARGEN + ANCHO_UTIL - anchoCaja
  const yCaja = hoja.y - 52

  hoja.escribir(datos.organismo.nombre.toUpperCase(), MARGEN, hoja.y - 10, {
    tamano: 10, negrita: true,
  })
  hoja.escribir('ACTA DE INSPECCIÓN', MARGEN, hoja.y - 40, { tamano: 21, negrita: true })

  hoja.rectangulo(xCaja, yCaja, anchoCaja, 46, { borde: NEGRO, grosor: 1.2 })
  hoja.escribir('ACTA NÚMERO', xCaja + 12, yCaja + 31, { tamano: 7, negrita: true, color: GRIS })
  hoja.escribir(datos.numero, xCaja + 12, yCaja + 11, { tamano: 15, negrita: true, color: NEGRO })

  hoja.avanzar(58)
  hoja.regla(NEGRO, 1.6)
  hoja.avanzar(12)
  hoja.parrafo(
    `${datos.tipoInspeccion.nombre} · ${datos.tipoInspeccion.direccionResponsable}`,
    { tamano: 9, color: GRIS },
  )
}

function bloqueInspeccion(hoja: Hoja, datos: DatosActa): void {
  const i = datos.inspeccion
  hoja.titulo('Datos de la inspección')
  hoja.dato('Fecha y hora', formatearFechaHora(i.ejecutadaEn ?? i.creadaEn))
  hoja.dato('Tipo de inspección', datos.tipoInspeccion.nombre)
  hoja.dato('Dirección responsable', datos.tipoInspeccion.direccionResponsable)
  hoja.dato('Origen', ORIGENES[i.origen])
  hoja.dato('Resultado', etiquetaResultado(i.resultado))
  hoja.dato('Inspector actuante', i.asignadoA ?? 'Sin asignar')
  if (i.ubicacionEjecucion) {
    const u = i.ubicacionEjecucion
    const precision = u.precision ? ` (± ${Math.round(u.precision)} m)` : ''
    hoja.dato('Ubicación al cerrar', `${u.lat.toFixed(6)}, ${u.lon.toFixed(6)}${precision}`)
  }
  hoja.dato('Identificador interno', i.uuid)
}

function bloqueObjeto(hoja: Hoja, datos: DatosActa): void {
  const o = datos.objeto
  hoja.titulo('Objeto inspeccionado')
  hoja.dato('Código', o.codigo)
  hoja.dato('Denominación', o.denominacion)
  hoja.dato('Dirección', o.direccion)
  hoja.dato('Coordenadas', `${o.ubicacion.lat.toFixed(6)}, ${o.ubicacion.lon.toFixed(6)}`)
}

/**
 * El plazo es lo primero que mira el inspeccionado, asi que va en una caja
 * grande y con la fecha en cuerpo grande. Nada de letra chica.
 */
function bloquePlazo(hoja: Hoja, datos: DatosActa, hayIncumplimientos: boolean): void {
  const alto = 76
  hoja.espacio(alto + 24)
  hoja.avanzar(16)
  const yCaja = hoja.y - alto

  hoja.rectangulo(MARGEN, yCaja, ANCHO_UTIL, alto, { borde: NEGRO, grosor: 1.6 })

  if (!hayIncumplimientos) {
    hoja.escribir('PLAZO DE SUBSANACIÓN', MARGEN + 16, yCaja + alto - 20, {
      tamano: 8.5, negrita: true, color: GRIS,
    })
    hoja.escribir('No corresponde: no se constataron incumplimientos.', MARGEN + 16, yCaja + 22, {
      tamano: 14, negrita: true, color: NEGRO,
    })
  } else {
    hoja.escribir('PLAZO DE SUBSANACIÓN — VENCE EL', MARGEN + 16, yCaja + alto - 20, {
      tamano: 8.5, negrita: true, color: GRIS,
    })
    hoja.escribir(formatearFecha(datos.plazoSubsanacion), MARGEN + 16, yCaja + 18, {
      tamano: 30, negrita: true, color: NEGRO,
    })
    hoja.escribirDerecha(
      `${datos.diasPlazo} días corridos`,
      MARGEN + ANCHO_UTIL - 16, yCaja + 30,
      { tamano: 12, negrita: true, color: NEGRO },
    )
    hoja.escribirDerecha(
      `desde el ${formatearFecha(datos.inspeccion.ejecutadaEn ?? datos.emitidaEn)}`,
      MARGEN + ANCHO_UTIL - 16, yCaja + 16,
      { tamano: 9, color: GRIS },
    )
  }

  hoja.avanzar(alto + 6)
}

function bloqueIncumplimientos(hoja: Hoja, incumplimientos: Incumplimiento[]): void {
  hoja.titulo('Incumplimientos constatados')

  if (!incumplimientos.length) {
    hoja.parrafo(
      'No se constataron incumplimientos en la presente inspección.',
      { tamano: 9.5 },
    )
    return
  }

  incumplimientos.forEach((incumplimiento, indice) => {
    hoja.espacio(46)
    const numero = `${indice + 1}.`
    const xTexto = MARGEN + 20
    const anchoTexto = ANCHO_UTIL - 20

    hoja.escribir(numero, MARGEN, hoja.y - 9.5, { tamano: 9.5, negrita: true })
    hoja.parrafo(incumplimiento.descripcion, { x: xTexto, ancho: anchoTexto, tamano: 9.5, negrita: true })
    hoja.parrafo(`Normativa: ${incumplimiento.normativa}`, {
      x: xTexto, ancho: anchoTexto, tamano: 8.5, color: GRIS,
    })
    hoja.parrafo(
      `Gravedad: ${etiquetaGravedad(incumplimiento.gravedad)} · Plazo de subsanación: ${incumplimiento.plazoSubsanacionDias} días`,
      { x: xTexto, ancho: anchoTexto, tamano: 8.5, color: GRIS },
    )
    if (indice < incumplimientos.length - 1) {
      hoja.avanzar(7)
      hoja.regla(FILETE, 0.5)
      hoja.avanzar(7)
    }
  })
}

function bloqueChecklist(hoja: Hoja, datos: DatosActa): void {
  hoja.titulo('Verificación realizada')

  const respuesta = datos.respuesta
  if (!respuesta) {
    hoja.parrafo('La inspección no registra respuestas del checklist.', { tamano: 9.5 })
    return
  }

  const anchoRespuesta = 118
  const anchoPregunta = ANCHO_UTIL - anchoRespuesta - 12

  for (const seccion of datos.formulario.secciones) {
    if (!seccion.preguntas.length) continue

    hoja.espacio(52)
    hoja.avanzar(4)
    const yBarra = hoja.y - 17
    hoja.rectangulo(MARGEN, yBarra, ANCHO_UTIL, 17, { relleno: FONDO_SUAVE })
    hoja.escribir(seccion.titulo, MARGEN + 8, yBarra + 5, { tamano: 9, negrita: true })
    hoja.avanzar(17 + 8)

    for (const pregunta of seccion.preguntas) {
      const valor = respuesta.datos[pregunta.id]
      const incumple = respondioLoQueIncumple(valor, pregunta.respuestaQueIncumple)
      const lineas = hoja.envolverTexto(pregunta.texto, 9, anchoPregunta)
      const altoFila = Math.max(lineas.length * 12.5, 14) + 7

      hoja.espacio(altoFila)
      const yFila = hoja.y

      lineas.forEach((linea, indice) => {
        hoja.escribir(linea, MARGEN, yFila - 9 - indice * 12.5, { tamano: 9 })
      })

      const leyenda = textoRespuesta(valor)
      hoja.escribirDerecha(
        hoja.recortarTexto(leyenda, 9, anchoRespuesta, true),
        MARGEN + ANCHO_UTIL, yFila - 9,
        { tamano: 9, negrita: true, color: NEGRO },
      )
      if (incumple) {
        hoja.escribirDerecha('INCUMPLE', MARGEN + ANCHO_UTIL, yFila - 21, {
          tamano: 7, negrita: true, color: NEGRO,
        })
      }

      hoja.avanzar(altoFila)
      hoja.regla(rgb(0.9, 0.91, 0.91), 0.4)
      hoja.avanzar(6)
    }
  }

  if (respuesta.observaciones && respuesta.observaciones.trim()) {
    hoja.titulo('Observaciones del inspector')
    hoja.parrafo(respuesta.observaciones.trim(), { tamano: 9.5 })
  }
}

async function bloqueFotos(hoja: Hoja, doc: PDFDocument, evidencias: Evidencia[]): Promise<void> {
  const fotos = evidencias.filter((e) => e.tipo === 'foto').slice(0, MAXIMO_FOTOS)
  if (!fotos.length) return

  hoja.titulo('Registro fotográfico')

  const separacion = 14
  const anchoCelda = (ANCHO_UTIL - separacion) / 2
  const altoMarco = 134
  const altoCelda = altoMarco + 20

  for (let indice = 0; indice < fotos.length; indice += 2) {
    const fila = fotos.slice(indice, indice + 2)
    hoja.espacio(altoCelda + 8)
    const yFila = hoja.y

    for (let columna = 0; columna < fila.length; columna += 1) {
      const foto = fila[columna]
      const x = MARGEN + columna * (anchoCelda + separacion)
      const yMarco = yFila - altoMarco

      hoja.rectangulo(x, yMarco, anchoCelda, altoMarco, { borde: FILETE, grosor: 0.8 })

      const imagen = await embeberImagen(doc, foto.contenido)
      if (imagen) {
        const { ancho, alto } = encajar(imagen, anchoCelda - 8, altoMarco - 8)
        hoja.imagen(
          imagen,
          x + (anchoCelda - ancho) / 2,
          yMarco + (altoMarco - alto) / 2,
          ancho, alto,
        )
      } else {
        hoja.escribirCentrado('Imagen no disponible', x + anchoCelda / 2, yMarco + altoMarco / 2, {
          tamano: 8.5, color: GRIS,
        })
      }

      hoja.escribir(
        `Foto ${indice + columna + 1} · ${formatearFechaHora(foto.tomadaEn)}`,
        x, yMarco - 12,
        { tamano: 7.5, color: GRIS },
      )
    }

    hoja.avanzar(altoCelda + 8)
  }
}

async function bloqueFirma(hoja: Hoja, doc: PDFDocument, firma: Firma | undefined): Promise<void> {
  hoja.titulo('Firma del inspeccionado')

  const alto = 118
  hoja.espacio(alto + 12)
  const yCaja = hoja.y - alto

  if (!firma) {
    hoja.rectangulo(MARGEN, yCaja, ANCHO_UTIL, alto, { borde: FILETE, grosor: 0.8 })
    hoja.escribirCentrado('NO SE REGISTRÓ FIRMA', MARGEN + ANCHO_UTIL / 2, yCaja + alto / 2, {
      tamano: 14, negrita: true, color: NEGRO,
    })
    hoja.avanzar(alto + 6)
    return
  }

  if (firma.seNegoAFirmar) {
    hoja.rectangulo(MARGEN, yCaja, ANCHO_UTIL, alto, { borde: NEGRO, grosor: 1.6 })
    hoja.escribirCentrado('SE NEGÓ A FIRMAR', MARGEN + ANCHO_UTIL / 2, yCaja + alto - 44, {
      tamano: 22, negrita: true, color: NEGRO,
    })
    hoja.escribirCentrado(
      'Se deja constancia de la negativa a firmar la presente acta.',
      MARGEN + ANCHO_UTIL / 2, yCaja + alto - 64,
      { tamano: 9, color: GRIS },
    )
    const identificacion = [firma.firmante, firma.documento].filter(Boolean).join(' · ')
    if (identificacion) {
      hoja.escribirCentrado(identificacion, MARGEN + ANCHO_UTIL / 2, yCaja + 32, {
        tamano: 9.5, negrita: true,
      })
    }
    hoja.escribirCentrado(
      `Constancia registrada el ${formatearFechaHora(firma.firmadoEn)}`,
      MARGEN + ANCHO_UTIL / 2, yCaja + 16,
      { tamano: 8.5, color: GRIS },
    )
    hoja.avanzar(alto + 6)
    return
  }

  hoja.rectangulo(MARGEN, yCaja, ANCHO_UTIL, alto, { borde: FILETE, grosor: 0.8 })

  const imagen = await embeberImagen(doc, firma.imagen)
  const yLinea = yCaja + 44
  if (imagen) {
    const { ancho, alto: altoFirma } = encajar(imagen, 220, 52)
    hoja.imagen(imagen, MARGEN + 32, yLinea + 6, ancho, altoFirma)
  }

  hoja.rectangulo(MARGEN + 32, yLinea, 260, 0.8, { relleno: NEGRO })
  hoja.escribir(firma.firmante || 'Sin identificar', MARGEN + 32, yLinea - 14, {
    tamano: 10, negrita: true,
  })
  hoja.escribir(`Documento: ${firma.documento || 'no informado'}`, MARGEN + 32, yLinea - 27, {
    tamano: 8.5, color: GRIS,
  })
  hoja.escribirDerecha(
    `Firmado el ${formatearFechaHora(firma.firmadoEn)}`,
    MARGEN + ANCHO_UTIL - 20, yLinea - 14,
    { tamano: 8.5, color: GRIS },
  )

  hoja.avanzar(alto + 6)
}

// ── Punto de entrada ──────────────────────────────────────────────────

/**
 * Arma el PDF del acta. Todo ocurre en el dispositivo: no hay pedido de red en
 * ninguna parte de este archivo.
 */
export async function generarActaPdf(datos: DatosActa): Promise<Blob> {
  const doc = await PDFDocument.create()
  const normal = await doc.embedFont(StandardFonts.Helvetica)
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold)

  doc.setTitle(sanitizar(`Acta de inspección ${datos.numero}`))
  doc.setSubject(sanitizar(`${datos.tipoInspeccion.nombre} — ${datos.objeto.denominacion}`))
  doc.setProducer('Tero')
  doc.setCreator('Tero — aplicación de campo')

  const incumplimientos = incumplimientosConstatados(datos.formulario, datos.respuesta)
  const hoja = new Hoja(doc, normal, negrita, `ACTA DE INSPECCIÓN ${datos.numero} — continuación`)

  encabezado(hoja, datos)
  bloqueInspeccion(hoja, datos)
  bloqueObjeto(hoja, datos)
  bloquePlazo(hoja, datos, incumplimientos.length > 0)
  bloqueIncumplimientos(hoja, incumplimientos)
  bloqueChecklist(hoja, datos)
  await bloqueFotos(hoja, doc, datos.evidencias)
  await bloqueFirma(hoja, doc, datos.firma)

  const hash = await hashDeVerificacion(datos, incumplimientos)
  hoja.cerrarPie(hash)

  const bytes = await doc.save()
  // Se copia a un ArrayBuffer propio: lo que devuelve pdf-lib puede estar
  // respaldado por un buffer compartido y `Blob` no lo acepta.
  const copia = new Uint8Array(bytes.length)
  copia.set(bytes)
  return new Blob([copia.buffer], { type: 'application/pdf' })
}
