// SPDX-FileCopyrightText: 2026 GoDoWorks
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Esquema de la base local (IndexedDB) y su apertura.
 *
 * Un almacen por entidad del dominio, con la misma clave primaria que usa el
 * modelo: asi el dia que exista el backend, lo que viaja por la red es
 * literalmente lo que hay guardado aca, sin traducciones.
 *
 * Los indices son solo los que la aplicacion consulta de verdad. Cada indice
 * cuesta escritura, y en campo escribimos mucho mas de lo que leemos.
 */

import {
  openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames,
} from 'idb'
import type { Reclamo } from './contratos'
import type {
  Acta, BorradorFormulario, Evidencia, EventoAuditoria, Firma, FormularioVersion,
  Inspeccion, ItemCola, ObjetoInspeccionable, Organismo, Respuesta, TipoInspeccion,
  TipoObjeto, Zona,
} from '@/dominio/tipos'

/**
 * Contador persistente de correlativos.
 *
 * Vive en su propio almacen y no en el de actas porque el numero se RESERVA
 * antes de que el acta exista: si lo dedujeramos del maximo ya emitido, dos
 * actas creadas en paralelo se llevarian el mismo numero.
 */
export interface Correlativo {
  /** `acta:<organismoId>:<anio>` */
  clave: string
  ultimo: number
}

export interface EsquemaTero extends DBSchema {
  organismos: { key: string; value: Organismo }
  zonas: { key: string; value: Zona }
  tiposObjeto: { key: string; value: TipoObjeto }
  objetos: {
    key: string
    value: ObjetoInspeccionable
    indexes: { porTipo: string }
  }
  /**
   * Historial completo de cada formulario: una fila por version publicada.
   * Nunca se actualiza ni se borra una fila de aca. El indice existe porque el
   * historial se pide siempre por formulario, y porque publicar necesita saber
   * cual es el numero de version mas alto sin recorrer toda la tabla.
   */
  formularioVersiones: {
    key: string
    value: FormularioVersion
    indexes: { porFormulario: string }
  }
  tiposInspeccion: { key: string; value: TipoInspeccion }
  /**
   * Formularios en edicion. Viven en su propio almacen, separados de las
   * versiones publicadas: mientras alguien arma un checklist, lo que hay a
   * medio hacer no puede estar ni por un instante donde una inspeccion en curso
   * lo pueda leer.
   */
  borradores: {
    key: string
    value: BorradorFormulario
    indexes: { porFormulario: string }
  }
  inspecciones: {
    key: string
    value: Inspeccion
    indexes: { porEstado: string; porObjeto: string }
  }
  /** Una respuesta por inspeccion: la clave es el uuid de la inspeccion. */
  respuestas: { key: string; value: Respuesta }
  evidencias: {
    key: string
    value: Evidencia
    indexes: { porInspeccion: string }
  }
  /** Una firma por inspeccion. */
  firmas: { key: string; value: Firma }
  actas: {
    key: string
    value: Acta
    indexes: { porInspeccion: string }
  }
  auditoria: {
    key: string
    value: EventoAuditoria
    indexes: { porEntidad: string }
  }
  cola: { key: number; value: ItemCola }
  correlativos: { key: string; value: Correlativo }
  /**
   * Reclamos del vecino. Se buscan casi siempre por el codigo corto que la
   * persona tiene anotado, no por su id.
   */
  reclamos: {
    key: string
    value: Reclamo
    indexes: { porCodigo: string; porEstado: string; porInspeccion: string }
  }
}

export type BdTero = IDBPDatabase<EsquemaTero>

/**
 * La transaccion de la migracion. Hace falta nombrarla porque un escalon que
 * agrega un indice sobre un almacen que ya existia solo puede hacerlo a traves
 * de ella, no del objeto base de datos.
 */
type TxMigracion = IDBPTransaction<EsquemaTero, StoreNames<EsquemaTero>[], 'versionchange'>

export const NOMBRE_BD = 'tero'

/**
 * Version del esquema.
 *
 *   1 — esquema inicial.
 *   2 — almacen `reclamos`.
 *   3 — almacen `borradores` e indice `porFormulario` en `formularioVersiones`.
 *
 * Subir esto NO reinicia nada. Cada escalon se aplica solo si el dispositivo
 * viene de mas atras, de modo que un telefono con inspecciones a medio hacer
 * las conserva. Ver `abrirBd`.
 */
export const VERSION_BD = 3

/** Todos los almacenes, en el orden en que se crean. Lo usa `reiniciar()`. */
export const ALMACENES = [
  'organismos', 'zonas', 'tiposObjeto', 'objetos', 'formularioVersiones',
  'tiposInspeccion', 'inspecciones', 'respuestas', 'evidencias', 'firmas',
  'actas', 'auditoria', 'cola', 'correlativos', 'reclamos', 'borradores',
] as const

let conexion: Promise<BdTero> | undefined

/**
 * Abre la base una sola vez por pestaña. La promesa se memoriza para que dos
 * vistas montandose al mismo tiempo no abran dos conexiones y se bloqueen
 * entre si durante una migracion.
 */
export function abrirBd(): Promise<BdTero> {
  if (!conexion) {
    conexion = openDB<EsquemaTero>(NOMBRE_BD, VERSION_BD, {
      /**
       * Migracion incremental y acumulativa: cada escalon se aplica en orden
       * y solo si el dispositivo no lo tiene. Una base recien creada entra con
       * `versionAnterior === 0` y recorre todos los escalones; una que venia de
       * la version 1 recorre solo el segundo y conserva lo que ya tenia dentro.
       *
       * Nunca se borra y se vuelve a sembrar aca. La demostracion puede estar
       * abierta en el telefono de alguien con trabajo de campo sin sincronizar,
       * y ese trabajo no tiene copia en ningun otro lado.
       */
      upgrade(bd, versionAnterior, _versionNueva, tx) {
        if (versionAnterior < 1) crearEsquemaV1(bd)
        if (versionAnterior < 2) crearEsquemaV2(bd)
        if (versionAnterior < 3) crearEsquemaV3(bd, tx)
      },
      blocked() {
        // Otra pestaña con la version vieja impide migrar. No hay nada que
        // hacer mas que avisar: cerrarla es decision de la persona.
        console.warn('[tero] hay otra pestaña abierta con una version anterior de la base')
      },
      blocking() {
        // Esta pestaña esta frenando una migracion de otra: soltamos.
        void conexion?.then((bd) => bd.close())
        conexion = undefined
      },
    })
  }
  return conexion
}

function crearEsquemaV1(bd: BdTero): void {
  bd.createObjectStore('organismos', { keyPath: 'id' })
  bd.createObjectStore('zonas', { keyPath: 'id' })
  bd.createObjectStore('tiposObjeto', { keyPath: 'id' })

  // El mapa y el buscador filtran por tipo constantemente.
  const objetos = bd.createObjectStore('objetos', { keyPath: 'id' })
  objetos.createIndex('porTipo', 'tipoObjetoId')

  bd.createObjectStore('formularioVersiones', { keyPath: 'id' })
  bd.createObjectStore('tiposInspeccion', { keyPath: 'id' })

  // `estado` es el filtro de la bandeja del inspector; `objetoId`, el del
  // historial de un objeto y el de las reinspecciones.
  const inspecciones = bd.createObjectStore('inspecciones', { keyPath: 'uuid' })
  inspecciones.createIndex('porEstado', 'estado')
  inspecciones.createIndex('porObjeto', 'objetoId')

  bd.createObjectStore('respuestas', { keyPath: 'inspeccionUuid' })

  // Las fotos se piden siempre por inspeccion, nunca de a una suelta.
  const evidencias = bd.createObjectStore('evidencias', { keyPath: 'id' })
  evidencias.createIndex('porInspeccion', 'inspeccionUuid')

  bd.createObjectStore('firmas', { keyPath: 'inspeccionUuid' })

  // El acta se guarda con id propio (es un documento con vida propia) pero se
  // busca por la inspeccion que la origino.
  const actas = bd.createObjectStore('actas', { keyPath: 'id' })
  actas.createIndex('porInspeccion', 'inspeccionUuid')

  const auditoria = bd.createObjectStore('auditoria', { keyPath: 'id' })
  auditoria.createIndex('porEntidad', 'entidadId')

  // La cola se procesa en orden de llegada: el autoincremental ES ese orden.
  bd.createObjectStore('cola', { keyPath: 'id', autoIncrement: true })

  bd.createObjectStore('correlativos', { keyPath: 'clave' })
}

/**
 * Version 2: los reclamos del vecino.
 *
 * Solo agrega un almacen nuevo. No toca ni lee ninguno de los anteriores, que
 * es lo que hace que la migracion sea segura sobre un dispositivo con datos.
 */
function crearEsquemaV2(bd: BdTero): void {
  const reclamos = bd.createObjectStore('reclamos', { keyPath: 'id' })

  // `unique` no es decorativo: es la base de datos, y no la aplicacion, quien
  // garantiza que dos vecinos no se lleven anotado el mismo codigo. Si el
  // generador tuviera una colision, la escritura falla y se reintenta.
  reclamos.createIndex('porCodigo', 'codigo', { unique: true })
  // La bandeja de la intendencia entra por estado.
  reclamos.createIndex('porEstado', 'estado')
  // Para recorrer el circuito al reves: de la inspeccion al reclamo que la
  // origino. Los reclamos sin inspeccion simplemente no entran al indice.
  reclamos.createIndex('porInspeccion', 'inspeccionUuid')
}

/**
 * Version 3: edicion de checklists.
 *
 * Agrega el almacen de borradores y un indice sobre `formularioVersiones`.
 * Ninguna de las dos cosas escribe, reescribe ni borra un solo registro: crear
 * un indice hace que IndexedDB recorra lo que ya hay y lo anote, sin tocarlo.
 * Un dispositivo que venia de la version 2 conserva intactos sus objetos, sus
 * inspecciones a medio hacer y sus versiones de formulario publicadas.
 *
 * Recibe la transaccion de migracion porque `formularioVersiones` ya existia
 * desde la version 1: un indice sobre un almacen preexistente se agrega desde
 * la transaccion, no desde la base.
 */
function crearEsquemaV3(bd: BdTero, tx: TxMigracion): void {
  // El historial de un formulario se pide siempre entero y por formulario.
  tx.objectStore('formularioVersiones').createIndex('porFormulario', 'formularioId')

  const borradores = bd.createObjectStore('borradores', { keyPath: 'id' })

  // `unique` es la regla «un borrador por formulario» puesta donde no se puede
  // esquivar. Que dos personas abran a la vez el mismo checklist y cada una
  // termine con su copia significa que una de las dos va a perder su trabajo
  // sin enterarse; con el indice unico, la segunda alta FALLA y el codigo
  // devuelve el borrador que ya estaba abierto.
  borradores.createIndex('porFormulario', 'formularioId', { unique: true })
}
