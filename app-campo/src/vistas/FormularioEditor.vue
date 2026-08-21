<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
/**
 * Editor de checklists. La pantalla que hace cierta la promesa de que cada
 * direccion arma los suyos sin programar.
 *
 * La usa un administrativo o un jefe de la Direccion de Contralor. No programa,
 * no sabe que es un JSON y no le interesa. Sabe perfectamente que hay que
 * controlar en una obra y que articulo del digesto se aplica. Todo lo que sigue
 * sale de ahi:
 *
 *  1. El versionado no se menciona mientras se edita. Editar es editar el
 *     checklist, no «trabajar sobre un borrador de la version 3». La version
 *     aparece en un solo lugar, y es el unico donde importa: al publicar, donde
 *     se explica con todas las letras que las inspecciones en curso y las
 *     cerradas no se tocan.
 *  2. El trabajo no se pierde nunca. Se guarda solo, con un respiro corto, igual
 *     que las respuestas del inspector en la calle; se fuerza el guardado al
 *     irse de la pantalla y al mandar la aplicacion a segundo plano. Un jefe que
 *     arma cuarenta preguntas y las pierde no vuelve a abrir el sistema.
 *  3. Si la validacion falla no hay cartel generico: hay una lista de lo que
 *     falta y cada linea lleva hasta el lugar exacto, con la pregunta abierta y
 *     señalada.
 *
 * Es una pantalla de escritorio: indice a la izquierda, listas largas, preguntas
 * plegadas para poder recorrerlas. En tablet todo refluye a una columna.
 */

import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import EditorPregunta from '@/componentes/EditorPregunta.vue'
import EditorIncumplimientos, { type UsoDeFalta } from '@/componentes/EditorIncumplimientos.vue'
import { almacen } from '@/datos/almacen'
import type {
  BorradorFormulario, FormularioVersion, Incumplimiento, Pregunta, Seccion, TipoInspeccion,
} from '@/dominio/tipos'
import { ahora, formatearFecha, formatearFechaHora, nuevoUuid } from '@/dominio/utilidades'

const props = defineProps<{ tipoInspeccionId: string }>()

/** Mientras no haya sesion, lo que se audita queda a nombre del rol. */
const ACTOR = 'contralor'

const tipo = ref<TipoInspeccion | undefined>(undefined)
const borrador = ref<BorradorFormulario | undefined>(undefined)
const versiones = ref<FormularioVersion[]>([])

const cargando = ref(true)
const error = ref('')

const abiertas = ref<Set<string>>(new Set())
const preguntaResaltada = ref<string | null>(null)
const faltaResaltada = ref<string | null>(null)

/** Los reproches solo aparecen despues de que la persona intento publicar. */
const intentoPublicar = ref(false)

const confirmandoPublicacion = ref(false)
const publicando = ref(false)
const publicada = ref<FormularioVersion | undefined>(undefined)
const errorPublicacion = ref('')
const aviso = ref('')

// ── Carga ───────────────────────────────────────────────────────────

async function cargar() {
  cargando.value = true
  error.value = ''
  try {
    const t = await almacen.formularios.tipoInspeccion(props.tipoInspeccionId)
    if (!t) {
      error.value = 'No encontramos este tipo de inspección.'
      return
    }
    tipo.value = t
    const b = await almacen.formularios.abrirBorrador(t.id, ACTOR)
    borrador.value = b
    versiones.value = await almacen.formularios.versiones(b.formularioId)
    guardadoEn.value = b.actualizadoEn
    sucio.value = false
  } catch {
    error.value = 'No se pudo abrir el checklist para editar.'
  } finally {
    cargando.value = false
  }
}

/** La que rige hoy. El historial viene de la mas nueva a la mas vieja. */
const versionVigente = computed<FormularioVersion | undefined>(() => versiones.value[0])

const proximaVersion = computed(() => (versionVigente.value?.version ?? 0) + 1)

/** De donde salio este borrador. Es contra esa version que se muestra que cambio. */
const versionBase = computed<FormularioVersion | undefined>(() => {
  const b = borrador.value
  if (!b) return undefined
  return versiones.value.find((v) => v.id === b.baseVersionId) ?? versionVigente.value
})

// ── Recorridas ──────────────────────────────────────────────────────

interface PreguntaUbicada {
  seccion: Seccion
  pregunta: Pregunta
  /** Lugar dentro de la sección, empezando en 1. */
  posicion: number
}

const preguntasUbicadas = computed<PreguntaUbicada[]>(() => {
  const b = borrador.value
  if (!b) return []
  return b.secciones.flatMap((seccion) =>
    seccion.preguntas.map((pregunta, i) => ({ seccion, pregunta, posicion: i + 1 })),
  )
})

const totalPreguntas = computed(() => preguntasUbicadas.value.length)

const faltas = computed<Incumplimiento[]>(() => borrador.value?.incumplimientos ?? [])

/** Cómo se llama, en palabras del inspector, una respuesta guardada. */
function textoRespuesta(pregunta: Pregunta, valor: string): string {
  if (pregunta.tipo === 'si_no' || pregunta.tipo === 'si_no_na') {
    if (valor === 'si') return 'Sí'
    if (valor === 'no') return 'No'
    if (valor === 'na') return 'No aplica'
  }
  return valor
}

/** Respuestas contra las que tiene sentido definir una regla. */
function respuestasValidas(pregunta: Pregunta): string[] {
  if (pregunta.tipo === 'si_no') return ['si', 'no']
  if (pregunta.tipo === 'si_no_na') return ['si', 'no', 'na']
  if (pregunta.tipo === 'opciones') {
    return (pregunta.opciones ?? []).filter((o) => o.trim() !== '')
  }
  return []
}

const usosPorFalta = computed<Record<string, UsoDeFalta[]>>(() => {
  const mapa: Record<string, UsoDeFalta[]> = {}
  for (const { seccion, pregunta } of preguntasUbicadas.value) {
    const faltaId = pregunta.incumplimientoId
    if (!faltaId || pregunta.respuestaQueIncumple === undefined) continue
    if (!mapa[faltaId]) mapa[faltaId] = []
    mapa[faltaId].push({
      preguntaId: pregunta.id,
      preguntaTexto: pregunta.texto,
      seccionTitulo: seccion.titulo,
      respuesta: textoRespuesta(pregunta, pregunta.respuestaQueIncumple),
    })
  }
  return mapa
})

// ── Guardado automático ─────────────────────────────────────────────

const sucio = ref(false)
const guardando = ref(false)
const guardadoEn = ref<string | null>(null)
const errorGuardado = ref('')

let temporizador: number | undefined

/** Todo cambio del borrador pasa por acá: marca sucio y programa el guardado. */
function tocar() {
  aviso.value = ''
  sucio.value = true
  if (temporizador) window.clearTimeout(temporizador)
  temporizador = window.setTimeout(() => void guardar(), 700)
}

/**
 * El borrador viaja a IndexedDB, que no sabe clonar los envoltorios reactivos
 * de Vue. Como es dato puro (sin blobs ni fechas), la vuelta por JSON alcanza y
 * deja una copia limpia.
 */
function copiaPlana(b: BorradorFormulario): BorradorFormulario {
  return JSON.parse(JSON.stringify(b)) as BorradorFormulario
}

async function guardar(): Promise<boolean> {
  const b = borrador.value
  if (!b || publicada.value) return true
  if (temporizador) {
    window.clearTimeout(temporizador)
    temporizador = undefined
  }
  guardando.value = true
  errorGuardado.value = ''
  try {
    b.actualizadoEn = ahora()
    await almacen.formularios.guardarBorrador(copiaPlana(b))
    guardadoEn.value = b.actualizadoEn
    sucio.value = false
    return true
  } catch {
    errorGuardado.value = 'No se pudo guardar. Los cambios están en pantalla pero no en el disco.'
    return false
  } finally {
    guardando.value = false
  }
}

function alOcultarPantalla() {
  if (document.visibilityState === 'hidden' && sucio.value) void guardar()
}

/** Cerrar la pestaña con algo sin guardar tiene que costar una pregunta. */
function alCerrarVentana(evento: BeforeUnloadEvent) {
  if (!sucio.value || publicada.value) return
  evento.preventDefault()
  evento.returnValue = ''
}

onMounted(() => {
  document.addEventListener('visibilitychange', alOcultarPantalla)
  window.addEventListener('beforeunload', alCerrarVentana)
  void cargar()
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', alOcultarPantalla)
  window.removeEventListener('beforeunload', alCerrarVentana)
  if (temporizador) window.clearTimeout(temporizador)
})

// Salir de la pantalla no puede perder nada: se fuerza el guardado y recién
// entonces se deja ir. Si el guardado falla, decide la persona.
onBeforeRouteLeave(async () => {
  if (!sucio.value || publicada.value) return true
  const guardado = await guardar()
  if (guardado) return true
  return window.confirm(
    'Los últimos cambios no se pudieron guardar. Si salís ahora se pierden. ¿Salir igual?',
  )
})

// ── Navegación dentro de la pantalla ────────────────────────────────

function irA(ancla: string) {
  void nextTick(() => {
    document.getElementById(ancla)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

function enfocar(id: string) {
  void nextTick(() => {
    const elemento = document.getElementById(id)
    if (elemento instanceof HTMLInputElement || elemento instanceof HTMLTextAreaElement) {
      elemento.focus()
      elemento.select()
    }
  })
}

function abrirPregunta(preguntaId: string) {
  abiertas.value.add(preguntaId)
  preguntaResaltada.value = preguntaId
  faltaResaltada.value = null
  irA('pregunta-' + preguntaId)
}

function alternarPregunta(preguntaId: string) {
  if (abiertas.value.has(preguntaId)) abiertas.value.delete(preguntaId)
  else abiertas.value.add(preguntaId)
  preguntaResaltada.value = null
}

function nuevoId(prefijo: string): string {
  return prefijo + '-' + nuevoUuid().slice(0, 8)
}

// ── Título ──────────────────────────────────────────────────────────

function alEscribirTitulo(evento: Event) {
  const b = borrador.value
  if (!b) return
  b.titulo = (evento.target as HTMLInputElement).value
  tocar()
}

// ── Secciones ───────────────────────────────────────────────────────

function agregarSeccion() {
  const b = borrador.value
  if (!b) return
  const seccion: Seccion = { id: nuevoId('sec'), titulo: '', preguntas: [] }
  b.secciones.push(seccion)
  tocar()
  irA('seccion-' + seccion.id)
  enfocar('titulo-seccion-' + seccion.id)
}

function alEscribirSeccion(seccion: Seccion, evento: Event) {
  seccion.titulo = (evento.target as HTMLInputElement).value
  tocar()
}

function moverSeccion(indice: number, direccion: -1 | 1) {
  const b = borrador.value
  if (!b) return
  const destino = indice + direccion
  if (destino < 0 || destino >= b.secciones.length) return
  const [movida] = b.secciones.splice(indice, 1)
  b.secciones.splice(destino, 0, movida)
  tocar()
}

function pedirBorrarSeccion(indice: number) {
  const b = borrador.value
  if (!b) return
  const seccion = b.secciones[indice]
  const nombre = seccion.titulo.trim() || 'Sección sin nombre'

  if (seccion.preguntas.length === 0) {
    quitarSeccion(indice)
    return
  }

  confirmacion.value = {
    titulo: 'Quitar «' + nombre + '»',
    cuerpo:
      'Esta sección tiene ' +
      seccion.preguntas.length +
      (seccion.preguntas.length === 1 ? ' pregunta' : ' preguntas') +
      '. Se van todas con ella.',
    detalle: seccion.preguntas.map((p) => p.texto || 'Pregunta sin texto'),
    nota: 'La versión que rige hoy no se toca: esto solo cambia lo que estás editando.',
    textoConfirmar: 'Quitar la sección',
    alConfirmar: () => quitarSeccion(indice),
  }
}

function quitarSeccion(indice: number) {
  const b = borrador.value
  if (!b) return
  b.secciones.splice(indice, 1)
  tocar()
}

// ── Preguntas ───────────────────────────────────────────────────────

function agregarPregunta(seccion: Seccion) {
  const pregunta: Pregunta = { id: nuevoId('p'), texto: '', tipo: 'si_no', obligatoria: true }
  seccion.preguntas.push(pregunta)
  abiertas.value.add(pregunta.id)
  preguntaResaltada.value = null
  tocar()
  irA('pregunta-' + pregunta.id)
  enfocar('texto-' + pregunta.id)
}

function cambiarPregunta(seccion: Seccion, indice: number, pregunta: Pregunta) {
  seccion.preguntas[indice] = pregunta
  tocar()
}

function moverPregunta(seccion: Seccion, indice: number, direccion: -1 | 1) {
  const destino = indice + direccion
  if (destino < 0 || destino >= seccion.preguntas.length) return
  const [movida] = seccion.preguntas.splice(indice, 1)
  seccion.preguntas.splice(destino, 0, movida)
  tocar()
}

function pedirBorrarPregunta(seccion: Seccion, indice: number) {
  const pregunta = seccion.preguntas[indice]
  const vacia = pregunta.texto.trim() === ''

  if (vacia) {
    seccion.preguntas.splice(indice, 1)
    tocar()
    return
  }

  confirmacion.value = {
    titulo: 'Quitar la pregunta',
    cuerpo: '«' + pregunta.texto + '» deja de estar en el checklist.',
    nota:
      pregunta.incumplimientoId !== undefined
        ? 'La falta que tenía vinculada queda en el catálogo, pero sin ninguna pregunta que la constate.'
        : 'La versión que rige hoy no se toca: esto solo cambia lo que estás editando.',
    textoConfirmar: 'Quitar la pregunta',
    alConfirmar: () => {
      seccion.preguntas.splice(indice, 1)
      tocar()
    },
  }
}

/** La respuesta con la que arranca una regla nueva: casi siempre incumple el «No». */
function respuestaPorDefecto(pregunta: Pregunta): string {
  const validas = respuestasValidas(pregunta)
  return validas.includes('no') ? 'no' : (validas[0] ?? '')
}

// ── Faltas ──────────────────────────────────────────────────────────

function crearFalta(): Incumplimiento {
  const b = borrador.value
  if (!b) throw new Error('sin borrador')
  const falta: Incumplimiento = {
    id: nuevoId('f'),
    descripcion: '',
    normativa: '',
    plazoSubsanacionDias: tipo.value?.plazoSubsanacionDias ?? 10,
    gravedad: 'grave',
  }
  b.incumplimientos.push(falta)
  return falta
}

function agregarFalta() {
  const falta = crearFalta()
  tocar()
  faltaResaltada.value = falta.id
  irA('falta-' + falta.id)
  enfocar('desc-' + falta.id)
}

/**
 * Crear la falta sin salir de la pregunta que la necesita. El vinculo queda
 * hecho de entrada; lo unico que le queda a la persona es escribir de que se
 * trata, y para eso la pantalla la lleva hasta ahi con el cursor puesto.
 */
function nuevaFaltaDesdePregunta(seccion: Seccion, indice: number) {
  const falta = crearFalta()
  const pregunta = seccion.preguntas[indice]
  const siguiente: Pregunta = { ...pregunta, incumplimientoId: falta.id }
  if (siguiente.respuestaQueIncumple === undefined) {
    siguiente.respuestaQueIncumple = respuestaPorDefecto(pregunta)
  }
  seccion.preguntas[indice] = siguiente
  tocar()
  faltaResaltada.value = falta.id
  preguntaResaltada.value = null
  irA('falta-' + falta.id)
  enfocar('desc-' + falta.id)
}

function cambiarFalta(falta: Incumplimiento) {
  const b = borrador.value
  if (!b) return
  const indice = b.incumplimientos.findIndex((f) => f.id === falta.id)
  if (indice < 0) return
  b.incumplimientos[indice] = falta
  tocar()
}

function pedirBorrarFalta(id: string) {
  const b = borrador.value
  if (!b) return
  const falta = b.incumplimientos.find((f) => f.id === id)
  if (!falta) return
  const usos = usosPorFalta.value[id] ?? []
  const nombre = falta.descripcion.trim() || 'Falta sin descripción'

  if (usos.length === 0) {
    quitarFalta(id)
    return
  }

  confirmacion.value = {
    titulo: 'Quitar «' + nombre + '»',
    cuerpo:
      'La usan ' +
      usos.length +
      (usos.length === 1 ? ' pregunta' : ' preguntas') +
      '. Esas preguntas se quedan en el checklist, pero dejan de constatar nada.',
    detalle: usos.map(
      (u) =>
        (u.preguntaTexto || 'Pregunta sin texto') + ' — ' + u.seccionTitulo + ' · «' + u.respuesta + '»',
    ),
    nota: 'Las actas ya emitidas con esta falta no se tocan: citan la versión con la que se hicieron.',
    textoConfirmar: 'Quitar la falta igual',
    alConfirmar: () => quitarFalta(id),
  }
}

function quitarFalta(id: string) {
  const b = borrador.value
  if (!b) return
  b.incumplimientos = b.incumplimientos.filter((f) => f.id !== id)
  for (const seccion of b.secciones) {
    seccion.preguntas = seccion.preguntas.map((p) => {
      if (p.incumplimientoId !== id) return p
      const limpia: Pregunta = { ...p }
      delete limpia.incumplimientoId
      delete limpia.respuestaQueIncumple
      return limpia
    })
  }
  tocar()
}

// ── Validación ──────────────────────────────────────────────────────

interface Problema {
  clave: string
  /** Si es grave, no se publica hasta resolverlo. */
  grave: boolean
  texto: string
  /** Elemento del DOM al que hay que llevar a la persona. */
  ancla: string
  preguntaId?: string
  faltaId?: string
}

const problemas = computed<Problema[]>(() => {
  const b = borrador.value
  if (!b) return []
  const salida: Problema[] = []

  if (b.titulo.trim() === '') {
    salida.push({
      clave: 'titulo',
      grave: true,
      texto: 'El checklist no tiene nombre.',
      ancla: 'titulo-formulario',
    })
  }

  if (totalPreguntas.value === 0) {
    salida.push({
      clave: 'sin-preguntas',
      grave: true,
      texto: 'El checklist no tiene ni una pregunta.',
      ancla: 'secciones',
    })
  }

  for (const seccion of b.secciones) {
    const nombreSeccion = seccion.titulo.trim() || 'Sección sin nombre'
    if (seccion.titulo.trim() === '') {
      salida.push({
        clave: 'seccion-titulo-' + seccion.id,
        grave: true,
        texto: 'Hay una sección sin nombre.',
        ancla: 'seccion-' + seccion.id,
      })
    }
    if (seccion.preguntas.length === 0) {
      salida.push({
        clave: 'seccion-vacia-' + seccion.id,
        grave: false,
        texto: '«' + nombreSeccion + '» no tiene preguntas. Al inspector le va a aparecer vacía.',
        ancla: 'seccion-' + seccion.id,
      })
    }

    seccion.preguntas.forEach((pregunta, i) => {
      const donde = '«' + nombreSeccion + '» · pregunta ' + (i + 1) + ': '
      const ancla = 'pregunta-' + pregunta.id

      if (pregunta.texto.trim() === '') {
        salida.push({
          clave: 'p-texto-' + pregunta.id,
          grave: true,
          texto: donde + 'falta escribir qué se pregunta.',
          ancla,
          preguntaId: pregunta.id,
        })
      }

      if (pregunta.tipo === 'opciones') {
        const validas = (pregunta.opciones ?? []).map((o) => o.trim()).filter((o) => o !== '')
        if (validas.length < 2) {
          salida.push({
            clave: 'p-opciones-' + pregunta.id,
            grave: true,
            texto: donde + 'una lista de opciones necesita al menos dos opciones escritas.',
            ancla,
            preguntaId: pregunta.id,
          })
        }
        if (new Set(validas).size !== validas.length) {
          salida.push({
            clave: 'p-opciones-repetidas-' + pregunta.id,
            grave: true,
            texto: donde + 'hay dos opciones escritas igual. El inspector no las va a poder distinguir.',
            ancla,
            preguntaId: pregunta.id,
          })
        }
      }

      const respuesta = pregunta.respuestaQueIncumple
      if (respuesta !== undefined) {
        if (!respuestasValidas(pregunta).includes(respuesta)) {
          salida.push({
            clave: 'p-regla-huerfana-' + pregunta.id,
            grave: true,
            texto:
              donde + 'la falta se constata con una respuesta que ya no existe. Elegí otra o sacá la regla.',
            ancla,
            preguntaId: pregunta.id,
          })
        }
        if (!pregunta.incumplimientoId) {
          salida.push({
            clave: 'p-regla-sin-falta-' + pregunta.id,
            grave: true,
            texto: donde + 'dice qué respuesta constata una falta, pero no cuál falta.',
            ancla,
            preguntaId: pregunta.id,
          })
        } else if (!b.incumplimientos.some((f) => f.id === pregunta.incumplimientoId)) {
          salida.push({
            clave: 'p-regla-borrada-' + pregunta.id,
            grave: true,
            texto: donde + 'apunta a una falta que ya no está en el catálogo.',
            ancla,
            preguntaId: pregunta.id,
          })
        }
      }
    })
  }

  for (const falta of b.incumplimientos) {
    const nombre = falta.descripcion.trim() || 'Falta sin descripción'
    const ancla = 'falta-' + falta.id

    if (falta.descripcion.trim() === '') {
      salida.push({
        clave: 'f-desc-' + falta.id,
        grave: true,
        texto: 'Hay una falta sin describir. Es lo que va a leer el responsable en el acta.',
        ancla,
        faltaId: falta.id,
      })
    }
    if (falta.normativa.trim() === '') {
      salida.push({
        clave: 'f-norma-' + falta.id,
        grave: false,
        texto: '«' + nombre + '» no cita ningún artículo. Un acta sin encuadre es impugnable.',
        ancla,
        faltaId: falta.id,
      })
    }
    if (!Number.isInteger(falta.plazoSubsanacionDias) || falta.plazoSubsanacionDias < 1) {
      salida.push({
        clave: 'f-plazo-' + falta.id,
        grave: true,
        texto: '«' + nombre + '» tiene que dar al menos un día de plazo para corregir.',
        ancla,
        faltaId: falta.id,
      })
    }
    if ((usosPorFalta.value[falta.id] ?? []).length === 0) {
      salida.push({
        clave: 'f-sin-uso-' + falta.id,
        grave: false,
        texto: '«' + nombre + '» no la constata ninguna pregunta: nunca se va a aplicar.',
        ancla,
        faltaId: falta.id,
      })
    }
  }

  return salida
})

const bloqueantes = computed(() => problemas.value.filter((p) => p.grave))
const avisos = computed(() => problemas.value.filter((p) => !p.grave))

function agrupar(clave: 'preguntaId' | 'faltaId'): Record<string, string[]> {
  const mapa: Record<string, string[]> = {}
  if (!intentoPublicar.value) return mapa
  for (const p of problemas.value) {
    const id = p[clave]
    if (!id) continue
    if (!mapa[id]) mapa[id] = []
    mapa[id].push(p.texto)
  }
  return mapa
}

const problemasPorPregunta = computed(() => agrupar('preguntaId'))
const problemasPorFalta = computed(() => agrupar('faltaId'))

function irAlProblema(problema: Problema) {
  if (problema.preguntaId) {
    abiertas.value.add(problema.preguntaId)
    preguntaResaltada.value = problema.preguntaId
    faltaResaltada.value = null
  } else if (problema.faltaId) {
    faltaResaltada.value = problema.faltaId
    preguntaResaltada.value = null
  } else {
    preguntaResaltada.value = null
    faltaResaltada.value = null
  }
  irA(problema.ancla)
  if (problema.clave === 'titulo') enfocar('titulo-formulario')
}

// ── Qué cambia respecto de la versión que rige ──────────────────────

interface BloqueCambios {
  titulo: string
  elementos: string[]
}

const cambios = computed<BloqueCambios[]>(() => {
  const b = borrador.value
  const base = versionBase.value
  if (!b || !base) return []

  const bloques: BloqueCambios[] = []
  const agregar = (titulo: string, elementos: string[]) => {
    if (elementos.length > 0) bloques.push({ titulo, elementos })
  }

  if (base.titulo !== b.titulo) {
    agregar('Cambia el nombre del checklist', ['«' + base.titulo + '» → «' + b.titulo + '»'])
  }

  const seccionesBase = new Map(base.secciones.map((s) => [s.id, s]))
  const seccionesNuevas = b.secciones.filter((s) => !seccionesBase.has(s.id))
  const seccionesIdsBorrador = new Set(b.secciones.map((s) => s.id))
  const seccionesQuitadas = base.secciones.filter((s) => !seccionesIdsBorrador.has(s.id))
  agregar('Secciones nuevas', seccionesNuevas.map((s) => s.titulo || 'Sección sin nombre'))
  agregar('Secciones que se van', seccionesQuitadas.map((s) => s.titulo))

  const preguntasBase = new Map(base.secciones.flatMap((s) => s.preguntas).map((p) => [p.id, p]))
  const preguntasBorrador = b.secciones.flatMap((s) => s.preguntas)
  const idsBorrador = new Set(preguntasBorrador.map((p) => p.id))

  const nuevas: string[] = []
  const editadas: string[] = []
  for (const p of preguntasBorrador) {
    const anterior = preguntasBase.get(p.id)
    if (!anterior) {
      nuevas.push(p.texto || 'Pregunta sin texto')
    } else if (JSON.stringify(anterior) !== JSON.stringify(p)) {
      editadas.push(p.texto || 'Pregunta sin texto')
    }
  }
  const quitadas = [...preguntasBase.values()]
    .filter((p) => !idsBorrador.has(p.id))
    .map((p) => p.texto)

  agregar('Preguntas nuevas', nuevas)
  agregar('Preguntas con cambios', editadas)
  agregar('Preguntas que se van', quitadas)

  const faltasBase = new Map(base.incumplimientos.map((f) => [f.id, f]))
  const idsFaltas = new Set(b.incumplimientos.map((f) => f.id))
  const faltasNuevas: string[] = []
  const faltasEditadas: string[] = []
  for (const f of b.incumplimientos) {
    const anterior = faltasBase.get(f.id)
    if (!anterior) faltasNuevas.push(f.descripcion || 'Falta sin descripción')
    else if (JSON.stringify(anterior) !== JSON.stringify(f)) faltasEditadas.push(f.descripcion)
  }
  agregar('Faltas nuevas', faltasNuevas)
  agregar('Faltas con cambios', faltasEditadas)
  agregar(
    'Faltas que se van',
    [...faltasBase.values()].filter((f) => !idsFaltas.has(f.id)).map((f) => f.descripcion),
  )

  return bloques
})

// ── Publicar ────────────────────────────────────────────────────────

function pedirPublicar() {
  intentoPublicar.value = true
  errorPublicacion.value = ''
  if (bloqueantes.value.length > 0) {
    irA('problemas')
    return
  }
  confirmandoPublicacion.value = true
}

async function publicar() {
  const b = borrador.value
  if (!b || publicando.value) return
  publicando.value = true
  errorPublicacion.value = ''
  try {
    const guardado = await guardar()
    if (!guardado) {
      errorPublicacion.value = 'No se pudo guardar el checklist, así que no se publicó nada.'
      return
    }
    publicada.value = await almacen.formularios.publicarBorrador(b.id, ACTOR)
    sucio.value = false
    confirmandoPublicacion.value = false
  } catch {
    errorPublicacion.value = 'No se pudo publicar. No se creó ninguna versión nueva.'
  } finally {
    publicando.value = false
  }
}

/**
 * Volver a editar despues de publicar abre una edicion nueva sobre la version
 * que acaba de quedar vigente. Lo que se publico no se toca nunca mas.
 */
async function volverAEditar() {
  publicada.value = undefined
  intentoPublicar.value = false
  abiertas.value = new Set()
  preguntaResaltada.value = null
  faltaResaltada.value = null
  await cargar()
}

// ── Descartar ───────────────────────────────────────────────────────

function pedirDescartar() {
  const vigente = versionVigente.value
  confirmacion.value = {
    titulo: 'Descartar los cambios',
    cuerpo:
      'Se pierde todo lo que editaste desde que abriste este checklist y vuelve a quedar como está publicado hoy.',
    nota: vigente
      ? 'La versión ' + vigente.version + ', que es la que se está usando en la calle, no se toca.'
      : undefined,
    textoConfirmar: 'Descartar todo',
    peligro: true,
    alConfirmar: () => void descartar(),
  }
}

async function descartar() {
  const b = borrador.value
  if (!b) return
  if (temporizador) {
    window.clearTimeout(temporizador)
    temporizador = undefined
  }
  sucio.value = false
  try {
    await almacen.formularios.descartarBorrador(b.id)
    intentoPublicar.value = false
    abiertas.value = new Set()
    await cargar()
    aviso.value = versionVigente.value
      ? 'Listo. El checklist volvió a la versión ' + versionVigente.value.version + '.'
      : 'Listo. Se descartaron los cambios.'
  } catch {
    errorGuardado.value = 'No se pudieron descartar los cambios.'
  }
}

// ── Confirmaciones ──────────────────────────────────────────────────

interface Confirmacion {
  titulo: string
  cuerpo: string
  /** Lo que concretamente se va. Nunca se borra a ciegas. */
  detalle?: string[]
  nota?: string
  textoConfirmar: string
  peligro?: boolean
  alConfirmar: () => void
}

const confirmacion = ref<Confirmacion | null>(null)

function confirmar() {
  const pendiente = confirmacion.value
  confirmacion.value = null
  pendiente?.alConfirmar()
}
</script>

<template>
  <div class="pantalla">
    <p v-if="cargando" class="vacio">Abriendo el checklist…</p>

    <div v-else-if="error" class="vacio-util">
      <p>{{ error }}</p>
      <button type="button" class="boton" @click="cargar">Volver a intentar</button>
    </div>

    <!-- ── Publicado ──────────────────────────────────────────────── -->
    <div v-else-if="publicada" class="publicado">
      <h2>Publicado</h2>
      <p class="publicado-frase">
        Desde ahora, toda inspección de <strong>{{ tipo?.nombre }}</strong> que se cree va a usar
        este checklist.
      </p>
      <ul class="consecuencias">
        <li>
          Las inspecciones que estaban en curso siguen con el checklist que tenían cuando
          empezaron.
        </li>
        <li>Las ya cerradas y sus actas no se tocaron: se pueden reconstruir tal como se emitieron.</li>
      </ul>
      <p class="chico tenue">
        Quedó como versión {{ publicada.version }}, vigente desde
        {{ formatearFecha(publicada.vigenteDesde) }}.
      </p>
      <button type="button" class="boton" @click="volverAEditar">Seguir editando el checklist</button>
    </div>

    <!-- ── Editor ─────────────────────────────────────────────────── -->
    <template v-else-if="borrador">
      <header class="encabezado">
        <p class="etiqueta">Checklist de {{ tipo?.nombre }}</p>
        <input
          id="titulo-formulario"
          class="titulo"
          type="text"
          placeholder="Nombre del checklist"
          aria-label="Nombre del checklist"
          :value="borrador.titulo"
          @input="alEscribirTitulo"
        />
        <p class="chico tenue">
          {{ tipo?.direccionResponsable }}
          <template v-if="versionVigente">
            · en la calle se está usando el checklist publicado el
            {{ formatearFecha(versionVigente.vigenteDesde) }}
          </template>
          <template v-else>· todavía no se publicó ninguna vez</template>
        </p>
      </header>

      <p v-if="aviso" class="nota nota--exito">{{ aviso }}</p>

      <div class="columnas">
        <!-- ── Índice ─────────────────────────────────────────────── -->
        <nav class="indice" aria-label="Índice del checklist">
          <p class="etiqueta">En este checklist</p>
          <ul class="indice-lista">
            <li v-for="seccion in borrador.secciones" :key="seccion.id">
              <button type="button" class="indice-enlace" @click="irA('seccion-' + seccion.id)">
                <span class="crece">{{ seccion.titulo || 'Sección sin nombre' }}</span>
                <span class="indice-cuenta">{{ seccion.preguntas.length }}</span>
              </button>
            </li>
          </ul>
          <button type="button" class="indice-enlace indice-enlace--faltas" @click="irA('faltas')">
            <span class="crece">Faltas</span>
            <span class="indice-cuenta">{{ faltas.length }}</span>
          </button>
          <p class="indice-resumen">
            {{ totalPreguntas }} {{ totalPreguntas === 1 ? 'pregunta' : 'preguntas' }} en total
          </p>
        </nav>

        <div class="cuerpo">
          <!-- ── Lo que falta para publicar ───────────────────────── -->
          <section
            v-if="intentoPublicar && problemas.length > 0"
            id="problemas"
            class="panel-problemas"
            :class="{ 'panel-problemas--solo-avisos': bloqueantes.length === 0 }"
            role="alert"
          >
            <h2 v-if="bloqueantes.length > 0">
              Falta resolver
              {{ bloqueantes.length }}
              {{ bloqueantes.length === 1 ? 'cosa' : 'cosas' }} para poder publicar
            </h2>
            <h2 v-else>Se puede publicar, pero mirá esto antes</h2>
            <p class="chico tenue">Tocá cualquiera de estas líneas y te llevo hasta el lugar.</p>
            <ul class="lista-problemas">
              <li v-for="p in bloqueantes" :key="p.clave">
                <button type="button" class="problema problema--grave" @click="irAlProblema(p)">
                  {{ p.texto }}
                </button>
              </li>
              <li v-for="p in avisos" :key="p.clave">
                <button type="button" class="problema" @click="irAlProblema(p)">
                  {{ p.texto }}
                  <span class="problema-marca">no impide publicar</span>
                </button>
              </li>
            </ul>
          </section>

          <!-- ── Secciones ────────────────────────────────────────── -->
          <div id="secciones" class="secciones">
            <section
              v-for="(seccion, indiceSeccion) in borrador.secciones"
              :id="'seccion-' + seccion.id"
              :key="seccion.id"
              class="seccion"
            >
              <div class="seccion-cabecera">
                <input
                  :id="'titulo-seccion-' + seccion.id"
                  class="titulo-seccion"
                  type="text"
                  placeholder="Nombre de la sección"
                  :aria-label="'Nombre de la sección ' + (indiceSeccion + 1)"
                  :value="seccion.titulo"
                  @input="alEscribirSeccion(seccion, $event)"
                />
                <div class="acciones-seccion">
                  <button
                    type="button"
                    class="icono"
                    title="Subir la sección"
                    aria-label="Subir la sección"
                    :disabled="indiceSeccion === 0"
                    @click="moverSeccion(indiceSeccion, -1)"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6" /></svg>
                  </button>
                  <button
                    type="button"
                    class="icono"
                    title="Bajar la sección"
                    aria-label="Bajar la sección"
                    :disabled="indiceSeccion === borrador.secciones.length - 1"
                    @click="moverSeccion(indiceSeccion, 1)"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  <button
                    type="button"
                    class="icono icono--peligro"
                    title="Quitar la sección"
                    aria-label="Quitar la sección"
                    @click="pedirBorrarSeccion(indiceSeccion)"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></svg>
                  </button>
                </div>
              </div>

              <div class="preguntas">
                <EditorPregunta
                  v-for="(pregunta, indicePregunta) in seccion.preguntas"
                  :key="pregunta.id"
                  :pregunta="pregunta"
                  :posicion="indicePregunta + 1"
                  :total="seccion.preguntas.length"
                  :faltas="faltas"
                  :abierta="abiertas.has(pregunta.id)"
                  :resaltada="preguntaResaltada === pregunta.id"
                  :problemas="problemasPorPregunta[pregunta.id]"
                  @alternar="alternarPregunta(pregunta.id)"
                  @cambiar="cambiarPregunta(seccion, indicePregunta, $event)"
                  @mover="moverPregunta(seccion, indicePregunta, $event)"
                  @borrar="pedirBorrarPregunta(seccion, indicePregunta)"
                  @nueva-falta="nuevaFaltaDesdePregunta(seccion, indicePregunta)"
                />
              </div>

              <button
                type="button"
                class="boton boton--secundario boton--agregar"
                @click="agregarPregunta(seccion)"
              >
                Agregar una pregunta a «{{ seccion.titulo || 'esta sección' }}»
              </button>
            </section>

            <p v-if="borrador.secciones.length === 0" class="vacio">
              El checklist está vacío. Empezá por una sección: «Documentación», «Seguridad en obra»,
              lo que ordene el control.
            </p>

            <button type="button" class="boton boton--secundario boton--seccion" @click="agregarSeccion">
              Agregar una sección
            </button>
          </div>

          <!-- ── Catálogo de faltas ───────────────────────────────── -->
          <EditorIncumplimientos
            :faltas="faltas"
            :usos="usosPorFalta"
            :resaltada="faltaResaltada"
            :problemas="problemasPorFalta"
            @agregar="agregarFalta"
            @cambiar="cambiarFalta"
            @borrar="pedirBorrarFalta"
            @ir-a-pregunta="abrirPregunta"
          />
        </div>
      </div>

      <!-- ── Barra fija: estado del guardado y publicación ─────────── -->
      <div class="barra-accion">
        <div class="barra-accion-interior">
          <p class="estado" :class="{ 'estado--error': !!errorGuardado }">
            <template v-if="errorGuardado">{{ errorGuardado }}</template>
            <template v-else-if="guardando">Guardando…</template>
            <template v-else-if="sucio">Cambios sin guardar</template>
            <template v-else-if="guardadoEn">
              <svg class="tilde" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>
              Guardado {{ formatearFechaHora(guardadoEn) }}
            </template>
            <template v-else>Todavía sin cambios</template>
          </p>

          <div class="botones">
            <button type="button" class="boton boton--fantasma boton--descartar" @click="pedirDescartar">
              Descartar los cambios
            </button>
            <button type="button" class="boton boton--publicar" @click="pedirPublicar">
              Publicar el checklist
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- ── Confirmación de algo que se va ─────────────────────────── -->
    <div v-if="confirmacion" class="velo" @click.self="confirmacion = null">
      <div class="dialogo" role="dialog" aria-modal="true" aria-labelledby="titulo-confirmacion">
        <h2 id="titulo-confirmacion">{{ confirmacion.titulo }}</h2>
        <p class="dialogo-frase">{{ confirmacion.cuerpo }}</p>

        <div v-if="confirmacion.detalle" class="dialogo-cuerpo">
          <ul class="lista-detalle">
            <li v-for="(linea, i) in confirmacion.detalle" :key="i">{{ linea }}</li>
          </ul>
        </div>

        <p v-if="confirmacion.nota" class="chico tenue">{{ confirmacion.nota }}</p>

        <div class="dialogo-acciones">
          <button type="button" class="boton boton--secundario" @click="confirmacion = null">
            Volver atrás
          </button>
          <button
            type="button"
            class="boton"
            :class="{ 'boton--peligro': confirmacion.peligro }"
            @click="confirmar"
          >
            {{ confirmacion.textoConfirmar }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Antes de publicar ──────────────────────────────────────── -->
    <div v-if="confirmandoPublicacion" class="velo" @click.self="confirmandoPublicacion = false">
      <div class="dialogo" role="dialog" aria-modal="true" aria-labelledby="titulo-publicar">
        <h2 id="titulo-publicar">Antes de publicar</h2>
        <p class="dialogo-frase">
          Estás por dejar en uso este checklist para las inspecciones de
          <strong>{{ tipo?.nombre }}</strong
          >.
        </p>

        <div class="dialogo-cuerpo">
          <ul class="consecuencias">
            <li>
              <strong>Las inspecciones nuevas</strong> van a usar este checklist, con estas preguntas
              y estas faltas.
            </li>
            <li>
              <strong>Las que están en curso y las ya cerradas</strong> siguen con el checklist con el
              que se hicieron. No cambian, y sus actas se pueden reconstruir tal cual se emitieron.
            </li>
            <li>
              Lo que publiques ahora <strong>no se edita más</strong>: para corregir algo se publica
              otra vez, y esto queda como antecedente.
            </li>
          </ul>

          <p class="resumen-publicar">
            {{ borrador?.secciones.length }}
            {{ borrador?.secciones.length === 1 ? 'sección' : 'secciones' }} ·
            {{ totalPreguntas }} {{ totalPreguntas === 1 ? 'pregunta' : 'preguntas' }} ·
            {{ faltas.length }} {{ faltas.length === 1 ? 'falta' : 'faltas' }}
          </p>

          <template v-if="versionBase">
            <template v-if="cambios.length > 0">
              <h3 class="titulo-lista">Qué cambia respecto de lo que se usa hoy</h3>
              <div v-for="bloque in cambios" :key="bloque.titulo" class="bloque-cambios">
                <p class="etiqueta">{{ bloque.titulo }}</p>
                <ul class="lista-detalle">
                  <li v-for="(linea, i) in bloque.elementos" :key="i">{{ linea }}</li>
                </ul>
              </div>
            </template>
            <p v-else class="chico tenue">
              No hay ninguna diferencia con el checklist que se está usando hoy.
            </p>
          </template>
          <p v-else class="chico tenue">Es la primera vez que se publica este checklist.</p>

          <template v-if="avisos.length > 0">
            <h3 class="titulo-lista titulo-lista--aviso">Se publica igual, pero conviene mirarlo</h3>
            <ul class="lista-detalle">
              <li v-for="p in avisos" :key="p.clave">{{ p.texto }}</li>
            </ul>
          </template>
        </div>

        <p v-if="errorPublicacion" class="nota nota--error">{{ errorPublicacion }}</p>

        <div class="dialogo-acciones">
          <button
            type="button"
            class="boton boton--secundario"
            :disabled="publicando"
            @click="confirmandoPublicacion = false"
          >
            Volver atrás
          </button>
          <button type="button" class="boton" :disabled="publicando" @click="publicar">
            {{ publicando ? 'Publicando…' : 'Publicar y dejar en uso' }}
          </button>
        </div>

        <p class="chico tenue pie-version">
          Queda registrado como la versión {{ proximaVersion }} de este checklist.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pantalla {
  padding: 1rem;
  /* Aire para el pie de navegación y para la barra fija de publicación. */
  padding-bottom: calc(var(--alto-pie) + var(--seguro-abajo) + 9rem);
  max-width: 1180px;
  margin-inline: auto;
}

/* ── Encabezado ─────────────────────────────────────────────────── */

.encabezado {
  margin-bottom: 1rem;
}

.titulo {
  width: 100%;
  margin: 0.2rem 0 0.35rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid transparent;
  border-radius: var(--radio-chico);
  background: transparent;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.015em;
}

.titulo:hover { border-color: var(--borde); }
.titulo:focus { border-color: var(--borde); background: var(--superficie); }

.nota {
  margin: 0 0 1rem;
  padding: 0.6rem 0.75rem;
  border-radius: var(--radio-chico);
  font-size: 0.875rem;
  font-weight: 600;
}

.nota--exito { background: var(--verde-suave); color: var(--verde); }
.nota--error { background: var(--rojo-suave); color: var(--rojo); }

/* ── Dos columnas ───────────────────────────────────────────────── */

.columnas {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}

.indice {
  position: sticky;
  top: calc(var(--alto-barra) + var(--seguro-arriba) + 1rem);
  padding: 0.85rem;
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: var(--radio);
}

.indice-lista {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.indice-enlace {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  min-height: 38px;
  padding: 0.3rem 0.45rem;
  border: none;
  border-radius: var(--radio-chico);
  background: transparent;
  color: var(--tinta);
  font-size: 0.875rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.indice-enlace:hover { background: var(--superficie-2); }

.indice-enlace--faltas {
  margin-top: 0.5rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--filete);
  border-radius: 0;
}

.indice-cuenta {
  flex: none;
  color: var(--apagado);
  font-size: 0.75rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.indice-resumen {
  margin: 0.6rem 0 0;
  color: var(--apagado);
  font-size: 0.75rem;
}

.cuerpo {
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
  min-width: 0;
}

/* ── Panel de problemas ─────────────────────────────────────────── */

.panel-problemas {
  padding: 0.9rem;
  border: 1px solid var(--rojo);
  border-left: 4px solid var(--rojo);
  border-radius: var(--radio);
  background: var(--rojo-suave);
  scroll-margin-top: calc(var(--alto-barra) + 2rem);
}

.panel-problemas--solo-avisos {
  border-color: var(--ambar);
  background: var(--ambar-suave);
}

.lista-problemas {
  list-style: none;
  margin: 0.6rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.problema {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  width: 100%;
  min-height: 38px;
  padding: 0.35rem 0.5rem;
  border: none;
  border-radius: var(--radio-chico);
  background: transparent;
  color: var(--tinta);
  font-size: 0.875rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.problema:hover { background: var(--superficie); }
.problema--grave { color: var(--rojo); }

.problema-marca {
  flex: none;
  color: var(--apagado);
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* ── Secciones ──────────────────────────────────────────────────── */

.secciones {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.seccion {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  scroll-margin-top: calc(var(--alto-barra) + 2rem);
}

.seccion-cabecera {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  border-bottom: 2px solid var(--borde);
  padding-bottom: 0.35rem;
}

.titulo-seccion {
  flex: 1;
  min-width: 0;
  padding: 0.3rem 0.45rem;
  border: 1px solid transparent;
  border-radius: var(--radio-chico);
  background: transparent;
  font-size: 0.9375rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.titulo-seccion:hover { border-color: var(--borde); }
.titulo-seccion:focus { border-color: var(--borde); background: var(--superficie); }

.acciones-seccion { display: flex; gap: 0.15rem; flex: none; }

.icono {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: none;
  border: 1px solid transparent;
  border-radius: var(--radio-chico);
  background: transparent;
  color: var(--apagado);
  cursor: pointer;
}

.icono:hover:not(:disabled) { background: var(--superficie-2); color: var(--tinta); }
.icono:disabled { opacity: 0.3; cursor: not-allowed; }
.icono--peligro:hover:not(:disabled) { background: var(--rojo-suave); color: var(--rojo); }

.preguntas {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.boton--agregar,
.boton--seccion {
  align-self: flex-start;
  min-height: 42px;
  font-size: 0.875rem;
}

.boton--seccion { border-style: dashed; }

/* ── Barra fija ─────────────────────────────────────────────────── */

/* Publicar no es un botón más en el medio de una lista de cuarenta preguntas:
   vive abajo, siempre a la vista, al lado de la prueba de que nada se perdió. */
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

.barra-accion-interior {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  max-width: 1180px;
  margin-inline: auto;
}

.estado {
  flex: 1;
  min-width: 200px;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  color: var(--apagado);
  font-size: 0.875rem;
  font-weight: 600;
}

.estado--error { color: var(--rojo); }
.tilde { color: var(--verde); flex: none; }

.botones { display: flex; gap: 0.6rem; flex: none; }

.boton--descartar { color: var(--rojo); }
.boton--publicar { min-width: 200px; }

/* ── Publicado ──────────────────────────────────────────────────── */

.publicado {
  max-width: 46rem;
  margin: 2rem auto;
  padding: 1.5rem;
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-left: 4px solid var(--verde);
  border-radius: var(--radio);
}

.publicado-frase { margin: 0.5rem 0 0.85rem; }

.consecuencias {
  margin: 0.85rem 0;
  padding-left: 1.15rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  line-height: 1.45;
}

.publicado .boton { margin-top: 0.85rem; }

/* ── Diálogos ───────────────────────────────────────────────────── */

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
  width: min(660px, 100%);
  max-height: 90vh;
  padding: 1.15rem;
  background: var(--superficie);
  border-radius: var(--radio);
  box-shadow: var(--sombra);
}

.dialogo-frase { margin: 0.6rem 0 0; line-height: 1.45; }

.dialogo-cuerpo {
  overflow-y: auto;
  flex: 1;
  margin: 0.85rem 0;
  padding: 0.85rem 0;
  border-top: 1px solid var(--filete);
  border-bottom: 1px solid var(--filete);
}

.lista-detalle {
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.lista-detalle li {
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--filete);
  font-size: 0.9375rem;
  line-height: 1.35;
}

.lista-detalle li:last-child { border-bottom: none; }

.resumen-publicar {
  margin: 0.85rem 0 0.5rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--filete);
  font-weight: 700;
}

.titulo-lista { margin: 0.85rem 0 0.2rem; }
.titulo-lista--aviso { color: var(--ambar); }
.bloque-cambios { margin-top: 0.6rem; }

.dialogo-acciones { display: flex; gap: 0.6rem; margin-top: 0.85rem; }
.dialogo-acciones .boton { flex: 1; }
.pie-version { margin: 0.6rem 0 0; text-align: center; }

/* ── Vacíos ─────────────────────────────────────────────────────── */

.vacio-util {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 2.5rem 1rem;
  text-align: center;
}

/* En tablet el índice deja de ser una columna y pasa a ser una tira arriba de
   todo: la pantalla es angosta y las preguntas necesitan el ancho. */
@media (max-width: 900px) {
  .columnas { grid-template-columns: 1fr; gap: 1rem; }
  .indice { position: static; }
  .indice-lista { flex-direction: row; flex-wrap: wrap; }
  .indice-enlace { width: auto; border: 1px solid var(--borde); }
  .indice-enlace--faltas { border-radius: var(--radio-chico); margin-top: 0; border-top: 1px solid var(--borde); padding-top: 0.3rem; }
  .indice-resumen { display: none; }
  .botones { flex: 1; }
  .botones .boton { flex: 1; }
  .boton--publicar { min-width: 0; }
}
</style>
