<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
/**
 * Envoltura de Leaflet para toda la aplicacion.
 *
 * Tero necesita teselas raster y marcadores, nada mas. Leaflet pesa 42 KB, no
 * usa WebGL ni workers y se comporta igual en los telefonos municipales viejos
 * que en el escritorio; por eso reemplazo a MapLibre, que ademas descartaba el
 * estilo del constructor sin emitir ningun error y dejaba el mapa sin fondo.
 *
 * Cuatro cosas que este componente resuelve y que no hay que volver a resolver
 * en cada vista:
 *
 *  1. Sin señal el mapa NO se rompe: si las teselas no llegan se ve el papel
 *     del fondo con un aviso chico. Nunca una pantalla en blanco.
 *  2. La instancia se destruye en `onUnmounted`. El inspector entra y sale del
 *     mapa decenas de veces por jornada.
 *  3. Los marcadores son elementos del DOM propios (`divIcon`) para que
 *     respeten las fichas de diseño y tengan un area tactil usable con guantes.
 *  4. El contenedor se revalida con `ResizeObserver`: el mapa vive dentro de
 *     vistas con barras que aparecen y desaparecen, y Leaflet no se entera solo.
 */
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import {
  DivIcon, Map as MapaLeaflet, Marker, TileLayer,
  control as controles,
  type LeafletMouseEvent,
} from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Punto } from '@/dominio/tipos'

export interface MarcadorMapa {
  id: string
  punto: Punto
  /** Color del punto. Siempre una variable de base.css, nunca un valor literal. */
  color?: string
  /** Texto para lectores de pantalla y para el toque sostenido. */
  etiqueta?: string
}

/**
 * Teselas de OpenStreetMap.
 *
 * Los subdominios a/b/c no son decorativos: `/^https:\/\/[abc]\.tile\.
 * openstreetmap\.org\//` es el patron que cachea el service worker configurado
 * en vite.config.ts, y esa cache es lo que hace que el mapa siga mostrando la
 * zona ya recorrida cuando no hay señal.
 */
const TESELAS = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const SUBDOMINIOS = 'abc'
const ZOOM_MAXIMO = 19

/** Atribucion obligatoria de OpenStreetMap. */
const ATRIBUCION = '© OpenStreetMap'

/** Si todavia no se sabe donde esta el inspector, se abre sobre Montevideo. */
const CENTRO_POR_DEFECTO: Punto = { lat: -34.9059, lon: -56.1913 }

const props = withDefaults(
  defineProps<{
    /** Centro del mapa. Cambiarlo mueve la camara. */
    centro?: Punto | null
    zoom?: number
    marcadores?: MarcadorMapa[]
    /** Marcador resaltado, por id. */
    seleccionado?: string | null
    /** Si es true, tocar el mapa elige un punto y lo emite. */
    elegible?: boolean
    /** Punto elegido a mano, dibujado como mira. */
    puntoElegido?: Punto | null
    /** Donde esta el inspector. Se dibuja distinto de los objetos. */
    puntoPropio?: Punto | null
    /** Un mapa no interactivo se usa como ilustracion dentro de una ficha. */
    interactivo?: boolean
  }>(),
  {
    centro: null,
    zoom: 16,
    marcadores: () => [],
    seleccionado: null,
    elegible: false,
    puntoElegido: null,
    puntoPropio: null,
    interactivo: true,
  },
)

const emitir = defineEmits<{
  (e: 'elegir', punto: Punto): void
  (e: 'marcador', id: string): void
}>()

const contenedor = ref<HTMLDivElement | null>(null)
const mapa = shallowRef<MapaLeaflet | null>(null)

/** El mapa no se pudo construir. La vista tiene que seguir sirviendo igual. */
const sinMapa = ref(false)
/** Las teselas no llegan: sin señal y sin nada guardado para esta zona. */
const teselasFallan = ref(false)

let marcadoresVivos: Marker[] = []
let marcaElegida: Marker | null = null
let marcaPropia: Marker | null = null
let avisoDemorado: number | undefined
let observador: ResizeObserver | null = null
/**
 * Teselas que fallaron desde el ultimo movimiento. Sin este contador, una sola
 * tesela guardada en cache cancelaria el aviso de una zona que en realidad no
 * se puede ver entera.
 */
let teselasFallidas = 0

function avisarFalla() {
  teselasFallidas += 1
  // Un parpadeo de error mientras se cargan teselas no es noticia: solo se
  // avisa si el problema persiste.
  if (teselasFallan.value || avisoDemorado !== undefined) return
  avisoDemorado = window.setTimeout(() => {
    teselasFallan.value = true
    avisoDemorado = undefined
  }, 1500)
}

function cancelarAviso() {
  if (avisoDemorado !== undefined) {
    window.clearTimeout(avisoDemorado)
    avisoDemorado = undefined
  }
  teselasFallan.value = false
}

/**
 * Icono de marcador: 44 px de area tactil aunque el punto visible sea de 20 px.
 * En el mapa hay que poder acertar con el pulgar, al sol y a veces con guantes.
 */
function icono(clase: string): DivIcon {
  return new DivIcon({
    className: clase,
    html: '<span class="marcador__punto"></span>',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  })
}

function pintarMarcadores() {
  const m = mapa.value
  if (!m) return
  for (const marca of marcadoresVivos) marca.remove()
  marcadoresVivos = []

  for (const dato of props.marcadores) {
    const elegido = dato.id === props.seleccionado
    const marca = new Marker([dato.punto.lat, dato.punto.lon], {
      icon: icono(elegido ? 'marcador marcador--elegido' : 'marcador'),
      // El foco y el teclado los maneja el elemento del DOM, mas abajo: asi el
      // marcador es un boton de verdad y no un atajo propio de Leaflet.
      keyboard: false,
      title: dato.etiqueta ?? '',
    }).addTo(m)

    const caja = marca.getElement()
    if (caja) {
      const punto = caja.querySelector<HTMLElement>('.marcador__punto')
      if (punto) punto.style.background = dato.color ?? 'var(--tinta)'

      caja.setAttribute('role', 'button')
      caja.setAttribute('tabindex', '0')
      caja.setAttribute('aria-label', dato.etiqueta ?? 'Objeto en el mapa')

      const abrir = (evento: Event) => {
        // Sin esto, en un mapa elegible tocar un marcador tambien moveria el
        // punto elegido.
        evento.stopPropagation()
        emitir('marcador', dato.id)
      }
      caja.addEventListener('click', abrir)
      caja.addEventListener('keydown', (evento) => {
        if (evento.key === 'Enter' || evento.key === ' ') {
          evento.preventDefault()
          abrir(evento)
        }
      })
    }

    marcadoresVivos.push(marca)
  }
}

function pintarElegido() {
  const m = mapa.value
  if (!m) return
  if (!props.puntoElegido) {
    marcaElegida?.remove()
    marcaElegida = null
    return
  }
  const destino: [number, number] = [props.puntoElegido.lat, props.puntoElegido.lon]
  if (marcaElegida) {
    marcaElegida.setLatLng(destino)
    return
  }
  marcaElegida = new Marker(destino, {
    icon: icono('mira'),
    interactive: false,
    keyboard: false,
  }).addTo(m)
  marcaElegida.getElement()?.setAttribute('aria-hidden', 'true')
}

function pintarPropio() {
  const m = mapa.value
  if (!m) return
  if (!props.puntoPropio) {
    marcaPropia?.remove()
    marcaPropia = null
    return
  }
  const destino: [number, number] = [props.puntoPropio.lat, props.puntoPropio.lon]
  if (marcaPropia) {
    marcaPropia.setLatLng(destino)
    return
  }
  marcaPropia = new Marker(destino, {
    icon: icono('propio'),
    interactive: false,
    keyboard: false,
  }).addTo(m)
  marcaPropia.getElement()?.setAttribute('aria-label', 'Tu ubicación')
}

function crearMapa() {
  const nodo = contenedor.value
  if (!nodo) return

  const centro = props.centro ?? CENTRO_POR_DEFECTO
  const vivo = props.interactivo

  let m: MapaLeaflet
  try {
    m = new MapaLeaflet(nodo, {
      center: [centro.lat, centro.lon],
      zoom: props.zoom,
      // Un mapa no interactivo es una ilustracion dentro de una ficha: no se
      // arrastra, no hace zoom y no roba el foco del teclado.
      dragging: vivo,
      touchZoom: vivo,
      doubleClickZoom: vivo,
      scrollWheelZoom: vivo,
      boxZoom: vivo,
      keyboard: vivo,
      zoomControl: false,
      // La atribucion se agrega a mano arriba a la izquierda: abajo la tapan
      // las barras de accion de las vistas, y tapar la atribucion de
      // OpenStreetMap no es una opcion.
      attributionControl: false,
    })
  } catch {
    sinMapa.value = true
    return
  }

  const capa = new TileLayer(TESELAS, {
    subdomains: SUBDOMINIOS,
    maxZoom: ZOOM_MAXIMO,
    attribution: ATRIBUCION,
  })
  capa.on('tileerror', avisarFalla)
  capa.on('tileload', () => {
    if (teselasFallidas === 0) cancelarAviso()
  })
  capa.addTo(m)

  controles.attribution({ position: 'topleft', prefix: false }).addTo(m)
  if (vivo) controles.zoom({ position: 'topright' }).addTo(m)

  // Cada desplazamiento vuelve a evaluar la zona: lo que fallo alla no dice
  // nada de lo que hay guardado aca.
  m.on('movestart', () => { teselasFallidas = 0 })

  m.on('click', (evento: LeafletMouseEvent) => {
    if (!props.elegible) return
    emitir('elegir', { lat: evento.latlng.lat, lon: evento.latlng.lng })
  })

  mapa.value = m

  pintarMarcadores()
  pintarElegido()
  pintarPropio()

  // El mapa suele montarse antes de que la vista termine de repartir el alto
  // disponible; sin esto Leaflet calcula mal cuantas teselas pedir.
  // `stop()` corta cualquier desplazamiento en curso: recalcular el tamaño en
  // medio de una animacion deja el origen del mapa desfasado.
  observador = new ResizeObserver(() => {
    m.stop()
    m.invalidateSize({ animate: false })
  })
  observador.observe(nodo)
}

onMounted(crearMapa)

onUnmounted(() => {
  if (avisoDemorado !== undefined) window.clearTimeout(avisoDemorado)
  observador?.disconnect()
  observador = null
  for (const marca of marcadoresVivos) marca.remove()
  marcadoresVivos = []
  marcaElegida?.remove()
  marcaPropia?.remove()
  marcaElegida = null
  marcaPropia = null
  mapa.value?.remove()
  mapa.value = null
})

watch(() => props.marcadores, pintarMarcadores, { deep: false })
watch(() => props.seleccionado, pintarMarcadores)
watch(() => props.puntoElegido, pintarElegido)
watch(() => props.puntoPropio, pintarPropio)

watch(
  () => [props.centro, props.zoom] as const,
  ([centro, zoom]) => {
    const m = mapa.value
    if (!m || !centro) return
    // Sin `animate: true` a proposito. Forzarlo saltea el control de distancia
    // de Leaflet: la vista del territorio arranca en Montevideo y salta al
    // organismo apenas termina de leer los objetos, y esa animacion de cientos
    // de kilometros deja las teselas dibujadas fuera del contenedor —el mapa se
    // ve vacio aunque las teselas hayan llegado—. Sin la opcion, Leaflet anima
    // los movimientos cortos y salta los largos, que es justo lo que hace falta.
    m.setView([centro.lat, centro.lon], zoom)
  },
)
</script>

<template>
  <div class="mapa" :class="{ 'mapa--elegible': elegible && !sinMapa }">
    <div ref="contenedor" class="lienzo" :class="{ 'lienzo--oculto': sinMapa }" />

    <!-- Si el mapa no se pudo construir, la vista tiene que seguir sirviendo. -->
    <div v-if="sinMapa" class="respaldo">
      <p class="respaldo__titulo">Este dispositivo no puede dibujar el mapa</p>
      <p class="chico tenue">
        Podés seguir trabajando: las coordenadas se toman igual del GPS.
      </p>
      <p v-if="puntoElegido || centro" class="coordenadas">
        {{ (puntoElegido ?? centro)!.lat.toFixed(5) }},
        {{ (puntoElegido ?? centro)!.lon.toFixed(5) }}
      </p>
    </div>

    <p v-else-if="teselasFallan" class="aviso">
      Sin señal: se muestra solo el mapa ya guardado en el dispositivo.
    </p>

    <p v-if="elegible && !sinMapa" class="instruccion">
      Tocá el mapa para corregir la ubicación
    </p>

    <slot />
  </div>
</template>

<style scoped>
.mapa {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  /* Se ve mientras las teselas no llegan. */
  background: var(--superficie-2);
}

/*
  El z-index no es cosmetico: los paneles de Leaflet llevan z-index propio (de
  200 a 800). Sin un contexto de apilado aca, esos paneles taparian los avisos
  de este componente y las barras de accion de las vistas, que se apoyan sobre
  el mapa con z-index chicos.
*/
.lienzo {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.lienzo--oculto { display: none; }

.respaldo {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 1.5rem;
  text-align: center;
}

.respaldo__titulo { margin: 0; font-weight: 700; }
.respaldo p { margin: 0; }

.coordenadas {
  margin-top: 0.5rem;
  padding: 0.4rem 0.7rem;
  border-radius: var(--radio-chico);
  background: var(--superficie);
  border: 1px solid var(--borde);
  font-variant-numeric: tabular-nums;
  font-size: 0.875rem;
}

.aviso,
.instruccion {
  position: absolute;
  z-index: 1;
  left: 0.75rem;
  right: 0.75rem;
  margin: 0;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radio-chico);
  font-size: 0.8125rem;
  font-weight: 600;
  text-align: center;
  pointer-events: none;
}

.aviso {
  /* Debajo de la atribucion, que va arriba a la izquierda. */
  top: 3.1rem;
  background: var(--ambar-suave);
  color: var(--ambar);
  border: 1px solid var(--ambar);
}

.instruccion {
  bottom: 0.75rem;
  background: var(--tinta);
  color: var(--papel);
  opacity: 0.92;
}

/* ── Leaflet ─────────────────────────────────────────────────────────
   Leaflet trae colores y tamaños propios. Se reemplazan por las fichas de
   diseño y por areas tactiles de 44px. */

:deep(.leaflet-container) {
  font-family: var(--fuente);
  /* Leaflet pinta el fondo de gris fijo; se usa el papel de la aplicacion. */
  background: var(--superficie-2);
}

/* Un mapa elegible se toca para marcar un punto, no para arrastrar. */
.mapa--elegible :deep(.leaflet-container) { cursor: crosshair; }

:deep(.leaflet-control-attribution) {
  font-family: var(--fuente);
  font-size: 0.6875rem;
  padding: 0.15rem 0.45rem;
  background: var(--superficie);
  color: var(--apagado);
  border-radius: 0 0 var(--radio-chico) 0;
}

:deep(.leaflet-control-zoom a) {
  width: 44px;
  height: 44px;
  line-height: 44px;
  font-size: 1.25rem;
  background: var(--superficie);
  color: var(--tinta);
  border-bottom-color: var(--borde);
}

:deep(.leaflet-control-zoom) {
  border-color: var(--borde);
  box-shadow: var(--sombra);
}

/* ── Marcadores ──────────────────────────────────────────────────────
   Los crea Leaflet desde `divIcon`, por eso van con :deep(). El area tactil es
   de 44px aunque el punto visible sea chico: en el mapa hay que poder acertar
   con el pulgar y con guantes. */

:deep(.marcador),
:deep(.mira),
:deep(.propio) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}

:deep(.marcador:focus-visible) {
  outline: 3px solid var(--tinta);
  outline-offset: -3px;
  border-radius: 50%;
}

:deep(.marcador .marcador__punto) {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid var(--superficie);
  box-shadow: var(--sombra);
}

:deep(.marcador--elegido .marcador__punto) {
  width: 30px;
  height: 30px;
  border-width: 3px;
  outline: 3px solid var(--tinta);
  outline-offset: 2px;
}

/* La mira y el punto propio son indicadores: el toque tiene que llegar al
   mapa, que es quien elige la ubicacion. */
:deep(.mira),
:deep(.propio) {
  cursor: default;
  pointer-events: none;
}

:deep(.mira .marcador__punto) {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 4px solid var(--rojo);
  background: var(--superficie);
  box-shadow: 0 0 0 3px var(--rojo-suave);
}

:deep(.propio .marcador__punto) {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--estado-asignada);
  border: 3px solid var(--superficie);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--estado-asignada) 25%, transparent);
}
</style>
