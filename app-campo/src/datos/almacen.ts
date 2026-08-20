// SPDX-FileCopyrightText: 2026 GoDoWorks
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Implementacion local del contrato de datos, sobre IndexedDB.
 *
 * Todo lo que la aplicacion guarda vive en el dispositivo y ademas se anota en
 * una cola de sincronizacion. Hoy la cola no tiene a donde viajar; el dia que
 * exista el backend, lo unico que cambia es `sincronizar()`.
 *
 * Dos invariantes que se sostienen aca y no en las vistas:
 *
 *  - Guardar una inspeccion es idempotente por `uuid`. Se puede reintentar
 *    tantas veces como haga falta sin duplicar ni perder lo ya escrito.
 *  - El correlativo del acta se reserva dentro de una transaccion. Dos actas
 *    no pueden llevar el mismo numero ni aunque se emitan a la vez.
 */

import type { IDBPObjectStore, StoreNames } from 'idb'
import { abrirBd, ALMACENES, type BdTero, type EsquemaTero } from './bd'
import type {
  Almacen, ColaSincronizacion, FiltroInspecciones, FiltroObjetos,
  RepositorioAuditoria, RepositorioFormularios, RepositorioInspecciones,
  RepositorioTerritorio,
} from './contratos'
import type {
  Acta, Evidencia, EventoAuditoria, Firma, FormularioVersion, Inspeccion,
  ItemCola, ObjetoInspeccionable, Organismo, Respuesta, TipoInspeccion,
  TipoObjeto, Uuid, Zona,
} from '@/dominio/tipos'
import { ahora, calcularHash, distanciaMetros, nuevoUuid } from '@/dominio/utilidades'
import { construirSemilla } from './semilla'

// ── Utilidades internas ───────────────────────────────────────────────

/**
 * El almacen de la cola visto desde cualquier transaccion de escritura.
 * IndexedDB tipa cada store con la lista de stores de SU transaccion; como la
 * cola se escribe desde transacciones de composicion distinta, se describe una
 * sola vez de forma laxa.
 */
type StoreCola = IDBPObjectStore<
  EsquemaTero,
  ArrayLike<StoreNames<EsquemaTero>>,
  'cola',
  'readwrite'
>

/**
 * Quita las claves con valor `undefined`.
 *
 * Sin esto, fusionar un objeto parcial sobre el guardado borraria campos: en
 * JavaScript `{...viejo, ...nuevo}` pisa con `undefined` igual que con un valor.
 */
function sinIndefinidos<T extends object>(objeto: T): Partial<T> {
  const entradas = Object.entries(objeto).filter(([, valor]) => valor !== undefined)
  return Object.fromEntries(entradas) as Partial<T>
}

/** Minusculas y sin tildes, para que buscar "Baigorria" encuentre "Baigorría". */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Anota un cambio en la cola dentro de la transaccion que lo produjo, para que
 * dato y anotacion se confirmen o se pierdan juntos.
 *
 * Si ya hay un item pendiente para la misma entidad no agrega otro: la cola
 * lleva la cuenta de CAMBIOS por enviar, no de veces que se toco "guardar".
 * El servidor deduplica igual por uuid, pero el contador de la barra superior
 * tiene que significar algo para quien lo mira.
 */
async function encolarEn(
  cola: StoreCola,
  tipo: ItemCola['tipo'],
  entidadUuid: Uuid,
): Promise<void> {
  const existentes = await cola.getAll()
  const yaEsperaba = existentes.some(
    (item) =>
      item.entidadUuid === entidadUuid &&
      item.tipo === tipo &&
      (item.estado === 'pendiente' || item.estado === 'enviando'),
  )
  if (yaEsperaba) return

  const nuevo: Omit<ItemCola, 'id'> = {
    tipo,
    entidadUuid,
    encoladoEn: ahora(),
    intentos: 0,
    estado: 'pendiente',
  }
  // El id lo pone IndexedDB (autoIncrement); por eso se omite al escribir.
  await cola.add(nuevo as ItemCola)
}

// ── Territorio ────────────────────────────────────────────────────────

async function organismoActual(): Promise<Organismo> {
  const bd = await abrirBd()
  let organismos = await bd.getAll('organismos')
  if (organismos.length === 0) {
    // Alguien pidio datos antes de que se sembrara. Sembrar es idempotente,
    // asi que es preferible resolverlo a explotarle en la cara a la vista.
    await prepararDatosIniciales()
    organismos = await bd.getAll('organismos')
  }
  const organismo = organismos[0]
  if (!organismo) throw new Error('No hay organismo cargado en la base local')
  return organismo
}

async function listarZonas(): Promise<Zona[]> {
  const bd = await abrirBd()
  const zonas = await bd.getAll('zonas')
  return zonas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

async function listarTiposObjeto(): Promise<TipoObjeto[]> {
  const bd = await abrirBd()
  const tipos = await bd.getAll('tiposObjeto')
  return tipos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

async function listarObjetos(filtro?: FiltroObjetos): Promise<ObjetoInspeccionable[]> {
  const bd = await abrirBd()
  // Con tipo elegido se entra por el indice; el resto se filtra en memoria
  // porque el universo de objetos de un organismo cabe holgado en el telefono.
  let objetos = filtro?.tipoObjetoId
    ? await bd.getAllFromIndex('objetos', 'porTipo', filtro.tipoObjetoId)
    : await bd.getAll('objetos')

  if (filtro?.zonaId) {
    objetos = objetos.filter((o) => o.zonaId === filtro.zonaId)
  }

  if (filtro?.texto) {
    const buscado = normalizar(filtro.texto)
    objetos = objetos.filter((o) =>
      normalizar(`${o.codigo} ${o.denominacion} ${o.direccion}`).includes(buscado),
    )
  }

  if (filtro?.cerca) {
    const { centro, radioMetros } = filtro.cerca
    objetos = objetos
      .filter((o) => distanciaMetros(centro, o.ubicacion) <= radioMetros)
      // Cerca significa cerca: lo mas proximo primero.
      .sort((a, b) => distanciaMetros(centro, a.ubicacion) - distanciaMetros(centro, b.ubicacion))
    return objetos
  }

  return objetos.sort((a, b) => a.denominacion.localeCompare(b.denominacion, 'es'))
}

async function obtenerObjeto(id: Uuid): Promise<ObjetoInspeccionable | undefined> {
  const bd = await abrirBd()
  return bd.get('objetos', id)
}

async function guardarObjeto(objeto: ObjetoInspeccionable): Promise<void> {
  const bd = await abrirBd()
  const tx = bd.transaction(['objetos', 'cola'], 'readwrite')
  await tx.objectStore('objetos').put(objeto)
  await encolarEn(tx.objectStore('cola'), 'objeto', objeto.id)
  await tx.done
}

const territorio: RepositorioTerritorio = {
  organismoActual,
  zonas: listarZonas,
  tiposObjeto: listarTiposObjeto,
  objetos: listarObjetos,
  objeto: obtenerObjeto,
  guardarObjeto,
}

// ── Formularios ───────────────────────────────────────────────────────

async function listarTiposInspeccion(): Promise<TipoInspeccion[]> {
  const bd = await abrirBd()
  const tipos = await bd.getAll('tiposInspeccion')
  return tipos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

async function obtenerTipoInspeccion(id: Uuid): Promise<TipoInspeccion | undefined> {
  const bd = await abrirBd()
  return bd.get('tiposInspeccion', id)
}

async function obtenerFormularioVersion(id: Uuid): Promise<FormularioVersion | undefined> {
  const bd = await abrirBd()
  // A proposito se busca por id de VERSION y no por formulario: un acta vieja
  // tiene que reconstruirse con el cuestionario con el que se lleno.
  return bd.get('formularioVersiones', id)
}

const formularios: RepositorioFormularios = {
  tiposInspeccion: listarTiposInspeccion,
  tipoInspeccion: obtenerTipoInspeccion,
  formularioVersion: obtenerFormularioVersion,
}

// ── Inspecciones ──────────────────────────────────────────────────────

/** Fecha con la que se ordena y se filtra una inspeccion en las listas. */
function fechaReferencia(i: Inspeccion): string {
  return i.ejecutadaEn ?? i.programadaPara ?? i.creadaEn
}

async function listarInspecciones(filtro?: FiltroInspecciones): Promise<Inspeccion[]> {
  const bd = await abrirBd()

  let inspecciones: Inspeccion[]
  if (filtro?.objetoId) {
    inspecciones = await bd.getAllFromIndex('inspecciones', 'porObjeto', filtro.objetoId)
  } else if (typeof filtro?.estado === 'string') {
    inspecciones = await bd.getAllFromIndex('inspecciones', 'porEstado', filtro.estado)
  } else {
    inspecciones = await bd.getAll('inspecciones')
  }

  if (filtro?.estado) {
    const estados = new Set(
      Array.isArray(filtro.estado) ? filtro.estado : [filtro.estado],
    )
    inspecciones = inspecciones.filter((i) => estados.has(i.estado))
  }

  if (filtro?.asignadoA) {
    inspecciones = inspecciones.filter((i) => i.asignadoA === filtro.asignadoA)
  }

  if (filtro?.desde) {
    inspecciones = inspecciones.filter((i) => fechaReferencia(i) >= filtro.desde!)
  }

  if (filtro?.hasta) {
    inspecciones = inspecciones.filter((i) => fechaReferencia(i) <= filtro.hasta!)
  }

  // Lo mas reciente arriba: es lo que se mira primero tanto en la bandeja como
  // en el historial de un objeto.
  return inspecciones.sort((a, b) => fechaReferencia(b).localeCompare(fechaReferencia(a)))
}

async function obtenerInspeccion(uuid: Uuid): Promise<Inspeccion | undefined> {
  const bd = await abrirBd()
  return bd.get('inspecciones', uuid)
}

async function guardarInspeccion(inspeccion: Inspeccion): Promise<void> {
  const bd = await abrirBd()
  const tx = bd.transaction(['inspecciones', 'cola'], 'readwrite')
  const store = tx.objectStore('inspecciones')

  // Idempotencia: la clave es el uuid, asi que reescribir no duplica. La
  // fusion con lo guardado evita que un formulario que solo conoce parte de la
  // inspeccion borre lo que escribio otra pantalla.
  const previa = await store.get(inspeccion.uuid)
  const fusionada: Inspeccion = {
    ...(previa ?? inspeccion),
    ...sinIndefinidos(inspeccion),
    uuid: inspeccion.uuid,
    // La fecha de creacion es la primera que hubo, no la del ultimo reintento.
    creadaEn: previa?.creadaEn ?? inspeccion.creadaEn,
    actualizadaEn: ahora(),
  }

  await store.put(fusionada)
  await encolarEn(tx.objectStore('cola'), 'inspeccion', fusionada.uuid)
  await tx.done
}

async function obtenerRespuesta(inspeccionUuid: Uuid): Promise<Respuesta | undefined> {
  const bd = await abrirBd()
  return bd.get('respuestas', inspeccionUuid)
}

async function guardarRespuesta(respuesta: Respuesta): Promise<void> {
  const bd = await abrirBd()
  const tx = bd.transaction(['respuestas', 'cola'], 'readwrite')
  // Una respuesta por inspeccion: la clave del almacen es el uuid, de modo que
  // el autoguardado mientras se completa el formulario pisa siempre la misma.
  await tx.objectStore('respuestas').put(respuesta)
  await encolarEn(tx.objectStore('cola'), 'respuesta', respuesta.inspeccionUuid)
  await tx.done
}

async function listarEvidencias(inspeccionUuid: Uuid): Promise<Evidencia[]> {
  const bd = await abrirBd()
  const evidencias = await bd.getAllFromIndex('evidencias', 'porInspeccion', inspeccionUuid)
  return evidencias.sort((a, b) => a.tomadaEn.localeCompare(b.tomadaEn))
}

async function guardarEvidencia(evidencia: Evidencia): Promise<void> {
  // El Blob va crudo a IndexedDB: no hace falta base64 y ademas no lo infla.
  // Si la foto llega sin hash lo calculamos aca; sin hash no hay forma de
  // sostener despues que la imagen es la que se tomo.
  const completa: Evidencia = evidencia.hash
    ? evidencia
    : { ...evidencia, hash: await calcularHash(evidencia.contenido) }

  const bd = await abrirBd()
  const tx = bd.transaction(['evidencias', 'cola'], 'readwrite')
  await tx.objectStore('evidencias').put(completa)
  await encolarEn(tx.objectStore('cola'), 'evidencia', completa.id)
  await tx.done
}

async function borrarEvidencia(id: Uuid): Promise<void> {
  const bd = await abrirBd()
  await bd.delete('evidencias', id)
}

async function obtenerFirma(inspeccionUuid: Uuid): Promise<Firma | undefined> {
  const bd = await abrirBd()
  return bd.get('firmas', inspeccionUuid)
}

async function guardarFirma(firma: Firma): Promise<void> {
  const bd = await abrirBd()
  const tx = bd.transaction(['firmas', 'cola'], 'readwrite')
  await tx.objectStore('firmas').put(firma)
  await encolarEn(tx.objectStore('cola'), 'firma', firma.inspeccionUuid)
  await tx.done
}

async function obtenerActa(inspeccionUuid: Uuid): Promise<Acta | undefined> {
  const bd = await abrirBd()
  return bd.getFromIndex('actas', 'porInspeccion', inspeccionUuid)
}

async function guardarActa(acta: Acta): Promise<void> {
  const bd = await abrirBd()
  const tx = bd.transaction(['actas', 'cola'], 'readwrite')
  await tx.objectStore('actas').put(acta)
  // La cola no tiene tipo propio para actas porque el acta no viaja sola: va
  // con su inspeccion, y el servidor la reconoce por ese uuid.
  await encolarEn(tx.objectStore('cola'), 'inspeccion', acta.inspeccionUuid)
  await tx.done
}

async function siguienteNumeroActa(): Promise<string> {
  const organismo = await organismoActual()
  const anio = new Date().getFullYear()
  const clave = `acta:${organismo.id}:${anio}`

  const bd = await abrirBd()
  const tx = bd.transaction('correlativos', 'readwrite')
  const store = tx.objectStore('correlativos')

  // Leer, sumar y escribir SIN esperar nada ajeno en el medio: mientras la
  // transaccion sigue viva, IndexedDB serializa cualquier otra escritura sobre
  // este almacen, y por eso dos actas simultaneas no pueden sacar el mismo
  // numero. Si se colara un `await` a algo externo, la transaccion se cerraria
  // sola y la garantia se perderia.
  const actual = await store.get(clave)
  const siguiente = (actual?.ultimo ?? 0) + 1
  await store.put({ clave, ultimo: siguiente })
  await tx.done

  return `${anio}-${String(siguiente).padStart(6, '0')}`
}

const inspecciones: RepositorioInspecciones = {
  listar: listarInspecciones,
  obtener: obtenerInspeccion,
  guardar: guardarInspeccion,
  respuesta: obtenerRespuesta,
  guardarRespuesta,
  evidencias: listarEvidencias,
  guardarEvidencia,
  borrarEvidencia,
  firma: obtenerFirma,
  guardarFirma,
  acta: obtenerActa,
  guardarActa,
  siguienteNumeroActa,
}

// ── Auditoria ─────────────────────────────────────────────────────────

const auditoria: RepositorioAuditoria = {
  /**
   * Solo agrega. No hay actualizar ni borrar en esta interfaz, y tampoco los
   * hay en la implementacion: un registro de auditoria que se puede editar no
   * sirve para nada. Se usa `add` y no `put` para que un id repetido falle en
   * vez de pisar lo anterior.
   */
  async registrar(evento) {
    const bd = await abrirBd()
    const completo: EventoAuditoria = {
      ...evento,
      id: nuevoUuid(),
      ocurridoEn: ahora(),
    }
    await bd.add('auditoria', completo)
  },

  async historial(entidad, entidadId) {
    const bd = await abrirBd()
    const eventos = await bd.getAllFromIndex('auditoria', 'porEntidad', entidadId)
    return eventos
      .filter((e) => e.entidad === entidad)
      .sort((a, b) => b.ocurridoEn.localeCompare(a.ocurridoEn))
  },
}

// ── Cola de sincronizacion ────────────────────────────────────────────

const cola: ColaSincronizacion = {
  async encolar(item) {
    const bd = await abrirBd()
    const tx = bd.transaction('cola', 'readwrite')
    await encolarEn(tx.objectStore('cola'), item.tipo, item.entidadUuid)
    await tx.done
  },

  async pendientes() {
    const bd = await abrirBd()
    const items = await bd.getAll('cola')
    return items.filter((i) => i.estado === 'pendiente' || i.estado === 'enviando')
  },

  async cantidadPendiente() {
    const items = await cola.pendientes()
    return items.length
  },

  /**
   * No hay servidor todavia. Devolver ceros y dejar la cola intacta no es una
   * tarea pendiente: es el comportamiento correcto. Marcar como enviado algo
   * que nadie recibio seria perder trabajo de campo en silencio, que es
   * exactamente lo que esta cola existe para evitar.
   */
  async sincronizar() {
    return { enviados: 0, fallidos: 0 }
  },
}

// ── Siembra y reinicio ────────────────────────────────────────────────

async function escribirSemilla(bd: BdTero): Promise<void> {
  const datos = construirSemilla()

  // Todo en una transaccion: o queda la demostracion entera o no queda nada.
  // Una base a medio sembrar es peor que una vacia, porque parece funcionar.
  const tx = bd.transaction(
    ['organismos', 'zonas', 'tiposObjeto', 'objetos', 'formularioVersiones',
      'tiposInspeccion', 'inspecciones', 'respuestas', 'auditoria'],
    'readwrite',
  )

  const escrituras: Promise<unknown>[] = [tx.objectStore('organismos').put(datos.organismo)]
  for (const z of datos.zonas) escrituras.push(tx.objectStore('zonas').put(z))
  for (const t of datos.tiposObjeto) escrituras.push(tx.objectStore('tiposObjeto').put(t))
  for (const o of datos.objetos) escrituras.push(tx.objectStore('objetos').put(o))
  for (const f of datos.formularioVersiones) escrituras.push(tx.objectStore('formularioVersiones').put(f))
  for (const t of datos.tiposInspeccion) escrituras.push(tx.objectStore('tiposInspeccion').put(t))
  for (const i of datos.inspecciones) escrituras.push(tx.objectStore('inspecciones').put(i))
  for (const r of datos.respuestas) escrituras.push(tx.objectStore('respuestas').put(r))
  for (const e of datos.auditoria) escrituras.push(tx.objectStore('auditoria').put(e))

  await Promise.all(escrituras)
  await tx.done
}

async function sembrarSiHaceFalta(): Promise<void> {
  const bd = await abrirBd()
  // La demostracion se siembra una sola vez. Si hay un organismo, esta base ya
  // vivio: puede tener inspecciones hechas y no se toca.
  const yaHabia = await bd.count('organismos')
  if (yaHabia > 0) return
  await escribirSemilla(bd)
}

/** Se memoriza para que dos vistas montandose a la vez no siembren dos veces. */
let siembra: Promise<void> | undefined

async function prepararDatosIniciales(): Promise<void> {
  if (!siembra) siembra = sembrarSiHaceFalta()
  try {
    await siembra
  } catch (error) {
    // Si fallo, el proximo intento tiene que volver a probar de verdad.
    siembra = undefined
    throw error
  }
}

async function reiniciar(): Promise<void> {
  const bd = await abrirBd()
  const tx = bd.transaction(ALMACENES, 'readwrite')
  await Promise.all(ALMACENES.map((nombre) => tx.objectStore(nombre).clear()))
  await tx.done

  // Incluye la cola y los correlativos: reiniciar es volver al dia cero, no
  // arrastrar la numeracion de actas de la demostracion anterior.
  siembra = undefined
  await prepararDatosIniciales()
}

export const almacen: Almacen = {
  territorio,
  formularios,
  inspecciones,
  auditoria,
  cola,
  prepararDatosIniciales,
  reiniciar,
}
