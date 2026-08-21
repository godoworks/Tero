<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
/**
 * Vista previa de una version de formulario, tal como la va a ver el inspector.
 *
 * Es de LECTURA y no puede ser otra cosa: se usa para mirar el checklist
 * vigente antes de editarlo y, sobre todo, para reconstruir con que preguntas
 * se hizo una inspeccion vieja. Una version publicada no se modifica nunca, asi
 * que aca no hay ni un control que se pueda tocar: las opciones se dibujan como
 * fichas apagadas, no como botones.
 *
 * Muestra lo que no se ve en el checklist de campo pero define el formulario:
 * de que tipo es cada respuesta, cual es obligatoria y que respuesta constata
 * que falta. Eso ultimo es lo que convierte un cuestionario en un acta.
 */

import { computed } from 'vue'
import type { FormularioVersion, Incumplimiento, Pregunta, TipoPregunta } from '@/dominio/tipos'

const props = defineProps<{
  formulario: FormularioVersion
  /** Preguntas que esta version agrego respecto de la anterior. */
  preguntasNuevas?: string[]
  /** Preguntas que cambiaron respecto de la anterior. */
  preguntasCambiadas?: string[]
}>()

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

const nuevas = computed(() => new Set(props.preguntasNuevas ?? []))
const cambiadas = computed(() => new Set(props.preguntasCambiadas ?? []))
const hayMarcas = computed(() => nuevas.value.size > 0 || cambiadas.value.size > 0)

const preguntas = computed(() => props.formulario.secciones.flatMap((s) => s.preguntas))
const totalPreguntas = computed(() => preguntas.value.length)
const totalObligatorias = computed(() => preguntas.value.filter((p) => p.obligatoria).length)

const faltasPorId = computed(
  () => new Map(props.formulario.incumplimientos.map((i) => [i.id, i])),
)

/** Las opciones que va a ver el inspector, ya en castellano. */
function opcionesDe(p: Pregunta): string[] {
  if (p.tipo === 'si_no') return ['Sí', 'No']
  if (p.tipo === 'si_no_na') return ['Sí', 'No', 'No aplica']
  if (p.tipo === 'opciones') return p.opciones ?? []
  return []
}

/** Que hace el inspector cuando la respuesta no es de opciones. */
function textoEntrada(p: Pregunta): string {
  if (p.tipo === 'texto') return 'Escribe la observación'
  if (p.tipo === 'numero') return 'Anota un número'
  if (p.tipo === 'foto') return 'Adjunta una o más fotos'
  return ''
}

function etiquetaValor(valor: string): string {
  if (valor === 'si') return 'Sí'
  if (valor === 'no') return 'No'
  if (valor === 'na') return 'No aplica'
  return valor
}

function faltaDe(p: Pregunta): Incumplimiento | undefined {
  return p.incumplimientoId ? faltasPorId.value.get(p.incumplimientoId) : undefined
}

/**
 * Faltas que ninguna pregunta constata sola. No sobran: son las que el
 * inspector agrega a mano al cerrar el acta, y por eso hay que poder verlas.
 */
const faltasSueltas = computed(() => {
  const usadas = new Set(
    preguntas.value.flatMap((p) => (p.incumplimientoId ? [p.incumplimientoId] : [])),
  )
  return props.formulario.incumplimientos.filter((i) => !usadas.has(i.id))
})
</script>

<template>
  <div class="vista-previa">
    <p class="aclaracion">
      Así lo ve el inspector en el teléfono. Es una vista de lectura: nada de lo que está acá
      se responde ni se edita.
    </p>

    <header class="encabezado">
      <h3 class="titulo">{{ formulario.titulo }}</h3>
      <p class="resumen tenue chico">
        Versión {{ formulario.version }} ·
        {{ formulario.secciones.length }}
        {{ formulario.secciones.length === 1 ? 'sección' : 'secciones' }} ·
        {{ totalPreguntas }} {{ totalPreguntas === 1 ? 'pregunta' : 'preguntas' }}
        ({{ totalObligatorias }} obligatorias) ·
        {{ formulario.incumplimientos.length }}
        {{ formulario.incumplimientos.length === 1 ? 'falta' : 'faltas' }}
      </p>
    </header>

    <p v-if="hayMarcas" class="leyenda chico">
      <span class="marca marca--nueva">Nueva</span> y
      <span class="marca marca--cambiada">Cambiada</span> señalan lo que se movió respecto de la
      versión anterior.
    </p>

    <p v-if="totalPreguntas === 0" class="vacio">Esta versión no tiene ninguna pregunta.</p>

    <section v-for="seccion in formulario.secciones" :key="seccion.id" class="seccion">
      <h4 class="seccion-titulo">{{ seccion.titulo }}</h4>

      <article
        v-for="pregunta in seccion.preguntas"
        :key="pregunta.id"
        class="pregunta"
        :class="{
          'pregunta--nueva': nuevas.has(pregunta.id),
          'pregunta--cambiada': cambiadas.has(pregunta.id),
        }"
      >
        <p class="pregunta-texto">
          {{ pregunta.texto }}
          <span v-if="pregunta.obligatoria" class="obligatoria" title="Obligatoria">*</span>
          <span v-if="nuevas.has(pregunta.id)" class="marca marca--nueva">Nueva</span>
          <span v-else-if="cambiadas.has(pregunta.id)" class="marca marca--cambiada">
            Cambiada
          </span>
        </p>

        <p class="meta chico">
          <span class="distintivo">{{ NOMBRE_TIPO[pregunta.tipo] }}</span>
          <span v-if="pregunta.obligatoria" class="distintivo distintivo--obligatoria">
            Obligatoria
          </span>
          <span v-else class="distintivo">Opcional</span>
        </p>

        <div v-if="opcionesDe(pregunta).length > 0" class="opciones">
          <span v-for="opcion in opcionesDe(pregunta)" :key="opcion" class="opcion">
            {{ opcion }}
          </span>
        </div>

        <p v-else class="entrada tenue chico">{{ textoEntrada(pregunta) }}</p>

        <p v-if="pregunta.respuestaQueIncumple" class="falta">
          <span class="falta-titulo">
            Si responde «{{ etiquetaValor(pregunta.respuestaQueIncumple) }}» queda constatado
          </span>
          <template v-if="faltaDe(pregunta)">
            <span>{{ faltaDe(pregunta)?.descripcion }}</span>
            <span class="falta-normativa">
              {{ faltaDe(pregunta)?.normativa }} ·
              {{ NOMBRE_GRAVEDAD[faltaDe(pregunta)!.gravedad] }} ·
              {{ faltaDe(pregunta)?.plazoSubsanacionDias }} días para subsanar
            </span>
          </template>
          <span v-else class="falta-rota">
            La falta «{{ pregunta.incumplimientoId }}» no está definida en esta versión.
          </span>
        </p>
      </article>
    </section>

    <section v-if="formulario.incumplimientos.length > 0" class="seccion">
      <h4 class="seccion-titulo">Faltas de esta versión</h4>
      <ul class="faltas">
        <li v-for="falta in formulario.incumplimientos" :key="falta.id" class="falta-ficha">
          <p class="falta-descripcion">{{ falta.descripcion }}</p>
          <p class="tenue chico falta-normativa">{{ falta.normativa }}</p>
          <p class="chico">
            <span class="distintivo" :class="'distintivo--' + falta.gravedad">
              {{ NOMBRE_GRAVEDAD[falta.gravedad] }}
            </span>
            <span class="distintivo">{{ falta.plazoSubsanacionDias }} días de plazo</span>
          </p>
        </li>
      </ul>
      <p v-if="faltasSueltas.length > 0" class="tenue chico nota-sueltas">
        {{ faltasSueltas.length }}
        {{ faltasSueltas.length === 1 ? 'falta no la constata' : 'faltas no las constata' }}
        ninguna pregunta: el inspector las agrega a mano al cerrar el acta.
      </p>
    </section>
  </div>
</template>

<style scoped>
.vista-previa {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.aclaracion {
  margin: 0;
  padding: 0.5rem 0.7rem;
  background: var(--superficie-2);
  border-radius: var(--radio-chico);
  font-size: 0.8125rem;
  color: var(--apagado);
}

.encabezado {
  border-bottom: 1px solid var(--filete);
  padding-bottom: 0.75rem;
}

.titulo {
  font-size: 1.0625rem;
}

.resumen {
  margin: 0.25rem 0 0;
}

.leyenda {
  margin: 0;
  color: var(--apagado);
}

.seccion {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.seccion-titulo {
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--apagado);
}

.pregunta {
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.pregunta--nueva {
  border-left: 4px solid var(--verde);
}

.pregunta--cambiada {
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

.marca {
  display: inline-block;
  margin-left: 0.4rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  vertical-align: middle;
}

.marca--nueva {
  background: var(--verde-suave);
  color: var(--verde);
}

.marca--cambiada {
  background: var(--ambar-suave);
  color: var(--ambar);
}

.meta {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.opciones {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

/* Fichas apagadas y no botones: se tiene que ver que no se puede responder. */
.opcion {
  padding: 0.3rem 0.7rem;
  border: 1px dashed var(--borde);
  border-radius: var(--radio-chico);
  background: var(--superficie-2);
  color: var(--apagado);
  font-size: 0.875rem;
  font-weight: 600;
}

.entrada {
  margin: 0;
  padding: 0.45rem 0.7rem;
  border: 1px dashed var(--borde);
  border-radius: var(--radio-chico);
  background: var(--superficie-2);
}

.falta {
  margin: 0;
  padding: 0.5rem 0.65rem;
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
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ambar);
}

.falta-normativa {
  color: var(--apagado);
  font-size: 0.8125rem;
}

.falta-rota {
  color: var(--rojo);
  font-weight: 600;
}

.faltas {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.6rem;
}

.falta-ficha {
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  padding: 0.7rem;
}

.falta-ficha p {
  margin: 0 0 0.25rem;
}

.falta-ficha p:last-child {
  margin-bottom: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.falta-descripcion {
  font-weight: 600;
}

.distintivo--obligatoria {
  background: var(--rojo-suave);
  color: var(--rojo);
}

.distintivo--leve {
  background: var(--superficie-2);
  color: var(--apagado);
}

.distintivo--grave {
  background: var(--ambar-suave);
  color: var(--ambar);
}

.distintivo--muy_grave {
  background: var(--rojo-suave);
  color: var(--rojo);
}

.nota-sueltas {
  margin: 0;
}
</style>
