// SPDX-FileCopyrightText: 2026 GoDoWorks
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tipos del dominio de Tero.
 *
 * Este archivo es el contrato entre todas las partes de la aplicacion. Los
 * nombres siguen el modelo de datos documentado en documentacion/modelo-de-datos.md
 * para que el dia que exista el backend no haya que traducir nada.
 *
 * Dos reglas que vienen del modelo y que hay que respetar aca tambien:
 *
 *  1. Una version de formulario NO se edita nunca: se crea otra. Un acta vieja
 *     tiene que poder reconstruirse tal como se emitio.
 *  2. Toda inspeccion nace con un `uuid` generado en el dispositivo. Ese uuid es
 *     lo que hace idempotente la sincronizacion: reenviar la misma inspeccion no
 *     puede duplicarla.
 */

/** Identificador estable generado en el dispositivo. */
export type Uuid = string

/** Fecha y hora en ISO 8601 con zona horaria. */
export type FechaHora = string

/** Punto en WGS 84, tal como lo entrega el GPS del telefono. */
export interface Punto {
  lat: number
  lon: number
  /** Precision informada por el dispositivo, en metros. */
  precision?: number
}

// ── Territorio ────────────────────────────────────────────────────────

export interface Organismo {
  id: Uuid
  nombre: string
  tipo: 'intendencia' | 'municipio'
}

export interface Zona {
  id: Uuid
  organismoId: Uuid
  nombre: string
  /** Anillo exterior del poligono. Suficiente para zonas operativas. */
  contorno: Punto[]
}

export type ClaveTipoObjeto =
  | 'luminaria'
  | 'contenedor'
  | 'obra'
  | 'comercio'
  | 'senalizacion'
  | 'parador'

export interface TipoObjeto {
  id: Uuid
  organismoId: Uuid
  clave: ClaveTipoObjeto
  nombre: string
  /** Nombre del icono con que se dibuja en el mapa. */
  icono: string
}

export interface ObjetoInspeccionable {
  id: Uuid
  organismoId: Uuid
  tipoObjetoId: Uuid
  /** Padron, numero de habilitacion o identificador propio del organismo. */
  codigo: string
  denominacion: string
  ubicacion: Punto
  direccion: string
  zonaId?: Uuid
  /** Lo propio de cada tipo: potencia de la luminaria, numero de permiso, etc. */
  atributos: Record<string, string | number | boolean>
  estado: 'activo' | 'inactivo' | 'baja'
  creadoEn: FechaHora
}

// ── Formularios ───────────────────────────────────────────────────────

export type TipoPregunta =
  | 'si_no'
  | 'si_no_na'
  | 'texto'
  | 'numero'
  | 'opciones'
  | 'foto'

export interface Pregunta {
  id: string
  texto: string
  tipo: TipoPregunta
  obligatoria: boolean
  /** Solo para `opciones`. */
  opciones?: string[]
  /**
   * Respuesta que constata una falta. Si el inspector responde esto, se suma
   * el incumplimiento indicado en `incumplimientoId`.
   */
  respuestaQueIncumple?: string
  incumplimientoId?: string
}

export interface Seccion {
  id: string
  titulo: string
  preguntas: Pregunta[]
}

export interface Incumplimiento {
  id: string
  descripcion: string
  /** Encuadre normativo, tal como se cita en el acta. */
  normativa: string
  plazoSubsanacionDias: number
  gravedad: 'leve' | 'grave' | 'muy_grave'
}

/**
 * INMUTABLE. Nunca se modifica una version existente: se crea una nueva con
 * `version` incrementada. Ver la regla 1 en la cabecera de este archivo.
 */
export interface FormularioVersion {
  id: Uuid
  formularioId: Uuid
  version: number
  titulo: string
  secciones: Seccion[]
  incumplimientos: Incumplimiento[]
  vigenteDesde: FechaHora
}

export interface TipoInspeccion {
  id: Uuid
  organismoId: Uuid
  nombre: string
  direccionResponsable: string
  formularioVersionId: Uuid
  /** Se usa cuando el incumplimiento constatado no define uno propio. */
  plazoSubsanacionDias: number
  /** Tipos de objeto a los que aplica. */
  tipoObjetoIds: Uuid[]
}

// ── Inspecciones ──────────────────────────────────────────────────────

export type OrigenInspeccion = 'plan' | 'reclamo' | 'oficio'

export type EstadoInspeccion =
  | 'pendiente'
  | 'asignada'
  | 'en_campo'
  | 'cerrada'
  | 'vencida'

export type ResultadoInspeccion =
  | 'conforme'
  | 'con_observaciones'
  | 'no_conforme'

export type Prioridad = 'baja' | 'media' | 'alta' | 'urgente'

export interface Inspeccion {
  /** Generado en el dispositivo. Clave de la idempotencia. */
  uuid: Uuid
  organismoId: Uuid
  objetoId: Uuid
  tipoInspeccionId: Uuid
  /** Contra que version del formulario se completo. Nunca cambia. */
  formularioVersionId: Uuid
  origen: OrigenInspeccion
  estado: EstadoInspeccion
  prioridad: Prioridad
  asignadoA?: string
  programadaPara?: FechaHora
  ejecutadaEn?: FechaHora
  /** Donde estaba el inspector al cerrar la inspeccion. */
  ubicacionEjecucion?: Punto
  resultado?: ResultadoInspeccion
  /** Si es una reinspeccion, el uuid de la original. */
  padreUuid?: Uuid
  creadaEn: FechaHora
  actualizadaEn: FechaHora
}

export interface Respuesta {
  inspeccionUuid: Uuid
  formularioVersionId: Uuid
  /** Clave: id de la pregunta. */
  datos: Record<string, string | number | boolean | null>
  observaciones?: string
  /** Ids de los incumplimientos constatados. */
  incumplimientoIds: string[]
}

export interface Evidencia {
  id: Uuid
  inspeccionUuid: Uuid
  tipo: 'foto' | 'audio'
  /** Contenido del archivo. En el navegador vive como Blob. */
  contenido: Blob
  /** Donde y cuando se tomo, no cuando se subio. */
  ubicacion?: Punto
  tomadaEn: FechaHora
  /** sha256 en hexadecimal, para poder probar que no se altero. */
  hash: string
  /** Pregunta que la origino, si la foto responde a una del checklist. */
  preguntaId?: string
}

export interface Firma {
  inspeccionUuid: Uuid
  firmante: string
  documento: string
  /** Trazo de la firma como PNG. */
  imagen: Blob
  firmadoEn: FechaHora
  /** Cuando la persona se niega a firmar, se deja constancia. */
  seNegoAFirmar: boolean
}

export interface Acta {
  id: Uuid
  inspeccionUuid: Uuid
  /** Correlativo por organismo, con el formato del organismo. */
  numero: string
  emitidaEn: FechaHora
  /** Fecha limite para subsanar lo constatado. */
  plazoSubsanacion?: FechaHora
  notificadaEn?: FechaHora
  /** El PDF generado. */
  documento: Blob
}

// ── Trazabilidad ──────────────────────────────────────────────────────

export interface EventoAuditoria {
  id: Uuid
  organismoId: Uuid
  /** Sobre que entidad ocurrio: uuid de inspeccion, id de objeto, etc. */
  entidad: string
  entidadId: string
  accion: string
  detalle?: string
  actor: string
  ocurridoEn: FechaHora
  ubicacion?: Punto
}

// ── Sincronizacion ────────────────────────────────────────────────────

/**
 * Un cambio hecho sin conexion, esperando su turno para viajar al servidor.
 *
 * La cola es de solo agregado y se procesa en orden. Como cada inspeccion
 * tiene un unico dueño en campo, no hay escritura concurrente que resolver:
 * alcanza con reenviar hasta que el servidor confirme.
 */
export interface ItemCola {
  id: number
  tipo: 'inspeccion' | 'respuesta' | 'evidencia' | 'firma' | 'objeto'
  /** uuid de la entidad, para que el servidor descarte duplicados. */
  entidadUuid: Uuid
  encoladoEn: FechaHora
  intentos: number
  ultimoError?: string
  estado: 'pendiente' | 'enviando' | 'confirmado' | 'fallido'
}
