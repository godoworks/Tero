<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type {
  EstadoInspeccion,
  Inspeccion,
  ObjetoInspeccionable,
  Prioridad,
  TipoInspeccion,
  Uuid,
} from '@/dominio/tipos'
import { almacen } from '@/datos/almacen'
import { formatearFecha } from '@/dominio/utilidades'

/**
 * La lista de trabajo del dia.
 *
 * Ordenada como la mira un inspector cuando arranca la jornada: primero lo que
 * ya se paso de fecha, despues lo urgente, y al final lo que ya cerro.
 */

type Filtro = 'todas' | 'por_hacer' | 'vencidas' | 'cerradas'

const inspecciones = ref<Inspeccion[]>([])
const objetos = ref<Map<Uuid, ObjetoInspeccionable>>(new Map())
const tipos = ref<Map<Uuid, TipoInspeccion>>(new Map())
const cargando = ref(true)
const error = ref('')
const filtro = ref<Filtro>('por_hacer')

const NOMBRE_PRIORIDAD: Record<Prioridad, string> = {
  urgente: 'Urgente',
  alta: 'Prioridad alta',
  media: 'Prioridad media',
  baja: 'Prioridad baja',
}

const NOMBRE_ESTADO: Record<EstadoInspeccion, string> = {
  pendiente: 'Sin asignar',
  asignada: 'Para hacer',
  en_campo: 'Empezada',
  cerrada: 'Cerrada',
  vencida: 'Vencida',
}

function esActiva(i: Inspeccion): boolean {
  return i.estado === 'asignada' || i.estado === 'en_campo' || i.estado === 'vencida'
}

/**
 * Se paso la fecha y todavia no se cerro.
 *
 * El corte es el FIN del dia programado, no el instante. Una inspeccion
 * agendada para hoy se trabaja durante todo el dia: marcarla vencida a las
 * 00:01 haria que el inspector abriera la aplicacion cada manana con toda su
 * jornada en rojo, y el rojo dejaria de significar algo.
 */
function estaVencida(i: Inspeccion): boolean {
  if (i.estado === 'vencida') return true
  if (!esActiva(i) || !i.programadaPara) return false
  const limite = new Date(i.programadaPara)
  limite.setHours(23, 59, 59, 999)
  return limite.getTime() < Date.now()
}

function objetoDe(i: Inspeccion): ObjetoInspeccionable | undefined {
  return objetos.value.get(i.objetoId)
}

function tipoDe(i: Inspeccion): string {
  return tipos.value.get(i.tipoInspeccionId)?.nombre ?? 'Inspección'
}

function porFecha(a: Inspeccion, b: Inspeccion): number {
  const fa = a.programadaPara ?? a.creadaEn
  const fb = b.programadaPara ?? b.creadaEn
  return fa.localeCompare(fb)
}

const vencidas = computed(() =>
  inspecciones.value.filter(estaVencida).sort(porFecha),
)

const porHacer = computed(() =>
  inspecciones.value.filter((i) => esActiva(i) && !estaVencida(i)).sort(porFecha),
)

const cerradas = computed(() =>
  inspecciones.value
    .filter((i) => i.estado === 'cerrada')
    .sort((a, b) => (b.ejecutadaEn ?? b.actualizadaEn).localeCompare(a.ejecutadaEn ?? a.actualizadaEn)),
)

const sinAsignar = computed(() =>
  inspecciones.value.filter((i) => i.estado === 'pendiente').sort(porFecha),
)

interface Grupo {
  clave: string
  titulo: string
  urgente: boolean
  filas: Inspeccion[]
}

const grupos = computed<Grupo[]>(() => {
  const salida: Grupo[] = []
  const f = filtro.value

  if ((f === 'todas' || f === 'por_hacer' || f === 'vencidas') && vencidas.value.length > 0) {
    salida.push({
      clave: 'vencidas',
      titulo: 'Se pasaron de fecha',
      urgente: true,
      filas: vencidas.value,
    })
  }

  if (f === 'todas' || f === 'por_hacer') {
    for (const prioridad of ['urgente', 'alta', 'media', 'baja'] as Prioridad[]) {
      const filas = porHacer.value.filter((i) => i.prioridad === prioridad)
      if (filas.length > 0) {
        salida.push({
          clave: 'prioridad-' + prioridad,
          titulo: NOMBRE_PRIORIDAD[prioridad],
          urgente: false,
          filas,
        })
      }
    }
  }

  if (f === 'todas' && sinAsignar.value.length > 0) {
    salida.push({
      clave: 'sin-asignar',
      titulo: 'Todavía sin asignar',
      urgente: false,
      filas: sinAsignar.value,
    })
  }

  if ((f === 'todas' || f === 'cerradas') && cerradas.value.length > 0) {
    salida.push({ clave: 'cerradas', titulo: 'Ya cerradas', urgente: false, filas: cerradas.value })
  }

  return salida
})

const hayFilas = computed(() => grupos.value.some((g) => g.filas.length > 0))

const mensajeVacio = computed(() => {
  switch (filtro.value) {
    case 'vencidas':
      return {
        titulo: 'No se te pasó ninguna de fecha',
        detalle: 'Seguí con las tareas del día.',
        accion: 'por_hacer' as Filtro,
        textoAccion: 'Ver las que tenés para hacer',
      }
    case 'cerradas':
      return {
        titulo: 'Todavía no cerraste ninguna',
        detalle: 'Cuando termines una inspección aparece acá con su acta.',
        accion: 'por_hacer' as Filtro,
        textoAccion: 'Ver las que tenés para hacer',
      }
    default:
      return {
        titulo: 'No tenés inspecciones para hacer',
        detalle:
          'Cuando la oficina te asigne trabajo aparece en esta lista. Mientras tanto podés relevar un objeto nuevo desde el mapa.',
        accion: null,
        textoAccion: '',
      }
  }
})

async function cargar() {
  cargando.value = true
  error.value = ''
  try {
    const [lista, cosas, tiposInspeccion] = await Promise.all([
      almacen.inspecciones.listar(),
      almacen.territorio.objetos(),
      almacen.formularios.tiposInspeccion(),
    ])
    inspecciones.value = lista
    objetos.value = new Map(cosas.map((o) => [o.id, o]))
    tipos.value = new Map(tiposInspeccion.map((t) => [t.id, t]))
  } catch {
    error.value = 'No se pudo leer el trabajo guardado en el teléfono.'
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)
</script>

<template>
  <div class="contenido">
    <div class="filtros" role="tablist" aria-label="Filtrar por estado">
      <button
        v-for="opcion in [
          { clave: 'por_hacer' as Filtro, texto: 'Para hacer', cuenta: porHacer.length + vencidas.length },
          { clave: 'vencidas' as Filtro, texto: 'Vencidas', cuenta: vencidas.length },
          { clave: 'cerradas' as Filtro, texto: 'Cerradas', cuenta: cerradas.length },
          { clave: 'todas' as Filtro, texto: 'Todas', cuenta: inspecciones.length },
        ]"
        :key="opcion.clave"
        type="button"
        role="tab"
        class="filtro"
        :class="{ 'filtro--activo': filtro === opcion.clave }"
        :aria-selected="filtro === opcion.clave"
        @click="filtro = opcion.clave"
      >
        {{ opcion.texto }}
        <span class="cuenta">{{ opcion.cuenta }}</span>
      </button>
    </div>

    <p v-if="cargando" class="vacio">Buscando tu trabajo del día…</p>

    <p v-else-if="error" class="aviso-error">{{ error }}</p>

    <template v-else-if="hayFilas">
      <section v-for="grupo in grupos" :key="grupo.clave" class="grupo">
        <h2 class="grupo-titulo" :class="{ 'grupo-titulo--urgente': grupo.urgente }">
          {{ grupo.titulo }}
          <span class="grupo-cuenta">{{ grupo.filas.length }}</span>
        </h2>

        <ul class="lista">
          <li v-for="i in grupo.filas" :key="i.uuid">
            <RouterLink
              class="fila-tarea"
              :class="{ 'fila-tarea--vencida': estaVencida(i) }"
              :to="'/inspeccion/' + i.uuid"
            >
              <div class="crece">
                <p class="denominacion">
                  {{ objetoDe(i)?.denominacion ?? 'Objeto sin ficha' }}
                </p>
                <p class="direccion">{{ objetoDe(i)?.direccion ?? 'Sin dirección cargada' }}</p>
                <p class="meta">
                  {{ tipoDe(i) }}
                  <template v-if="i.programadaPara">
                    · {{ estaVencida(i) ? 'Era para el' : 'Para el' }}
                    {{ formatearFecha(i.programadaPara) }}
                  </template>
                </p>
              </div>

              <div class="marcas">
                <span
                  class="distintivo"
                  :class="'distintivo--' + (estaVencida(i) ? 'vencida' : i.estado)"
                >
                  {{ estaVencida(i) ? 'Vencida' : NOMBRE_ESTADO[i.estado] }}
                </span>
                <span v-if="i.prioridad === 'urgente'" class="urgente-marca">Urgente</span>
              </div>
            </RouterLink>
          </li>
        </ul>
      </section>
    </template>

    <div v-else class="vacio-util">
      <h2>{{ mensajeVacio.titulo }}</h2>
      <p>{{ mensajeVacio.detalle }}</p>
      <button
        v-if="mensajeVacio.accion"
        type="button"
        class="boton"
        @click="filtro = mensajeVacio.accion as Filtro"
      >
        {{ mensajeVacio.textoAccion }}
      </button>
      <RouterLink v-else class="boton" to="/mapa">Ver el mapa del territorio</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.filtros {
  display: flex;
  gap: 0.4rem;
  overflow-x: auto;
  margin-bottom: 1rem;
  padding-bottom: 0.2rem;
}

.filtro {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 44px;
  padding: 0 0.85rem;
  white-space: nowrap;
  border: 1px solid var(--borde);
  border-radius: 999px;
  background: var(--superficie);
  color: var(--tinta);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}

.filtro--activo {
  background: var(--tinta);
  border-color: var(--tinta);
  color: var(--papel);
}

.cuenta {
  font-size: 0.75rem;
  font-weight: 700;
  opacity: 0.7;
}

.grupo {
  margin-bottom: 1.25rem;
}

.grupo-titulo {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--apagado);
}

.grupo-titulo--urgente {
  color: var(--rojo);
}

.grupo-cuenta {
  font-size: 0.75rem;
  letter-spacing: 0;
}

.lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.fila-tarea {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  min-height: 72px;
  padding: 0.85rem;
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  text-decoration: none;
  color: var(--tinta);
}

.fila-tarea--vencida {
  border-color: var(--rojo);
  background: var(--rojo-suave);
}

.denominacion {
  margin: 0;
  font-weight: 700;
  line-height: 1.25;
}

.direccion {
  margin: 0.1rem 0 0;
  font-size: 0.875rem;
}

.meta {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: var(--apagado);
}

.marcas {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.3rem;
  flex: none;
}

.urgente-marca {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--rojo);
}

.aviso-error {
  padding: 0.75rem;
  border-radius: var(--radio);
  background: var(--rojo-suave);
  color: var(--rojo);
  font-weight: 600;
}

.vacio-util {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 2.5rem 1rem;
  text-align: center;
}

.vacio-util p {
  margin: 0;
  color: var(--apagado);
  max-width: 34ch;
}
</style>
