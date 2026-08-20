<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import CapturaFotos from '@/componentes/CapturaFotos.vue'
import type { FormularioVersion, Incumplimiento, Pregunta, Uuid } from '@/dominio/tipos'

/**
 * Checklist dinamico de una version de formulario.
 *
 * El componente no guarda nada: avisa cada cambio hacia arriba. Quien orquesta
 * la inspeccion decide cuando persistir. Asi el mismo checklist sirve para
 * ejecutar la inspeccion y para mostrarla despues en modo lectura.
 */

type Valor = string | number | boolean | null

const props = defineProps<{
  formulario: FormularioVersion
  datos: Record<string, Valor>
  inspeccionUuid: Uuid
  /** Cuantas fotos hay cargadas para cada pregunta de tipo foto. */
  fotosPorPregunta?: Record<string, number>
  /** Pregunta obligatoria sin responder a la que hay que llevar al inspector. */
  faltante?: string | null
  soloLectura?: boolean
}>()

const emit = defineEmits<{
  (e: 'responder', preguntaId: string, valor: Valor): void
  (e: 'cambio-fotos'): void
}>()

const preguntas = computed(() => props.formulario.secciones.flatMap((s) => s.preguntas))

function respondida(p: Pregunta): boolean {
  if (p.tipo === 'foto') return (props.fotosPorPregunta?.[p.id] ?? 0) > 0
  const v = props.datos[p.id]
  return v !== null && v !== undefined && v !== ''
}

const total = computed(() => preguntas.value.length)
const contestadas = computed(() => preguntas.value.filter(respondida).length)
const faltanObligatorias = computed(
  () => preguntas.value.filter((p) => p.obligatoria && !respondida(p)).length,
)
const avance = computed(() =>
  total.value === 0 ? 100 : Math.round((contestadas.value / total.value) * 100),
)

const incumplimientosPorId = computed(
  () => new Map(props.formulario.incumplimientos.map((i) => [i.id, i])),
)

/** La falta que queda constatada por como esta respondida esta pregunta. */
function faltaDe(p: Pregunta): Incumplimiento | undefined {
  if (!p.respuestaQueIncumple || !p.incumplimientoId) return undefined
  const v = props.datos[p.id]
  if (v === null || v === undefined || v === '') return undefined
  if (String(v) !== p.respuestaQueIncumple) return undefined
  return incumplimientosPorId.value.get(p.incumplimientoId)
}

interface Opcion {
  valor: string
  texto: string
}

function opcionesDe(p: Pregunta): Opcion[] {
  if (p.tipo === 'si_no') {
    return [
      { valor: 'si', texto: 'Sí' },
      { valor: 'no', texto: 'No' },
    ]
  }
  if (p.tipo === 'si_no_na') {
    return [
      { valor: 'si', texto: 'Sí' },
      { valor: 'no', texto: 'No' },
      { valor: 'na', texto: 'No aplica' },
    ]
  }
  return (p.opciones ?? []).map((o) => ({ valor: o, texto: o }))
}

function elegir(p: Pregunta, valor: string) {
  if (props.soloLectura) return
  emit('responder', p.id, valor)
}

function escribir(p: Pregunta, evento: Event) {
  const destino = evento.target as HTMLTextAreaElement
  emit('responder', p.id, destino.value === '' ? null : destino.value)
}

function escribirNumero(p: Pregunta, evento: Event) {
  const destino = evento.target as HTMLInputElement
  if (destino.value === '') {
    emit('responder', p.id, null)
    return
  }
  const n = Number(destino.value)
  emit('responder', p.id, Number.isFinite(n) ? n : null)
}

function textoDe(p: Pregunta): string {
  const v = props.datos[p.id]
  return v === null || v === undefined ? '' : String(v)
}

/** Cuando la validacion señala una pregunta sin responder, hay que llevar el ojo ahi. */
watch(
  () => props.faltante,
  async (id) => {
    if (!id) return
    await nextTick()
    document.getElementById('pregunta-' + id)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  },
  { immediate: true },
)
</script>

<template>
  <div class="checklist">
    <div class="avance" role="status">
      <div class="avance-texto">
        <strong>{{ contestadas }} de {{ total }} respondidas</strong>
        <span v-if="faltanObligatorias > 0" class="avance-falta">
          Faltan {{ faltanObligatorias }} obligatorias
        </span>
        <span v-else class="avance-listo">Están todas las obligatorias</span>
      </div>
      <div class="barra">
        <div class="barra-llena" :style="{ width: avance + '%' }"></div>
      </div>
    </div>

    <section v-for="seccion in formulario.secciones" :key="seccion.id" class="seccion">
      <h2 class="seccion-titulo">{{ seccion.titulo }}</h2>

      <article
        v-for="pregunta in seccion.preguntas"
        :id="'pregunta-' + pregunta.id"
        :key="pregunta.id"
        class="pregunta"
        :class="{
          'pregunta--faltante': faltante === pregunta.id,
          'pregunta--con-falta': !!faltaDe(pregunta),
        }"
      >
        <p class="pregunta-texto">
          {{ pregunta.texto }}
          <span v-if="pregunta.obligatoria" class="obligatoria" aria-label="obligatoria">*</span>
        </p>

        <div
          v-if="
            pregunta.tipo === 'si_no' ||
            pregunta.tipo === 'si_no_na' ||
            pregunta.tipo === 'opciones'
          "
          class="opciones"
          :class="{ 'opciones--lista': pregunta.tipo === 'opciones' }"
        >
          <button
            v-for="opcion in opcionesDe(pregunta)"
            :key="opcion.valor"
            type="button"
            class="opcion"
            :class="{ 'opcion--elegida': textoDe(pregunta) === opcion.valor }"
            :aria-pressed="textoDe(pregunta) === opcion.valor"
            :disabled="soloLectura"
            @click="elegir(pregunta, opcion.valor)"
          >
            {{ opcion.texto }}
          </button>
        </div>

        <input
          v-else-if="pregunta.tipo === 'numero'"
          class="entrada"
          type="number"
          inputmode="decimal"
          :value="textoDe(pregunta)"
          :disabled="soloLectura"
          @input="escribirNumero(pregunta, $event)"
        />

        <textarea
          v-else-if="pregunta.tipo === 'texto'"
          class="entrada entrada--larga"
          rows="3"
          :value="textoDe(pregunta)"
          :disabled="soloLectura"
          @input="escribir(pregunta, $event)"
        ></textarea>

        <CapturaFotos
          v-else-if="pregunta.tipo === 'foto'"
          :inspeccion-uuid="inspeccionUuid"
          :pregunta-id="pregunta.id"
          :solo-lectura="soloLectura"
          compacto
          @cambio="emit('cambio-fotos')"
        />

        <p v-if="faltante === pregunta.id" class="aviso-faltante">
          Esta respuesta hace falta para poder cerrar.
        </p>

        <p v-if="faltaDe(pregunta)" class="falta">
          <span class="falta-titulo">Falta constatada</span>
          <span>{{ faltaDe(pregunta)?.descripcion }}</span>
          <span class="falta-normativa">{{ faltaDe(pregunta)?.normativa }}</span>
        </p>
      </article>
    </section>
  </div>
</template>

<style scoped>
.checklist {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.avance {
  position: sticky;
  top: calc(var(--alto-barra) + var(--seguro-arriba));
  z-index: 5;
  padding: 0.6rem 0.75rem;
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: var(--radio);
}

.avance-texto {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.875rem;
  margin-bottom: 0.4rem;
}

.avance-falta {
  color: var(--ambar);
  font-weight: 700;
  white-space: nowrap;
}

.avance-listo {
  color: var(--verde);
  font-weight: 700;
  white-space: nowrap;
}

.barra {
  height: 8px;
  border-radius: 999px;
  background: var(--superficie-2);
  overflow: hidden;
}

.barra-llena {
  height: 100%;
  background: var(--verde);
  transition: width 0.2s ease;
}

.seccion {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.seccion-titulo {
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--apagado);
}

.pregunta {
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  padding: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  scroll-margin-top: calc(var(--alto-barra) + 6rem);
}

.pregunta--faltante {
  border-color: var(--rojo);
  box-shadow: 0 0 0 3px var(--rojo-suave);
}

.pregunta--con-falta {
  border-left: 4px solid var(--ambar);
}

.pregunta-texto {
  margin: 0;
  font-weight: 600;
  line-height: 1.35;
}

.obligatoria {
  color: var(--rojo);
}

.opciones {
  display: flex;
  gap: 0.5rem;
}

.opciones--lista {
  flex-direction: column;
}

.opcion {
  flex: 1;
  min-height: 56px;
  padding: 0.5rem 0.75rem;
  border: 2px solid var(--borde);
  border-radius: var(--radio);
  background: var(--superficie);
  color: var(--tinta);
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
}

.opcion--elegida {
  background: var(--tinta);
  border-color: var(--tinta);
  color: var(--papel);
}

.opcion:disabled {
  opacity: 0.6;
  cursor: default;
}

.entrada {
  width: 100%;
  min-height: 48px;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--borde);
  border-radius: var(--radio-chico);
  background: var(--superficie);
}

.entrada--larga {
  min-height: 88px;
  resize: vertical;
}

.aviso-faltante {
  margin: 0;
  color: var(--rojo);
  font-size: 0.875rem;
  font-weight: 600;
}

.falta {
  margin: 0;
  padding: 0.55rem 0.65rem;
  background: var(--ambar-suave);
  border-radius: var(--radio-chico);
  font-size: 0.875rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.falta-titulo {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ambar);
}

.falta-normativa {
  color: var(--apagado);
  font-size: 0.8125rem;
}
</style>
