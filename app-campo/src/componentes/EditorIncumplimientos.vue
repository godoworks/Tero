<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
/**
 * Donde queda usada una falta. Lo calcula la vista, que es la unica que ve el
 * borrador entero. Vive en un bloque aparte porque `<script setup>` no puede
 * exportar nada y la vista necesita este tipo para armar el dato.
 */
export interface UsoDeFalta {
  preguntaId: string
  preguntaTexto: string
  seccionTitulo: string
  /** La respuesta que la dispara, ya en palabras del inspector. */
  respuesta: string
}
</script>

<script setup lang="ts">
import type { Incumplimiento } from '@/dominio/tipos'

/**
 * Catalogo de faltas del formulario.
 *
 * Una falta no es un texto suelto: es lo que despues se imprime en el acta con
 * su encuadre normativo y su plazo. Por eso el catalogo vive dentro del
 * formulario y se publica junto con el, y no en una tabla aparte que alguien
 * pueda cambiar por atras dejando actas viejas citando algo que ya no dice eso.
 *
 * Dos avisos que el componente da siempre, porque son los dos errores que se
 * cometen armando un checklist:
 *
 *  - Una falta que ninguna pregunta usa nunca se va a constatar. Esta escrita
 *    para nada.
 *  - Borrar una falta que si se usa deja preguntas sin regla. Antes de dejar
 *    hacerlo hay que decir exactamente cuales.
 */

const props = defineProps<{
  faltas: Incumplimiento[]
  /** Clave: id de la falta. */
  usos: Record<string, UsoDeFalta[]>
  /** Falta a la que la persona acaba de ser llevada. */
  resaltada?: string | null
  /** Qué le falta a cada falta para poder publicar. Clave: id de la falta. */
  problemas?: Record<string, string[]>
}>()

const emit = defineEmits<{
  (e: 'agregar'): void
  (e: 'cambiar', falta: Incumplimiento): void
  (e: 'borrar', id: string): void
  (e: 'ir-a-pregunta', preguntaId: string): void
}>()

const GRAVEDADES: { clave: Incumplimiento['gravedad']; nombre: string }[] = [
  { clave: 'leve', nombre: 'Leve' },
  { clave: 'grave', nombre: 'Grave' },
  { clave: 'muy_grave', nombre: 'Muy grave' },
]

function cambiar(falta: Incumplimiento, parcial: Partial<Incumplimiento>) {
  emit('cambiar', { ...falta, ...parcial })
}

function alEscribirDescripcion(falta: Incumplimiento, evento: Event) {
  cambiar(falta, { descripcion: (evento.target as HTMLTextAreaElement).value })
}

function alEscribirNormativa(falta: Incumplimiento, evento: Event) {
  cambiar(falta, { normativa: (evento.target as HTMLInputElement).value })
}

function alEscribirPlazo(falta: Incumplimiento, evento: Event) {
  const bruto = (evento.target as HTMLInputElement).value
  const dias = Number.parseInt(bruto, 10)
  cambiar(falta, { plazoSubsanacionDias: Number.isFinite(dias) ? dias : 0 })
}

function usosDe(falta: Incumplimiento): UsoDeFalta[] {
  return props.usos[falta.id] ?? []
}

function problemasDe(falta: Incumplimiento): string[] {
  return props.problemas?.[falta.id] ?? []
}
</script>

<template>
  <section id="faltas" class="catalogo">
    <header class="cabecera">
      <div class="crece">
        <h2>Faltas que este checklist puede constatar</h2>
        <p class="ayuda">
          Son las únicas que las preguntas van a poder vincular. Cada una viaja al acta con su
          encuadre normativo y su plazo, tal como se escriba acá.
        </p>
      </div>
      <button type="button" class="boton boton--secundario" @click="emit('agregar')">
        Agregar una falta
      </button>
    </header>

    <p v-if="faltas.length === 0" class="vacio">
      Todavía no hay ninguna falta cargada. Sin faltas, el checklist sirve para dejar constancia de
      lo que se vio, pero ninguna inspección va a poder terminar en un acta.
    </p>

    <ul v-else class="lista">
      <li
        v-for="falta in faltas"
        :id="'falta-' + falta.id"
        :key="falta.id"
        class="ficha"
        :class="{
          'ficha--resaltada': resaltada === falta.id,
          'ficha--sin-uso': usosDe(falta).length === 0,
        }"
      >
        <ul v-if="problemasDe(falta).length > 0" class="problemas">
          <li v-for="p in problemasDe(falta)" :key="p">{{ p }}</li>
        </ul>

        <div class="campo">
          <label :for="'desc-' + falta.id">Qué se constata</label>
          <textarea
            :id="'desc-' + falta.id"
            class="entrada entrada--larga"
            rows="2"
            placeholder="Obra sin permiso de construcción vigente exhibido en el lugar"
            :value="falta.descripcion"
            @input="alEscribirDescripcion(falta, $event)"
          ></textarea>
          <p class="ayuda">Esta es la frase que va a leer el responsable en el acta.</p>
        </div>

        <div class="campo">
          <label :for="'norma-' + falta.id">Encuadre normativo</label>
          <input
            :id="'norma-' + falta.id"
            class="entrada"
            type="text"
            placeholder="Digesto Departamental, art. 34 (Decreto Departamental 3.117/2016)"
            :value="falta.normativa"
            @input="alEscribirNormativa(falta, $event)"
          />
          <p class="ayuda">El artículo que se cita. Sin esto el acta es impugnable.</p>
        </div>

        <div class="fila-campos">
          <div class="campo">
            <span class="etiqueta-campo">Gravedad</span>
            <div class="segmentado" role="group" aria-label="Gravedad de la falta">
              <button
                v-for="g in GRAVEDADES"
                :key="g.clave"
                type="button"
                class="segmento"
                :class="[
                  'segmento--' + g.clave,
                  { 'segmento--elegido': falta.gravedad === g.clave },
                ]"
                :aria-pressed="falta.gravedad === g.clave"
                @click="cambiar(falta, { gravedad: g.clave })"
              >
                {{ g.nombre }}
              </button>
            </div>
            <p class="ayuda">
              Con una falta grave o muy grave la inspección cierra como «no conforme».
            </p>
          </div>

          <div class="campo campo--plazo">
            <label :for="'plazo-' + falta.id">Plazo para corregir</label>
            <div class="con-sufijo">
              <input
                :id="'plazo-' + falta.id"
                class="entrada entrada--numero"
                type="number"
                min="1"
                max="365"
                inputmode="numeric"
                :value="falta.plazoSubsanacionDias"
                @input="alEscribirPlazo(falta, $event)"
              />
              <span class="sufijo">días corridos</span>
            </div>
            <p class="ayuda">Se cuenta desde que se notifica el acta.</p>
          </div>
        </div>

        <!-- ── Dónde se usa ──────────────────────────────────────── -->
        <div class="uso" :class="{ 'uso--huerfana': usosDe(falta).length === 0 }">
          <template v-if="usosDe(falta).length > 0">
            <span class="uso-titulo">
              La constatan {{ usosDe(falta).length }}
              {{ usosDe(falta).length === 1 ? 'pregunta' : 'preguntas' }}
            </span>
            <ul class="uso-lista">
              <li v-for="uso in usosDe(falta)" :key="uso.preguntaId">
                <button type="button" class="enlace" @click="emit('ir-a-pregunta', uso.preguntaId)">
                  {{ uso.preguntaTexto || 'Pregunta sin texto' }}
                </button>
                <span class="uso-detalle">
                  {{ uso.seccionTitulo }} · cuando se responde «{{ uso.respuesta }}»
                </span>
              </li>
            </ul>
          </template>
          <template v-else>
            <span class="uso-titulo">Ninguna pregunta la constata</span>
            <p class="uso-detalle">
              Tal como está, esta falta nunca se va a aplicar. Vinculala desde una pregunta o
              quitala del catálogo.
            </p>
          </template>
        </div>

        <div class="acciones">
          <button type="button" class="boton boton--fantasma boton--quitar" @click="emit('borrar', falta.id)">
            Quitar esta falta
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.catalogo {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.cabecera {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.ayuda {
  margin: 0.25rem 0 0;
  color: var(--apagado);
  font-size: 0.8125rem;
  font-weight: 400;
  line-height: 1.4;
}

.vacio {
  margin: 0;
  padding: 1.25rem;
  border: 1px dashed var(--borde);
  border-radius: var(--radio);
  background: var(--superficie);
  color: var(--apagado);
  max-width: 60ch;
}

.lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.ficha {
  padding: 0.9rem;
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-left: 4px solid var(--verde);
  border-radius: var(--radio);
  scroll-margin-top: calc(var(--alto-barra) + 2rem);
}

.ficha--sin-uso {
  border-left-color: var(--ambar);
}

.ficha--resaltada {
  border-color: var(--rojo);
  box-shadow: 0 0 0 3px var(--rojo-suave);
}

.problemas {
  list-style: none;
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.7rem;
  border-radius: var(--radio-chico);
  background: var(--rojo-suave);
  color: var(--rojo);
  font-size: 0.875rem;
  font-weight: 600;
}

.entrada {
  width: 100%;
  min-height: 44px;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--borde);
  border-radius: var(--radio-chico);
  background: var(--superficie);
}

.entrada--larga {
  min-height: 60px;
  resize: vertical;
}

.entrada--numero {
  width: 6rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.fila-campos {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
}

.campo--plazo { min-width: 200px; }

.etiqueta-campo {
  font-size: 0.875rem;
  font-weight: 600;
}

.con-sufijo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.sufijo {
  color: var(--apagado);
  font-size: 0.875rem;
}

/* ── Gravedad ───────────────────────────────────────────────────── */

.segmentado {
  display: inline-flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.segmento {
  min-height: 44px;
  padding: 0 0.9rem;
  border: 2px solid var(--borde);
  border-radius: var(--radio-chico);
  background: var(--superficie);
  color: var(--apagado);
  font-size: 0.875rem;
  font-weight: 700;
  cursor: pointer;
}

.segmento--elegido.segmento--leve {
  background: var(--superficie-2);
  border-color: var(--apagado);
  color: var(--tinta);
}

.segmento--elegido.segmento--grave {
  background: var(--ambar-suave);
  border-color: var(--ambar);
  color: var(--ambar);
}

.segmento--elegido.segmento--muy_grave {
  background: var(--rojo-suave);
  border-color: var(--rojo);
  color: var(--rojo);
}

/* ── Dónde se usa ───────────────────────────────────────────────── */

.uso {
  margin-top: 0.35rem;
  padding: 0.6rem 0.7rem;
  border-radius: var(--radio-chico);
  background: var(--verde-suave);
  font-size: 0.875rem;
}

.uso--huerfana {
  background: var(--ambar-suave);
}

.uso-titulo {
  display: block;
  font-weight: 700;
  color: var(--verde);
}

.uso--huerfana .uso-titulo { color: var(--ambar); }

.uso-lista {
  list-style: none;
  margin: 0.35rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.uso-detalle {
  display: block;
  margin: 0.1rem 0 0;
  color: var(--apagado);
  font-size: 0.8125rem;
}

.enlace {
  padding: 0;
  border: none;
  background: none;
  color: var(--tinta);
  font-size: 0.875rem;
  font-weight: 700;
  text-align: left;
  text-decoration: underline;
  cursor: pointer;
}

.acciones {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.5rem;
}

.boton--quitar {
  min-height: 40px;
  padding: 0 0.75rem;
  color: var(--rojo);
  font-size: 0.875rem;
}

@media (max-width: 720px) {
  .cabecera .boton { width: 100%; }
}
</style>
