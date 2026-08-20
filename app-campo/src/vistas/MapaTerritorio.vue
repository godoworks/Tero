<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
/**
 * El territorio del organismo en un mapa.
 *
 * Es la pantalla desde la que el inspector se orienta cuando llega a una
 * esquina: que hay alrededor, cual es cual, y como dar de alta lo que todavia
 * no esta cargado. Las dos acciones que se usan de verdad —«mi ubicacion» y
 * «nuevo objeto»— estan siempre a la vista sobre el mapa, sin scrollear.
 */
import { computed, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import MapaBase, { type MarcadorMapa } from '@/componentes/MapaBase.vue'
import { almacen } from '@/datos/almacen'
import { distanciaMetros, ubicacionActual } from '@/dominio/utilidades'
import type {
  ClaveTipoObjeto, ObjetoInspeccionable, Punto, TipoObjeto, Uuid, Zona,
} from '@/dominio/tipos'

/** Un color por tipo de objeto, todos salidos de las fichas de diseño. */
const COLOR_TIPO: Record<ClaveTipoObjeto, string> = {
  luminaria: 'var(--ambar)',
  contenedor: 'var(--verde)',
  obra: 'var(--rojo)',
  comercio: 'var(--estado-asignada)',
  senalizacion: 'var(--tinta)',
  parador: 'var(--apagado)',
}

const enrutador = useRouter()

const objetos = ref<ObjetoInspeccionable[]>([])
const tipos = ref<TipoObjeto[]>([])
const zonas = ref<Zona[]>([])
const cargando = ref(true)
const error = ref('')

const texto = ref('')
const tipoElegido = ref<Uuid | ''>('')
const seleccionadoId = ref<string | null>(null)

const miUbicacion = ref<Punto | null>(null)
const centro = ref<Punto | null>(null)
const zoom = ref(15)
const buscandoGps = ref(false)
const avisoGps = ref('')

let temporizadorAviso: number | undefined

/** Compara sin acentos ni mayusculas: nadie escribe tildes con una mano. */
function normalizar(valor: string): string {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function colorDe(tipoObjetoId: Uuid): string {
  const tipo = tipos.value.find((t) => t.id === tipoObjetoId)
  return tipo ? COLOR_TIPO[tipo.clave] : 'var(--apagado)'
}

function nombreTipo(tipoObjetoId: Uuid): string {
  return tipos.value.find((t) => t.id === tipoObjetoId)?.nombre ?? 'Sin tipo'
}

function nombreZona(zonaId?: Uuid): string {
  if (!zonaId) return 'Sin zona asignada'
  return zonas.value.find((z) => z.id === zonaId)?.nombre ?? 'Sin zona asignada'
}

const objetosVisibles = computed<ObjetoInspeccionable[]>(() => {
  const buscado = normalizar(texto.value)
  return objetos.value.filter((o) => {
    if (tipoElegido.value && o.tipoObjetoId !== tipoElegido.value) return false
    if (!buscado) return true
    return (
      normalizar(o.codigo).includes(buscado) ||
      normalizar(o.denominacion).includes(buscado) ||
      normalizar(o.direccion).includes(buscado)
    )
  })
})

const marcadores = computed<MarcadorMapa[]>(() =>
  objetosVisibles.value.map((o) => ({
    id: o.id,
    punto: o.ubicacion,
    color: colorDe(o.tipoObjetoId),
    etiqueta: `${o.codigo} · ${o.denominacion}`,
  })),
)

const seleccionado = computed<ObjetoInspeccionable | undefined>(() =>
  objetos.value.find((o) => o.id === seleccionadoId.value),
)

const distanciaAlSeleccionado = computed<string>(() => {
  const objeto = seleccionado.value
  if (!objeto || !miUbicacion.value) return ''
  const metros = Math.round(distanciaMetros(miUbicacion.value, objeto.ubicacion))
  return metros < 1000 ? `a ${metros} m tuyo` : `a ${(metros / 1000).toFixed(1)} km tuyo`
})

/** Centro del rectangulo que abarca todo lo cargado: la primera vista muestra el territorio. */
function centroDe(lista: ObjetoInspeccionable[]): Punto {
  const lats = lista.map((o) => o.ubicacion.lat)
  const lones = lista.map((o) => o.ubicacion.lon)
  return {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lon: (Math.min(...lones) + Math.max(...lones)) / 2,
  }
}

async function cargar() {
  cargando.value = true
  error.value = ''
  try {
    const [listaObjetos, listaTipos, listaZonas] = await Promise.all([
      almacen.territorio.objetos(),
      almacen.territorio.tiposObjeto(),
      almacen.territorio.zonas(),
    ])
    objetos.value = listaObjetos
    tipos.value = listaTipos
    zonas.value = listaZonas
    if (!centro.value && listaObjetos.length > 0) {
      centro.value = centroDe(listaObjetos)
      zoom.value = 14
    }
  } catch {
    error.value = 'No se pudieron leer los objetos guardados en el dispositivo.'
  } finally {
    cargando.value = false
  }
}

function mostrarAviso(mensaje: string) {
  avisoGps.value = mensaje
  if (temporizadorAviso) window.clearTimeout(temporizadorAviso)
  temporizadorAviso = window.setTimeout(() => { avisoGps.value = '' }, 5000)
}

async function irAMiUbicacion() {
  buscandoGps.value = true
  avisoGps.value = ''
  try {
    const punto = await ubicacionActual()
    if (!punto) {
      mostrarAviso('No se pudo leer el GPS. Activá la ubicación y volvé a tocar el botón.')
      return
    }
    miUbicacion.value = punto
    // Objeto nuevo a proposito: asi el mapa se vuelve a centrar aunque las
    // coordenadas sean casi las mismas que la vez anterior.
    centro.value = { lat: punto.lat, lon: punto.lon }
    zoom.value = 17
  } finally {
    buscandoGps.value = false
  }
}

function alTocarMarcador(id: string) {
  seleccionadoId.value = id
  const objeto = objetos.value.find((o) => o.id === id)
  if (objeto) centro.value = { lat: objeto.ubicacion.lat, lon: objeto.ubicacion.lon }
}

function irANuevo() {
  enrutador.push('/objeto/nuevo')
}

onUnmounted(() => {
  if (temporizadorAviso) window.clearTimeout(temporizadorAviso)
})

cargar()
</script>

<template>
  <div class="vista">
    <div class="filtros">
      <label class="buscador">
        <span class="visualmente-oculto">Buscar objeto por código, nombre o dirección</span>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" stroke-linecap="round" />
        </svg>
        <input
          v-model="texto"
          type="search"
          inputmode="search"
          placeholder="Código, nombre o calle"
          autocomplete="off"
        />
      </label>

      <div class="chips" role="group" aria-label="Filtrar por tipo de objeto">
        <button
          type="button"
          class="chip"
          :class="{ 'chip--activo': tipoElegido === '' }"
          :aria-pressed="tipoElegido === ''"
          @click="tipoElegido = ''"
        >
          Todos
        </button>
        <button
          v-for="tipo in tipos"
          :key="tipo.id"
          type="button"
          class="chip"
          :class="{ 'chip--activo': tipoElegido === tipo.id }"
          :aria-pressed="tipoElegido === tipo.id"
          @click="tipoElegido = tipo.id"
        >
          <span class="chip__color" :style="{ background: COLOR_TIPO[tipo.clave] }" aria-hidden="true" />
          {{ tipo.nombre }}
        </button>
      </div>

      <p class="conteo chico tenue">
        <span v-if="cargando">Leyendo el territorio…</span>
        <span v-else-if="error">{{ error }}</span>
        <span v-else>{{ objetosVisibles.length }} de {{ objetos.length }} objetos</span>
      </p>
    </div>

    <div class="mapa-caja">
      <MapaBase
        :centro="centro"
        :zoom="zoom"
        :marcadores="marcadores"
        :seleccionado="seleccionadoId"
        :punto-propio="miUbicacion"
        @marcador="alTocarMarcador"
      />

      <div class="avisos">
        <p v-if="!cargando && !error && objetosVisibles.length === 0" class="sin-resultados">
          Ningún objeto coincide con la búsqueda. Probá con el código de la chapa
          o tocá «Nuevo objeto» para cargarlo.
        </p>

        <p v-if="avisoGps" class="aviso-gps" role="status">{{ avisoGps }}</p>
      </div>

      <div class="acciones">
        <button
          type="button"
          class="boton boton--secundario accion"
          :disabled="buscandoGps"
          @click="irAMiUbicacion"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="7" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke-linecap="round" />
          </svg>
          {{ buscandoGps ? 'Buscando…' : 'Mi ubicación' }}
        </button>

        <button type="button" class="boton accion" @click="irANuevo">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Nuevo objeto
        </button>
      </div>

      <div v-if="seleccionado" class="ficha-rapida tarjeta">
        <div class="fila">
          <span class="punto-tipo" :style="{ background: colorDe(seleccionado.tipoObjetoId) }" aria-hidden="true" />
          <span class="etiqueta crece">{{ nombreTipo(seleccionado.tipoObjetoId) }}</span>
          <button type="button" class="cerrar" aria-label="Cerrar ficha rápida" @click="seleccionadoId = null">
            ✕
          </button>
        </div>

        <h2 class="titulo-ficha">{{ seleccionado.denominacion }}</h2>
        <p class="chico tenue dato">
          {{ seleccionado.codigo }} · {{ seleccionado.direccion }}
        </p>
        <p class="chico tenue dato">
          {{ nombreZona(seleccionado.zonaId) }}
          <template v-if="distanciaAlSeleccionado"> · {{ distanciaAlSeleccionado }}</template>
        </p>

        <RouterLink class="boton boton--ancho" :to="`/objeto/${seleccionado.id}`">
          Ver ficha del objeto
        </RouterLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vista {
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--alto-barra) - var(--seguro-arriba) - var(--alto-pie) - var(--seguro-abajo));
  height: calc(100dvh - var(--alto-barra) - var(--seguro-arriba) - var(--alto-pie) - var(--seguro-abajo));
}

.filtros {
  flex: none;
  padding: 0.75rem 1rem 0.5rem;
  background: var(--superficie);
  border-bottom: 1px solid var(--borde);
}

.buscador {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 48px;
  padding: 0 0.75rem;
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  background: var(--papel);
  color: var(--apagado);
}

.buscador input {
  flex: 1;
  min-width: 0;
  min-height: 46px;
  border: 0;
  background: none;
  outline-offset: -3px;
}

.visualmente-oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.chips {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.5rem;
  padding-bottom: 0.25rem;
  overflow-x: auto;
  scrollbar-width: none;
}

.chips::-webkit-scrollbar { display: none; }

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex: none;
  min-height: 40px;
  padding: 0 0.8rem;
  border: 1px solid var(--borde);
  border-radius: 999px;
  background: var(--superficie);
  font-size: 0.875rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.chip--activo {
  background: var(--tinta);
  color: var(--papel);
  border-color: var(--tinta);
}

.chip__color {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.conteo { margin: 0.4rem 0 0; }

.mapa-caja {
  position: relative;
  flex: 1;
  min-height: 0;
}

.acciones {
  position: absolute;
  left: 0.75rem;
  right: 0.75rem;
  bottom: 0.75rem;
  display: flex;
  gap: 0.5rem;
  z-index: 5;
}

.accion {
  flex: 1;
  box-shadow: var(--sombra);
}

/* Los avisos se apilan arriba: debajo de la atribucion y sin pisar los
   botones de zoom del mapa. */
.avisos {
  position: absolute;
  top: 3.1rem;
  left: 0.75rem;
  right: 3.75rem;
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  pointer-events: none;
}

.sin-resultados,
.aviso-gps {
  margin: 0;
  padding: 0.75rem 0.9rem;
  border-radius: var(--radio);
  font-size: 0.875rem;
  font-weight: 600;
  text-align: center;
  box-shadow: var(--sombra);
}

.sin-resultados {
  background: var(--superficie);
  border: 1px solid var(--borde);
}

.aviso-gps {
  background: var(--rojo-suave);
  color: var(--rojo);
  border: 1px solid var(--rojo);
}

/* La ficha rapida se apoya arriba de los botones: la accion principal nunca
   queda tapada. */
.ficha-rapida {
  position: absolute;
  left: 0.75rem;
  right: 0.75rem;
  bottom: calc(1.25rem + 48px);
  z-index: 7;
  box-shadow: var(--sombra);
}

.punto-tipo {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex: none;
}

.cerrar {
  flex: none;
  width: 44px;
  height: 44px;
  margin: -0.5rem -0.5rem -0.5rem 0;
  border: 0;
  background: none;
  color: var(--apagado);
  font-size: 1rem;
  cursor: pointer;
}

.titulo-ficha { margin: 0.35rem 0 0.15rem; }
.dato { margin: 0 0 0.15rem; }
.ficha-rapida .boton { margin-top: 0.75rem; }
</style>
