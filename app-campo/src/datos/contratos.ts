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
  Acta, Evidencia, EventoAuditoria, Firma, FormularioVersion, Inspeccion,
  ItemCola, ObjetoInspeccionable, Organismo, Punto, Respuesta, TipoInspeccion,
  TipoObjeto, Uuid, Zona, EstadoInspeccion,
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

/** Punto unico de entrada a los datos. */
export interface Almacen {
  territorio: RepositorioTerritorio
  formularios: RepositorioFormularios
  inspecciones: RepositorioInspecciones
  auditoria: RepositorioAuditoria
  cola: ColaSincronizacion
  /** Carga los datos de demostracion si la base esta vacia. */
  prepararDatosIniciales(): Promise<void>
  /** Borra todo y vuelve a sembrar. Util para demostrar dos veces seguidas. */
  reiniciar(): Promise<void>
}
