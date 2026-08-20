// SPDX-FileCopyrightText: 2026 GoDoWorks
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reinspeccion automatica por vencimiento del plazo de subsanacion.
 *
 * Cuando un acta constata incumplimientos, fija una fecha limite para
 * subsanarlos. Vencida esa fecha sin constancia de que se haya cumplido, el
 * caso tiene que volver solo a la lista del inspector: no puede depender de que
 * alguien se acuerde ni de una planilla aparte. Eso es lo que hace este
 * archivo, y se ejecuta en cada arranque de la aplicacion.
 *
 * Tres decisiones que sostienen todo lo demas:
 *
 *  1. IDEMPOTENCIA POR DATO, NO POR MARCA. Que una inspeccion ya haya generado
 *     su reinspeccion no se anota en ningun campo nuevo: se pregunta si existe
 *     alguna inspeccion cuyo `padreUuid` sea la original. La relacion padre-hijo
 *     ES el registro. Una marca aparte se desincroniza el dia que alguien borra
 *     la reinspeccion, o que la sincronizacion trae inspecciones del servidor
 *     con el estado real; el vinculo no.
 *
 *  2. EL PLAZO CORRE DESDE `ejecutadaEn`, igual que en `servicios/acta.ts`. Se
 *     usa la fecha que el acta ya guardo (`Acta.plazoSubsanacion`), que es la
 *     que el inspeccionado leyo impresa. Solo si esa fecha faltara se recalcula,
 *     y se recalcula con las mismas funciones que uso el acta —`diasDePlazo`
 *     sobre los incumplimientos constatados— para que el sistema no pueda
 *     contradecirse a si mismo ante un recurso administrativo.
 *
 *  3. SOLO LO NO SUBSANADO, con el criterio explicado en `haySubsanacion`.
 */

import { almacen } from '@/datos/almacen'
import type {
  Acta, FechaHora, Inspeccion, Prioridad, Uuid,
} from '@/dominio/tipos'
import { ahora, formatearFecha, nuevoUuid, sumarDias } from '@/dominio/utilidades'
import { diasDePlazo, incumplimientosConstatados } from '@/servicios/acta'

// ── Resultado de la corrida ───────────────────────────────────────────

/** Por que no se genero reinspeccion en cada caso descartado. */
export interface DescartesReinspeccion {
  /** Ya existia una inspeccion con esa `padreUuid`. Es el caso normal. */
  yaTeniaReinspeccion: number
  /** Cerrada sin acta emitida: sin acta no hay plazo que vencer. */
  sinActa: number
  /** El acta no constato incumplimientos: no hay nada que reinspeccionar. */
  sinIncumplimientos: number
  /** El plazo todavia corre. */
  plazoVigente: number
  /** Hay constancia posterior de que la falta se resolvio. */
  subsanadas: number
  /** El objeto ya no existe o esta dado de baja. */
  objetoNoVigente: number
  /** El registro no se pudo procesar. Se cuenta y se sigue. */
  fallidas: number
}

export interface ResumenReinspeccion {
  /** Inspecciones cerradas examinadas en esta corrida. */
  examinadas: number
  /** Reinspecciones efectivamente creadas. */
  creadas: number
  /** Uuid de cada reinspeccion creada, en el orden en que se crearon. */
  uuids: Uuid[]
  descartes: DescartesReinspeccion
  corridaEn: FechaHora
}

function resumenVacio(): ResumenReinspeccion {
  return {
    examinadas: 0,
    creadas: 0,
    uuids: [],
    descartes: {
      yaTeniaReinspeccion: 0,
      sinActa: 0,
      sinIncumplimientos: 0,
      plazoVigente: 0,
      subsanadas: 0,
      objetoNoVigente: 0,
      fallidas: 0,
    },
    corridaEn: ahora(),
  }
}

// ── Reglas ────────────────────────────────────────────────────────────

/**
 * El plazo vence al FINAL del dia impreso en el acta, no en el instante exacto
 * en que se cumplen los dias.
 *
 * El acta muestra una fecha, no una hora: si la inspeccion se ejecuto un martes
 * a las 09:00 y el plazo es de diez dias, el vecino leyo "vence el jueves 20" y
 * tiene el jueves entero para cumplir. Cortar a las 09:00 de ese jueves seria
 * generarle una reinspeccion mientras todavia esta en plazo segun el papel que
 * tiene en la mano. Es el mismo criterio de fin de dia que usa la lista de
 * tareas para marcar una inspeccion como vencida.
 */
function plazoVencido(limite: FechaHora, referencia: number): boolean {
  const fin = new Date(limite)
  fin.setHours(23, 59, 59, 999)
  return fin.getTime() < referencia
}

/** Escalon siguiente de prioridad. `urgente` ya es el techo. */
const PRIORIDAD_ELEVADA: Record<Prioridad, Prioridad> = {
  baja: 'media',
  media: 'alta',
  alta: 'urgente',
  urgente: 'urgente',
}

/**
 * Fecha con la que se ordena una inspeccion en el tiempo. Una cerrada siempre
 * tiene `ejecutadaEn`; el respaldo es para no comparar contra `undefined`.
 */
function momentoDe(i: Inspeccion): FechaHora {
  return i.ejecutadaEn ?? i.actualizadaEn
}

/**
 * Si hay constancia de que lo constatado se resolvio.
 *
 * QUE INFORMACION HAY. El modelo no tiene ningun campo que diga "subsanado":
 * no hay declaracion del inspeccionado, ni acta de cierre, ni marca de
 * cumplimiento. Lo unico que el sistema puede saber es lo que un inspector
 * constato en campo. Por eso la unica evidencia admisible aca es una inspeccion
 * POSTERIOR, cerrada, sobre el MISMO objeto y del MISMO tipo, con resultado
 * conforme: alguien volvio, miro y anoto que estaba en regla.
 *
 * QUE ERROR SE ELIGE COMETER. La informacion no alcanza para decidir con
 * certeza: que no exista esa inspeccion posterior no prueba que el vecino no
 * haya cumplido, solo prueba que nadie lo verifico. Frente a la duda hay dos
 * errores posibles y se elige deliberadamente el primero:
 *
 *   - GENERAR UNA REINSPECCION DE MAS a quien ya cumplio. Cuesta una visita.
 *     No sanciona a nadie, no acusa a nadie y no produce ningun efecto juridico:
 *     una reinspeccion es exactamente el acto de ir a verificar. Si el vecino
 *     cumplio, la visita cierra conforme y le deja al expediente la constancia
 *     de cumplimiento que hoy no tiene, que lo beneficia a el.
 *
 *   - NO GENERARLA cuando el incumplimiento sigue. Cuesta que un acta emitida
 *     por el organismo venza sin que nadie la controle. El acta ya intimo y ya
 *     fijo un plazo; dejarlo pasar en silencio es inaccion administrativa sobre
 *     una falta que el propio organismo constato y documento.
 *
 * El segundo error es peor y ademas es invisible: nadie se entera de lo que no
 * se verifico. Por eso, sin evidencia positiva de subsanacion, se reinspecciona.
 * Ese es el sentido conservador aca: conservar la verificacion, no la omision.
 */
function haySubsanacion(original: Inspeccion, todas: Inspeccion[]): boolean {
  const desde = momentoDe(original)
  return todas.some(
    (otra) =>
      otra.uuid !== original.uuid &&
      otra.objetoId === original.objetoId &&
      otra.tipoInspeccionId === original.tipoInspeccionId &&
      otra.estado === 'cerrada' &&
      otra.resultado === 'conforme' &&
      // Las fechas son ISO en UTC: comparar como texto ordena igual que como fecha.
      momentoDe(otra) > desde,
  )
}

// ── Fecha limite del acta ─────────────────────────────────────────────

/**
 * Fecha en que vence el plazo de subsanacion de un acta, y cuantos
 * incumplimientos la sostienen.
 *
 * Devuelve `undefined` cuando no corresponde reinspeccion porque el acta no
 * constato incumplimientos.
 */
async function limiteDelActa(
  inspeccion: Inspeccion,
  acta: Acta,
): Promise<{ limite: FechaHora; incumplimientos: number } | undefined> {
  const [formulario, respuesta] = await Promise.all([
    // La version exacta con la que se completo, no la vigente: los
    // incumplimientos hay que leerlos con las preguntas de aquel momento.
    almacen.formularios.formularioVersion(inspeccion.formularioVersionId),
    almacen.inspecciones.respuesta(inspeccion.uuid),
  ])
  if (!formulario) return undefined

  const constatados = incumplimientosConstatados(formulario, respuesta)
  if (!constatados.length) return undefined

  // Lo normal: el acta ya tiene calculada y guardada su fecha limite, que es la
  // que se imprimio. Se respeta esa y no se recalcula nada.
  if (acta.plazoSubsanacion) {
    return { limite: acta.plazoSubsanacion, incumplimientos: constatados.length }
  }

  // Respaldo para un acta vieja sin plazo guardado: se reconstruye con las
  // mismas reglas que uso `ActaEmision` —dias del incumplimiento mas grave,
  // contados desde `ejecutadaEn`— para no inventar un criterio paralelo.
  const tipo = await almacen.formularios.tipoInspeccion(inspeccion.tipoInspeccionId)
  if (!tipo) return undefined
  const dias = diasDePlazo(constatados, tipo.plazoSubsanacionDias)
  const desde = inspeccion.ejecutadaEn ?? acta.emitidaEn
  return { limite: sumarDias(desde, dias), incumplimientos: constatados.length }
}

// ── Creacion de la reinspeccion ───────────────────────────────────────

async function crearReinspeccion(
  original: Inspeccion,
  acta: Acta,
  limite: FechaHora,
  incumplimientos: number,
): Promise<Uuid> {
  const momento = ahora()

  const nueva: Inspeccion = {
    uuid: nuevoUuid(),
    organismoId: original.organismoId,
    objetoId: original.objetoId,
    tipoInspeccionId: original.tipoInspeccionId,
    // La misma version de formulario que la original, NO la vigente. La
    // reinspeccion verifica lo que se constato con aquellas preguntas: si el
    // formulario cambio en el medio, comparar contra otro cuestionario no
    // responderia si el vecino subsano lo que se le intimo.
    formularioVersionId: original.formularioVersionId,
    // De oficio: la inicia el organismo por el vencimiento del plazo, sin plan
    // previo ni reclamo de un vecino.
    origen: 'oficio',
    // Asignada, incluso si no se hereda inspector: es lo que la hace aparecer
    // en la lista de trabajo. Dejarla pendiente la mandaria al grupo "todavia
    // sin asignar", que es justamente donde nadie la mira.
    estado: 'asignada',
    // Una falta que no se subsano en plazo pesa mas que cuando se constato.
    prioridad: PRIORIDAD_ELEVADA[original.prioridad],
    asignadoA: original.asignadoA,
    // Para hoy: el plazo ya vencio, no hay razon para agendarla mas adelante.
    programadaPara: momento,
    padreUuid: original.uuid,
    creadaEn: momento,
    actualizadaEn: momento,
  }

  await almacen.inspecciones.guardar(nueva)

  await almacen.auditoria.registrar({
    organismoId: nueva.organismoId,
    entidad: 'inspeccion',
    entidadId: nueva.uuid,
    accion: 'reinspeccion_generada',
    detalle:
      `Generada de oficio por vencimiento del plazo del acta ${acta.numero}, ` +
      `que vencio el ${formatearFecha(limite)}. ` +
      `Inspeccion original ${original.uuid} con ${incumplimientos} incumplimiento(s) ` +
      'constatado(s) y sin constancia de subsanacion.',
    // No la origina una persona: la origina el vencimiento del plazo. Firmar
    // esto con el nombre de un inspector seria atribuirle un acto que no hizo.
    actor: 'sistema',
  })

  return nueva.uuid
}

// ── Punto de entrada ──────────────────────────────────────────────────

/**
 * Revisa los plazos vencidos y genera las reinspecciones que falten.
 *
 * Segura de correr en cada arranque y tantas veces como haga falta: lo unico
 * que decide si se crea algo es si ya existe la reinspeccion en los datos.
 */
async function revisar(): Promise<ResumenReinspeccion> {
  const resumen = resumenVacio()
  const referencia = Date.now()

  // Una sola lectura: de la misma lista salen las cerradas a examinar, los
  // vinculos padre-hijo que dan la idempotencia y las inspecciones posteriores
  // que prueban la subsanacion. Leer todo junto evita ademas que la lista
  // cambie entre consultas dentro de una misma corrida.
  const todas = await almacen.inspecciones.listar()

  const conReinspeccion = new Set<Uuid>()
  for (const i of todas) {
    if (i.padreUuid) conReinspeccion.add(i.padreUuid)
  }

  const cerradas = todas.filter((i) => i.estado === 'cerrada')
  resumen.examinadas = cerradas.length

  // En serie a proposito: son pocas y cada una escribe en IndexedDB. Una
  // avalancha de transacciones al arranque le robaria tiempo al primer dibujo
  // de la pantalla, que es lo unico que el inspector esta esperando.
  for (const original of cerradas) {
    try {
      if (conReinspeccion.has(original.uuid)) {
        resumen.descartes.yaTeniaReinspeccion += 1
        continue
      }

      // Sin acta no hay plazo: el plazo nace del acta emitida, no del cierre.
      const acta = await almacen.inspecciones.acta(original.uuid)
      if (!acta) {
        resumen.descartes.sinActa += 1
        continue
      }

      const plazo = await limiteDelActa(original, acta)
      if (!plazo) {
        resumen.descartes.sinIncumplimientos += 1
        continue
      }

      if (!plazoVencido(plazo.limite, referencia)) {
        resumen.descartes.plazoVigente += 1
        continue
      }

      if (haySubsanacion(original, todas)) {
        resumen.descartes.subsanadas += 1
        continue
      }

      // Volver a inspeccionar un objeto dado de baja —una obra terminada, un
      // comercio cerrado— manda al inspector a una direccion donde ya no hay
      // nada que constatar.
      const objeto = await almacen.territorio.objeto(original.objetoId)
      if (!objeto || objeto.estado === 'baja') {
        resumen.descartes.objetoNoVigente += 1
        continue
      }

      const uuid = await crearReinspeccion(original, acta, plazo.limite, plazo.incumplimientos)
      // La corrida no vuelve a mirar la base: se anota aca para que la
      // idempotencia valga tambien dentro de esta misma pasada.
      conReinspeccion.add(original.uuid)
      resumen.uuids.push(uuid)
      resumen.creadas += 1
    } catch (error) {
      // Un registro roto no puede dejar sin revisar a los demas: el arranque
      // tiene que terminar igual y el resto de los plazos tiene que agendarse.
      resumen.descartes.fallidas += 1
      console.warn('No se pudo revisar el vencimiento de la inspección', original.uuid, error)
    }
  }

  return resumen
}

/**
 * Corrida en curso, si la hay.
 *
 * Dos llamadas simultaneas —el arranque y una pantalla que refresca— no pueden
 * examinar la misma inspeccion a la vez y crearle dos reinspecciones: la
 * segunda leeria la lista antes de que la primera escriba. Compartir la
 * promesa las convierte en una sola corrida.
 */
let enCurso: Promise<ResumenReinspeccion> | undefined

export function revisarVencimientos(): Promise<ResumenReinspeccion> {
  if (!enCurso) {
    enCurso = revisar().finally(() => {
      enCurso = undefined
    })
  }
  return enCurso
}
