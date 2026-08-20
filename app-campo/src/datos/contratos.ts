// SPDX-FileCopyrightText: 2026 GoDoWorks
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Contrato de acceso a datos.
 *
 * Toda la aplicacion habla con estas interfaces y nunca con IndexedDB ni con
 * `fetch` directamente. Hoy hay una sola implementacion, local, que guarda en
 * el dispositivo; el dia que exista el backend se agrega otra que hable con la
 * API sin tocar ni una vista.
 *
 * Esto no es una abstraccion por las dudas: es como se construye una aplicacion
 * que tiene que funcionar sin señal. La vista no puede saber si el dato vino
 * del dispositivo o del servidor.
 */

import type {
  Acta, Evidencia, EventoAuditoria, FechaHora, Firma, FormularioVersion,
  Inspeccion, ItemCola, ObjetoInspeccionable, Organismo, Punto, Respuesta,
  TipoInspeccion, TipoObjeto, Uuid, Zona, EstadoInspeccion,
} from '@/dominio/tipos'

export interface FiltroObjetos {
  tipoObjetoId?: Uuid
  zonaId?: Uuid
  texto?: string
  /** Objetos dentro de un radio en metros alrededor de un punto. */
  cerca?: { centro: Punto; radioMetros: number }
}

export interface FiltroInspecciones {
  estado?: EstadoInspeccion | EstadoInspeccion[]
  asignadoA?: string
  objetoId?: Uuid
  desde?: string
  hasta?: string
}

export interface RepositorioTerritorio {
  organismoActual(): Promise<Organismo>
  zonas(): Promise<Zona[]>
  tiposObjeto(): Promise<TipoObjeto[]>
  objetos(filtro?: FiltroObjetos): Promise<ObjetoInspeccionable[]>
  objeto(id: Uuid): Promise<ObjetoInspeccionable | undefined>
  guardarObjeto(objeto: ObjetoInspeccionable): Promise<void>
}

export interface RepositorioFormularios {
  tiposInspeccion(): Promise<TipoInspeccion[]>
  tipoInspeccion(id: Uuid): Promise<TipoInspeccion | undefined>
  /** Devuelve la version exacta, no la vigente: las actas viejas dependen de esto. */
  formularioVersion(id: Uuid): Promise<FormularioVersion | undefined>
}

export interface RepositorioInspecciones {
  listar(filtro?: FiltroInspecciones): Promise<Inspeccion[]>
  obtener(uuid: Uuid): Promise<Inspeccion | undefined>
  /** Idempotente por uuid: guardar dos veces la misma no la duplica. */
  guardar(inspeccion: Inspeccion): Promise<void>

  respuesta(inspeccionUuid: Uuid): Promise<Respuesta | undefined>
  guardarRespuesta(respuesta: Respuesta): Promise<void>

  evidencias(inspeccionUuid: Uuid): Promise<Evidencia[]>
  guardarEvidencia(evidencia: Evidencia): Promise<void>
  borrarEvidencia(id: Uuid): Promise<void>

  firma(inspeccionUuid: Uuid): Promise<Firma | undefined>
  guardarFirma(firma: Firma): Promise<void>

  acta(inspeccionUuid: Uuid): Promise<Acta | undefined>
  guardarActa(acta: Acta): Promise<void>
  /** Siguiente correlativo del organismo. Reserva el numero al pedirlo. */
  siguienteNumeroActa(): Promise<string>
}

export interface RepositorioAuditoria {
  registrar(evento: Omit<EventoAuditoria, 'id' | 'ocurridoEn'>): Promise<void>
  historial(entidad: string, entidadId: string): Promise<EventoAuditoria[]>
}

export interface ColaSincronizacion {
  encolar(item: Omit<ItemCola, 'id' | 'encoladoEn' | 'intentos' | 'estado'>): Promise<void>
  pendientes(): Promise<ItemCola[]>
  /** Cuantos cambios esperan para viajar. Lo muestra la barra superior. */
  cantidadPendiente(): Promise<number>
  /**
   * Intenta enviar lo pendiente. Sin backend todavia no envia nada: deja los
   * items en la cola, que es exactamente el comportamiento correcto cuando no
   * hay a donde enviarlos.
   */
  sincronizar(): Promise<{ enviados: number; fallidos: number }>
}

// ── Reclamos del vecino ───────────────────────────────────────────────

/**
 * El reclamo es la punta que abre y cierra el circuito: alguien reporta algo,
 * eso se convierte en una inspeccion sobre un objeto del territorio, y la
 * trazabilidad de esa inspeccion vuelve al vecino.
 *
 * El modelo vive aca y no en `dominio/tipos.ts` porque todavia no forma parte
 * del contrato con el backend: cuando se acuerde, se muda tal cual esta.
 *
 * Estados en el idioma del vecino, no en el del organismo. `recibido` no es
 * «pendiente» y `resuelto` no es «cerrada»: son las cuatro cosas que una
 * persona necesita saber sobre un tramite suyo.
 */
export type EstadoReclamo = 'recibido' | 'asignado' | 'inspeccionado' | 'resuelto'

/** Un paso ya ocurrido, con la fecha en que ocurrio. Solo se agrega, nunca se corrige. */
export interface HitoReclamo {
  estado: EstadoReclamo
  ocurridoEn: FechaHora
}

/** Como se comunica al vecino lo que dio la inspeccion, sin nombrar la falta. */
export type ResultadoVisible = 'sin_hallazgos' | 'requiere_correccion'

export interface ContactoReclamo {
  nombre?: string
  telefono?: string
}

export interface Reclamo {
  id: Uuid
  organismoId: Uuid
  /**
   * Codigo corto que el vecino se lleva anotado o le dictan por telefono, del
   * estilo `RC-4F7K`. Es la unica llave que necesita para volver a consultar,
   * y por eso es unico dentro de la base.
   */
  codigo: string
  /** Que le pasa al vecino, en sus palabras. */
  descripcion: string
  ubicacion: Punto
  /** Calle y altura o esquina, si la persona la sabe decir. */
  referencia?: string
  /** Opcional a proposito: un reclamo anonimo tiene que poder entrar igual. */
  contacto?: ContactoReclamo
  estado: EstadoReclamo
  /** La inspeccion que lo resuelve. Es el enganche del circuito. */
  inspeccionUuid?: Uuid
  /** Objeto del territorio al que se lo asocio, si se identifico alguno. */
  objetoId?: Uuid
  hitos: HitoReclamo[]
  creadoEn: FechaHora
  actualizadoEn: FechaHora
}

/** Lo que hace falta para dar de alta. El codigo y los hitos los pone el repositorio. */
export interface DatosNuevoReclamo {
  descripcion: string
  ubicacion: Punto
  referencia?: string
  contacto?: ContactoReclamo
  objetoId?: Uuid
}

export interface FiltroReclamos {
  estado?: EstadoReclamo | EstadoReclamo[]
  /** Los que todavia no derivaron en una inspeccion: la bandeja de entrada. */
  sinInspeccion?: boolean
}

/** Un paso de la linea de tiempo tal como se le muestra al vecino. */
export interface PasoSeguimiento {
  estado: EstadoReclamo
  /** Texto en idioma del vecino. */
  titulo: string
  cumplido: boolean
  ocurridoEn?: FechaHora
}

/**
 * Vista publica de un reclamo.
 *
 * Este tipo existe para que sea IMPOSIBLE filtrar de mas: la vista de consulta
 * no recibe un `Reclamo` ni una `Inspeccion`, recibe esto. Lo que no esta aca
 * no se le puede mostrar al vecino aunque una vista se distraiga.
 *
 * Queda afuera a proposito: quien es el inspector asignado, que incumplimientos
 * se constataron, el encuadre normativo, el numero de acta, las fotos, las
 * observaciones internas y cualquier dato del tercero inspeccionado. Nada de
 * eso es del vecino que reporto, y varias de esas cosas son datos personales
 * de otra persona.
 *
 * Queda adentro porque es informacion sobre SU tramite: en que paso va, cuando
 * ocurrio cada paso, si un inspector ya fue al lugar, si se constato algo que
 * hay que corregir y hasta cuando tiene plazo el responsable para hacerlo.
 */
export interface SeguimientoReclamo {
  codigo: string
  descripcion: string
  ubicacion: Punto
  referencia?: string
  estado: EstadoReclamo
  pasos: PasoSeguimiento[]
  /** Si ya hay una inspeccion enganchada. Nunca cual ni de quien. */
  hayInspeccion: boolean
  /** Solo cuando la inspeccion ya se hizo. */
  resultado?: ResultadoVisible
  /** Fecha limite que se le dio al responsable para corregir. */
  plazoHasta?: FechaHora
  creadoEn: FechaHora
  actualizadoEn: FechaHora
}

export interface RepositorioReclamos {
  listar(filtro?: FiltroReclamos): Promise<Reclamo[]>
  obtener(id: Uuid): Promise<Reclamo | undefined>
  /**
   * Busca por el codigo anotado en un papel. Tolerante a como lo escriba la
   * persona: minusculas, espacios de mas, con o sin el prefijo.
   */
  porCodigo(codigo: string): Promise<Reclamo | undefined>
  /** El reclamo que origino una inspeccion, para poder mirar el circuito al reves. */
  porInspeccion(inspeccionUuid: Uuid): Promise<Reclamo | undefined>
  /** Alta. Genera el codigo unico y deja asentado el hito «recibido». */
  registrar(datos: DatosNuevoReclamo): Promise<Reclamo>
  /**
   * Engancha el reclamo con la inspeccion que lo resuelve. Idempotente:
   * vincular dos veces la misma inspeccion no duplica hitos.
   */
  vincularInspeccion(id: Uuid, inspeccionUuid: Uuid): Promise<Reclamo>
  /**
   * Lo que ve el vecino. Antes de responder pone al dia el estado del reclamo
   * contra el de su inspeccion, asi la consulta nunca miente por falta de que
   * alguien empuje el cambio.
   */
  seguimiento(codigo: string): Promise<SeguimientoReclamo | undefined>
}

/** Punto unico de entrada a los datos. */
export interface Almacen {
  territorio: RepositorioTerritorio
  formularios: RepositorioFormularios
  inspecciones: RepositorioInspecciones
  reclamos: RepositorioReclamos
  auditoria: RepositorioAuditoria
  cola: ColaSincronizacion
  /** Carga los datos de demostracion si la base esta vacia. */
  prepararDatosIniciales(): Promise<void>
  /** Borra todo y vuelve a sembrar. Util para demostrar dos veces seguidas. */
  reiniciar(): Promise<void>
}
