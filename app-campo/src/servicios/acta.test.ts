// SPDX-FileCopyrightText: 2026 GoDoWorks
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pruebas de las reglas que deciden que dice el acta.
 *
 * Todo lo que se prueba aca son funciones puras, asi que no hay ningun doble ni
 * ningun espia: se arman los datos con ayudantes y se compara el resultado.
 *
 * El plazo es lo mas delicado del archivo. Un plazo mal calculado no es un error
 * de pantalla: es una fecha limite equivocada en un documento que se le entrega
 * a una persona y contra el que puede recurrir.
 */

import { describe, expect, it } from 'vitest'
import type {
  FormularioVersion, Incumplimiento, Pregunta, Respuesta, Seccion,
} from '@/dominio/tipos'
import {
  diasDePlazo, etiquetaGravedad, incumplimientosConstatados, nombreArchivoActa, textoRespuesta,
} from './acta'

// ── Ayudantes ─────────────────────────────────────────────────────────

function falta(
  id: string,
  gravedad: Incumplimiento['gravedad'],
  plazoSubsanacionDias: number,
): Incumplimiento {
  return {
    id,
    descripcion: `Descripción de ${id}`,
    normativa: 'Digesto Departamental, art. 1',
    plazoSubsanacionDias,
    gravedad,
  }
}

function preguntaSiNo(
  id: string,
  opciones: { respuestaQueIncumple?: string; incumplimientoId?: string } = {},
): Pregunta {
  return {
    id,
    texto: `¿Pregunta ${id}?`,
    tipo: 'si_no',
    obligatoria: true,
    ...opciones,
  }
}

function seccion(id: string, preguntas: Pregunta[]): Seccion {
  return { id, titulo: `Sección ${id}`, preguntas }
}

function formulario(
  secciones: Seccion[],
  incumplimientos: Incumplimiento[],
): FormularioVersion {
  return {
    id: 'fv-1',
    formularioId: 'f-1',
    version: 1,
    titulo: 'Formulario de prueba',
    vigenteDesde: '2026-01-01T00:00:00.000Z',
    secciones,
    incumplimientos,
  }
}

function respuesta(
  datos: Respuesta['datos'],
  incumplimientoIds: string[] = [],
): Respuesta {
  return {
    inspeccionUuid: 'i-1',
    formularioVersionId: 'fv-1',
    datos,
    incumplimientoIds,
  }
}

// ── Plazo del acta ────────────────────────────────────────────────────

describe('diasDePlazo', () => {
  it('sin incumplimientos rige el plazo que fija el tipo de inspección', () => {
    expect(diasDePlazo([], 15)).toBe(15)
  })

  it('con un solo incumplimiento rige su plazo y no el del tipo de inspección', () => {
    expect(diasDePlazo([falta('a', 'leve', 30)], 15)).toBe(30)
  })

  it('el plazo lo fija el incumplimiento más grave', () => {
    const constatados = [falta('leve', 'leve', 30), falta('muygrave', 'muy_grave', 3)]
    expect(diasDePlazo(constatados, 15)).toBe(3)
  })

  it('el más grave manda aunque su plazo sea el más largo de todos', () => {
    // Si ganara el plazo mas corto sin mirar gravedad, esto daria 5.
    const constatados = [falta('leve', 'leve', 5), falta('muygrave', 'muy_grave', 20)]
    expect(diasDePlazo(constatados, 15)).toBe(20)
  })

  it('a igual gravedad rige el plazo más corto, que es el que primero vence', () => {
    const constatados = [falta('a', 'grave', 20), falta('b', 'grave', 7), falta('c', 'grave', 12)]
    expect(diasDePlazo(constatados, 15)).toBe(7)
  })

  it('grave le gana a leve', () => {
    expect(diasDePlazo([falta('a', 'leve', 5), falta('b', 'grave', 10)], 15)).toBe(10)
  })

  it('muy grave le gana a grave', () => {
    expect(diasDePlazo([falta('a', 'grave', 5), falta('b', 'muy_grave', 10)], 15)).toBe(10)
  })

  it('con varias gravedades solo compiten las del escalón más alto', () => {
    const constatados = [
      falta('leve', 'leve', 1),
      falta('grave1', 'grave', 2),
      falta('muygrave1', 'muy_grave', 25),
      falta('muygrave2', 'muy_grave', 10),
      falta('grave2', 'grave', 3),
    ]
    expect(diasDePlazo(constatados, 15)).toBe(10)
  })

  it('el orden en que llegan los incumplimientos no cambia el plazo', () => {
    const constatados = [
      falta('a', 'leve', 2),
      falta('b', 'muy_grave', 30),
      falta('c', 'grave', 4),
    ]
    const alDerecho = diasDePlazo(constatados, 15)
    const alReves = diasDePlazo([...constatados].reverse(), 15)
    expect(alReves).toBe(alDerecho)
  })

  it('si todos empatan en gravedad y plazo, ese es el plazo', () => {
    const constatados = [falta('a', 'grave', 8), falta('b', 'grave', 8)]
    expect(diasDePlazo(constatados, 15)).toBe(8)
  })

  it('un incumplimiento con plazo cero no se confunde con la ausencia de plazo', () => {
    // Cero es un valor legitimo: subsanacion inmediata. No puede caer al defecto.
    expect(diasDePlazo([falta('a', 'muy_grave', 0)], 15)).toBe(0)
  })
})

// ── Incumplimientos constatados ───────────────────────────────────────

describe('incumplimientosConstatados', () => {
  const catalogo = [
    falta('sin-luz', 'grave', 10),
    falta('tapa-abierta', 'muy_grave', 3),
    falta('follaje', 'leve', 30),
  ]

  const formularioAlumbrado = formulario(
    [
      seccion('s1', [
        preguntaSiNo('p1', { respuestaQueIncumple: 'si', incumplimientoId: 'sin-luz' }),
        preguntaSiNo('p2', { respuestaQueIncumple: 'no', incumplimientoId: 'tapa-abierta' }),
      ]),
      seccion('s2', [
        preguntaSiNo('p3', { respuestaQueIncumple: 'si', incumplimientoId: 'follaje' }),
        // Pregunta informativa: no puede constatar nada por si sola.
        preguntaSiNo('p4'),
      ]),
    ],
    catalogo,
  )

  it('una inspección sin respuestas no constata ningún incumplimiento', () => {
    expect(incumplimientosConstatados(formularioAlumbrado, undefined)).toEqual([])
  })

  it('un checklist todo conforme no constata ningún incumplimiento', () => {
    const constatados = incumplimientosConstatados(
      formularioAlumbrado,
      respuesta({ p1: 'no', p2: 'si', p3: 'no', p4: 'si' }),
    )
    expect(constatados).toEqual([])
  })

  it('la respuesta que constata la falta la agrega al acta', () => {
    const constatados = incumplimientosConstatados(
      formularioAlumbrado,
      respuesta({ p1: 'si', p2: 'si', p3: 'no' }),
    )
    expect(constatados.map((i) => i.id)).toEqual(['sin-luz'])
  })

  it('una pregunta sin falta asociada nunca agrega nada', () => {
    const constatados = incumplimientosConstatados(
      formularioAlumbrado,
      respuesta({ p4: 'si' }),
    )
    expect(constatados).toEqual([])
  })

  it('los incumplimientos declarados a mano se suman a los deducidos', () => {
    const constatados = incumplimientosConstatados(
      formularioAlumbrado,
      respuesta({ p3: 'si' }, ['sin-luz']),
    )
    expect(constatados.map((i) => i.id)).toEqual(['sin-luz', 'follaje'])
  })

  it('un incumplimiento declarado y además deducido aparece una sola vez', () => {
    const constatados = incumplimientosConstatados(
      formularioAlumbrado,
      respuesta({ p1: 'si' }, ['sin-luz']),
    )
    expect(constatados.map((i) => i.id)).toEqual(['sin-luz'])
  })

  it('se devuelven en el orden del formulario, no en el orden en que se declararon', () => {
    const constatados = incumplimientosConstatados(
      formularioAlumbrado,
      respuesta({}, ['follaje', 'sin-luz']),
    )
    expect(constatados.map((i) => i.id)).toEqual(['sin-luz', 'follaje'])
  })

  it('un id declarado que no está en el catálogo de la versión se descarta', () => {
    // Protege la regla de inmutabilidad: si el acta se reconstruye contra la
    // version con la que se completo, un id de otra version no puede colarse.
    const constatados = incumplimientosConstatados(
      formularioAlumbrado,
      respuesta({}, ['falta-de-otra-version']),
    )
    expect(constatados).toEqual([])
  })

  it('«Sí» con tilde y mayúscula constata igual que «si»', () => {
    const constatados = incumplimientosConstatados(
      formularioAlumbrado,
      respuesta({ p1: 'Sí' }),
    )
    expect(constatados.map((i) => i.id)).toEqual(['sin-luz'])
  })

  it('«NO» en mayúsculas constata igual que «no»', () => {
    const constatados = incumplimientosConstatados(
      formularioAlumbrado,
      respuesta({ p2: 'NO' }),
    )
    expect(constatados.map((i) => i.id)).toEqual(['tapa-abierta'])
  })

  it('los espacios sobrantes alrededor de la respuesta no impiden constatar', () => {
    const constatados = incumplimientosConstatados(
      formularioAlumbrado,
      respuesta({ p1: '  sí  ' }),
    )
    expect(constatados.map((i) => i.id)).toEqual(['sin-luz'])
  })

  it('una respuesta booleana se lee como «si» o «no»', () => {
    const constatados = incumplimientosConstatados(
      formularioAlumbrado,
      respuesta({ p1: true, p2: false }),
    )
    expect(constatados.map((i) => i.id)).toEqual(['sin-luz', 'tapa-abierta'])
  })

  it('una pregunta sin responder no constata la falta', () => {
    const constatados = incumplimientosConstatados(
      formularioAlumbrado,
      respuesta({ p1: null, p2: null }),
    )
    expect(constatados).toEqual([])
  })

  it('una respuesta de opciones constata comparando sin acentos ni mayúsculas', () => {
    const conOpciones = formulario(
      [seccion('s1', [{
        id: 'p1',
        texto: 'Estado de encendido',
        tipo: 'opciones',
        obligatoria: true,
        opciones: ['enciende', 'no enciende'],
        respuestaQueIncumple: 'no enciende',
        incumplimientoId: 'sin-luz',
      }])],
      catalogo,
    )
    const constatados = incumplimientosConstatados(conOpciones, respuesta({ p1: 'No Enciende' }))
    expect(constatados.map((i) => i.id)).toEqual(['sin-luz'])
  })

  it('devuelve el incumplimiento entero, con su plazo y su gravedad', () => {
    const [constatado] = incumplimientosConstatados(formularioAlumbrado, respuesta({ p2: 'no' }))
    expect(constatado).toEqual(falta('tapa-abierta', 'muy_grave', 3))
  })
})

// ── Como se lee una respuesta en el acta ──────────────────────────────

describe('textoRespuesta', () => {
  it('una pregunta sin responder se imprime como tal y no en blanco', () => {
    expect(textoRespuesta(null)).toBe('Sin responder')
    expect(textoRespuesta(undefined)).toBe('Sin responder')
  })

  it('una respuesta vacía o de puros espacios cuenta como sin responder', () => {
    expect(textoRespuesta('   ')).toBe('Sin responder')
  })

  it('el sí y el no se imprimen siempre igual, venga como venga escrito', () => {
    for (const valor of ['si', 'SI', 'Sí', ' sí ', 'sÍ']) {
      expect(textoRespuesta(valor)).toBe('Sí')
    }
    for (const valor of ['no', 'NO', ' No ']) {
      expect(textoRespuesta(valor)).toBe('No')
    }
  })

  it('un valor booleano se lee como sí o no', () => {
    expect(textoRespuesta(true)).toBe('Sí')
    expect(textoRespuesta(false)).toBe('No')
  })

  it('todas las formas de «no aplica» se imprimen igual', () => {
    for (const valor of ['na', 'N/A', 'no aplica', 'no_aplica', 'NO APLICA']) {
      expect(textoRespuesta(valor)).toBe('No aplica')
    }
  })

  it('el cero se imprime, no se confunde con una respuesta ausente', () => {
    expect(textoRespuesta(0)).toBe('0')
  })

  it('un número se imprime tal cual', () => {
    expect(textoRespuesta(150)).toBe('150')
  })

  it('el texto libre se imprime como lo escribió el inspector, sin espacios de más', () => {
    expect(textoRespuesta('  Esquina con calle interior  ')).toBe('Esquina con calle interior')
  })
})

// ── Etiquetas ─────────────────────────────────────────────────────────

describe('etiquetaGravedad', () => {
  it('la gravedad se imprime en castellano legible y no con la clave interna', () => {
    expect(etiquetaGravedad('leve')).toBe('Leve')
    expect(etiquetaGravedad('grave')).toBe('Grave')
    expect(etiquetaGravedad('muy_grave')).toBe('Muy grave')
  })
})

// ── Nombre del archivo ────────────────────────────────────────────────

describe('nombreArchivoActa', () => {
  it('el archivo lleva el número de acta para que se identifique al descargarlo', () => {
    expect(nombreArchivoActa('A-2026-000123')).toBe('acta-A-2026-000123.pdf')
  })

  it('los separadores del correlativo se reemplazan por guiones', () => {
    expect(nombreArchivoActa('2026/000123')).toBe('acta-2026-000123.pdf')
  })

  it('nunca quedan guiones al principio ni al final del nombre', () => {
    expect(nombreArchivoActa('· 2026-1 ·')).toBe('acta-2026-1.pdf')
  })

  it('un número sin caracteres utilizables cae en «sin número» y no en un nombre vacío', () => {
    expect(nombreArchivoActa('   ')).toBe('acta-s-n.pdf')
  })

  it('un emoji en el número no deja el archivo sin nombre ni rompe la descarga', () => {
    expect(nombreArchivoActa('2026-7 🚧')).toBe('acta-2026-7.pdf')
  })
})
