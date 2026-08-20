// SPDX-FileCopyrightText: 2026 GoDoWorks
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pruebas del saneado del texto del acta.
 *
 * `sanitizar` no se exporta, y esta bien que no se exporte: es un detalle del
 * generador. Pero es la funcion que evita que un acta no se pueda emitir por el
 * nombre de una calle, asi que se prueba por donde se usa de verdad — generando
 * el PDF y volviendolo a leer.
 *
 * El PDF se arma entero en memoria: no hay red, ni archivos, ni navegador.
 */

import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type {
  FormularioVersion, Inspeccion, ObjetoInspeccionable, Organismo, Respuesta, TipoInspeccion,
} from '@/dominio/tipos'
import { generarActaPdf, type DatosActa } from './acta'

// ── Ayudantes ─────────────────────────────────────────────────────────

const MOMENTO = '2026-04-20T13:00:00.000Z'

const ORGANISMO: Organismo = {
  id: 'org-1',
  nombre: 'Intendencia Demostración',
  tipo: 'intendencia',
}

const FORMULARIO: FormularioVersion = {
  id: 'fv-1',
  formularioId: 'f-1',
  version: 1,
  titulo: 'Habilitación de comercio',
  vigenteDesde: '2026-01-01T00:00:00.000Z',
  secciones: [{
    id: 's1',
    titulo: 'Identificación',
    preguntas: [{
      id: 'p1',
      texto: '¿Exhibe la habilitación vigente?',
      tipo: 'si_no',
      obligatoria: true,
      respuestaQueIncumple: 'no',
      incumplimientoId: 'sin-habilitacion',
    }],
  }],
  incumplimientos: [{
    id: 'sin-habilitacion',
    descripcion: 'Local sin habilitación vigente',
    normativa: 'Digesto Departamental, art. 40',
    plazoSubsanacionDias: 10,
    gravedad: 'grave',
  }],
}

const TIPO_INSPECCION: TipoInspeccion = {
  id: 'ti-1',
  organismoId: ORGANISMO.id,
  nombre: 'Habilitación de comercio',
  direccionResponsable: 'Dirección de Habilitaciones y Contralor',
  formularioVersionId: FORMULARIO.id,
  plazoSubsanacionDias: 20,
  tipoObjetoIds: ['to-1'],
}

const INSPECCION: Inspeccion = {
  uuid: 'insp-1',
  organismoId: ORGANISMO.id,
  objetoId: 'obj-1',
  tipoInspeccionId: TIPO_INSPECCION.id,
  formularioVersionId: FORMULARIO.id,
  origen: 'plan',
  estado: 'cerrada',
  prioridad: 'media',
  asignadoA: 'ines.rodriguez',
  ejecutadaEn: MOMENTO,
  resultado: 'no_conforme',
  creadaEn: MOMENTO,
  actualizadaEn: MOMENTO,
}

const RESPUESTA: Respuesta = {
  inspeccionUuid: INSPECCION.uuid,
  formularioVersionId: FORMULARIO.id,
  datos: { p1: 'no' },
  incumplimientoIds: [],
}

function objetoLlamado(denominacion: string, direccion = 'Calle Los Ceibos 1234'): ObjetoInspeccionable {
  return {
    id: 'obj-1',
    organismoId: ORGANISMO.id,
    tipoObjetoId: 'to-1',
    codigo: 'COM-0001',
    denominacion,
    ubicacion: { lat: -34.9012, lon: -56.1645 },
    direccion,
    atributos: {},
    estado: 'activo',
    creadoEn: MOMENTO,
  }
}

function datosDeActa(objeto: ObjetoInspeccionable): DatosActa {
  return {
    organismo: ORGANISMO,
    inspeccion: INSPECCION,
    objeto,
    tipoInspeccion: TIPO_INSPECCION,
    formulario: FORMULARIO,
    respuesta: RESPUESTA,
    evidencias: [],
    numero: 'A-2026-000123',
    emitidaEn: MOMENTO,
    plazoSubsanacion: '2026-04-30T13:00:00.000Z',
    diasPlazo: 10,
  }
}

/**
 * Emite el acta y devuelve el asunto del PDF, que es donde viaja la
 * denominacion del objeto ya saneada. Es la unica via para observar el texto
 * que realmente se escribio en el documento.
 */
async function asuntoDelActaCon(denominacion: string): Promise<string> {
  const pdf = await generarActaPdf(datosDeActa(objetoLlamado(denominacion)))
  const documento = await PDFDocument.load(await pdf.arrayBuffer())
  return documento.getSubject() ?? ''
}

// ── Saneado ───────────────────────────────────────────────────────────

describe('saneado del texto del acta', () => {
  it('la ñ llega intacta al documento', async () => {
    expect(await asuntoDelActaCon('Parador El Ñandú')).toContain('Parador El Ñandú')
  })

  it('un acento combinante se compone y no se pierde ni se parte', async () => {
    // "e" + U+0301 son dos codepoints y WinAnsi no conoce el segundo.
    // Normalizado a NFC es una sola é (U+00E9) y entra sin problema.
    const asunto = await asuntoDelActaCon('Almace\u0301n Don Eli\u0301as')
    expect(asunto).toContain('Almacén Don Elías')
  })

  it('el acento combinante y el precompuesto producen exactamente el mismo texto', async () => {
    const combinante = await asuntoDelActaCon('Panaderi\u0301a La Espiga')
    const precompuesto = await asuntoDelActaCon('Panadería La Espiga')
    expect(combinante).toBe(precompuesto)
  })

  it('un emoji se descarta sin impedir que el acta se emita', async () => {
    const asunto = await asuntoDelActaCon('Bar El Ancla 🍺 🚧')
    expect(asunto).toContain('Bar El Ancla')
    expect(asunto).not.toContain('🍺')
  })

  it('el acta se emite igual con emojis en la dirección del objeto', async () => {
    const objeto = objetoLlamado('Kiosco La Esquina', 'Calle Los Médanos 220 🚧 esquina Ñ')
    const pdf = await generarActaPdf(datosDeActa(objeto))
    expect(pdf.type).toBe('application/pdf')
    expect(pdf.size).toBeGreaterThan(0)
  })

  it('el acta se emite aunque el texto no traiga nada raro', async () => {
    const pdf = await generarActaPdf(datosDeActa(objetoLlamado('Almacén Don Elías')))
    expect(pdf.size).toBeGreaterThan(0)
  })

  it('sin saneado el emoji rompería la emisión: por eso el saneado no es opcional', async () => {
    // Control de la prueba anterior. Si esto dejara de fallar, las pruebas de
    // arriba ya no estarian demostrando nada.
    const documento = await PDFDocument.create()
    const fuente = await documento.embedFont(StandardFonts.Helvetica)
    const pagina = documento.addPage()
    expect(() => pagina.drawText('🚧', { font: fuente, size: 10 })).toThrow()
  })
})
