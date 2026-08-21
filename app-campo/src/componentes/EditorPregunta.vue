<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { Incumplimiento, Pregunta, TipoPregunta } from '@/dominio/tipos'

/**
 * Edicion de una pregunta del checklist.
 *
 * Quien usa esta pantalla no programa: es el administrativo de la direccion que
 * sabe que hay que controlar en una obra. Por eso aca no aparece ni un nombre
 * tecnico. Tres decisiones ordenan el componente:
 *
 *  1. Plegada muestra lo que importa de un vistazo (que pregunta es, como se
 *     responde y si constata una falta). Un checklist de cuarenta preguntas no
 *     se puede recorrer si cada una ocupa media pantalla.
 *  2. Lo que en el modelo son `respuestaQueIncumple` e `incumplimientoId` aca es
 *     una sola frase que se lee de corrido: «Si la respuesta es No, se constata
 *     Obra sin permiso». Nadie tiene que entender que hay dos campos.
 *  3. Al lado de la edicion esta lo que va a ver el inspector en la calle. Es la
 *     unica forma de que armar el formulario no sea un acto de fe.
 *
 * El componente no guarda nada: avisa cada cambio hacia arriba con la pregunta
 * ya modificada. La vista decide cuando persistir.
 */

interface FichaTipo {
  clave: TipoPregunta
  nombre: string
  /** Que le aparece al inspector cuando le toca responderla. */
  comoSeResponde: string
}

const TIPOS: FichaTipo[] = [
  {
    clave: 'si_no',
    nombre: 'Sí / No',
    comoSeResponde: 'Dos botones grandes. El inspector toca uno.',
  },
  {
    clave: 'si_no_na',
    nombre: 'Sí / No / No aplica',
    comoSeResponde:
      'Tres botones. «No aplica» es para lo que no corresponde controlar en ese lugar.',
  },
  {
    clave: 'opciones',
    nombre: 'Una de varias opciones',
    comoSeResponde: 'Las opciones que definas acá abajo, una debajo de la otra.',
  },
  { clave: 'texto', nombre: 'Texto libre', comoSeResponde: 'Un recuadro para escribir.' },
  {
    clave: 'numero',
    nombre: 'Un número',
    comoSeResponde: 'Un campo numérico, con el teclado de números del teléfono.',
  },
  {
    clave: 'foto',
    nombre: 'Una foto',
    comoSeResponde: 'La cámara. Queda respondida cuando saca al menos una foto.',
  },
]

interface Respuesta {
  valor: string
  texto: string
}

const props = defineProps<{
  pregunta: Pregunta
  /** Lugar que ocupa dentro de la sección, empezando en 1. */
  posicion: number
  total: number
  /** Faltas que definió este formulario. Son las únicas que se pueden vincular. */
  faltas: Incumplimiento[]
  abierta: boolean
  /** Se la señala cuando la validación mandó a la persona hasta acá. */
  resaltada?: boolean
  /** Qué le falta a esta pregunta para poder publicar. */
  problemas?: string[]
}>()

const emit = defineEmits<{
  (e: 'cambiar', pregunta: Pregunta): void
  (e: 'borrar'): void
  (e: 'mover', direccion: -1 | 1): void
  (e: 'alternar'): void
  (e: 'nueva-falta'): void
}>()

// ── Respuestas posibles ─────────────────────────────────────────────

/**
 * Las respuestas concretas que el inspector puede llegar a tocar. Es lo unico
 * contra lo que tiene sentido definir una regla: si la pregunta se responde
 * escribiendo o sacando una foto, no hay nada que comparar.
 */
function respuestasDe(p: Pregunta): Respuesta[] {
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
  if (p.tipo === 'opciones') {
    return (p.opciones ?? [])
      .filter((o) => o.trim() !== '')
      .map((o) => ({ valor: o, texto: o }))
  }
  return []
}

const respuestas = computed(() => respuestasDe(props.pregunta))

/** Solo las de respuesta cerrada pueden decidir solas que hay una falta. */
const esDeRespuestaCerrada = computed(
  () =>
    props.pregunta.tipo === 'si_no' ||
    props.pregunta.tipo === 'si_no_na' ||
    props.pregunta.tipo === 'opciones',
)

const fichaTipo = computed(
  () => TIPOS.find((t) => t.clave === props.pregunta.tipo) ?? TIPOS[0],
)

const opciones = computed(() => props.pregunta.opciones ?? [])

// ── Cambios ─────────────────────────────────────────────────────────

function cambiar(parcial: Partial<Pregunta>) {
  emit('cambiar', { ...props.pregunta, ...parcial })
}

function alEscribirTexto(evento: Event) {
  cambiar({ texto: (evento.target as HTMLTextAreaElement).value })
}

function alCambiarObligatoria(evento: Event) {
  cambiar({ obligatoria: (evento.target as HTMLInputElement).checked })
}

/**
 * Cambiar el tipo puede dejar la regla apuntando a una respuesta que ya no
 * existe. Antes que guardar una regla rota se la suelta, y se avisa en pantalla.
 */
function alCambiarTipo(evento: Event) {
  const nuevo = (evento.target as HTMLSelectElement).value as TipoPregunta
  const siguiente: Pregunta = { ...props.pregunta, tipo: nuevo }

  if (nuevo === 'opciones') {
    if (!siguiente.opciones || siguiente.opciones.length === 0) siguiente.opciones = ['', '']
  } else {
    delete siguiente.opciones
  }

  const valores = respuestasDe(siguiente).map((r) => r.valor)
  if (!siguiente.respuestaQueIncumple || !valores.includes(siguiente.respuestaQueIncumple)) {
    delete siguiente.respuestaQueIncumple
    delete siguiente.incumplimientoId
  }
  emit('cambiar', siguiente)
}

// ── Opciones de la lista ────────────────────────────────────────────

function alEscribirOpcion(indice: number, evento: Event) {
  const valor = (evento.target as HTMLInputElement).value
  const lista = [...opciones.value]
  const anterior = lista[indice]
  lista[indice] = valor
  const siguiente: Pregunta = { ...props.pregunta, opciones: lista }
  // Si la regla apuntaba a esta opción, la sigue: renombrarla no es borrarla.
  if (siguiente.respuestaQueIncumple === anterior) siguiente.respuestaQueIncumple = valor
  emit('cambiar', siguiente)
}

function agregarOpcion() {
  cambiar({ opciones: [...opciones.value, ''] })
}

function borrarOpcion(indice: number) {
  const lista = [...opciones.value]
  const quitada = lista[indice]
  lista.splice(indice, 1)
  const siguiente: Pregunta = { ...props.pregunta, opciones: lista }
  if (siguiente.respuestaQueIncumple === quitada) {
    delete siguiente.respuestaQueIncumple
    delete siguiente.incumplimientoId
  }
  emit('cambiar', siguiente)
}

function moverOpcion(indice: number, direccion: -1 | 1) {
  const destino = indice + direccion
  if (destino < 0 || destino >= opciones.value.length) return
  const lista = [...opciones.value]
  const [movida] = lista.splice(indice, 1)
  lista.splice(destino, 0, movida)
  cambiar({ opciones: lista })
}

// ── La regla: qué respuesta constata qué falta ──────────────────────

const reglaActiva = computed(
  () => props.pregunta.respuestaQueIncumple !== undefined,
)

const faltaVinculada = computed(() =>
  props.faltas.find((f) => f.id === props.pregunta.incumplimientoId),
)

const textoRespuestaRegla = computed(() => {
  const valor = props.pregunta.respuestaQueIncumple
  if (valor === undefined) return ''
  return respuestas.value.find((r) => r.valor === valor)?.texto ?? valor
})

function alternarRegla(evento: Event) {
  if ((evento.target as HTMLInputElement).checked) {
    // Se arranca con lo más probable ya elegido: casi siempre la falta la
    // constata el «No», y si hay una sola falta cargada es esa.
    const preferida =
      respuestas.value.find((r) => r.valor === 'no') ?? respuestas.value[0]
    const siguiente: Pregunta = {
      ...props.pregunta,
      respuestaQueIncumple: preferida?.valor ?? '',
    }
    if (props.faltas.length === 1) siguiente.incumplimientoId = props.faltas[0].id
    emit('cambiar', siguiente)
    return
  }
  const siguiente: Pregunta = { ...props.pregunta }
  delete siguiente.respuestaQueIncumple
  delete siguiente.incumplimientoId
  emit('cambiar', siguiente)
}

function alElegirRespuesta(evento: Event) {
  cambiar({ respuestaQueIncumple: (evento.target as HTMLSelectElement).value })
}

function alElegirFalta(evento: Event) {
  const valor = (evento.target as HTMLSelectElement).value
  if (valor === '__nueva__') {
    emit('nueva-falta')
    return
  }
  cambiar({ incumplimientoId: valor === '' ? undefined : valor })
}

const TEXTO_GRAVEDAD: Record<Incumplimiento['gravedad'], string> = {
  leve: 'Leve',
  grave: 'Grave',
  muy_grave: 'Muy grave',
}

/** Resumen de la regla para cuando la pregunta está plegada. */
const resumenRegla = computed(() => {
  if (!reglaActiva.value) return ''
  const falta = faltaVinculada.value
  const respuesta = textoRespuestaRegla.value || '…'
  if (!falta) return 'Si responde «' + respuesta + '» → falta sin elegir'
  return 'Si responde «' + respuesta + '» → ' + (falta.descripcion || 'falta sin describir')
})
</script>

<template>
  <article
    :id="'pregunta-' + pregunta.id"
    class="pregunta"
    :class="{
      'pregunta--abierta': abierta,
      'pregunta--resaltada': resaltada,
      'pregunta--con-regla': reglaActiva,
    }"
  >
    <!-- ── Encabezado: siempre visible ────────────────────────────── -->
    <div class="cabecera">
      <button
        type="button"
        class="desplegar"
        :aria-expanded="abierta"
        :aria-controls="'cuerpo-' + pregunta.id"
        @click="emit('alternar')"
      >
        <span class="numero">{{ posicion }}</span>
        <span class="cabecera-texto">
          <span class="titulo-pregunta" :class="{ 'titulo-pregunta--vacio': !pregunta.texto }">
            {{ pregunta.texto || 'Pregunta sin texto' }}
          </span>
          <span class="marcas">
            <span class="marca">{{ fichaTipo.nombre }}</span>
            <span v-if="pregunta.obligatoria" class="marca marca--obligatoria">Obligatoria</span>
            <span v-if="resumenRegla" class="marca marca--regla">{{ resumenRegla }}</span>
          </span>
        </span>
        <svg
          class="galon"
          :class="{ 'galon--abierto': abierta }"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <div class="acciones-cabecera">
        <button
          type="button"
          class="icono"
          title="Subir"
          aria-label="Subir la pregunta"
          :disabled="posicion === 1"
          @click="emit('mover', -1)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="m18 15-6-6-6 6" />
          </svg>
        </button>
        <button
          type="button"
          class="icono"
          title="Bajar"
          aria-label="Bajar la pregunta"
          :disabled="posicion === total"
          @click="emit('mover', 1)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <button
          type="button"
          class="icono icono--peligro"
          title="Quitar la pregunta"
          aria-label="Quitar la pregunta"
          @click="emit('borrar')"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
          </svg>
        </button>
      </div>
    </div>

    <ul v-if="problemas && problemas.length > 0" class="problemas">
      <li v-for="p in problemas" :key="p">{{ p }}</li>
    </ul>

    <!-- ── Cuerpo: la edición ─────────────────────────────────────── -->
    <div v-if="abierta" :id="'cuerpo-' + pregunta.id" class="cuerpo">
      <div class="campo">
        <label :for="'texto-' + pregunta.id">Qué se le pregunta al inspector</label>
        <textarea
          :id="'texto-' + pregunta.id"
          class="entrada entrada--larga"
          rows="2"
          placeholder="¿Exhibe el permiso de construcción vigente?"
          :value="pregunta.texto"
          @input="alEscribirTexto"
        ></textarea>
      </div>

      <div class="dos-columnas">
        <div class="campo">
          <label :for="'tipo-' + pregunta.id">Cómo se responde</label>
          <select
            :id="'tipo-' + pregunta.id"
            class="entrada"
            :value="pregunta.tipo"
            @change="alCambiarTipo"
          >
            <option v-for="t in TIPOS" :key="t.clave" :value="t.clave">{{ t.nombre }}</option>
          </select>
          <p class="ayuda">{{ fichaTipo.comoSeResponde }}</p>
        </div>

        <div class="campo">
          <label class="marca-caja">
            <input
              type="checkbox"
              :checked="pregunta.obligatoria"
              @change="alCambiarObligatoria"
            />
            <span>
              Es obligatoria
              <span class="ayuda ayuda--bloque">
                Sin esta respuesta el inspector no puede cerrar la inspección.
              </span>
            </span>
          </label>
        </div>
      </div>

      <!-- Opciones de la lista -->
      <fieldset v-if="pregunta.tipo === 'opciones'" class="bloque">
        <legend class="etiqueta">Opciones entre las que elige</legend>
        <ul class="lista-opciones">
          <li v-for="(opcion, i) in opciones" :key="i">
            <input
              class="entrada"
              type="text"
              :value="opcion"
              :placeholder="'Opción ' + (i + 1)"
              :aria-label="'Opción ' + (i + 1)"
              @input="alEscribirOpcion(i, $event)"
            />
            <button
              type="button"
              class="icono"
              title="Subir"
              aria-label="Subir la opción"
              :disabled="i === 0"
              @click="moverOpcion(i, -1)"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6" /></svg>
            </button>
            <button
              type="button"
              class="icono"
              title="Bajar"
              aria-label="Bajar la opción"
              :disabled="i === opciones.length - 1"
              @click="moverOpcion(i, 1)"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            <button
              type="button"
              class="icono icono--peligro"
              title="Quitar la opción"
              aria-label="Quitar la opción"
              @click="borrarOpcion(i)"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14" /></svg>
            </button>
          </li>
        </ul>
        <button type="button" class="boton boton--secundario boton--chico" @click="agregarOpcion">
          Agregar una opción
        </button>
      </fieldset>

      <!-- ── La regla: qué respuesta constata qué falta ───────────── -->
      <fieldset class="bloque bloque--regla">
        <legend class="etiqueta">Faltas</legend>

        <label class="marca-caja">
          <input
            type="checkbox"
            :checked="reglaActiva"
            :disabled="!esDeRespuestaCerrada || respuestas.length === 0"
            @change="alternarRegla"
          />
          <span>
            Una respuesta de esta pregunta constata una falta
            <span class="ayuda ayuda--bloque">
              Cuando el inspector responde eso, la falta queda constatada sola y entra en el acta.
              No tiene que elegirla ni acordarse del artículo.
            </span>
          </span>
        </label>

        <p v-if="!esDeRespuestaCerrada" class="nota nota--tenue">
          Una pregunta de {{ fichaTipo.nombre.toLowerCase() }} no puede constatar una falta por sí
          sola: no hay una respuesta fija contra la cual decidirlo. Si esto tiene que derivar en una
          falta, agregá una pregunta de Sí / No al lado.
        </p>
        <p v-else-if="respuestas.length === 0" class="nota nota--tenue">
          Cargá primero las opciones acá arriba y después vas a poder elegir cuál de ellas constata
          una falta.
        </p>

        <template v-if="reglaActiva">
          <p class="frase">
            <span class="frase-parte">Si la respuesta es</span>
            <select
              class="entrada entrada--enfrase"
              :value="pregunta.respuestaQueIncumple"
              :aria-label="'Respuesta que constata la falta'"
              @change="alElegirRespuesta"
            >
              <option v-for="r in respuestas" :key="r.valor" :value="r.valor">{{ r.texto }}</option>
            </select>
            <span class="frase-parte frase-flecha" aria-hidden="true">→</span>
            <span class="frase-parte">se constata</span>
            <select
              class="entrada entrada--enfrase entrada--falta"
              :class="{ 'entrada--pendiente': !faltaVinculada }"
              :value="pregunta.incumplimientoId ?? ''"
              aria-label="Falta que se constata"
              @change="alElegirFalta"
            >
              <option value="">elegí la falta…</option>
              <option v-for="f in faltas" :key="f.id" :value="f.id">
                {{ f.descripcion || 'Falta sin descripción' }}
              </option>
              <option value="__nueva__">＋ Crear una falta nueva…</option>
            </select>
          </p>

          <p v-if="faltaVinculada" class="ficha-falta">
            <span class="distintivo" :class="'distintivo--' + faltaVinculada.gravedad">
              {{ TEXTO_GRAVEDAD[faltaVinculada.gravedad] }}
            </span>
            <span class="ficha-normativa">
              {{ faltaVinculada.normativa || 'Sin encuadre normativo cargado' }}
            </span>
            <span class="ficha-plazo">
              {{ faltaVinculada.plazoSubsanacionDias }} días para corregir
            </span>
          </p>
          <p v-else-if="faltas.length === 0" class="nota nota--aviso">
            Este formulario todavía no tiene ninguna falta cargada. Elegí «Crear una falta nueva» en
            la lista de acá arriba.
          </p>
        </template>
      </fieldset>

      <!-- ── Lo que ve el inspector ──────────────────────────────── -->
      <div class="previa">
        <span class="etiqueta">Así lo ve el inspector en la calle</span>
        <p class="previa-texto">
          {{ pregunta.texto || 'Pregunta sin texto' }}
          <span v-if="pregunta.obligatoria" class="previa-obligatoria">*</span>
        </p>

        <div
          v-if="esDeRespuestaCerrada"
          class="previa-opciones"
          :class="{ 'previa-opciones--lista': pregunta.tipo === 'opciones' }"
        >
          <span
            v-for="r in respuestas"
            :key="r.valor"
            class="previa-opcion"
            :class="{ 'previa-opcion--incumple': reglaActiva && pregunta.respuestaQueIncumple === r.valor }"
          >
            {{ r.texto }}
            <span v-if="reglaActiva && pregunta.respuestaQueIncumple === r.valor" class="previa-aviso">
              constata falta
            </span>
          </span>
          <span v-if="respuestas.length === 0" class="previa-hueco">Sin opciones cargadas</span>
        </div>
        <div v-else-if="pregunta.tipo === 'foto'" class="previa-hueco previa-hueco--caja">
          Botón de cámara
        </div>
        <div v-else class="previa-hueco previa-hueco--caja">
          {{ pregunta.tipo === 'numero' ? 'Campo numérico' : 'Recuadro de texto' }}
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.pregunta {
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  scroll-margin-top: calc(var(--alto-barra) + 2rem);
}

.pregunta--abierta {
  box-shadow: var(--sombra);
}

.pregunta--con-regla {
  border-left: 4px solid var(--ambar);
}

.pregunta--resaltada {
  border-color: var(--rojo);
  box-shadow: 0 0 0 3px var(--rojo-suave);
}

/* ── Encabezado ─────────────────────────────────────────────────── */

.cabecera {
  display: flex;
  align-items: flex-start;
  gap: 0.25rem;
  padding: 0.35rem 0.5rem 0.35rem 0;
}

.desplegar {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.5rem 0.5rem 0.5rem 0.75rem;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  border-radius: var(--radio-chico);
}

.numero {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  background: var(--superficie-2);
  color: var(--apagado);
  font-size: 0.8125rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.cabecera-texto {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.titulo-pregunta {
  font-weight: 600;
  line-height: 1.3;
}

.titulo-pregunta--vacio {
  color: var(--apagado);
  font-style: italic;
}

.marcas {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.marca {
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--superficie-2);
  color: var(--apagado);
  font-size: 0.6875rem;
  font-weight: 700;
}

.marca--obligatoria {
  background: var(--rojo-suave);
  color: var(--rojo);
}

.marca--regla {
  background: var(--ambar-suave);
  color: var(--ambar);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.galon {
  flex: none;
  margin-top: 0.2rem;
  color: var(--apagado);
  transition: transform 0.15s ease;
}

.galon--abierto {
  transform: rotate(180deg);
}

.acciones-cabecera {
  flex: none;
  display: flex;
  gap: 0.15rem;
  padding-top: 0.5rem;
}

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

.icono:hover:not(:disabled) {
  background: var(--superficie-2);
  color: var(--tinta);
}

.icono:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.icono--peligro:hover:not(:disabled) {
  background: var(--rojo-suave);
  color: var(--rojo);
}

/* ── Problemas de validación ────────────────────────────────────── */

.problemas {
  margin: 0 0.75rem 0.75rem;
  padding: 0.5rem 0.75rem 0.5rem 1.75rem;
  border-radius: var(--radio-chico);
  background: var(--rojo-suave);
  color: var(--rojo);
  font-size: 0.875rem;
  font-weight: 600;
}

/* ── Cuerpo ─────────────────────────────────────────────────────── */

.cuerpo {
  padding: 0 0.85rem 0.85rem;
  border-top: 1px solid var(--filete);
  padding-top: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.dos-columnas {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(220px, 1fr);
  gap: 0.75rem;
  align-items: start;
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
  min-height: 64px;
  resize: vertical;
}

.ayuda {
  margin: 0.2rem 0 0;
  color: var(--apagado);
  font-size: 0.8125rem;
  font-weight: 400;
  line-height: 1.35;
}

.ayuda--bloque {
  display: block;
}

.marca-caja {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  cursor: pointer;
  font-size: 0.9375rem;
  font-weight: 600;
}

.marca-caja input {
  width: 20px;
  height: 20px;
  flex: none;
  margin-top: 0.15rem;
  cursor: pointer;
}

/* ── Bloques ────────────────────────────────────────────────────── */

.bloque {
  margin: 0.5rem 0 0;
  padding: 0.75rem;
  border: 1px solid var(--filete);
  border-radius: var(--radio-chico);
  background: var(--papel);
}

.bloque legend {
  padding: 0 0.35rem;
}

.bloque--regla {
  background: var(--ambar-suave);
  border-color: var(--ambar-suave);
}

.lista-opciones {
  list-style: none;
  margin: 0 0 0.6rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.lista-opciones li {
  display: flex;
  align-items: center;
  gap: 0.2rem;
}

.boton--chico {
  min-height: 38px;
  padding: 0 0.8rem;
  font-size: 0.875rem;
}

/* ── La frase ───────────────────────────────────────────────────── */

/* Se lee de corrido, como una oración: «Si la respuesta es No se constata Obra
   sin permiso». Los dos campos del modelo desaparecen adentro del texto. */
.frase {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0.75rem 0 0;
  font-size: 1rem;
  font-weight: 600;
}

.frase-parte {
  white-space: nowrap;
}

.frase-flecha {
  color: var(--ambar);
  font-weight: 700;
}

.entrada--enfrase {
  width: auto;
  min-width: 6rem;
  max-width: 100%;
  min-height: 40px;
  font-weight: 700;
  border-color: var(--ambar);
}

.entrada--falta {
  flex: 1;
  min-width: 14rem;
}

.entrada--pendiente {
  border-color: var(--rojo);
  color: var(--rojo);
}

.ficha-falta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin: 0.6rem 0 0;
  font-size: 0.8125rem;
  color: var(--apagado);
}

.ficha-normativa {
  font-weight: 600;
}

.ficha-plazo {
  white-space: nowrap;
}

.distintivo--leve { background: var(--superficie-2); color: var(--apagado); }
.distintivo--grave { background: var(--ambar-suave); color: var(--ambar); }
.distintivo--muy_grave { background: var(--rojo-suave); color: var(--rojo); }

.nota {
  margin: 0.6rem 0 0;
  font-size: 0.875rem;
  line-height: 1.4;
}

.nota--tenue { color: var(--apagado); }
.nota--aviso { color: var(--rojo); font-weight: 600; }

/* ── Vista previa ───────────────────────────────────────────────── */

.previa {
  margin-top: 0.75rem;
  padding: 0.75rem;
  border: 1px dashed var(--borde);
  border-radius: var(--radio-chico);
  background: var(--papel);
}

.previa-texto {
  margin: 0.35rem 0 0.5rem;
  font-weight: 600;
  line-height: 1.3;
}

.previa-obligatoria { color: var(--rojo); }

.previa-opciones {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.previa-opciones--lista {
  flex-direction: column;
}

.previa-opcion {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.7rem;
  border: 2px solid var(--borde);
  border-radius: var(--radio-chico);
  background: var(--superficie);
  font-size: 0.875rem;
  font-weight: 700;
}

.previa-opcion--incumple {
  border-color: var(--ambar);
  background: var(--ambar-suave);
  color: var(--ambar);
}

.previa-aviso {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.previa-hueco {
  color: var(--apagado);
  font-size: 0.875rem;
}

.previa-hueco--caja {
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--borde);
  border-radius: var(--radio-chico);
  background: var(--superficie);
}

/* En tablet vertical las dos columnas no entran: se apilan. */
@media (max-width: 720px) {
  .dos-columnas { grid-template-columns: 1fr; }
  .entrada--enfrase { width: 100%; }
  .frase { align-items: stretch; }
}
</style>
