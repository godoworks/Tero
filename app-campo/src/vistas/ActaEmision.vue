<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
/**
 * Emision, vista previa y descarga del acta.
 *
 * La regla que manda en esta pantalla: un acta emitida NO se vuelve a generar
 * nunca. Tiene numero correlativo y fecha de emision, es un documento. Si la
 * inspeccion ya tiene acta, se muestra la que esta guardada tal cual se emitio,
 * aunque hoy el formulario o los datos del objeto hayan cambiado.
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { almacen } from '@/datos/almacen'
import type { Acta, Incumplimiento, Inspeccion } from '@/dominio/tipos'
import { ahora, formatearFecha, formatearFechaHora, nuevoUuid, sumarDias } from '@/dominio/utilidades'
import {
  diasDePlazo, etiquetaGravedad, generarActaPdf, incumplimientosConstatados,
  nombreArchivoActa, type DatosActa,
} from '@/servicios/acta'

const props = defineProps<{ uuid: string }>()

type Situacion = 'cargando' | 'emitiendo' | 'lista' | 'sin_cerrar' | 'error'

const situacion = ref<Situacion>('cargando')
const mensaje = ref('')
const inspeccion = ref<Inspeccion>()
const acta = ref<Acta>()
const incumplimientos = ref<Incumplimiento[]>([])
const diasPlazo = ref(0)
const urlPdf = ref('')
const recienEmitida = ref(false)

/**
 * Emisiones en curso por inspeccion. Entrar dos veces muy rapido a la pantalla
 * no puede reservar dos correlativos para la misma inspeccion.
 */
const emisiones = new Map<string, Promise<Acta>>()

const nombreArchivo = computed(() =>
  acta.value ? nombreArchivoActa(acta.value.numero) : 'acta.pdf',
)

const hayIncumplimientos = computed(() => incumplimientos.value.length > 0)

function liberarUrl() {
  if (!urlPdf.value) return
  URL.revokeObjectURL(urlPdf.value)
  urlPdf.value = ''
}

function mostrar(documento: Acta) {
  acta.value = documento
  liberarUrl()
  urlPdf.value = URL.createObjectURL(documento.documento)
  situacion.value = 'lista'
}

function fallar(texto: string) {
  mensaje.value = texto
  situacion.value = 'error'
}

/** Todo lo que el acta necesita, en una sola pasada al almacen. */
async function reunir(i: Inspeccion) {
  const [organismo, objeto, tipoInspeccion, formulario, respuesta, evidencias, firma] =
    await Promise.all([
      almacen.territorio.organismoActual(),
      almacen.territorio.objeto(i.objetoId),
      almacen.formularios.tipoInspeccion(i.tipoInspeccionId),
      // La version exacta con la que se completo, no la vigente.
      almacen.formularios.formularioVersion(i.formularioVersionId),
      almacen.inspecciones.respuesta(i.uuid),
      almacen.inspecciones.evidencias(i.uuid),
      almacen.inspecciones.firma(i.uuid),
    ])

  if (!objeto) throw new Error('No se encontró el objeto inspeccionado.')
  if (!tipoInspeccion) throw new Error('No se encontró el tipo de inspección.')
  if (!formulario) throw new Error('No se encontró la versión del formulario.')

  return { organismo, objeto, tipoInspeccion, formulario, respuesta, evidencias, firma }
}

function resumir(
  formulario: Awaited<ReturnType<typeof reunir>>['formulario'],
  respuesta: Awaited<ReturnType<typeof reunir>>['respuesta'],
  plazoPorDefecto: number,
) {
  incumplimientos.value = incumplimientosConstatados(formulario, respuesta)
  diasPlazo.value = diasDePlazo(incumplimientos.value, plazoPorDefecto)
}

/** Genera el PDF, reserva el correlativo, guarda el acta y deja rastro. */
async function emitirAhora(i: Inspeccion): Promise<Acta> {
  const datos = await reunir(i)
  resumir(datos.formulario, datos.respuesta, datos.tipoInspeccion.plazoSubsanacionDias)

  const emitidaEn = ahora()
  // El plazo corre desde que se hizo la inspeccion, no desde que se imprime.
  const desde = i.ejecutadaEn ?? emitidaEn
  const plazoSubsanacion = sumarDias(desde, diasPlazo.value)

  // El numero se pide lo mas tarde posible: reservarlo y despues fallar al
  // generar el PDF dejaria un correlativo quemado.
  const numero = await almacen.inspecciones.siguienteNumeroActa()

  const contenido: DatosActa = {
    organismo: datos.organismo,
    inspeccion: i,
    objeto: datos.objeto,
    tipoInspeccion: datos.tipoInspeccion,
    formulario: datos.formulario,
    respuesta: datos.respuesta,
    evidencias: datos.evidencias,
    firma: datos.firma,
    numero,
    emitidaEn,
    plazoSubsanacion,
    diasPlazo: diasPlazo.value,
  }

  const documento = await generarActaPdf(contenido)

  const nueva: Acta = {
    id: nuevoUuid(),
    inspeccionUuid: i.uuid,
    numero,
    emitidaEn,
    plazoSubsanacion,
    documento,
  }
  await almacen.inspecciones.guardarActa(nueva)

  await almacen.auditoria.registrar({
    organismoId: i.organismoId,
    entidad: 'acta',
    entidadId: nueva.id,
    accion: 'emitida',
    detalle:
      `Acta ${numero} de la inspección ${i.uuid}. ` +
      `${incumplimientos.value.length} incumplimiento(s). ` +
      `Plazo de subsanación: ${formatearFecha(plazoSubsanacion)}.`,
    actor: i.asignadoA ?? 'inspector',
    ubicacion: i.ubicacionEjecucion,
  })

  return nueva
}

async function emitir(i: Inspeccion) {
  situacion.value = 'emitiendo'
  const enCurso = emisiones.get(i.uuid)
  const tarea = enCurso ?? emitirAhora(i)
  if (!enCurso) emisiones.set(i.uuid, tarea)
  try {
    const nueva = await tarea
    recienEmitida.value = !enCurso
    mostrar(nueva)
  } finally {
    if (!enCurso) emisiones.delete(i.uuid)
  }
}

async function cargar() {
  situacion.value = 'cargando'
  try {
    const i = await almacen.inspecciones.obtener(props.uuid)
    if (!i) {
      fallar('No se encontró la inspección.')
      return
    }
    inspeccion.value = i

    // Si ya tiene acta se muestra la guardada. No se regenera jamas.
    const existente = await almacen.inspecciones.acta(i.uuid)
    if (existente) {
      const datos = await reunir(i)
      resumir(datos.formulario, datos.respuesta, datos.tipoInspeccion.plazoSubsanacionDias)
      mostrar(existente)
      return
    }

    if (i.estado !== 'cerrada') {
      const datos = await reunir(i)
      resumir(datos.formulario, datos.respuesta, datos.tipoInspeccion.plazoSubsanacionDias)
      situacion.value = 'sin_cerrar'
      return
    }

    await emitir(i)
  } catch (error) {
    fallar(error instanceof Error ? error.message : 'No se pudo preparar el acta.')
  }
}

async function emitirIgual() {
  const i = inspeccion.value
  if (!i) return
  try {
    await emitir(i)
  } catch (error) {
    fallar(error instanceof Error ? error.message : 'No se pudo emitir el acta.')
  }
}

onMounted(cargar)
onUnmounted(liberarUrl)
</script>

<template>
  <div class="contenido apilado">
    <p v-if="situacion === 'cargando'" class="vacio">Buscando el acta…</p>

    <p v-else-if="situacion === 'emitiendo'" class="vacio">
      Emitiendo el acta en el dispositivo…
    </p>

    <div v-else-if="situacion === 'error'" class="tarjeta problema">
      <h2>No se pudo mostrar el acta</h2>
      <p class="chico">{{ mensaje }}</p>
      <button class="boton boton--secundario" type="button" @click="cargar">
        Reintentar
      </button>
    </div>

    <div v-else-if="situacion === 'sin_cerrar'" class="tarjeta apilado">
      <h2>La inspección todavía no está cerrada</h2>
      <p class="chico tenue">
        El acta lleva número correlativo y una vez emitida no se regenera. Conviene
        terminar el checklist y cerrar la inspección antes de emitirla.
      </p>
      <RouterLink class="boton boton--secundario" :to="'/inspeccion/' + props.uuid">
        Volver a la inspección
      </RouterLink>
      <button class="boton boton--fantasma" type="button" @click="emitirIgual">
        Emitir el acta igual
      </button>
    </div>

    <template v-else-if="acta">
      <div class="tarjeta ficha">
        <p class="etiqueta">Acta de inspección</p>
        <p class="numero">{{ acta.numero }}</p>
        <p class="chico tenue">Emitida el {{ formatearFechaHora(acta.emitidaEn) }}</p>

        <div class="plazo" :class="{ 'plazo--sin': !hayIncumplimientos }">
          <p class="etiqueta">
            {{ hayIncumplimientos ? 'Plazo de subsanación — vence el' : 'Sin incumplimientos' }}
          </p>
          <p v-if="hayIncumplimientos" class="plazo-fecha">
            {{ formatearFecha(acta.plazoSubsanacion) }}
          </p>
          <p v-else class="plazo-sin">No hay nada que subsanar</p>
          <p v-if="hayIncumplimientos" class="chico tenue">
            {{ diasPlazo }} días corridos desde la inspección
          </p>
        </div>
      </div>

      <div v-if="hayIncumplimientos" class="tarjeta apilado">
        <p class="etiqueta">Incumplimientos constatados</p>
        <div v-for="i in incumplimientos" :key="i.id" class="incumplimiento">
          <p class="incumplimiento-texto">{{ i.descripcion }}</p>
          <p class="chico tenue">{{ i.normativa }}</p>
          <span class="distintivo" :class="'gravedad--' + i.gravedad">
            {{ etiquetaGravedad(i.gravedad) }} · {{ i.plazoSubsanacionDias }} días
          </span>
        </div>
      </div>

      <a class="boton boton--ancho descargar" :href="urlPdf" :download="nombreArchivo">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />
        </svg>
        Descargar el acta en PDF
      </a>

      <p v-if="recienEmitida" class="chico tenue aviso">
        El acta quedó emitida y guardada en el dispositivo. No se vuelve a generar:
        entrar de nuevo a esta pantalla muestra siempre este mismo documento.
      </p>
      <p v-else class="chico tenue aviso">
        Acta ya emitida. Se muestra tal como se generó el
        {{ formatearFecha(acta.emitidaEn) }}.
      </p>

      <section class="previa">
        <p class="etiqueta">Vista previa</p>
        <iframe :src="urlPdf" class="visor" title="Vista previa del acta"></iframe>
        <p class="chico tenue">
          Si el visor no muestra el documento en este teléfono, usá el botón de descarga.
        </p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.ficha { text-align: left; }

.numero {
  margin: 0.1rem 0 0.15rem;
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}

.plazo {
  margin-top: 1rem;
  padding: 0.85rem 1rem;
  border: 2px solid var(--rojo);
  border-radius: var(--radio);
  background: var(--rojo-suave);
}

.plazo--sin {
  border-color: var(--verde);
  background: var(--verde-suave);
}

.plazo-fecha {
  margin: 0.15rem 0 0.1rem;
  font-size: 2.25rem;
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  color: var(--rojo);
}

.plazo-sin {
  margin: 0.15rem 0 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--verde);
}

.incumplimiento {
  padding-top: 0.7rem;
  border-top: 1px solid var(--filete);
}

.incumplimiento:first-of-type { border-top: 0; padding-top: 0; }

.incumplimiento-texto { margin: 0 0 0.15rem; font-weight: 600; }
.incumplimiento p { margin: 0 0 0.35rem; }

.gravedad--leve { background: var(--superficie-2); color: var(--apagado); }
.gravedad--grave { background: var(--ambar-suave); color: var(--ambar); }
.gravedad--muy_grave { background: var(--rojo-suave); color: var(--rojo); }

.descargar { min-height: 56px; font-size: 1.0625rem; }

.aviso { margin: 0; text-align: center; }

.previa { display: flex; flex-direction: column; gap: 0.5rem; }

.visor {
  width: 100%;
  height: 70vh;
  min-height: 420px;
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  background: var(--superficie);
}

.problema h2 { margin-bottom: 0.4rem; }
.problema p { margin: 0 0 0.9rem; }
</style>
