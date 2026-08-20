<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
/**
 * Planificacion y asignacion. La pantalla del supervisor.
 *
 * Esta es la pantalla que decide que se hace mañana, y reemplaza al grupo de
 * WhatsApp donde hoy se reparte el trabajo. Tres decisiones la ordenan:
 *
 *  1. Lo primero que se ve es lo que hace mas tiempo que nadie mira. Un plan de
 *     inspeccion sirve para eso: para que ningun objeto quede olvidado. Por eso
 *     la lista arranca ordenada por antiguedad y no por nombre.
 *  2. Nunca se crea una tanda a ciegas. Antes de confirmar se muestra la lista
 *     exacta de lo que se va a crear, a quien y para cuando. Crear treinta
 *     inspecciones de mas cuesta muchisimo mas deshacerlo que revisarlo antes.
 *  3. Si un objeto ya tiene una inspeccion abierta del mismo tipo, no se
 *     duplica en silencio: se avisa y decide el supervisor.
 *
 * Se usa sentada en un escritorio, con mouse: puede tener tablas y seleccion
 * multiple. Pero el director la abre desde el telefono para mirar la carga del
 * equipo, asi que todo refluye a una columna y las tablas scrollean solas.
 */

import { computed, onMounted, ref } from 'vue'
import { almacen } from '@/datos/almacen'
import type {
  EstadoInspeccion, FechaHora, Inspeccion, ObjetoInspeccionable, Prioridad,
  TipoInspeccion, TipoObjeto, Uuid, Zona,
} from '@/dominio/tipos'
import { ahora, formatearFecha, nuevoUuid } from '@/dominio/utilidades'

const DIA = 86_400_000

/** Mientras no haya sesion, lo que se audita queda a nombre del rol. */
const ACTOR = 'supervisor'

/** Una inspeccion sigue viva mientras no se cierre. */
const ABIERTOS: EstadoInspeccion[] = ['pendiente', 'asignada', 'en_campo', 'vencida']

const NOMBRE_PRIORIDAD: Record<Prioridad, string> = {
  urgente: 'Urgente',
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
}

const NOMBRE_ESTADO: Record<EstadoInspeccion, string> = {
  pendiente: 'Sin asignar',
  asignada: 'Asignada',
  en_campo: 'En campo',
  cerrada: 'Cerrada',
  vencida: 'Vencida',
}

const PRIORIDADES: Prioridad[] = ['urgente', 'alta', 'media', 'baja']

const ANTIGUEDADES = [
  { clave: 'todos', texto: 'Todos' },
  { clave: 'nunca', texto: 'Nunca inspeccionados' },
  { clave: '90', texto: 'Hace más de 90 días' },
  { clave: '180', texto: 'Hace más de 6 meses' },
  { clave: '365', texto: 'Hace más de 1 año' },
] as const

type ClaveAntiguedad = (typeof ANTIGUEDADES)[number]['clave']
type Pestana = 'plan' | 'equipo'

// ── Estado ────────────────────────────────────────────────────────────

const objetos = ref<ObjetoInspeccionable[]>([])
const zonas = ref<Zona[]>([])
const tiposObjeto = ref<TipoObjeto[]>([])
const tiposInspeccion = ref<TipoInspeccion[]>([])
const inspecciones = ref<Inspeccion[]>([])

const cargando = ref(true)
const problema = ref('')
const aviso = ref('')

const pestana = ref<Pestana>('plan')

// Filtros de la lista de objetos.
const filtroTipoObjeto = ref<Uuid | ''>('')
const filtroZona = ref<Uuid | ''>('')
const filtroTexto = ref('')
const filtroAntiguedad = ref<ClaveAntiguedad>('todos')

// Seleccion de objetos para la tanda. Se reasigna entera para que Vue la vea.
const seleccion = ref<Set<Uuid>>(new Set())

// Formulario de la tanda.
const tandaTipoId = ref<Uuid | ''>('')
const tandaAsignado = ref('')
const tandaPrioridad = ref<Prioridad>('media')
const tandaFecha = ref(fechaLocal(new Date(Date.now() + DIA)))

const confirmando = ref(false)
const duplicadosAceptados = ref<Set<Uuid>>(new Set())
const creando = ref(false)

// Reasignacion.
const filtroInspector = ref('')
const reasignados = ref<Set<Uuid>>(new Set())
const destinoReasignacion = ref('')
const confirmandoReasignacion = ref(false)
const reasignando = ref(false)

// ── Utilidades locales ────────────────────────────────────────────────

/** Fecha en formato del `input type="date"`, en hora local y no en UTC. */
function fechaLocal(d: Date): string {
  const dosDigitos = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`
}

/** El dia elegido, a las 9 de la mañana: la jornada empieza ahi, no a medianoche. */
function comienzoDeJornada(fecha: string): FechaHora {
  return new Date(`${fecha}T09:00:00`).toISOString()
}

function esAbierta(i: Inspeccion): boolean {
  return ABIERTOS.includes(i.estado)
}

/**
 * Se paso la fecha y todavia no se cerro. El corte es el FIN del dia
 * programado, igual que en la lista del inspector: una inspeccion agendada
 * para hoy se trabaja durante todo el dia.
 */
function estaVencida(i: Inspeccion): boolean {
  if (i.estado === 'vencida') return true
  if (!esAbierta(i) || !i.programadaPara) return false
  const limite = new Date(i.programadaPara)
  limite.setHours(23, 59, 59, 999)
  return limite.getTime() < Date.now()
}

function haceCuanto(f: FechaHora | undefined): string {
  if (!f) return 'Nunca'
  const dias = Math.floor((Date.now() - new Date(f).getTime()) / DIA)
  if (dias <= 0) return 'Hoy'
  if (dias === 1) return 'Ayer'
  if (dias < 60) return `Hace ${dias} días`
  const meses = Math.floor(dias / 30)
  if (meses < 24) return `Hace ${meses} meses`
  return `Hace ${Math.floor(dias / 365)} años`
}

function diasDesde(f: FechaHora | undefined): number {
  if (!f) return Number.POSITIVE_INFINITY
  return Math.floor((Date.now() - new Date(f).getTime()) / DIA)
}

/** `ines.rodriguez` se lee mejor como `Ines Rodriguez`. El usuario queda de título. */
function nombreInspector(usuario: string): string {
  if (!usuario) return 'Sin asignar'
  return usuario
    .split(/[._-]+/)
    .filter(Boolean)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(' ')
}

function nombreTipoObjeto(id: Uuid): string {
  return tiposObjeto.value.find((t) => t.id === id)?.nombre ?? 'Sin tipo'
}

function nombreZona(id: Uuid | undefined): string {
  if (!id) return 'Sin zona'
  return zonas.value.find((z) => z.id === id)?.nombre ?? 'Sin zona'
}

function nombreTipoInspeccion(id: Uuid): string {
  return tiposInspeccion.value.find((t) => t.id === id)?.nombre ?? 'Inspección'
}

// ── Carga ─────────────────────────────────────────────────────────────

async function cargar() {
  cargando.value = true
  problema.value = ''
  try {
    const [listaObjetos, listaZonas, listaTiposObjeto, listaTiposInspeccion, listaInspecciones] =
      await Promise.all([
        almacen.territorio.objetos(),
        almacen.territorio.zonas(),
        almacen.territorio.tiposObjeto(),
        almacen.formularios.tiposInspeccion(),
        almacen.inspecciones.listar(),
      ])

    objetos.value = listaObjetos
    zonas.value = listaZonas
    tiposObjeto.value = listaTiposObjeto
    tiposInspeccion.value = listaTiposInspeccion
    inspecciones.value = listaInspecciones

    if (!tandaTipoId.value) tandaTipoId.value = listaTiposInspeccion[0]?.id ?? ''
  } catch {
    problema.value = 'No se pudieron leer los datos guardados en este dispositivo.'
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

// ── Que falta inspeccionar ────────────────────────────────────────────

/** Ultima inspeccion cerrada de cada objeto: es la que cuenta como "lo miraron". */
const ultimaCerradaPorObjeto = computed(() => {
  const mapa = new Map<Uuid, Inspeccion>()
  for (const i of inspecciones.value) {
    if (i.estado !== 'cerrada') continue
    const previa = mapa.get(i.objetoId)
    const fecha = i.ejecutadaEn ?? i.actualizadaEn
    if (!previa || fecha > (previa.ejecutadaEn ?? previa.actualizadaEn)) mapa.set(i.objetoId, i)
  }
  return mapa
})

const abiertasPorObjeto = computed(() => {
  const mapa = new Map<Uuid, Inspeccion[]>()
  for (const i of inspecciones.value) {
    if (!esAbierta(i)) continue
    const lista = mapa.get(i.objetoId)
    if (lista) lista.push(i)
    else mapa.set(i.objetoId, [i])
  }
  return mapa
})

interface FilaObjeto {
  objeto: ObjetoInspeccionable
  ultima: FechaHora | undefined
  dias: number
  abiertas: Inspeccion[]
}

const filas = computed<FilaObjeto[]>(() => {
  const texto = filtroTexto.value.trim().toLowerCase()

  return objetos.value
    .filter((o) => o.estado !== 'baja')
    .filter((o) => !filtroTipoObjeto.value || o.tipoObjetoId === filtroTipoObjeto.value)
    .filter((o) => !filtroZona.value || o.zonaId === filtroZona.value)
    .filter((o) =>
      !texto ||
      o.denominacion.toLowerCase().includes(texto) ||
      o.codigo.toLowerCase().includes(texto) ||
      o.direccion.toLowerCase().includes(texto),
    )
    .map<FilaObjeto>((o) => {
      const cerrada = ultimaCerradaPorObjeto.value.get(o.id)
      const ultima = cerrada?.ejecutadaEn ?? cerrada?.actualizadaEn
      return {
        objeto: o,
        ultima,
        dias: diasDesde(ultima),
        abiertas: abiertasPorObjeto.value.get(o.id) ?? [],
      }
    })
    .filter((f) => {
      switch (filtroAntiguedad.value) {
        case 'nunca': return f.ultima === undefined
        case '90': return f.dias > 90
        case '180': return f.dias > 180
        case '365': return f.dias > 365
        default: return true
      }
    })
    // Lo que hace mas tiempo que nadie mira, primero. Es el motivo de la pantalla.
    .sort((a, b) => b.dias - a.dias || a.objeto.denominacion.localeCompare(b.objeto.denominacion))
})

const hayFiltros = computed(
  () =>
    filtroTipoObjeto.value !== '' ||
    filtroZona.value !== '' ||
    filtroAntiguedad.value !== 'todos' ||
    filtroTexto.value.trim() !== '',
)

function limpiarFiltros() {
  filtroTipoObjeto.value = ''
  filtroZona.value = ''
  filtroAntiguedad.value = 'todos'
  filtroTexto.value = ''
}

// ── Seleccion ─────────────────────────────────────────────────────────

function estaSeleccionado(id: Uuid): boolean {
  return seleccion.value.has(id)
}

function alternar(id: Uuid) {
  const copia = new Set(seleccion.value)
  if (copia.has(id)) copia.delete(id)
  else copia.add(id)
  seleccion.value = copia
  aviso.value = ''
}

const todosVisiblesSeleccionados = computed(
  () => filas.value.length > 0 && filas.value.every((f) => seleccion.value.has(f.objeto.id)),
)

function alternarVisibles() {
  const copia = new Set(seleccion.value)
  if (todosVisiblesSeleccionados.value) {
    for (const f of filas.value) copia.delete(f.objeto.id)
  } else {
    for (const f of filas.value) copia.add(f.objeto.id)
  }
  seleccion.value = copia
}

function limpiarSeleccion() {
  seleccion.value = new Set()
}

const objetosSeleccionados = computed(() =>
  objetos.value.filter((o) => seleccion.value.has(o.id)),
)

// ── Vista previa de la tanda ──────────────────────────────────────────

type MotivoFila = 'nueva' | 'duplicada' | 'no_aplica'

interface FilaPrevia {
  objeto: ObjetoInspeccionable
  motivo: MotivoFila
  abierta?: Inspeccion
}

const tipoElegido = computed(() =>
  tiposInspeccion.value.find((t) => t.id === tandaTipoId.value),
)

const previa = computed<FilaPrevia[]>(() => {
  const tipo = tipoElegido.value
  if (!tipo) return []

  return objetosSeleccionados.value.map<FilaPrevia>((objeto) => {
    if (!tipo.tipoObjetoIds.includes(objeto.tipoObjetoId)) {
      return { objeto, motivo: 'no_aplica' }
    }
    const abierta = (abiertasPorObjeto.value.get(objeto.id) ?? []).find(
      (i) => i.tipoInspeccionId === tipo.id,
    )
    if (abierta) return { objeto, motivo: 'duplicada', abierta }
    return { objeto, motivo: 'nueva' }
  })
})

const nuevas = computed(() => previa.value.filter((f) => f.motivo === 'nueva'))
const duplicadas = computed(() => previa.value.filter((f) => f.motivo === 'duplicada'))
const noAplican = computed(() => previa.value.filter((f) => f.motivo === 'no_aplica'))

/** Lo que realmente se va a crear si el supervisor confirma. */
const aCrear = computed(() =>
  previa.value.filter(
    (f) =>
      f.motivo === 'nueva' ||
      (f.motivo === 'duplicada' && duplicadosAceptados.value.has(f.objeto.id)),
  ),
)

function alternarDuplicado(id: Uuid) {
  const copia = new Set(duplicadosAceptados.value)
  if (copia.has(id)) copia.delete(id)
  else copia.add(id)
  duplicadosAceptados.value = copia
}

function abrirConfirmacion() {
  if (!tipoElegido.value || seleccion.value.size === 0) return
  duplicadosAceptados.value = new Set()
  aviso.value = ''
  confirmando.value = true
}

function cerrarConfirmacion() {
  confirmando.value = false
}

async function crearTanda() {
  const tipo = tipoElegido.value
  const lista = aCrear.value
  if (!tipo || lista.length === 0 || creando.value) return

  creando.value = true
  problema.value = ''

  const momento = ahora()
  const programada = comienzoDeJornada(tandaFecha.value)
  const asignado = tandaAsignado.value || undefined

  try {
    for (const fila of lista) {
      const inspeccion: Inspeccion = {
        uuid: nuevoUuid(),
        organismoId: fila.objeto.organismoId,
        objetoId: fila.objeto.id,
        tipoInspeccionId: tipo.id,
        // Se congela contra que version del formulario se va a trabajar: un acta
        // vieja tiene que poder reconstruirse tal cual se emitio.
        formularioVersionId: tipo.formularioVersionId,
        origen: 'plan',
        estado: asignado ? 'asignada' : 'pendiente',
        prioridad: tandaPrioridad.value,
        asignadoA: asignado,
        programadaPara: programada,
        creadaEn: momento,
        actualizadaEn: momento,
      }

      await almacen.inspecciones.guardar(inspeccion)
      await almacen.auditoria.registrar({
        organismoId: fila.objeto.organismoId,
        entidad: 'inspeccion',
        entidadId: inspeccion.uuid,
        accion: 'inspeccion_planificada',
        detalle:
          `${tipo.nombre} sobre ${fila.objeto.codigo} para el ${formatearFecha(programada)}` +
          ` · ${asignado ? nombreInspector(asignado) : 'sin asignar'}` +
          ` · prioridad ${NOMBRE_PRIORIDAD[tandaPrioridad.value].toLowerCase()}`,
        actor: ACTOR,
      })
    }

    const cuantas = lista.length
    aviso.value =
      `Se ${cuantas === 1 ? 'creó 1 inspección' : `crearon ${cuantas} inspecciones`}` +
      ` de ${tipo.nombre} para el ${formatearFecha(programada)}` +
      (asignado ? `, a nombre de ${nombreInspector(asignado)}.` : ', todavía sin asignar.')

    confirmando.value = false
    limpiarSeleccion()
    duplicadosAceptados.value = new Set()
    await cargar()
  } catch {
    problema.value =
      'No se pudieron guardar todas las inspecciones. Revisá la lista y volvé a intentar.'
  } finally {
    creando.value = false
  }
}

// ── Carga del equipo ──────────────────────────────────────────────────

/** Los inspectores salen de lo que ya existe en los datos, no de un padrón aparte. */
const inspectores = computed(() => {
  const nombres = new Set<string>()
  for (const i of inspecciones.value) {
    if (i.asignadoA) nombres.add(i.asignadoA)
  }
  return [...nombres].sort((a, b) => a.localeCompare(b))
})

interface CargaInspector {
  usuario: string
  abiertas: number
  vencidas: number
  estaSemana: number
  cerradasMes: number
}

const cargaEquipo = computed<CargaInspector[]>(() => {
  const limiteSemana = Date.now() + 7 * DIA
  const limiteMes = Date.now() - 30 * DIA

  return inspectores.value
    .map<CargaInspector>((usuario) => {
      const suyas = inspecciones.value.filter((i) => i.asignadoA === usuario)
      const abiertas = suyas.filter(esAbierta)
      return {
        usuario,
        abiertas: abiertas.length,
        vencidas: abiertas.filter(estaVencida).length,
        estaSemana: abiertas.filter(
          (i) => i.programadaPara && new Date(i.programadaPara).getTime() <= limiteSemana,
        ).length,
        cerradasMes: suyas.filter(
          (i) =>
            i.estado === 'cerrada' &&
            new Date(i.ejecutadaEn ?? i.actualizadaEn).getTime() >= limiteMes,
        ).length,
      }
    })
    .sort((a, b) => b.abiertas - a.abiertas)
})

const sinAsignar = computed(() =>
  inspecciones.value.filter((i) => esAbierta(i) && !i.asignadoA),
)

/** Referencia para dibujar las barras: la mochila mas pesada del equipo. */
const cargaMaxima = computed(() =>
  Math.max(1, ...cargaEquipo.value.map((c) => c.abiertas), sinAsignar.value.length),
)

function anchoBarra(valor: number): string {
  return `${Math.round((valor / cargaMaxima.value) * 100)}%`
}

// ── Reasignacion ──────────────────────────────────────────────────────

/** Solo se mueve lo que todavia no se cerro: lo cerrado ya tiene dueño histórico. */
const reasignables = computed(() =>
  inspecciones.value
    .filter(esAbierta)
    .filter((i) => !filtroInspector.value || (i.asignadoA ?? '') === filtroInspector.value)
    .sort((a, b) =>
      (a.programadaPara ?? a.creadaEn).localeCompare(b.programadaPara ?? b.creadaEn),
    ),
)

function objetoDe(i: Inspeccion): ObjetoInspeccionable | undefined {
  return objetos.value.find((o) => o.id === i.objetoId)
}

function alternarReasignacion(uuid: Uuid) {
  const copia = new Set(reasignados.value)
  if (copia.has(uuid)) copia.delete(uuid)
  else copia.add(uuid)
  reasignados.value = copia
  aviso.value = ''
}

const todasReasignablesElegidas = computed(
  () =>
    reasignables.value.length > 0 &&
    reasignables.value.every((i) => reasignados.value.has(i.uuid)),
)

function alternarTodasReasignables() {
  const copia = new Set(reasignados.value)
  if (todasReasignablesElegidas.value) {
    for (const i of reasignables.value) copia.delete(i.uuid)
  } else {
    for (const i of reasignables.value) copia.add(i.uuid)
  }
  reasignados.value = copia
}

function vaciarReasignacion() {
  reasignados.value = new Set()
}

const aMover = computed(() => reasignables.value.filter((i) => reasignados.value.has(i.uuid)))

/** Mover a alguien lo que ya es suyo no es un movimiento: no se cuenta. */
const aMoverEfectivas = computed(() =>
  aMover.value.filter((i) => (i.asignadoA ?? '') !== destinoReasignacion.value),
)

function abrirConfirmacionReasignacion() {
  if (!destinoReasignacion.value || aMoverEfectivas.value.length === 0) return
  aviso.value = ''
  confirmandoReasignacion.value = true
}

async function reasignar() {
  const destino = destinoReasignacion.value
  const lista = aMoverEfectivas.value
  if (!destino || lista.length === 0 || reasignando.value) return

  reasignando.value = true
  problema.value = ''

  try {
    for (const original of lista) {
      const anterior = original.asignadoA
      const movida: Inspeccion = {
        ...original,
        asignadoA: destino,
        // Lo que estaba sin dueño pasa a estar asignado; lo demas conserva su estado.
        estado: original.estado === 'pendiente' ? 'asignada' : original.estado,
        actualizadaEn: ahora(),
      }
      await almacen.inspecciones.guardar(movida)
      await almacen.auditoria.registrar({
        organismoId: original.organismoId,
        entidad: 'inspeccion',
        entidadId: original.uuid,
        accion: 'inspeccion_reasignada',
        detalle: `De ${anterior ? nombreInspector(anterior) : 'sin asignar'} a ${nombreInspector(destino)}`,
        actor: ACTOR,
      })
    }

    const cuantas = lista.length
    aviso.value =
      `Se ${cuantas === 1 ? 'movió 1 inspección' : `movieron ${cuantas} inspecciones`}` +
      ` a ${nombreInspector(destino)}.`

    confirmandoReasignacion.value = false
    vaciarReasignacion()
    await cargar()
  } catch {
    problema.value = 'No se pudo completar la reasignación. Volvé a intentar.'
  } finally {
    reasignando.value = false
  }
}
</script>

<template>
  <div class="pantalla">
    <div class="pestanas" role="tablist" aria-label="Secciones de planificación">
      <button
        type="button"
        role="tab"
        class="pestana"
        :class="{ 'pestana--activa': pestana === 'plan' }"
        :aria-selected="pestana === 'plan'"
        @click="pestana = 'plan'"
      >
        Qué falta inspeccionar
        <span class="cuenta">{{ filas.length }}</span>
      </button>
      <button
        type="button"
        role="tab"
        class="pestana"
        :class="{ 'pestana--activa': pestana === 'equipo' }"
        :aria-selected="pestana === 'equipo'"
        @click="pestana = 'equipo'"
      >
        Carga del equipo
        <span class="cuenta">{{ inspectores.length }}</span>
      </button>
    </div>

    <p v-if="aviso" class="nota nota--exito" role="status">{{ aviso }}</p>
    <p v-if="problema" class="nota nota--error" role="alert">{{ problema }}</p>

    <p v-if="cargando" class="vacio">Leyendo el territorio y el trabajo en curso…</p>

    <!-- ── Qué falta inspeccionar ─────────────────────────────────── -->
    <section v-else-if="pestana === 'plan'">
      <div class="filtros">
        <div class="campo campo--filtro">
          <label for="f-tipo">Tipo de objeto</label>
          <select id="f-tipo" v-model="filtroTipoObjeto">
            <option value="">Todos</option>
            <option v-for="t in tiposObjeto" :key="t.id" :value="t.id">{{ t.nombre }}</option>
          </select>
        </div>

        <div class="campo campo--filtro">
          <label for="f-zona">Zona</label>
          <select id="f-zona" v-model="filtroZona">
            <option value="">Todas</option>
            <option v-for="z in zonas" :key="z.id" :value="z.id">{{ z.nombre }}</option>
          </select>
        </div>

        <div class="campo campo--filtro">
          <label for="f-antiguedad">Última inspección</label>
          <select id="f-antiguedad" v-model="filtroAntiguedad">
            <option v-for="a in ANTIGUEDADES" :key="a.clave" :value="a.clave">{{ a.texto }}</option>
          </select>
        </div>

        <div class="campo campo--filtro campo--crece">
          <label for="f-texto">Buscar</label>
          <input
            id="f-texto"
            v-model="filtroTexto"
            type="search"
            placeholder="Código, nombre o dirección"
          />
        </div>

        <button
          v-if="hayFiltros"
          type="button"
          class="boton boton--secundario boton--filtro"
          @click="limpiarFiltros"
        >
          Limpiar filtros
        </button>
      </div>

      <p class="chico tenue resumen">
        {{ filas.length }} de {{ objetos.length }} objetos · arriba, lo que hace más tiempo que
        nadie inspecciona
      </p>

      <div v-if="filas.length === 0" class="vacio-util">
        <h2>Ningún objeto entra en ese filtro</h2>
        <p>Probá con otra zona, otro tipo de objeto o un período más corto.</p>
        <button
          v-if="hayFiltros"
          type="button"
          class="boton boton--secundario"
          @click="limpiarFiltros"
        >
          Limpiar filtros
        </button>
      </div>

      <div v-else class="tabla-envoltorio">
        <table class="tabla">
          <thead>
            <tr>
              <th class="col-marca">
                <input
                  type="checkbox"
                  :checked="todosVisiblesSeleccionados"
                  :aria-label="
                    todosVisiblesSeleccionados
                      ? 'Quitar de la selección todos los visibles'
                      : 'Seleccionar todos los visibles'
                  "
                  @change="alternarVisibles"
                />
              </th>
              <th>Objeto</th>
              <th class="col-opcional">Tipo</th>
              <th class="col-opcional">Zona</th>
              <th>Última inspección</th>
              <th>En curso</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="fila in filas"
              :key="fila.objeto.id"
              :class="{ 'fila--elegida': estaSeleccionado(fila.objeto.id) }"
              @click="alternar(fila.objeto.id)"
            >
              <td class="col-marca">
                <input
                  type="checkbox"
                  :checked="estaSeleccionado(fila.objeto.id)"
                  :aria-label="'Seleccionar ' + fila.objeto.denominacion"
                  @click.stop
                  @change="alternar(fila.objeto.id)"
                />
              </td>
              <td>
                <RouterLink class="enlace-objeto" :to="'/objeto/' + fila.objeto.id" @click.stop>
                  {{ fila.objeto.denominacion }}
                </RouterLink>
                <p class="chico tenue sub">{{ fila.objeto.codigo }} · {{ fila.objeto.direccion }}</p>
              </td>
              <td class="col-opcional">{{ nombreTipoObjeto(fila.objeto.tipoObjetoId) }}</td>
              <td class="col-opcional">{{ nombreZona(fila.objeto.zonaId) }}</td>
              <td>
                <span
                  class="antiguedad"
                  :class="{
                    'antiguedad--vieja': fila.dias > 365,
                    'antiguedad--media': fila.dias > 180 && fila.dias <= 365,
                  }"
                >
                  {{ haceCuanto(fila.ultima) }}
                </span>
                <p v-if="fila.ultima" class="chico tenue sub">{{ formatearFecha(fila.ultima) }}</p>
              </td>
              <td>
                <span v-if="fila.abiertas.length === 0" class="chico tenue">—</span>
                <span
                  v-for="i in fila.abiertas"
                  :key="i.uuid"
                  class="distintivo"
                  :class="'distintivo--' + (estaVencida(i) ? 'vencida' : i.estado)"
                >
                  {{ nombreTipoInspeccion(i.tipoInspeccionId) }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── Carga del equipo y reasignación ────────────────────────── -->
    <section v-else class="equipo">
      <h2 class="titulo-bloque">Cuánto tiene cada uno</h2>

      <div v-if="inspectores.length === 0" class="vacio-util">
        <h2>Todavía no hay trabajo repartido</h2>
        <p>
          Los nombres del equipo salen de las inspecciones ya asignadas. Creá una tanda para
          empezar a repartir.
        </p>
        <button type="button" class="boton" @click="pestana = 'plan'">
          Ver qué falta inspeccionar
        </button>
      </div>

      <ul v-else class="tarjetas">
        <li v-for="c in cargaEquipo" :key="c.usuario" class="tarjeta">
          <div class="fila">
            <span class="crece nombre" :title="c.usuario">{{ nombreInspector(c.usuario) }}</span>
            <span class="numerote">{{ c.abiertas }}</span>
          </div>
          <div class="barra">
            <span class="barra-relleno" :style="{ width: anchoBarra(c.abiertas) }" />
            <span
              v-if="c.vencidas > 0"
              class="barra-relleno barra-relleno--vencida"
              :style="{ width: anchoBarra(c.vencidas) }"
            />
          </div>
          <p class="chico tenue detalle">
            {{ c.abiertas }} abiertas ·
            <span :class="{ alerta: c.vencidas > 0 }">{{ c.vencidas }} vencidas</span> ·
            {{ c.estaSemana }} en los próximos 7 días · {{ c.cerradasMes }} cerradas en 30 días
          </p>
        </li>

        <li v-if="sinAsignar.length > 0" class="tarjeta tarjeta--huerfanas">
          <div class="fila">
            <span class="crece nombre">Sin asignar</span>
            <span class="numerote">{{ sinAsignar.length }}</span>
          </div>
          <div class="barra">
            <span
              class="barra-relleno barra-relleno--tenue"
              :style="{ width: anchoBarra(sinAsignar.length) }"
            />
          </div>
          <p class="chico tenue detalle">
            Inspecciones creadas que todavía no tienen dueño. Elegilas abajo y movelas a alguien.
          </p>
        </li>
      </ul>

      <h2 class="titulo-bloque">Mover trabajo de un inspector a otro</h2>

      <div class="filtros">
        <div class="campo campo--filtro">
          <label for="f-inspector">Ver las de</label>
          <select id="f-inspector" v-model="filtroInspector">
            <option value="">Todo el equipo</option>
            <option v-for="u in inspectores" :key="u" :value="u">{{ nombreInspector(u) }}</option>
          </select>
        </div>
      </div>

      <p v-if="reasignables.length === 0" class="vacio">No hay inspecciones abiertas para mover.</p>

      <div v-else class="tabla-envoltorio">
        <table class="tabla">
          <thead>
            <tr>
              <th class="col-marca">
                <input
                  type="checkbox"
                  :checked="todasReasignablesElegidas"
                  aria-label="Seleccionar todas las inspecciones visibles"
                  @change="alternarTodasReasignables"
                />
              </th>
              <th>Objeto</th>
              <th class="col-opcional">Inspección</th>
              <th>Asignada a</th>
              <th>Para el</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="i in reasignables"
              :key="i.uuid"
              :class="{ 'fila--elegida': reasignados.has(i.uuid) }"
              @click="alternarReasignacion(i.uuid)"
            >
              <td class="col-marca">
                <input
                  type="checkbox"
                  :checked="reasignados.has(i.uuid)"
                  :aria-label="
                    'Seleccionar la inspección de ' + (objetoDe(i)?.denominacion ?? 'objeto sin ficha')
                  "
                  @click.stop
                  @change="alternarReasignacion(i.uuid)"
                />
              </td>
              <td>
                <RouterLink class="enlace-objeto" :to="'/inspeccion/' + i.uuid" @click.stop>
                  {{ objetoDe(i)?.denominacion ?? 'Objeto sin ficha' }}
                </RouterLink>
                <p class="chico tenue sub">{{ objetoDe(i)?.direccion ?? '—' }}</p>
              </td>
              <td class="col-opcional">{{ nombreTipoInspeccion(i.tipoInspeccionId) }}</td>
              <td>{{ i.asignadoA ? nombreInspector(i.asignadoA) : 'Sin asignar' }}</td>
              <td :class="{ alerta: estaVencida(i) }">{{ formatearFecha(i.programadaPara) }}</td>
              <td>
                <span
                  class="distintivo"
                  :class="'distintivo--' + (estaVencida(i) ? 'vencida' : i.estado)"
                >
                  {{ estaVencida(i) ? 'Vencida' : NOMBRE_ESTADO[i.estado] }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── Barra de la tanda ──────────────────────────────────────── -->
    <div v-if="pestana === 'plan' && seleccion.size > 0" class="barra-accion">
      <div class="barra-accion-interior">
        <p class="elegidos">
          {{ seleccion.size }} {{ seleccion.size === 1 ? 'objeto elegido' : 'objetos elegidos' }}
          <button
            type="button"
            class="boton boton--fantasma boton--chico"
            @click="limpiarSeleccion"
          >
            Vaciar
          </button>
        </p>

        <div class="campos-tanda">
          <div class="campo campo--filtro">
            <label for="t-tipo">Tipo de inspección</label>
            <select id="t-tipo" v-model="tandaTipoId">
              <option v-for="t in tiposInspeccion" :key="t.id" :value="t.id">{{ t.nombre }}</option>
            </select>
          </div>

          <div class="campo campo--filtro">
            <label for="t-asignado">Asignar a</label>
            <select id="t-asignado" v-model="tandaAsignado">
              <option value="">Dejar sin asignar</option>
              <option v-for="u in inspectores" :key="u" :value="u">{{ nombreInspector(u) }}</option>
            </select>
          </div>

          <div class="campo campo--filtro">
            <label for="t-fecha">Para el día</label>
            <input id="t-fecha" v-model="tandaFecha" type="date" />
          </div>

          <div class="campo campo--filtro">
            <label for="t-prioridad">Prioridad</label>
            <select id="t-prioridad" v-model="tandaPrioridad">
              <option v-for="p in PRIORIDADES" :key="p" :value="p">{{ NOMBRE_PRIORIDAD[p] }}</option>
            </select>
          </div>

          <button
            type="button"
            class="boton boton--revisar"
            :disabled="!tipoElegido"
            @click="abrirConfirmacion"
          >
            Revisar y crear
          </button>
        </div>
      </div>
    </div>

    <!-- ── Barra de reasignación ──────────────────────────────────── -->
    <div v-if="pestana === 'equipo' && reasignados.size > 0" class="barra-accion">
      <div class="barra-accion-interior">
        <p class="elegidos">
          {{ reasignados.size }}
          {{ reasignados.size === 1 ? 'inspección elegida' : 'inspecciones elegidas' }}
          <button
            type="button"
            class="boton boton--fantasma boton--chico"
            @click="vaciarReasignacion"
          >
            Vaciar
          </button>
        </p>

        <div class="campos-tanda">
          <div class="campo campo--filtro campo--crece">
            <label for="r-destino">Mover a</label>
            <select id="r-destino" v-model="destinoReasignacion">
              <option value="">Elegí un inspector</option>
              <option v-for="u in inspectores" :key="u" :value="u">{{ nombreInspector(u) }}</option>
            </select>
          </div>

          <button
            type="button"
            class="boton boton--revisar"
            :disabled="!destinoReasignacion || aMoverEfectivas.length === 0"
            @click="abrirConfirmacionReasignacion"
          >
            Revisar y mover
          </button>
        </div>

        <p v-if="destinoReasignacion && aMoverEfectivas.length === 0" class="chico tenue">
          Todas las elegidas ya son de {{ nombreInspector(destinoReasignacion) }}.
        </p>
      </div>
    </div>

    <!-- ── Confirmación de la tanda ───────────────────────────────── -->
    <div v-if="confirmando" class="velo" @click.self="cerrarConfirmacion">
      <div class="dialogo" role="dialog" aria-modal="true" aria-labelledby="titulo-confirmacion">
        <h2 id="titulo-confirmacion">Antes de crear</h2>

        <dl class="resumen-tanda">
          <div>
            <dt class="etiqueta">Inspección</dt>
            <dd>{{ tipoElegido?.nombre }}</dd>
          </div>
          <div>
            <dt class="etiqueta">Asignada a</dt>
            <dd>{{ tandaAsignado ? nombreInspector(tandaAsignado) : 'Nadie todavía' }}</dd>
          </div>
          <div>
            <dt class="etiqueta">Para el día</dt>
            <dd>{{ formatearFecha(comienzoDeJornada(tandaFecha)) }}</dd>
          </div>
          <div>
            <dt class="etiqueta">Prioridad</dt>
            <dd>{{ NOMBRE_PRIORIDAD[tandaPrioridad] }}</dd>
          </div>
        </dl>

        <div class="dialogo-cuerpo">
          <template v-if="nuevas.length > 0">
            <h3 class="titulo-lista">Se van a crear ({{ nuevas.length }})</h3>
            <ul class="lista-previa">
              <li v-for="f in nuevas" :key="f.objeto.id">
                <span class="crece">{{ f.objeto.denominacion }}</span>
                <span class="chico tenue">{{ f.objeto.codigo }}</span>
              </li>
            </ul>
          </template>

          <template v-if="duplicadas.length > 0">
            <h3 class="titulo-lista titulo-lista--aviso">
              Ya tienen una inspección abierta del mismo tipo ({{ duplicadas.length }})
            </h3>
            <p class="chico tenue">
              No se crean salvo que lo pidas expresamente: duplicar una inspección abierta manda a
              dos personas al mismo lugar.
            </p>
            <ul class="lista-previa">
              <li v-for="f in duplicadas" :key="f.objeto.id">
                <label class="marca-duplicado">
                  <input
                    type="checkbox"
                    :checked="duplicadosAceptados.has(f.objeto.id)"
                    @change="alternarDuplicado(f.objeto.id)"
                  />
                  <span class="crece">
                    {{ f.objeto.denominacion }}
                    <span class="chico tenue">
                      · abierta
                      {{
                        f.abierta?.asignadoA
                          ? 'a nombre de ' + nombreInspector(f.abierta.asignadoA)
                          : 'sin asignar'
                      }}, para el {{ formatearFecha(f.abierta?.programadaPara) }}
                    </span>
                  </span>
                  <span class="chico">Crear igual</span>
                </label>
              </li>
            </ul>
          </template>

          <template v-if="noAplican.length > 0">
            <h3 class="titulo-lista titulo-lista--aviso">Se descartan ({{ noAplican.length }})</h3>
            <p class="chico tenue">
              {{ tipoElegido?.nombre }} no aplica a este tipo de objeto.
            </p>
            <ul class="lista-previa">
              <li v-for="f in noAplican" :key="f.objeto.id">
                <span class="crece">{{ f.objeto.denominacion }}</span>
                <span class="chico tenue">{{ nombreTipoObjeto(f.objeto.tipoObjetoId) }}</span>
              </li>
            </ul>
          </template>
        </div>

        <p class="total">
          <template v-if="aCrear.length > 0">
            Se crean <strong>{{ aCrear.length }}</strong>
            {{ aCrear.length === 1 ? 'inspección' : 'inspecciones' }}.
          </template>
          <template v-else>No queda ninguna inspección para crear con esta selección.</template>
        </p>

        <div class="dialogo-acciones">
          <button
            type="button"
            class="boton boton--secundario"
            :disabled="creando"
            @click="cerrarConfirmacion"
          >
            Volver atrás
          </button>
          <button
            type="button"
            class="boton"
            :disabled="creando || aCrear.length === 0"
            @click="crearTanda"
          >
            {{ creando ? 'Creando…' : 'Crear ' + aCrear.length }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Confirmación de la reasignación ────────────────────────── -->
    <div v-if="confirmandoReasignacion" class="velo" @click.self="confirmandoReasignacion = false">
      <div class="dialogo" role="dialog" aria-modal="true" aria-labelledby="titulo-reasignacion">
        <h2 id="titulo-reasignacion">Mover a {{ nombreInspector(destinoReasignacion) }}</h2>

        <div class="dialogo-cuerpo">
          <ul class="lista-previa">
            <li v-for="i in aMoverEfectivas" :key="i.uuid">
              <span class="crece">
                {{ objetoDe(i)?.denominacion ?? 'Objeto sin ficha' }}
                <span class="chico tenue">
                  · {{ i.asignadoA ? nombreInspector(i.asignadoA) : 'sin asignar' }} →
                  {{ nombreInspector(destinoReasignacion) }}
                </span>
              </span>
              <span class="chico tenue">{{ formatearFecha(i.programadaPara) }}</span>
            </li>
          </ul>
        </div>

        <p class="total">
          Se
          {{
            aMoverEfectivas.length === 1
              ? 'mueve 1 inspección'
              : 'mueven ' + aMoverEfectivas.length + ' inspecciones'
          }}.
        </p>

        <div class="dialogo-acciones">
          <button
            type="button"
            class="boton boton--secundario"
            :disabled="reasignando"
            @click="confirmandoReasignacion = false"
          >
            Volver atrás
          </button>
          <button type="button" class="boton" :disabled="reasignando" @click="reasignar">
            {{ reasignando ? 'Moviendo…' : 'Confirmar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pantalla {
  padding: 1rem;
  /* Deja aire para el pie de navegacion y para la barra de la tanda. */
  padding-bottom: calc(var(--alto-pie) + var(--seguro-abajo) + 15rem);
  max-width: 1100px;
  margin-inline: auto;
}

/* ── Pestañas ──────────────────────────────────────────────────── */

.pestanas {
  display: flex;
  gap: 0.4rem;
  overflow-x: auto;
  margin-bottom: 1rem;
}

.pestana {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 44px;
  padding: 0 0.9rem;
  white-space: nowrap;
  border: 1px solid var(--borde);
  border-radius: 999px;
  background: var(--superficie);
  color: var(--tinta);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}

.pestana--activa {
  background: var(--tinta);
  border-color: var(--tinta);
  color: var(--papel);
}

.cuenta { font-size: 0.75rem; font-weight: 700; opacity: 0.7; }

/* ── Avisos ────────────────────────────────────────────────────── */

.nota {
  margin: 0 0 1rem;
  padding: 0.6rem 0.75rem;
  border-radius: var(--radio-chico);
  font-size: 0.875rem;
  font-weight: 600;
}

.nota--error { background: var(--rojo-suave); color: var(--rojo); }
.nota--exito { background: var(--verde-suave); color: var(--verde); }
.alerta { color: var(--rojo); font-weight: 600; }

/* ── Filtros ───────────────────────────────────────────────────── */

.filtros {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.campo--filtro { margin-bottom: 0; min-width: 160px; }
.campo--crece { flex: 1; min-width: 200px; }
.boton--filtro { min-height: 48px; }
.resumen { margin: 0 0 0.75rem; }

/* ── Tabla ─────────────────────────────────────────────────────── */

.tabla-envoltorio {
  overflow-x: auto;
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: var(--radio);
}

.tabla {
  width: 100%;
  border-collapse: collapse;
  min-width: 620px;
}

.tabla th {
  padding: 0.6rem 0.75rem;
  text-align: left;
  background: var(--superficie-2);
  border-bottom: 1px solid var(--borde);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--apagado);
}

.tabla td {
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid var(--filete);
  vertical-align: top;
  cursor: pointer;
}

.tabla tbody tr:last-child td { border-bottom: none; }
.tabla tbody tr:hover td { background: var(--superficie-2); }
.fila--elegida td,
.fila--elegida:hover td { background: var(--verde-suave); }

.col-marca { width: 44px; }
.col-marca input { width: 20px; height: 20px; cursor: pointer; }

.sub { margin: 0.15rem 0 0; }
.enlace-objeto { color: var(--tinta); font-weight: 700; text-decoration: none; }
.enlace-objeto:hover { text-decoration: underline; }

.antiguedad { font-weight: 600; white-space: nowrap; }
.antiguedad--media { color: var(--ambar); }
.antiguedad--vieja { color: var(--rojo); }

.tabla .distintivo { margin: 0 0.25rem 0.25rem 0; }

/* ── Carga del equipo ──────────────────────────────────────────── */

.titulo-bloque { margin: 1.5rem 0 0.75rem; }
.equipo > .titulo-bloque:first-child { margin-top: 0; }

.tarjetas {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.75rem;
}

.nombre { font-weight: 700; }
.numerote { font-size: 1.5rem; font-weight: 700; font-variant-numeric: tabular-nums; }

/* Dos barras superpuestas: la carga total y, encima, cuanto de eso ya se
   paso de fecha. Se lee de un vistazo quien esta ahogado. */
.barra {
  position: relative;
  height: 10px;
  margin: 0.5rem 0 0.4rem;
  border-radius: 999px;
  background: var(--superficie-2);
  overflow: hidden;
}

.barra-relleno {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 999px;
  background: var(--estado-asignada);
}

.barra-relleno--vencida { background: var(--rojo); }
.barra-relleno--tenue { background: var(--apagado); }
.detalle { margin: 0; }
.tarjeta--huerfanas { border-style: dashed; }

/* ── Barra de acción ───────────────────────────────────────────── */

/* Fija abajo: el supervisor elige objetos scrolleando y la acción no puede
   quedar arriba de todo, fuera de la vista. */
.barra-accion {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(var(--alto-pie) + var(--seguro-abajo));
  z-index: 15;
  padding: 0.65rem 1rem;
  background: var(--superficie);
  border-top: 1px solid var(--borde);
  box-shadow: var(--sombra);
}

.barra-accion-interior { max-width: 1100px; margin-inline: auto; }

.elegidos {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.5rem;
  font-weight: 700;
}

.boton--chico {
  min-height: 32px;
  padding: 0 0.6rem;
  font-size: 0.8125rem;
  text-decoration: underline;
}

.campos-tanda {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.6rem;
}

.boton--revisar { min-height: 48px; flex: 1; min-width: 180px; }

/* ── Diálogo de confirmación ───────────────────────────────────── */

.velo {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(18, 33, 46, 0.55);
}

.dialogo {
  display: flex;
  flex-direction: column;
  width: min(640px, 100%);
  max-height: 90vh;
  padding: 1rem;
  background: var(--superficie);
  border-radius: var(--radio);
  box-shadow: var(--sombra);
}

.resumen-tanda {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.6rem;
  margin: 0.85rem 0;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid var(--filete);
}

.resumen-tanda dd { margin: 0.1rem 0 0; font-weight: 700; }

.dialogo-cuerpo { overflow-y: auto; flex: 1; }

.titulo-lista { margin: 0.85rem 0 0.4rem; }
.titulo-lista--aviso { color: var(--ambar); }

.lista-previa {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.lista-previa li {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--filete);
}

.marca-duplicado {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  width: 100%;
  cursor: pointer;
}

.marca-duplicado input { width: 20px; height: 20px; flex: none; }

.total {
  margin: 0.85rem 0;
  padding-top: 0.85rem;
  border-top: 1px solid var(--filete);
  font-weight: 600;
}

.dialogo-acciones { display: flex; gap: 0.6rem; }
.dialogo-acciones .boton { flex: 1; }

/* ── Vacíos ────────────────────────────────────────────────────── */

.vacio-util {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 2.5rem 1rem;
  text-align: center;
}

.vacio-util p { margin: 0; color: var(--apagado); max-width: 40ch; }

/* En el teléfono el director viene a mirar la carga del equipo: las columnas
   secundarias de la tabla solo estorban. */
@media (max-width: 640px) {
  .col-opcional { display: none; }
  .tabla { min-width: 0; }
  .campo--filtro { min-width: 140px; flex: 1; }
  .boton--revisar { width: 100%; }
}
</style>
