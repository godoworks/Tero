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
  Almacen, ColaSincronizacion, ContactoReclamo, DatosNuevoReclamo,
  EstadoReclamo, FiltroInspecciones, FiltroObjetos, FiltroReclamos,
  PasoSeguimiento, Reclamo, RepositorioAuditoria, RepositorioFormularios,
  RepositorioInspecciones, RepositorioReclamos, RepositorioTerritorio,
  ResultadoVisible, SeguimientoReclamo,
} from './contratos'
import type {
  Acta, BorradorFormulario, Evidencia, EventoAuditoria, FechaHora, Firma,
  FormularioVersion, Inspeccion, ItemCola, ObjetoInspeccionable, Organismo,
  Respuesta, TipoInspeccion, TipoObjeto, Uuid, Zona,
} from '@/dominio/tipos'
import { ahora, calcularHash, distanciaMetros, nuevoUuid } from '@/dominio/utilidades'
import { aDatoPlano } from './planos'
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
  await cola.add(aDatoPlano(nuevo) as ItemCola)
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
  await tx.objectStore('objetos').put(aDatoPlano(objeto))
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

// ── Edicion de checklists ─────────────────────────────────────────────
//
// Toda esta parte se apoya en una sola regla, y conviene decirla una vez:
// una `FormularioVersion` publicada no se modifica NUNCA. Editar no es
// cambiar la version vigente, es escribir una nueva al lado. Por eso:
//
//  - lo que se edita vive en el almacen `borradores`, aparte;
//  - publicar usa `add` y no `put` sobre `formularioVersiones`, de modo que
//    ni un id repetido pueda pisar una version existente;
//  - las inspecciones no se tocan al publicar. Una inspeccion guarda su
//    `formularioVersionId` y sigue con el, aunque despues salgan diez
//    versiones mas. Es lo que permite reconstruir un acta de hace ocho meses
//    tal como se emitio, y lo que evita que a un inspector que esta en la
//    calle le cambien las preguntas abajo de los pies.

async function listarVersiones(formularioId: Uuid): Promise<FormularioVersion[]> {
  const bd = await abrirBd()
  const versiones = await bd.getAllFromIndex('formularioVersiones', 'porFormulario', formularioId)
  // De la mas nueva a la mas vieja: quien mira el historial busca primero que
  // cambio ultimo.
  return versiones.sort((a, b) => b.version - a.version)
}

async function listarBorradores(): Promise<BorradorFormulario[]> {
  const bd = await abrirBd()
  const borradores = await bd.getAll('borradores')
  return borradores.sort((a, b) => b.actualizadoEn.localeCompare(a.actualizadoEn))
}

async function obtenerBorrador(id: Uuid): Promise<BorradorFormulario | undefined> {
  const bd = await abrirBd()
  return bd.get('borradores', id)
}

/**
 * Abre la edicion de un checklist.
 *
 * Una sola transaccion para leer el tipo, leer su version vigente, mirar si ya
 * hay un borrador y crearlo si no lo hay. Que la comprobacion y el alta ocurran
 * dentro de la misma transaccion es lo que hace de verdad cierto el «uno por
 * formulario»: si estuvieran separadas, dos pestañas podrian comprobar a la vez
 * que no hay ninguno y crear una cada una. El indice unico del almacen es la
 * red debajo de eso.
 */
async function abrirBorrador(tipoInspeccionId: Uuid, autor: string): Promise<BorradorFormulario> {
  const bd = await abrirBd()
  const tx = bd.transaction(
    ['tiposInspeccion', 'formularioVersiones', 'borradores'],
    'readwrite',
  )

  const tipo = await tx.objectStore('tiposInspeccion').get(tipoInspeccionId)
  if (!tipo) {
    await tx.done
    throw new Error(`No hay ningún tipo de inspección con el id ${tipoInspeccionId}`)
  }

  const vigente = await tx.objectStore('formularioVersiones').get(tipo.formularioVersionId)
  if (!vigente) {
    await tx.done
    throw new Error(
      `El tipo de inspección «${tipo.nombre}» apunta a una versión de formulario que no está en la base`,
    )
  }

  const store = tx.objectStore('borradores')
  const abierto = await store.index('porFormulario').get(vigente.formularioId)
  if (abierto) {
    // Ya hay alguien editando este checklist. Se devuelve ese borrador en vez
    // de abrir otro: dos personas con copias distintas del mismo formulario
    // terminan con una de las dos perdiendo su trabajo sin enterarse.
    await tx.done
    return abierto
  }

  const momento = ahora()
  const borrador: BorradorFormulario = {
    id: nuevoUuid(),
    organismoId: tipo.organismoId,
    formularioId: vigente.formularioId,
    baseVersionId: vigente.id,
    titulo: vigente.titulo,
    // `vigente` salio de IndexedDB, o sea que ya es una copia propia: editar
    // estas secciones no puede alcanzar a la version publicada de la que se
    // partio ni por referencia compartida.
    secciones: vigente.secciones,
    incumplimientos: vigente.incumplimientos,
    autor,
    creadoEn: momento,
    actualizadoEn: momento,
  }

  // `add` y no `put`: un id ya usado tiene que fallar, no pisar nada.
  await store.add(aDatoPlano(borrador))
  await tx.done
  return borrador
}

async function guardarBorrador(borrador: BorradorFormulario): Promise<void> {
  const bd = await abrirBd()
  const tx = bd.transaction('borradores', 'readwrite')
  const store = tx.objectStore('borradores')

  const previo = await store.get(borrador.id)
  const completo: BorradorFormulario = {
    ...borrador,
    // De que formulario es el borrador y de que version se partio quedaron
    // fijados al abrirlo. Una pantalla de edicion no tiene por que poder
    // cambiarlos, y si los cambiara, al publicar la version nueva colgaria de
    // otro formulario.
    formularioId: previo?.formularioId ?? borrador.formularioId,
    baseVersionId: previo?.baseVersionId ?? borrador.baseVersionId,
    creadoEn: previo?.creadoEn ?? borrador.creadoEn,
    actualizadoEn: ahora(),
  }

  try {
    await store.put(aDatoPlano(completo))
    await tx.done
  } catch (error) {
    if (error instanceof DOMException && error.name === 'ConstraintError') {
      throw new Error(
        'Ya hay otro borrador abierto para este formulario. Publicalo o descartalo antes de abrir uno nuevo.',
      )
    }
    throw error
  }

  // El borrador NO se encola: es trabajo a medio hacer, y lo que viaja al
  // servidor el dia que exista es la version publicada, no el intento.
}

async function descartarBorrador(id: Uuid): Promise<void> {
  const bd = await abrirBd()
  // Borra el borrador y nada mas. Ninguna version publicada esta en este
  // almacen, asi que por este camino no hay forma de perder una.
  await bd.delete('borradores', id)
}

/**
 * Todo lo que le falta a un borrador para poder publicarse.
 *
 * Junta TODAS las faltas en vez de cortar en la primera: quien esta armando un
 * checklist prefiere ver de una lo que le falta a descubrirlo de a un error por
 * intento. Es pura, no toca la base, y por eso corre antes de abrir ninguna
 * transaccion de escritura.
 */
function faltasParaPublicar(borrador: BorradorFormulario): string[] {
  const faltas: string[] = []

  if (!borrador.titulo.trim()) faltas.push('El formulario no tiene título.')
  if (borrador.secciones.length === 0) {
    faltas.push('El formulario no tiene ninguna sección.')
  }

  // El catalogo es el del propio formulario: un incumplimiento de otro
  // formulario no existe para este, y al emitir el acta no habria de donde
  // sacar la normativa ni el plazo.
  const catalogo = new Set(borrador.incumplimientos.map((i) => i.id))
  const idsSeccion = new Set<string>()
  const idsPregunta = new Set<string>()

  for (const seccion of borrador.secciones) {
    const nombre = seccion.titulo.trim() || `(sección ${seccion.id})`
    if (!seccion.titulo.trim()) {
      faltas.push(`La sección ${seccion.id} no tiene título.`)
    }
    if (idsSeccion.has(seccion.id)) {
      faltas.push(`Hay dos secciones con el mismo identificador «${seccion.id}».`)
    }
    idsSeccion.add(seccion.id)

    if (seccion.preguntas.length === 0) {
      faltas.push(`La sección «${nombre}» no tiene ninguna pregunta.`)
      continue
    }

    for (const pregunta of seccion.preguntas) {
      const texto = pregunta.texto.trim()
      const cual = texto || `de identificador ${pregunta.id}`

      if (!texto) {
        faltas.push(`Hay una pregunta sin texto en la sección «${nombre}».`)
      }
      // El id de la pregunta es la clave con la que se guarda la respuesta:
      // dos iguales hacen que una respuesta pise a la otra en silencio.
      if (idsPregunta.has(pregunta.id)) {
        faltas.push(`Hay dos preguntas con el mismo identificador «${pregunta.id}».`)
      }
      idsPregunta.add(pregunta.id)

      if (pregunta.tipo === 'opciones' && (pregunta.opciones?.length ?? 0) === 0) {
        faltas.push(
          `La pregunta «${cual}» de la sección «${nombre}» es de opciones pero no tiene ninguna cargada.`,
        )
      }

      if (pregunta.incumplimientoId && !catalogo.has(pregunta.incumplimientoId)) {
        faltas.push(
          `La pregunta «${cual}» de la sección «${nombre}» apunta al incumplimiento «${pregunta.incumplimientoId}», que no está en el catálogo del formulario.`,
        )
      }
    }
  }

  return faltas
}

/**
 * Publica el borrador como version nueva.
 *
 * Todo lo que cambia el estado del mundo ocurre en UNA transaccion: se agrega
 * la version, se reapunta el o los tipos de inspeccion, se borra el borrador y
 * se anota la auditoria. O pasa todo o no pasa nada. Si esto quedara a medias
 * —version escrita, tipo sin reapuntar, o peor, tipo apuntando a una version
 * que no llego a escribirse— la aplicacion dejaria de poder abrir inspecciones
 * de ese tipo.
 *
 * Por eso mismo, entre el `bd.transaction(...)` y el `tx.done` no hay ni un
 * `await` a algo que no sea la propia transaccion: IndexedDB cierra una
 * transaccion en cuanto se queda sin trabajo pendiente, y esperar cualquier
 * otra cosa en el medio la mataria.
 */
async function publicarBorrador(id: Uuid, autor: string): Promise<FormularioVersion> {
  const bd = await abrirBd()

  const previo = await bd.get('borradores', id)
  if (!previo) throw new Error(`No hay ningún borrador con el id ${id}`)

  const faltas = faltasParaPublicar(previo)
  if (faltas.length > 0) {
    throw new Error(`No se puede publicar el formulario. ${faltas.join(' ')}`)
  }

  const tx = bd.transaction(
    ['borradores', 'formularioVersiones', 'tiposInspeccion', 'auditoria'],
    'readwrite',
  )
  const almacenBorradores = tx.objectStore('borradores')
  const almacenVersiones = tx.objectStore('formularioVersiones')
  const almacenTipos = tx.objectStore('tiposInspeccion')

  // Se relee dentro de la transaccion: entre la validacion y esta linea otra
  // pestaña pudo haberlo descartado o publicado.
  const borrador = await almacenBorradores.get(id)
  if (!borrador) {
    await tx.done
    throw new Error(`El borrador ${id} ya no existe: alguien lo publicó o lo descartó`)
  }

  const anteriores = await almacenVersiones.index('porFormulario').getAll(borrador.formularioId)
  // El numero sale del maximo ya publicado y no de una cuenta ni de un
  // contador aparte: aunque falte alguna version intermedia, la nueva siempre
  // queda por encima de todas.
  const maxima = anteriores.reduce((mayor, v) => Math.max(mayor, v.version), 0)

  const nueva: FormularioVersion = {
    id: nuevoUuid(),
    formularioId: borrador.formularioId,
    version: maxima + 1,
    titulo: borrador.titulo.trim(),
    secciones: borrador.secciones,
    incumplimientos: borrador.incumplimientos,
    vigenteDesde: ahora(),
    publicadaPor: autor,
  }

  // `add` y no `put`. Es la ultima linea de defensa de la inmutabilidad: si el
  // id sorteado ya existiera, esto falla y aborta la transaccion entera en vez
  // de sobrescribir una version publicada.
  await almacenVersiones.add(aDatoPlano(nueva))

  // Se reapunta el tipo de inspeccion que estaba usando CUALQUIER version de
  // este formulario, no solo la que sirvio de base: puede haberse publicado
  // otra mientras este borrador estaba abierto.
  const idsAnteriores = new Set(anteriores.map((v) => v.id))
  const tipos = await almacenTipos.getAll()
  const reapuntados = tipos.filter((t) => idsAnteriores.has(t.formularioVersionId))
  for (const tipo of reapuntados) {
    await almacenTipos.put(aDatoPlano({ ...tipo, formularioVersionId: nueva.id }))
  }

  // El borrador deja de existir al publicarse: lo que queda es la version.
  await almacenBorradores.delete(id)

  // La auditoria se escribe aca dentro y no con `auditoria.registrar()`, que
  // abriria su propia transaccion: publicar sin dejar rastro, o dejar rastro de
  // algo que no se publico, son las dos cosas que este registro existe para
  // que no pasen.
  const evento: EventoAuditoria = {
    id: nuevoUuid(),
    organismoId: borrador.organismoId,
    entidad: 'formulario',
    entidadId: borrador.formularioId,
    accion: 'publicar_version',
    detalle: `Versión ${nueva.version} de «${nueva.titulo}»`
      + ` (${nueva.secciones.length} secciones, ${nueva.incumplimientos.length} incumplimientos).`
      + ` Tipos de inspección reapuntados: ${reapuntados.length}.`,
    actor: autor,
    ocurridoEn: ahora(),
  }
  await tx.objectStore('auditoria').add(aDatoPlano(evento))

  await tx.done

  // Las inspecciones no se tocaron: ni las cerradas ni las que estan en curso.
  // Cada una sigue con el `formularioVersionId` con el que nacio.
  return nueva
}

const formularios: RepositorioFormularios = {
  tiposInspeccion: listarTiposInspeccion,
  tipoInspeccion: obtenerTipoInspeccion,
  formularioVersion: obtenerFormularioVersion,
  versiones: listarVersiones,
  borradores: listarBorradores,
  borrador: obtenerBorrador,
  abrirBorrador,
  guardarBorrador,
  descartarBorrador,
  publicarBorrador,
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

  await store.put(aDatoPlano(fusionada))
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
  await tx.objectStore('respuestas').put(aDatoPlano(respuesta))
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
  await tx.objectStore('evidencias').put(aDatoPlano(completa))
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
  await tx.objectStore('firmas').put(aDatoPlano(firma))
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
  await tx.objectStore('actas').put(aDatoPlano(acta))
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

// ── Reclamos ──────────────────────────────────────────────────────────

/**
 * Alfabeto del codigo de seguimiento.
 *
 * Faltan la I, la L, la O, el 0 y el 1 a proposito: el codigo se dicta por
 * telefono y se anota en un papel. «Cero» y «o», «uno», «i» y «ele» son la
 * fuente de casi todos los errores de transcripcion, y un codigo mal anotado
 * es un vecino que no puede consultar lo suyo.
 */
const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const LARGO_CODIGO = 4
const PREFIJO_CODIGO = 'RC-'

/** Cuantas veces se vuelve a sortear si el codigo ya estaba tomado. */
const INTENTOS_CODIGO = 8

/** Estados del reclamo en el orden en que ocurren. La linea de tiempo del vecino. */
const ORDEN_ESTADO: EstadoReclamo[] = ['recibido', 'asignado', 'inspeccionado', 'resuelto']

/** Como se nombra cada paso en la pantalla publica. Nada de jerga del organismo. */
const TITULO_PASO: Record<EstadoReclamo, string> = {
  recibido: 'Recibido',
  asignado: 'Asignado a un inspector',
  inspeccionado: 'Inspeccionado',
  resuelto: 'Resuelto',
}

function sortearCodigo(): string {
  const valores = new Uint32Array(LARGO_CODIGO)
  crypto.getRandomValues(valores)
  let cuerpo = ''
  for (const valor of valores) cuerpo += ALFABETO_CODIGO[valor % ALFABETO_CODIGO.length]
  return PREFIJO_CODIGO + cuerpo
}

/**
 * Deja el codigo como se guardo, venga como venga escrito.
 *
 * Se aceptan minusculas, espacios, guiones de mas y la falta del prefijo,
 * porque quien consulta lo esta copiando de un papel. Lo que NO se hace es
 * adivinar: como el alfabeto no tiene I, L, O, 0 ni 1, un codigo que las trae
 * esta mal transcripto y no hay a que letra mapearlo sin equivocarse. Es
 * preferible decir que no se encontro a mostrarle a alguien el reclamo de otro.
 */
export function normalizarCodigoReclamo(texto: string): string {
  const limpio = texto.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const cuerpo = limpio.startsWith('RC') ? limpio.slice(2) : limpio
  return PREFIJO_CODIGO + cuerpo
}

/** El indice unico rechazo el codigo: hay que sortear otro. */
function esCodigoTomado(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'ConstraintError'
}

function limpiarContacto(contacto?: ContactoReclamo): ContactoReclamo | undefined {
  const nombre = contacto?.nombre?.trim()
  const telefono = contacto?.telefono?.trim()
  // Un reclamo anonimo entra igual: guardar un contacto vacio solo ensucia.
  if (!nombre && !telefono) return undefined
  return { nombre: nombre || undefined, telefono: telefono || undefined }
}

/**
 * En que paso del reclamo se traduce el estado de su inspeccion.
 *
 * `conforme` significa que no quedo nada por corregir: para el vecino el
 * tramite termino. Con observaciones o no conforme el problema se constato
 * pero todavia hay que arreglarlo, y decirle «resuelto» seria exactamente la
 * disculpa que este circuito viene a evitar.
 */
function estadoSegunInspeccion(inspeccion: Inspeccion): EstadoReclamo {
  switch (inspeccion.estado) {
    case 'asignada':
    case 'en_campo':
      return 'asignado'
    case 'cerrada':
      return inspeccion.resultado === 'conforme' ? 'resuelto' : 'inspeccionado'
    case 'vencida':
      // Vencida quiere decir que el plazo se paso, no que nadie fue nunca.
      return 'inspeccionado'
    default:
      // `pendiente`: la orden existe pero todavia no la tomo nadie.
      return 'recibido'
  }
}

function fechaDelPaso(estado: EstadoReclamo, inspeccion: Inspeccion): FechaHora {
  if (estado === 'asignado') return inspeccion.actualizadaEn
  return inspeccion.ejecutadaEn ?? inspeccion.actualizadaEn
}

/**
 * Pone al dia el reclamo contra el estado real de su inspeccion.
 *
 * Se hace al consultar y no cuando la inspeccion cambia, para que el vecino
 * nunca vea un estado viejo por culpa de que alguien se olvido de empujar el
 * cambio. Los hitos son historia: solo se agregan. Si una inspeccion se
 * reabre y vuelve para atras, lo que ya se le informo al vecino sigue habiendo
 * pasado, asi que la linea de tiempo no retrocede.
 */
async function ponerAlDia(reclamo: Reclamo): Promise<Reclamo> {
  if (!reclamo.inspeccionUuid) return reclamo

  const inspeccion = await obtenerInspeccion(reclamo.inspeccionUuid)
  if (!inspeccion) return reclamo

  const destino = estadoSegunInspeccion(inspeccion)
  const desdeIndice = ORDEN_ESTADO.indexOf(reclamo.estado)
  const hastaIndice = ORDEN_ESTADO.indexOf(destino)
  if (hastaIndice <= desdeIndice) return reclamo

  // Se rellenan tambien los pasos salteados: una inspeccion puede pasar de
  // pendiente a cerrada de un tiron, y el vecino tiene que ver la escalera
  // completa, no un hueco.
  const hitos = [...reclamo.hitos]
  let anterior = hitos[hitos.length - 1]?.ocurridoEn ?? reclamo.creadoEn
  for (let i = desdeIndice + 1; i <= hastaIndice; i += 1) {
    const estado = ORDEN_ESTADO[i]
    // Ningun paso puede figurar antes que el anterior. Puede pasar cuando se
    // engancha un reclamo con una inspeccion que ya venia hecha de antes, y una
    // linea de tiempo que va para atras no se le explica a nadie.
    const propuesta = fechaDelPaso(estado, inspeccion)
    const ocurridoEn = propuesta > anterior ? propuesta : anterior
    hitos.push({ estado, ocurridoEn })
    anterior = ocurridoEn
  }

  const actualizado: Reclamo = {
    ...reclamo,
    estado: destino,
    hitos,
    actualizadoEn: ahora(),
  }
  const bd = await abrirBd()
  await bd.put('reclamos', aDatoPlano(actualizado))
  return actualizado
}

async function listarReclamos(filtro?: FiltroReclamos): Promise<Reclamo[]> {
  const bd = await abrirBd()

  let reclamos = typeof filtro?.estado === 'string'
    ? await bd.getAllFromIndex('reclamos', 'porEstado', filtro.estado)
    : await bd.getAll('reclamos')

  if (filtro?.estado) {
    const estados = new Set(Array.isArray(filtro.estado) ? filtro.estado : [filtro.estado])
    reclamos = reclamos.filter((r) => estados.has(r.estado))
  }

  if (filtro?.sinInspeccion) {
    reclamos = reclamos.filter((r) => !r.inspeccionUuid)
  }

  // Lo mas nuevo arriba: quien atiende el telefono mira lo que acaba de entrar.
  return reclamos.sort((a, b) => b.creadoEn.localeCompare(a.creadoEn))
}

async function obtenerReclamo(id: Uuid): Promise<Reclamo | undefined> {
  const bd = await abrirBd()
  return bd.get('reclamos', id)
}

async function reclamoPorCodigo(codigo: string): Promise<Reclamo | undefined> {
  const buscado = normalizarCodigoReclamo(codigo)
  if (buscado.length !== PREFIJO_CODIGO.length + LARGO_CODIGO) return undefined
  const bd = await abrirBd()
  return bd.getFromIndex('reclamos', 'porCodigo', buscado)
}

async function reclamoPorInspeccion(inspeccionUuid: Uuid): Promise<Reclamo | undefined> {
  const bd = await abrirBd()
  return bd.getFromIndex('reclamos', 'porInspeccion', inspeccionUuid)
}

async function registrarReclamo(datos: DatosNuevoReclamo): Promise<Reclamo> {
  const organismo = await organismoActual()
  const bd = await abrirBd()
  const momento = ahora()

  const base: Omit<Reclamo, 'codigo'> = {
    id: nuevoUuid(),
    organismoId: organismo.id,
    descripcion: datos.descripcion.trim(),
    ubicacion: datos.ubicacion,
    referencia: datos.referencia?.trim() || undefined,
    contacto: limpiarContacto(datos.contacto),
    estado: 'recibido',
    objetoId: datos.objetoId,
    hitos: [{ estado: 'recibido', ocurridoEn: momento }],
    creadoEn: momento,
    actualizadoEn: momento,
  }

  // La unicidad la garantiza el indice, no este bucle: se usa `add` (y no
  // `put`) para que un codigo ya tomado FALLE en vez de pisar el reclamo de
  // otra persona. Con 31^4 combinaciones la colision es rarisima, pero
  // «rarisima» no es «imposible» y aca lo que se pisaria es el tramite de
  // alguien.
  for (let intento = 0; intento < INTENTOS_CODIGO; intento += 1) {
    const reclamo: Reclamo = { ...base, codigo: sortearCodigo() }
    try {
      await bd.add('reclamos', aDatoPlano(reclamo))
      return reclamo
    } catch (error) {
      if (!esCodigoTomado(error)) throw error
    }
  }

  throw new Error('No se pudo generar un código de seguimiento libre')
}

/**
 * El enganche del circuito.
 *
 * No mueve el estado del reclamo: eso lo deriva `ponerAlDia()` de la
 * inspeccion. Vincular una inspeccion recien creada, todavia sin asignar, no
 * cambia nada de lo que ve el vecino, y esta bien que asi sea.
 *
 * Quien llame a esto es el responsable de anotar el evento de auditoria, igual
 * que hace cada vista con las altas.
 */
async function vincularInspeccion(id: Uuid, inspeccionUuid: Uuid): Promise<Reclamo> {
  const bd = await abrirBd()
  const tx = bd.transaction('reclamos', 'readwrite')
  const store = tx.objectStore('reclamos')

  const previo = await store.get(id)
  if (!previo) {
    await tx.done
    throw new Error(`No hay ningún reclamo con el id ${id}`)
  }

  // Idempotente: vincular dos veces la misma inspeccion no agrega nada.
  if (previo.inspeccionUuid === inspeccionUuid) {
    await tx.done
    return previo
  }

  const actualizado: Reclamo = { ...previo, inspeccionUuid, actualizadoEn: ahora() }
  await store.put(actualizado)
  await tx.done

  // El reclamo NO se encola: `ItemCola['tipo']` todavia no tiene un valor
  // 'reclamo' y ese tipo vive en dominio/tipos.ts. Mientras tanto el reclamo
  // viaja pegado a su inspeccion, que si esta encolada.
  return ponerAlDia(actualizado)
}

async function seguimientoReclamo(codigo: string): Promise<SeguimientoReclamo | undefined> {
  const encontrado = await reclamoPorCodigo(codigo)
  if (!encontrado) return undefined

  const reclamo = await ponerAlDia(encontrado)

  let resultado: ResultadoVisible | undefined
  let plazoHasta: FechaHora | undefined

  if (reclamo.inspeccionUuid) {
    const inspeccion = await obtenerInspeccion(reclamo.inspeccionUuid)
    if (inspeccion?.resultado) {
      resultado = inspeccion.resultado === 'conforme' ? 'sin_hallazgos' : 'requiere_correccion'
    }
    if (resultado === 'requiere_correccion') {
      // Del acta se toma UNICAMENTE la fecha limite. Ni el numero, ni el
      // encuadre normativo, ni el PDF, ni quien es el responsable notificado:
      // al vecino le sirve saber hasta cuando hay plazo para que se corrija lo
      // que el reporto, y nada mas que eso.
      const acta = await obtenerActa(reclamo.inspeccionUuid)
      plazoHasta = acta?.plazoSubsanacion
    }
  }

  const pasos: PasoSeguimiento[] = ORDEN_ESTADO.map((estado) => {
    const hito = reclamo.hitos.find((h) => h.estado === estado)
    return {
      estado,
      titulo: TITULO_PASO[estado],
      cumplido: hito !== undefined,
      ocurridoEn: hito?.ocurridoEn,
    }
  })

  // Se devuelve un objeto armado a mano y no el reclamo entero: asi la vista
  // publica no tiene forma de mostrar el contacto de quien reclamo, el id
  // interno ni el uuid de la inspeccion aunque quisiera.
  return {
    codigo: reclamo.codigo,
    descripcion: reclamo.descripcion,
    ubicacion: reclamo.ubicacion,
    referencia: reclamo.referencia,
    estado: reclamo.estado,
    pasos,
    hayInspeccion: reclamo.inspeccionUuid !== undefined,
    resultado,
    plazoHasta,
    creadoEn: reclamo.creadoEn,
    actualizadoEn: reclamo.actualizadoEn,
  }
}

const reclamos: RepositorioReclamos = {
  listar: listarReclamos,
  obtener: obtenerReclamo,
  porCodigo: reclamoPorCodigo,
  porInspeccion: reclamoPorInspeccion,
  registrar: registrarReclamo,
  vincularInspeccion,
  seguimiento: seguimientoReclamo,
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
    await bd.add('auditoria', aDatoPlano(completo))
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
  reclamos,
  auditoria,
  cola,
  prepararDatosIniciales,
  reiniciar,
}
