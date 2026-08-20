// SPDX-FileCopyrightText: 2026 GoDoWorks
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pruebas de la semilla de demostracion.
 *
 * La semilla es lo primero que ve alguien que abre Tero, y ademas es el juego de
 * datos contra el que se prueba a mano casi todo. Dos cosas tienen que valer:
 *
 *  1. Coherencia referencial: ninguna inspeccion puede apuntar a un objeto, a un
 *     tipo o a una version de formulario que no existe. Una referencia rota no
 *     rompe la semilla — rompe la vista que la lee, y encima en la demostracion.
 *  2. Determinismo: construirla dos veces tiene que dar lo mismo. Si la
 *     demostracion cambia sola, ninguna captura de pantalla ni prueba manual
 *     significa nada.
 */

import { describe, expect, it } from 'vitest'
import type { DatosSemilla } from './semilla'
import { construirSemilla } from './semilla'

// ── Ayudantes ─────────────────────────────────────────────────────────

const semilla = construirSemilla()

function idsDe(items: readonly { id: string }[]): Set<string> {
  return new Set(items.map((i) => i.id))
}

/** Los ids de todas las preguntas del formulario, seccion por seccion. */
function preguntasDe(formulario: DatosSemilla['formularioVersiones'][number]) {
  return formulario.secciones.flatMap((s) => s.preguntas)
}

/**
 * Los datos sin ningun identificador generado en el dispositivo.
 *
 * Sirve para comparar dos construcciones: los uuid cambian por definicion, pero
 * todo lo demas — coordenadas, codigos, direcciones, atributos — tiene que ser
 * identico.
 */
const CLAVES_DE_IDENTIDAD = new Set([
  'id', 'uuid', 'formularioId', 'organismoId', 'objetoId', 'tipoObjetoId',
  'tipoInspeccionId', 'formularioVersionId', 'zonaId', 'inspeccionUuid',
  'entidadId', 'tipoObjetoIds', 'padreUuid',
])

function sinIdentificadores(datos: DatosSemilla): string {
  return JSON.stringify(datos, (clave, valor) =>
    CLAVES_DE_IDENTIDAD.has(clave) ? undefined : valor)
}

// ── Coherencia referencial ────────────────────────────────────────────

describe('coherencia de la semilla', () => {
  it('todo cuelga del mismo organismo', () => {
    const ajenos = [
      ...semilla.zonas, ...semilla.tiposObjeto, ...semilla.objetos,
      ...semilla.tiposInspeccion, ...semilla.auditoria,
    ].filter((e) => e.organismoId !== semilla.organismo.id)
    expect(ajenos).toEqual([])
  })

  it('toda inspección apunta a un objeto que existe', () => {
    const objetos = idsDe(semilla.objetos)
    const huerfanas = semilla.inspecciones.filter((i) => !objetos.has(i.objetoId))
    expect(huerfanas).toEqual([])
  })

  it('toda inspección apunta a un tipo de inspección que existe', () => {
    const tipos = idsDe(semilla.tiposInspeccion)
    const huerfanas = semilla.inspecciones.filter((i) => !tipos.has(i.tipoInspeccionId))
    expect(huerfanas).toEqual([])
  })

  it('toda inspección apunta a una versión de formulario que existe', () => {
    // Es la regla de inmutabilidad del modelo: el acta se reconstruye contra la
    // version con la que se completo, asi que esa version tiene que estar.
    const versiones = idsDe(semilla.formularioVersiones)
    const huerfanas = semilla.inspecciones.filter((i) => !versiones.has(i.formularioVersionId))
    expect(huerfanas).toEqual([])
  })

  it('la versión de formulario de la inspección es la del tipo de inspección', () => {
    const porTipo = new Map(semilla.tiposInspeccion.map((t) => [t.id, t.formularioVersionId]))
    const desalineadas = semilla.inspecciones.filter(
      (i) => porTipo.get(i.tipoInspeccionId) !== i.formularioVersionId,
    )
    expect(desalineadas).toEqual([])
  })

  it('todo tipo de inspección apunta a una versión de formulario que existe', () => {
    const versiones = idsDe(semilla.formularioVersiones)
    const huerfanos = semilla.tiposInspeccion.filter((t) => !versiones.has(t.formularioVersionId))
    expect(huerfanos).toEqual([])
  })

  it('todo tipo de inspección alcanza tipos de objeto que existen', () => {
    const tiposObjeto = idsDe(semilla.tiposObjeto)
    const rotos = semilla.tiposInspeccion.filter(
      (t) => t.tipoObjetoIds.some((id) => !tiposObjeto.has(id)),
    )
    expect(rotos).toEqual([])
  })

  it('el objeto inspeccionado es de un tipo que el tipo de inspección alcanza', () => {
    const objetos = new Map(semilla.objetos.map((o) => [o.id, o]))
    const tipos = new Map(semilla.tiposInspeccion.map((t) => [t.id, t]))
    const impropias = semilla.inspecciones.filter((i) => {
      const objeto = objetos.get(i.objetoId)!
      const tipo = tipos.get(i.tipoInspeccionId)!
      return !tipo.tipoObjetoIds.includes(objeto.tipoObjetoId)
    })
    expect(impropias).toEqual([])
  })

  it('todo objeto apunta a un tipo de objeto y a una zona que existen', () => {
    const tipos = idsDe(semilla.tiposObjeto)
    const zonas = idsDe(semilla.zonas)
    const rotos = semilla.objetos.filter(
      (o) => !tipos.has(o.tipoObjetoId) || (o.zonaId !== undefined && !zonas.has(o.zonaId)),
    )
    expect(rotos).toEqual([])
  })

  it('toda respuesta pertenece a una inspección existente', () => {
    const inspecciones = new Set(semilla.inspecciones.map((i) => i.uuid))
    const huerfanas = semilla.respuestas.filter((r) => !inspecciones.has(r.inspeccionUuid))
    expect(huerfanas).toEqual([])
  })

  it('la respuesta se guarda contra la misma versión de formulario que la inspección', () => {
    const porUuid = new Map(semilla.inspecciones.map((i) => [i.uuid, i.formularioVersionId]))
    const desalineadas = semilla.respuestas.filter(
      (r) => porUuid.get(r.inspeccionUuid) !== r.formularioVersionId,
    )
    expect(desalineadas).toEqual([])
  })

  it('todo evento de auditoría refiere a una inspección existente', () => {
    const inspecciones = new Set(semilla.inspecciones.map((i) => i.uuid))
    const huerfanos = semilla.auditoria.filter(
      (e) => e.entidad === 'inspeccion' && !inspecciones.has(e.entidadId),
    )
    expect(huerfanos).toEqual([])
  })
})

// ── Formularios ───────────────────────────────────────────────────────

describe('formularios de la semilla', () => {
  it('todo incumplimiento referido por una pregunta existe en su formulario', () => {
    const rotos = semilla.formularioVersiones.flatMap((formulario) => {
      const catalogo = idsDe(formulario.incumplimientos)
      return preguntasDe(formulario)
        .filter((p) => p.incumplimientoId !== undefined && !catalogo.has(p.incumplimientoId))
        .map((p) => `${formulario.titulo} · ${p.id} → ${p.incumplimientoId}`)
    })
    expect(rotos).toEqual([])
  })

  it('una pregunta que constata una falta dice cuál es la respuesta que la constata', () => {
    // Sin `respuestaQueIncumple` el incumplimiento jamas se deduciria, y la
    // falta quedaria fuera del acta sin que nadie se entere.
    const mudas = semilla.formularioVersiones.flatMap((formulario) =>
      preguntasDe(formulario)
        .filter((p) => p.incumplimientoId !== undefined && !p.respuestaQueIncumple)
        .map((p) => `${formulario.titulo} · ${p.id}`))
    expect(mudas).toEqual([])
  })

  it('todo incumplimiento declarado en una respuesta existe en su formulario', () => {
    const porVersion = new Map(
      semilla.formularioVersiones.map((f) => [f.id, idsDe(f.incumplimientos)]),
    )
    const rotos = semilla.respuestas.flatMap((r) =>
      r.incumplimientoIds.filter((id) => !porVersion.get(r.formularioVersionId)?.has(id)))
    expect(rotos).toEqual([])
  })

  it('los ids de pregunta no se repiten dentro de un formulario', () => {
    for (const formulario of semilla.formularioVersiones) {
      const ids = preguntasDe(formulario).map((p) => p.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('los ids de incumplimiento no se repiten dentro de un formulario', () => {
    for (const formulario of semilla.formularioVersiones) {
      const ids = formulario.incumplimientos.map((i) => i.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('todo incumplimiento trae plazo y encuadre normativo, que es lo que se cita en el acta', () => {
    const incompletos = semilla.formularioVersiones.flatMap((f) =>
      f.incumplimientos.filter((i) => !i.normativa.trim() || !(i.plazoSubsanacionDias > 0)))
    expect(incompletos).toEqual([])
  })
})

// ── Identificadores ───────────────────────────────────────────────────

describe('identificadores de la semilla', () => {
  it('el uuid de cada inspección es único: de eso depende la idempotencia', () => {
    const uuids = semilla.inspecciones.map((i) => i.uuid)
    expect(new Set(uuids).size).toBe(uuids.length)
  })

  it('el código de cada objeto es único dentro del organismo', () => {
    const codigos = semilla.objetos.map((o) => o.codigo)
    expect(new Set(codigos).size).toBe(codigos.length)
  })

  it('hay una sola respuesta por inspección', () => {
    const uuids = semilla.respuestas.map((r) => r.inspeccionUuid)
    expect(new Set(uuids).size).toBe(uuids.length)
  })
})

// ── Determinismo ──────────────────────────────────────────────────────

describe('determinismo de la semilla', () => {
  it('la demostración se ve igual cada vez que alguien la abre', () => {
    expect(sinIdentificadores(construirSemilla()))
      .toBe(sinIdentificadores(construirSemilla()))
  })

  it('los objetos caen siempre en el mismo lugar del mapa', () => {
    const ubicaciones = (datos: DatosSemilla) =>
      datos.objetos.map((o) => `${o.codigo} ${o.ubicacion.lat},${o.ubicacion.lon}`)
    expect(ubicaciones(construirSemilla())).toEqual(ubicaciones(construirSemilla()))
  })

  it('la bandeja del inspector trae siempre la misma cantidad de tareas', () => {
    const deHoy = (datos: DatosSemilla) =>
      datos.inspecciones.filter((i) => i.estado === 'asignada').length
    expect(deHoy(construirSemilla())).toBe(deHoy(semilla))
    expect(deHoy(semilla)).toBeGreaterThan(0)
  })

  /**
   * Los identificadores tienen que ser estables entre construcciones.
   *
   * Si los ids se generaran al azar, el «Identificador interno» que imprime el
   * acta cambiaria cada vez que alguien abre la demostracion, y nada podria
   * guardar una referencia a un objeto sembrado entre sesiones. Por eso
   * `semilla.ts` los deriva de un contador y no de `crypto.randomUUID()`.
   */
  it('los identificadores de la demostración se repiten entre construcciones', () => {
    expect(JSON.stringify(construirSemilla())).toBe(JSON.stringify(construirSemilla()))
  })
})
