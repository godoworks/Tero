<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
/**
 * Historial de versiones de un formulario. La memoria del checklist.
 *
 * Esta pantalla existe para contestar una pregunta muy concreta: «esta
 * inspección se hizo en marzo, ¿qué preguntas tenía el formulario entonces?».
 * Todo lo que hay acá está puesto para eso:
 *
 *  - Cada versión dice entre qué fechas rigió, no solo desde cuándo. Sin el
 *    hasta, para saber cuál regía en una fecha hay que hacer la cuenta a mano.
 *  - Se puede buscar directamente por fecha: se escribe el día de la inspección
 *    y la pantalla salta a la versión que estaba vigente ese día.
 *  - De cada versión se muestra qué cambió respecto de la anterior —preguntas
 *    y faltas dadas de alta, de baja o modificadas— porque leer dos
 *    cuestionarios enteros en paralelo no lo hace nadie.
 *
 * Y una cosa que NO hay, a propósito: ninguna forma de editar. Una versión
 * publicada no se modifica nunca; si se modificara, el acta de hace ocho meses
 * dejaría de poder reconstruirse. Para cambiar el checklist se edita el vigente
 * y se publica una versión nueva.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import VistaPreviaChecklist from '@/componentes/VistaPreviaChecklist.vue'
import { almacen } from '@/datos/almacen'
import type { RepositorioFormularios } from '@/datos/contratos'
import type {
  BorradorFormulario, FormularioVersion, Incumplimiento, Pregunta, TipoInspeccion,
  TipoPregunta, Uuid,
} from '@/dominio/tipos'
import { formatearFecha, formatearFechaHora } from '@/dominio/utilidades'

const props = defineProps<{ formularioId?: string }>()

const ruta = useRoute()
const formularioId = computed(
  () => props.formularioId ?? String(ruta.params.formularioId ?? ''),
)

const NOMBRE_TIPO: Record<TipoPregunta, string> = {
  si_no: 'Sí / No',
  si_no_na: 'Sí / No / No aplica',
  texto: 'Texto libre',
  numero: 'Número',
  opciones: 'Opciones',
  foto: 'Foto',
}

const NOMBRE_GRAVEDAD: Record<Incumplimiento['gravedad'], string> = {
  leve: 'Leve',
  grave: 'Grave',
  muy_grave: 'Muy grave',
}

// ── Comparacion entre versiones ───────────────────────────────────────
//
// No se compara caracter por caracter: se compara por identidad. Cada pregunta
// y cada falta tienen un id estable que sobrevive de una version a la otra, asi
// que el diff correcto es de altas, bajas y modificaciones sobre esos ids. Eso
// es ademas lo que se puede leer de un vistazo.

interface PreguntaUbicada {
  pregunta: Pregunta
  seccion: string
}

interface CambioPregunta {
  id: string
  texto: string
  seccion: string
  tipo: TipoPregunta
  /** Que cambio exactamente, en castellano. Vacio en las altas y bajas. */
  detalles: string[]
}

interface CambioFalta {
  id: string
  descripcion: string
  detalles: string[]
}

interface Comparacion {
  /** Version contra la que se compara. */
  contra: number
  preguntasAgregadas: CambioPregunta[]
  preguntasQuitadas: CambioPregunta[]
  preguntasCambiadas: CambioPregunta[]
  faltasAgregadas: CambioFalta[]
  faltasQuitadas: CambioFalta[]
  faltasCambiadas: CambioFalta[]
  seccionesAgregadas: string[]
  seccionesQuitadas: string[]
  sinCambios: boolean
}

function indexarPreguntas(version: FormularioVersion): Map<string, PreguntaUbicada> {
  const indice = new Map<string, PreguntaUbicada>()
  for (const seccion of version.secciones) {
    for (const pregunta of seccion.preguntas) {
      indice.set(pregunta.id, { pregunta, seccion: seccion.titulo })
    }
  }
  return indice
}

function comoCambio(ubicada: PreguntaUbicada): CambioPregunta {
  return {
    id: ubicada.pregunta.id,
    texto: ubicada.pregunta.texto,
    seccion: ubicada.seccion,
    tipo: ubicada.pregunta.tipo,
    detalles: [],
  }
}

function etiquetaValor(valor: string): string {
  if (valor === 'si') return 'Sí'
  if (valor === 'no') return 'No'
  if (valor === 'na') return 'No aplica'
  return valor
}

/** Como se nombra una falta cuando hay que citarla dentro de un cambio. */
function nombrarFalta(id: string | undefined, version: FormularioVersion): string {
  if (!id) return 'ninguna'
  const falta = version.incumplimientos.find((i) => i.id === id)
  return falta ? falta.descripcion : id
}

function detallarPregunta(
  antes: PreguntaUbicada,
  ahora: PreguntaUbicada,
  versionAntes: FormularioVersion,
  versionAhora: FormularioVersion,
): string[] {
  const a = antes.pregunta
  const b = ahora.pregunta
  const detalles: string[] = []

  if (a.texto !== b.texto) {
    detalles.push(`Texto: «${a.texto}» → «${b.texto}»`)
  }
  if (a.tipo !== b.tipo) {
    detalles.push(`Tipo de respuesta: ${NOMBRE_TIPO[a.tipo]} → ${NOMBRE_TIPO[b.tipo]}`)
  }
  if (a.obligatoria !== b.obligatoria) {
    detalles.push(b.obligatoria ? 'Pasó a ser obligatoria' : 'Dejó de ser obligatoria')
  }

  const opcionesAntes = (a.opciones ?? []).join(', ')
  const opcionesAhora = (b.opciones ?? []).join(', ')
  if (opcionesAntes !== opcionesAhora) {
    detalles.push(
      `Opciones: ${opcionesAntes === '' ? 'ninguna' : `«${opcionesAntes}»`} → ` +
        `${opcionesAhora === '' ? 'ninguna' : `«${opcionesAhora}»`}`,
    )
  }

  const constataAntes = !!a.respuestaQueIncumple && !!a.incumplimientoId
  const constataAhora = !!b.respuestaQueIncumple && !!b.incumplimientoId

  if (!constataAntes && constataAhora) {
    detalles.push(
      `Ahora responder «${etiquetaValor(b.respuestaQueIncumple!)}» constata la falta ` +
        `«${nombrarFalta(b.incumplimientoId, versionAhora)}»`,
    )
  } else if (constataAntes && !constataAhora) {
    detalles.push(
      'Ya no constata ninguna falta (antes ' +
        `«${etiquetaValor(a.respuestaQueIncumple!)}» constataba ` +
        `«${nombrarFalta(a.incumplimientoId, versionAntes)}»)`,
    )
  } else if (constataAntes && constataAhora) {
    if (a.incumplimientoId !== b.incumplimientoId) {
      detalles.push(
        `Cambió la falta que constata: «${nombrarFalta(a.incumplimientoId, versionAntes)}» → ` +
          `«${nombrarFalta(b.incumplimientoId, versionAhora)}»`,
      )
    }
    if (a.respuestaQueIncumple !== b.respuestaQueIncumple) {
      detalles.push(
        `La respuesta que constata la falta pasó de «${etiquetaValor(a.respuestaQueIncumple!)}» ` +
          `a «${etiquetaValor(b.respuestaQueIncumple!)}»`,
      )
    }
  }

  if (antes.seccion !== ahora.seccion) {
    detalles.push(`Se movió de «${antes.seccion}» a «${ahora.seccion}»`)
  }

  return detalles
}

function detallarFalta(a: Incumplimiento, b: Incumplimiento): string[] {
  const detalles: string[] = []
  if (a.descripcion !== b.descripcion) {
    detalles.push(`Descripción: «${a.descripcion}» → «${b.descripcion}»`)
  }
  if (a.normativa !== b.normativa) {
    detalles.push(`Encuadre normativo: ${a.normativa} → ${b.normativa}`)
  }
  if (a.plazoSubsanacionDias !== b.plazoSubsanacionDias) {
    detalles.push(
      `Plazo para subsanar: ${a.plazoSubsanacionDias} → ${b.plazoSubsanacionDias} días`,
    )
  }
  if (a.gravedad !== b.gravedad) {
    detalles.push(`Gravedad: ${NOMBRE_GRAVEDAD[a.gravedad]} → ${NOMBRE_GRAVEDAD[b.gravedad]}`)
  }
  return detalles
}

function comparar(nueva: FormularioVersion, previa: FormularioVersion): Comparacion {
  const antes = indexarPreguntas(previa)
  const ahora = indexarPreguntas(nueva)

  const preguntasAgregadas: CambioPregunta[] = []
  const preguntasCambiadas: CambioPregunta[] = []
  for (const [id, ubicada] of ahora) {
    const anterior = antes.get(id)
    if (!anterior) {
      preguntasAgregadas.push(comoCambio(ubicada))
      continue
    }
    const detalles = detallarPregunta(anterior, ubicada, previa, nueva)
    if (detalles.length > 0) {
      preguntasCambiadas.push({ ...comoCambio(ubicada), detalles })
    }
  }

  const preguntasQuitadas: CambioPregunta[] = []
  for (const [id, ubicada] of antes) {
    if (!ahora.has(id)) preguntasQuitadas.push(comoCambio(ubicada))
  }

  const faltasAntes = new Map(previa.incumplimientos.map((i) => [i.id, i]))
  const faltasAhora = new Map(nueva.incumplimientos.map((i) => [i.id, i]))

  const faltasAgregadas: CambioFalta[] = []
  const faltasCambiadas: CambioFalta[] = []
  for (const [id, falta] of faltasAhora) {
    const anterior = faltasAntes.get(id)
    if (!anterior) {
      faltasAgregadas.push({ id, descripcion: falta.descripcion, detalles: [] })
      continue
    }
    const detalles = detallarFalta(anterior, falta)
    if (detalles.length > 0) {
      faltasCambiadas.push({ id, descripcion: falta.descripcion, detalles })
    }
  }

  const faltasQuitadas: CambioFalta[] = []
  for (const [id, falta] of faltasAntes) {
    if (!faltasAhora.has(id)) {
      faltasQuitadas.push({ id, descripcion: falta.descripcion, detalles: [] })
    }
  }

  const titulosAntes = new Set(previa.secciones.map((s) => s.titulo))
  const titulosAhora = new Set(nueva.secciones.map((s) => s.titulo))
  const seccionesAgregadas = [...titulosAhora].filter((t) => !titulosAntes.has(t))
  const seccionesQuitadas = [...titulosAntes].filter((t) => !titulosAhora.has(t))

  return {
    contra: previa.version,
    preguntasAgregadas,
    preguntasQuitadas,
    preguntasCambiadas,
    faltasAgregadas,
    faltasQuitadas,
    faltasCambiadas,
    seccionesAgregadas,
    seccionesQuitadas,
    sinCambios:
      preguntasAgregadas.length === 0 &&
      preguntasQuitadas.length === 0 &&
      preguntasCambiadas.length === 0 &&
      faltasAgregadas.length === 0 &&
      faltasQuitadas.length === 0 &&
      faltasCambiadas.length === 0 &&
      seccionesAgregadas.length === 0 &&
      seccionesQuitadas.length === 0 &&
      previa.titulo === nueva.titulo,
  }
}

// ── Carga ─────────────────────────────────────────────────────────────

const cargando = ref(true)
const problema = ref('')
const versiones = ref<FormularioVersion[]>([])
const tipo = ref<TipoInspeccion | undefined>()
const borrador = ref<BorradorFormulario | undefined>()
const elegidaId = ref<Uuid>('')
const fechaConsulta = ref('')
const avisoFecha = ref('')

/**
 * El historial es parte del contrato de edicion de checklists. Si la
 * implementacion todavia no lo ofrece, se dice con todas las letras en vez de
 * mostrar una pantalla vacia que parece un formulario sin historia.
 */
async function listarVersiones(id: Uuid): Promise<FormularioVersion[] | undefined> {
  const repositorio = almacen.formularios as Partial<RepositorioFormularios>
  if (typeof repositorio.versiones !== 'function') return undefined
  return repositorio.versiones(id)
}

async function buscarBorrador(id: Uuid): Promise<BorradorFormulario | undefined> {
  const repositorio = almacen.formularios as Partial<RepositorioFormularios>
  if (typeof repositorio.borradores !== 'function') return undefined
  const abiertos = await repositorio.borradores()
  return abiertos.find((b) => b.formularioId === id)
}

async function cargar() {
  cargando.value = true
  problema.value = ''
  try {
    const id = formularioId.value
    const historial = await listarVersiones(id)
    if (!historial) {
      problema.value =
        'Esta instalación todavía no guarda el historial de versiones de los formularios.'
      versiones.value = []
      return
    }

    // El contrato ya las devuelve de la mas nueva a la mas vieja; se reordena
    // igual porque toda la pantalla depende de ese orden.
    versiones.value = [...historial].sort((a, b) => b.version - a.version)

    const tipos = await almacen.formularios.tiposInspeccion()
    const ids = new Set(versiones.value.map((v) => v.id))
    tipo.value = tipos.find((t) => ids.has(t.formularioVersionId))
    borrador.value = await buscarBorrador(id)

    const vigente = versiones.value.find((v) => v.id === tipo.value?.formularioVersionId)
    elegidaId.value = vigente?.id ?? versiones.value[0]?.id ?? ''
  } catch (error) {
    problema.value = 'No se pudo leer el historial: ' + String(error)
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)
watch(formularioId, cargar)

// ── Lectura ───────────────────────────────────────────────────────────

const titulo = computed(() => versiones.value[0]?.titulo ?? 'Formulario')
const vigenteId = computed(() => tipo.value?.formularioVersionId ?? versiones.value[0]?.id)

const elegida = computed(() => versiones.value.find((v) => v.id === elegidaId.value))
const indiceElegida = computed(() => versiones.value.findIndex((v) => v.id === elegidaId.value))

/** La version inmediatamente anterior a una dada, o nada si es la primera. */
function previaDe(indice: number): FormularioVersion | undefined {
  return indice >= 0 ? versiones.value[indice + 1] : undefined
}

function comparacionDe(indice: number): Comparacion | undefined {
  const version = versiones.value[indice]
  const previa = previaDe(indice)
  if (!version || !previa) return undefined
  return comparar(version, previa)
}

/** Las comparaciones de todas las versiones: la lista muestra un resumen de cada una. */
const comparaciones = computed(() => versiones.value.map((_, i) => comparacionDe(i)))

const comparacionElegida = computed(() => comparaciones.value[indiceElegida.value])

const preguntasNuevas = computed(
  () => comparacionElegida.value?.preguntasAgregadas.map((c) => c.id) ?? [],
)
const preguntasCambiadas = computed(
  () => comparacionElegida.value?.preguntasCambiadas.map((c) => c.id) ?? [],
)

function contarPreguntas(version: FormularioVersion): number {
  return version.secciones.reduce((suma, s) => suma + s.preguntas.length, 0)
}

/** Hasta cuando rigió: hasta que empezó a regir la siguiente. */
function rigioHasta(indice: number): string {
  const posterior = versiones.value[indice - 1]
  return posterior ? formatearFecha(posterior.vigenteDesde) : ''
}

function textoVigencia(indice: number): string {
  const version = versiones.value[indice]
  if (!version) return ''
  const desde = formatearFecha(version.vigenteDesde)
  const hasta = rigioHasta(indice)
  if (!hasta) return `Rige desde el ${desde}`
  return `Rigió del ${desde} al ${hasta}`
}

/**
 * Quien publico la version, cuando el dato existe. El tipo del dominio todavia
 * no lo declara, asi que se lee sin suponer que esta: mostrar «publicó: nadie»
 * seria peor que no mostrar la linea.
 */
function publicadaPor(version: FormularioVersion): string {
  const datos = version as unknown as Record<string, unknown>
  const valor = datos['publicadaPor'] ?? datos['publicadoPor'] ?? datos['autor']
  return typeof valor === 'string' ? valor : ''
}

function elegir(version: FormularioVersion) {
  elegidaId.value = version.id
  avisoFecha.value = ''
}

/**
 * Buscar por fecha es el atajo que contesta la pregunta real de esta pantalla:
 * con la fecha de una inspección vieja en la mano, cuál era su cuestionario.
 */
function buscarPorFecha() {
  const fecha = fechaConsulta.value
  if (!fecha) {
    avisoFecha.value = ''
    return
  }
  const encontrada = versiones.value.find((v) => v.vigenteDesde.slice(0, 10) <= fecha)
  if (!encontrada) {
    avisoFecha.value = 'Ese día todavía no regía ninguna versión de este formulario.'
    return
  }
  elegidaId.value = encontrada.id
  // Se le pone hora del mediodia para que el huso no corra la fecha un dia.
  avisoFecha.value = `El ${formatearFecha(fecha + 'T12:00:00')} regía la versión ${encontrada.version}.`
}
</script>

<template>
  <div class="pantalla">
    <header class="cabecera">
      <div class="crece">
        <RouterLink to="/formularios" class="volver chico">← Todos los formularios</RouterLink>
        <h2>{{ titulo }}</h2>
        <p v-if="tipo" class="tenue chico sub">
          <template v-if="tipo.nombre !== titulo">{{ tipo.nombre }} · </template>
          {{ tipo.direccionResponsable }}
        </p>
      </div>
      <p v-if="!cargando && versiones.length > 0" class="tenue chico conteo">
        {{ versiones.length }} {{ versiones.length === 1 ? 'versión' : 'versiones' }}
      </p>
    </header>

    <p class="candado" role="note">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="4" y="10" width="16" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 018 0v3" />
      </svg>
      <span>
        Historial de solo lectura. Una versión publicada no se modifica nunca: por eso un acta
        de hace ocho meses se puede reconstruir tal como se emitió. Para cambiar el checklist
        se edita el vigente y se publica una versión nueva.
      </span>
    </p>

    <p v-if="borrador" class="borrador chico">
      <span class="borrador-titulo">Este formulario tiene un borrador sin publicar</span>
      <span>
        Lo dejó {{ borrador.autor }} · última edición
        {{ formatearFechaHora(borrador.actualizadoEn) }}
      </span>
      <span>
        Todavía no es una versión: nada de lo que tiene rige en campo, y hasta que se publique
        no aparece en este historial.
        <RouterLink v-if="tipo" :to="'/formularios/' + tipo.id + '/editar'">
          Seguir editándolo
        </RouterLink>
      </span>
    </p>

    <p v-if="problema" class="nota nota--error" role="alert">{{ problema }}</p>
    <p v-if="cargando" class="vacio">Leyendo el historial…</p>
    <p v-else-if="versiones.length === 0 && !problema" class="vacio">
      Este formulario no tiene ninguna versión publicada.
    </p>

    <div v-else-if="versiones.length > 0" class="columnas">
      <!-- ── Linea de tiempo ─────────────────────────────────────── -->
      <aside class="historial">
        <div class="buscar">
          <label for="fecha-consulta" class="etiqueta">Qué versión regía el día</label>
          <div class="fila">
            <input
              id="fecha-consulta"
              v-model="fechaConsulta"
              type="date"
              class="entrada-fecha"
              @change="buscarPorFecha"
            />
            <button type="button" class="boton boton--secundario" @click="buscarPorFecha">
              Buscar
            </button>
          </div>
          <p v-if="avisoFecha" class="chico aviso-fecha">{{ avisoFecha }}</p>
        </div>

        <ol class="lista">
          <li v-for="(version, i) in versiones" :key="version.id">
            <button
              type="button"
              class="version"
              :class="{ 'version--elegida': version.id === elegidaId }"
              :aria-current="version.id === elegidaId ? 'true' : undefined"
              @click="elegir(version)"
            >
              <span class="version-fila">
                <strong class="version-numero">Versión {{ version.version }}</strong>
                <span v-if="version.id === vigenteId" class="distintivo distintivo--cerrada">
                  Vigente
                </span>
              </span>
              <span class="chico tenue">{{ textoVigencia(i) }}</span>
              <span v-if="publicadaPor(version)" class="chico tenue">
                Publicó {{ publicadaPor(version) }}
              </span>
              <span class="chico resumen-cambios">
                <template v-if="comparaciones[i]">
                  <span v-if="comparaciones[i]!.sinCambios" class="tenue">
                    Sin cambios en las preguntas
                  </span>
                  <template v-else>
                    <span v-if="comparaciones[i]!.preguntasAgregadas.length" class="alta">
                      +{{ comparaciones[i]!.preguntasAgregadas.length }}
                    </span>
                    <span v-if="comparaciones[i]!.preguntasQuitadas.length" class="baja">
                      −{{ comparaciones[i]!.preguntasQuitadas.length }}
                    </span>
                    <span v-if="comparaciones[i]!.preguntasCambiadas.length" class="cambio">
                      ~{{ comparaciones[i]!.preguntasCambiadas.length }}
                    </span>
                    <span class="tenue">preguntas</span>
                  </template>
                </template>
                <span v-else class="tenue">Primera versión</span>
              </span>
            </button>
          </li>
        </ol>
      </aside>

      <!-- ── Version elegida ─────────────────────────────────────── -->
      <section v-if="elegida" class="detalle">
        <div class="tarjeta">
          <div class="detalle-cabecera">
            <div class="crece">
              <h3>Versión {{ elegida.version }}</h3>
              <p class="chico tenue sub">
                {{ textoVigencia(indiceElegida) }} ·
                {{ contarPreguntas(elegida) }} preguntas ·
                {{ elegida.incumplimientos.length }} faltas
                <template v-if="publicadaPor(elegida)">
                  · publicó {{ publicadaPor(elegida) }}
                </template>
              </p>
            </div>
            <span v-if="elegida.id === vigenteId" class="distintivo distintivo--cerrada">
              Vigente
            </span>
            <span v-else class="distintivo">Ya no rige</span>
          </div>
        </div>

        <!-- ── Que cambió ────────────────────────────────────────── -->
        <div class="tarjeta cambios">
          <h3 v-if="comparacionElegida">
            Qué cambió respecto de la versión {{ comparacionElegida.contra }}
          </h3>
          <h3 v-else>Primera versión</h3>

          <p v-if="!comparacionElegida" class="tenue chico">
            No hay versión anterior con la cual compararla: acá empieza la historia de este
            formulario.
          </p>
          <p v-else-if="comparacionElegida.sinCambios" class="tenue chico">
            Ni las preguntas ni las faltas cambiaron. Se publicó una versión nueva sin tocar el
            contenido.
          </p>

          <template v-else-if="comparacionElegida">
            <p
              v-if="comparacionElegida.seccionesAgregadas.length > 0 ||
                comparacionElegida.seccionesQuitadas.length > 0"
              class="chico secciones"
            >
              <span v-if="comparacionElegida.seccionesAgregadas.length > 0">
                <span class="alta">Secciones nuevas:</span>
                {{ comparacionElegida.seccionesAgregadas.join(', ') }}
              </span>
              <span v-if="comparacionElegida.seccionesQuitadas.length > 0">
                <span class="baja">Secciones que ya no están:</span>
                {{ comparacionElegida.seccionesQuitadas.join(', ') }}
              </span>
            </p>

            <div v-if="comparacionElegida.preguntasAgregadas.length > 0" class="bloque">
              <h4 class="bloque-titulo alta">
                {{ comparacionElegida.preguntasAgregadas.length }}
                {{ comparacionElegida.preguntasAgregadas.length === 1
                  ? 'pregunta agregada' : 'preguntas agregadas' }}
              </h4>
              <ul class="cambios-lista">
                <li v-for="c in comparacionElegida.preguntasAgregadas" :key="c.id" class="alta-item">
                  <p class="cambio-texto">{{ c.texto }}</p>
                  <p class="tenue chico">{{ c.seccion }} · {{ NOMBRE_TIPO[c.tipo] }}</p>
                </li>
              </ul>
            </div>

            <div v-if="comparacionElegida.preguntasQuitadas.length > 0" class="bloque">
              <h4 class="bloque-titulo baja">
                {{ comparacionElegida.preguntasQuitadas.length }}
                {{ comparacionElegida.preguntasQuitadas.length === 1
                  ? 'pregunta quitada' : 'preguntas quitadas' }}
              </h4>
              <ul class="cambios-lista">
                <li v-for="c in comparacionElegida.preguntasQuitadas" :key="c.id" class="baja-item">
                  <p class="cambio-texto tachado">{{ c.texto }}</p>
                  <p class="tenue chico">Estaba en «{{ c.seccion }}»</p>
                </li>
              </ul>
            </div>

            <div v-if="comparacionElegida.preguntasCambiadas.length > 0" class="bloque">
              <h4 class="bloque-titulo cambio">
                {{ comparacionElegida.preguntasCambiadas.length }}
                {{ comparacionElegida.preguntasCambiadas.length === 1
                  ? 'pregunta modificada' : 'preguntas modificadas' }}
              </h4>
              <ul class="cambios-lista">
                <li
                  v-for="c in comparacionElegida.preguntasCambiadas"
                  :key="c.id"
                  class="cambio-item"
                >
                  <p class="cambio-texto">{{ c.texto }}</p>
                  <ul class="detalles chico">
                    <li v-for="(d, j) in c.detalles" :key="j">{{ d }}</li>
                  </ul>
                </li>
              </ul>
            </div>

            <div
              v-if="comparacionElegida.faltasAgregadas.length > 0 ||
                comparacionElegida.faltasQuitadas.length > 0 ||
                comparacionElegida.faltasCambiadas.length > 0"
              class="bloque"
            >
              <h4 class="bloque-titulo">Faltas</h4>
              <ul class="cambios-lista">
                <li v-for="c in comparacionElegida.faltasAgregadas" :key="'a' + c.id" class="alta-item">
                  <p class="cambio-texto"><span class="alta">Nueva:</span> {{ c.descripcion }}</p>
                </li>
                <li v-for="c in comparacionElegida.faltasQuitadas" :key="'b' + c.id" class="baja-item">
                  <p class="cambio-texto">
                    <span class="baja">Quitada:</span>&nbsp;<span class="tachado">{{
                      c.descripcion }}</span>
                  </p>
                </li>
                <li v-for="c in comparacionElegida.faltasCambiadas" :key="'c' + c.id" class="cambio-item">
                  <p class="cambio-texto">{{ c.descripcion }}</p>
                  <ul class="detalles chico">
                    <li v-for="(d, j) in c.detalles" :key="j">{{ d }}</li>
                  </ul>
                </li>
              </ul>
            </div>
          </template>
        </div>

        <!-- ── Como se veia ──────────────────────────────────────── -->
        <div class="tarjeta">
          <h3 class="titulo-previa">El checklist tal como se completaba con esta versión</h3>
          <VistaPreviaChecklist
            :formulario="elegida"
            :preguntas-nuevas="preguntasNuevas"
            :preguntas-cambiadas="preguntasCambiadas"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.pantalla {
  padding: 1rem;
  padding-bottom: calc(var(--alto-pie) + var(--seguro-abajo) + 2rem);
  max-width: 1180px;
  margin-inline: auto;
}

.cabecera {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.volver {
  display: inline-block;
  margin-bottom: 0.3rem;
  color: var(--apagado);
  text-decoration: none;
  font-weight: 600;
}

.volver:hover {
  text-decoration: underline;
}

.sub {
  margin: 0.2rem 0 0;
}

.conteo {
  margin: 0;
  white-space: nowrap;
}

.candado {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  margin: 0 0 1rem;
  padding: 0.65rem 0.8rem;
  background: var(--superficie-2);
  border-left: 4px solid var(--tinta);
  border-radius: var(--radio-chico);
  font-size: 0.875rem;
  color: var(--apagado);
}

.candado svg {
  flex: none;
  margin-top: 0.15rem;
  color: var(--tinta);
}

.nota {
  margin: 0 0 1rem;
  padding: 0.6rem 0.75rem;
  border-radius: var(--radio-chico);
  font-size: 0.875rem;
  font-weight: 600;
}

.nota--error {
  background: var(--rojo-suave);
  color: var(--rojo);
}

.columnas {
  display: grid;
  grid-template-columns: minmax(240px, 320px) 1fr;
  gap: 1rem;
  align-items: start;
}

@media (max-width: 900px) {
  .columnas {
    grid-template-columns: 1fr;
  }
}

/* ── Linea de tiempo ─────────────────────────────────────────────── */

.historial {
  position: sticky;
  top: calc(var(--alto-barra) + var(--seguro-arriba) + 0.5rem);
}

.buscar {
  padding: 0.7rem;
  margin-bottom: 0.75rem;
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: var(--radio);
}

.entrada-fecha {
  flex: 1;
  min-width: 0;
  min-height: 48px;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--borde);
  border-radius: var(--radio-chico);
  background: var(--superficie);
}

.buscar .fila {
  margin-top: 0.35rem;
}

.aviso-fecha {
  margin: 0.4rem 0 0;
  font-weight: 600;
}

.lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 60vh;
  overflow-y: auto;
}

.version {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.65rem 0.75rem;
  text-align: left;
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-left: 4px solid var(--borde);
  border-radius: var(--radio);
  color: var(--tinta);
  cursor: pointer;
}

.version:hover {
  background: var(--superficie-2);
}

.version--elegida {
  border-left-color: var(--tinta);
  background: var(--superficie-2);
}

.version-fila {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}

.version-numero {
  font-size: 1rem;
}

.resumen-cambios {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.15rem;
  font-variant-numeric: tabular-nums;
}

/* ── Detalle ─────────────────────────────────────────────────────── */

.detalle {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.detalle-cabecera {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.6rem;
}

.borrador {
  margin: 0 0 1rem;
  padding: 0.6rem 0.7rem;
  background: var(--ambar-suave);
  border-radius: var(--radio-chico);
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.borrador-titulo {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ambar);
}

.borrador a {
  color: var(--tinta);
  font-weight: 700;
}

.cambios h3 {
  margin-bottom: 0.5rem;
}

.secciones {
  margin: 0 0 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.bloque {
  margin-top: 0.9rem;
}

.bloque-titulo {
  margin: 0 0 0.4rem;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.alta {
  color: var(--verde);
  font-weight: 700;
}

.baja {
  color: var(--rojo);
  font-weight: 700;
}

.cambio {
  color: var(--ambar);
  font-weight: 700;
}

.cambios-lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.cambios-lista li {
  padding: 0.5rem 0.65rem;
  border-radius: var(--radio-chico);
  border-left: 3px solid var(--borde);
  background: var(--superficie-2);
}

.cambios-lista li.alta-item {
  border-left-color: var(--verde);
  background: var(--verde-suave);
}

.cambios-lista li.baja-item {
  border-left-color: var(--rojo);
  background: var(--rojo-suave);
}

.cambios-lista li.cambio-item {
  border-left-color: var(--ambar);
  background: var(--ambar-suave);
}

.cambio-texto {
  margin: 0;
  font-weight: 600;
  line-height: 1.35;
}

.tachado {
  text-decoration: line-through;
}

.detalles {
  margin: 0.3rem 0 0;
  padding-left: 1.1rem;
  color: var(--apagado);
}

.detalles li {
  padding: 0;
  border: none;
  background: none;
  margin-bottom: 0.1rem;
}

.titulo-previa {
  margin-bottom: 0.75rem;
}
</style>
