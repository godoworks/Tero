<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
/**
 * Alta de un objeto inspeccionable.
 *
 * El inspector da de alta parado frente a la luminaria, con una mano. Por eso
 * la ubicacion no se escribe: se toma del GPS al abrir la pantalla y se
 * corrige tocando el mapa cuando el GPS miente (pasa siempre entre edificios
 * altos o bajo arboleda).
 *
 * Los mensajes de validacion dicen que hacer, no que falta. «Campo requerido»
 * no le sirve a nadie que esta al sol con un guante puesto.
 */
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import MapaBase from '@/componentes/MapaBase.vue'
import { almacen } from '@/datos/almacen'
import { ahora, nuevoUuid, ubicacionActual } from '@/dominio/utilidades'
import type {
  ObjetoInspeccionable, Organismo, Punto, TipoObjeto, Uuid, Zona,
} from '@/dominio/tipos'

/** Mientras no haya sesion, todo lo que se audita queda a nombre del rol. */
const ACTOR = 'inspector'

/** Por encima de esta precision conviene corregir el punto a mano. */
const PRECISION_DUDOSA = 30

const enrutador = useRouter()

const organismo = ref<Organismo | null>(null)
const tipos = ref<TipoObjeto[]>([])
const zonas = ref<Zona[]>([])
const existentes = ref<ObjetoInspeccionable[]>([])

const cargando = ref(true)
const guardando = ref(false)
const errorGeneral = ref('')

const buscandoGps = ref(false)
const gpsFallo = ref(false)
const ubicacionEsDelGps = ref(false)

const forma = reactive({
  tipoObjetoId: '' as Uuid | '',
  codigo: '',
  denominacion: '',
  direccion: '',
  zonaId: '' as Uuid | '',
})

const ubicacion = ref<Punto | null>(null)
/** Ultima lectura del GPS. Se sigue mostrando despues de corregir a mano. */
const puntoGps = ref<Punto | null>(null)
const centro = ref<Punto | null>(null)

/** Un campo solo muestra su error cuando ya se lo toco o cuando se intento guardar. */
const tocado = reactive<Record<string, boolean>>({})
const intentoGuardar = ref(false)

function marcarTocado(campo: string) {
  tocado[campo] = true
}

function seVe(campo: string): boolean {
  return intentoGuardar.value || tocado[campo] === true
}

// ── Validacion ──────────────────────────────────────────────────────

const errores = computed<Record<string, string>>(() => {
  const e: Record<string, string> = {}

  if (!forma.tipoObjetoId) {
    e.tipoObjetoId = 'Elegí qué estás dando de alta: una luminaria, un contenedor, una obra…'
  }

  const codigo = forma.codigo.trim()
  if (!codigo) {
    e.codigo = 'Copiá el código de la chapa o el padrón. Es lo único que permite volver a encontrarlo.'
  } else {
    const repetido = existentes.value.find(
      (o) => o.codigo.toLowerCase() === codigo.toLowerCase(),
    )
    if (repetido) {
      e.codigo =
        `Ya hay un objeto con el código ${repetido.codigo} (${repetido.denominacion}). ` +
        'Revisá la chapa, o buscalo en el mapa en vez de darlo de alta otra vez.'
    }
  }

  if (forma.denominacion.trim().length < 3) {
    e.denominacion = 'Poné un nombre corto para reconocerlo de un vistazo, por ejemplo «Luminaria Rivera y Soca».'
  }

  if (forma.direccion.trim().length < 4) {
    e.direccion = 'Escribí la calle y la altura o la esquina más cercana, así otro inspector llega sin preguntar.'
  }

  if (!ubicacion.value) {
    e.ubicacion = 'Falta la ubicación. Tocá «Usar mi GPS» estando parado frente al objeto, o marcá el punto en el mapa.'
  }

  return e
})

const hayErrores = computed(() => Object.keys(errores.value).length > 0)

const avisoPrecision = computed<string>(() => {
  const punto = ubicacion.value
  if (!punto || !ubicacionEsDelGps.value || punto.precision === undefined) return ''
  if (punto.precision <= PRECISION_DUDOSA) return ''
  return (
    `El GPS informa ±${Math.round(punto.precision)} m. Si el punto quedó lejos del objeto, ` +
    'corregilo tocando el mapa.'
  )
})

// ── Zona por el contorno ────────────────────────────────────────────

/** Punto dentro del anillo exterior de la zona (algoritmo del rayo). */
function contiene(contorno: Punto[], punto: Punto): boolean {
  let dentro = false
  for (let i = 0, j = contorno.length - 1; i < contorno.length; j = i++) {
    const a = contorno[i]
    const b = contorno[j]
    const cruza = a.lat > punto.lat !== b.lat > punto.lat
    if (!cruza) continue
    const corte = ((b.lon - a.lon) * (punto.lat - a.lat)) / (b.lat - a.lat) + a.lon
    if (punto.lon < corte) dentro = !dentro
  }
  return dentro
}

/** Sugiere la zona segun donde cayo el punto. No pisa lo que el inspector eligio. */
function sugerirZona(punto: Punto) {
  if (tocado.zonaId) return
  const zona = zonas.value.find((z) => z.contorno.length > 2 && contiene(z.contorno, punto))
  forma.zonaId = zona ? zona.id : ''
}

// ── Ubicacion ───────────────────────────────────────────────────────

function fijarUbicacion(punto: Punto, delGps: boolean) {
  ubicacion.value = punto
  ubicacionEsDelGps.value = delGps
  sugerirZona(punto)
}

async function tomarDelGps() {
  buscandoGps.value = true
  gpsFallo.value = false
  try {
    const punto = await ubicacionActual()
    if (!punto) {
      gpsFallo.value = true
      return
    }
    puntoGps.value = punto
    fijarUbicacion(punto, true)
    centro.value = { lat: punto.lat, lon: punto.lon }
  } finally {
    buscandoGps.value = false
  }
}

function alElegirEnMapa(punto: Punto) {
  // Un punto marcado a dedo no tiene precision informada: es exacto por
  // definicion, lo puso quien estaba mirando el objeto.
  fijarUbicacion({ lat: punto.lat, lon: punto.lon }, false)
  marcarTocado('ubicacion')
}

// ── Carga y guardado ────────────────────────────────────────────────

async function cargar() {
  cargando.value = true
  try {
    const [org, listaTipos, listaZonas, listaObjetos] = await Promise.all([
      almacen.territorio.organismoActual(),
      almacen.territorio.tiposObjeto(),
      almacen.territorio.zonas(),
      almacen.territorio.objetos(),
    ])
    organismo.value = org
    tipos.value = listaTipos
    zonas.value = listaZonas
    existentes.value = listaObjetos
    if (listaObjetos.length > 0) centro.value = { ...listaObjetos[0].ubicacion }
  } catch {
    errorGeneral.value = 'No se pudieron leer los datos del organismo en este dispositivo.'
  } finally {
    cargando.value = false
  }
  // El GPS se pide apenas se abre la pantalla: el inspector ya esta parado
  // donde va el objeto.
  await tomarDelGps()
}

async function guardar() {
  intentoGuardar.value = true
  if (hayErrores.value || guardando.value) return

  const org = organismo.value
  const punto = ubicacion.value
  if (!org || !punto) {
    errorGeneral.value = 'No se pudo identificar el organismo. Recargá la aplicación.'
    return
  }

  guardando.value = true
  errorGeneral.value = ''

  const objeto: ObjetoInspeccionable = {
    id: nuevoUuid(),
    organismoId: org.id,
    tipoObjetoId: forma.tipoObjetoId,
    codigo: forma.codigo.trim(),
    denominacion: forma.denominacion.trim(),
    ubicacion: punto,
    direccion: forma.direccion.trim(),
    zonaId: forma.zonaId || undefined,
    atributos: {},
    estado: 'activo',
    creadoEn: ahora(),
  }

  try {
    await almacen.territorio.guardarObjeto(objeto)
    await almacen.auditoria.registrar({
      organismoId: org.id,
      entidad: 'objeto',
      entidadId: objeto.id,
      accion: 'alta',
      detalle: `${objeto.codigo} · ${objeto.denominacion}`,
      actor: ACTOR,
      ubicacion: punto,
    })
    // `replace`: volver atras desde la ficha no tiene que reabrir el formulario
    // con los datos ya guardados.
    enrutador.replace(`/objeto/${objeto.id}`)
  } catch {
    errorGeneral.value =
      'No se pudo guardar en el dispositivo. Fijate que haya espacio libre y volvé a intentar.'
    guardando.value = false
  }
}

cargar()
</script>

<template>
  <div class="vista">
    <div class="mapa-caja">
      <MapaBase
        :centro="centro"
        :zoom="18"
        :punto-elegido="ubicacion"
        :punto-propio="ubicacionEsDelGps ? null : puntoGps"
        elegible
        @elegir="alElegirEnMapa"
      />
    </div>

    <div class="contenido">
      <div class="tarjeta ubicacion">
        <p class="etiqueta">Ubicación</p>
        <p v-if="ubicacion" class="coordenadas">
          {{ ubicacion.lat.toFixed(5) }}, {{ ubicacion.lon.toFixed(5) }}
          <span class="tenue chico">
            · {{ ubicacionEsDelGps ? 'tomada del GPS' : 'marcada en el mapa' }}
          </span>
        </p>
        <p v-else class="chico tenue">Todavía sin ubicación.</p>

        <p v-if="avisoPrecision" class="nota nota--atencion">{{ avisoPrecision }}</p>
        <p v-if="gpsFallo" class="nota nota--error">
          No se pudo leer el GPS. Activá la ubicación del teléfono, o marcá el punto
          tocando el mapa de arriba.
        </p>
        <p v-if="seVe('ubicacion') && errores.ubicacion" class="nota nota--error">
          {{ errores.ubicacion }}
        </p>

        <button
          type="button"
          class="boton boton--secundario boton--ancho"
          :disabled="buscandoGps"
          @click="tomarDelGps"
        >
          {{ buscandoGps ? 'Buscando señal…' : 'Usar mi GPS' }}
        </button>
      </div>

      <form novalidate @submit.prevent="guardar">
        <div class="campo">
          <label for="tipo">Tipo de objeto</label>
          <select
            id="tipo"
            v-model="forma.tipoObjetoId"
            :aria-invalid="seVe('tipoObjetoId') && !!errores.tipoObjetoId"
            @change="marcarTocado('tipoObjetoId')"
          >
            <option value="">Elegí un tipo…</option>
            <option v-for="tipo in tipos" :key="tipo.id" :value="tipo.id">
              {{ tipo.nombre }}
            </option>
          </select>
          <p v-if="seVe('tipoObjetoId') && errores.tipoObjetoId" class="nota nota--error">
            {{ errores.tipoObjetoId }}
          </p>
        </div>

        <div class="campo">
          <label for="codigo">Código o padrón</label>
          <input
            id="codigo"
            v-model="forma.codigo"
            type="text"
            autocapitalize="characters"
            autocomplete="off"
            placeholder="L-1042"
            :aria-invalid="seVe('codigo') && !!errores.codigo"
            @blur="marcarTocado('codigo')"
          />
          <p v-if="seVe('codigo') && errores.codigo" class="nota nota--error">
            {{ errores.codigo }}
          </p>
        </div>

        <div class="campo">
          <label for="denominacion">Denominación</label>
          <input
            id="denominacion"
            v-model="forma.denominacion"
            type="text"
            autocomplete="off"
            placeholder="Luminaria Rivera y Soca"
            :aria-invalid="seVe('denominacion') && !!errores.denominacion"
            @blur="marcarTocado('denominacion')"
          />
          <p v-if="seVe('denominacion') && errores.denominacion" class="nota nota--error">
            {{ errores.denominacion }}
          </p>
        </div>

        <div class="campo">
          <label for="direccion">Dirección</label>
          <input
            id="direccion"
            v-model="forma.direccion"
            type="text"
            autocomplete="off"
            placeholder="Av. Rivera 3820"
            :aria-invalid="seVe('direccion') && !!errores.direccion"
            @blur="marcarTocado('direccion')"
          />
          <p v-if="seVe('direccion') && errores.direccion" class="nota nota--error">
            {{ errores.direccion }}
          </p>
        </div>

        <div class="campo">
          <label for="zona">Zona</label>
          <select id="zona" v-model="forma.zonaId" @change="marcarTocado('zonaId')">
            <option value="">Sin zona</option>
            <option v-for="zona in zonas" :key="zona.id" :value="zona.id">
              {{ zona.nombre }}
            </option>
          </select>
          <p class="chico tenue">
            Se completa sola según dónde caiga el punto. Podés cambiarla.
          </p>
        </div>

        <p v-if="errorGeneral" class="nota nota--error">{{ errorGeneral }}</p>
        <p v-if="cargando" class="chico tenue">Leyendo tipos y zonas del organismo…</p>
      </form>
    </div>

    <div class="acciones">
      <button
        type="button"
        class="boton boton--ancho"
        :disabled="guardando || cargando"
        @click="guardar"
      >
        {{ guardando ? 'Guardando…' : 'Guardar objeto' }}
      </button>
      <p v-if="intentoGuardar && hayErrores" class="chico faltante">
        Revisá lo que está marcado en rojo más arriba.
      </p>
    </div>
  </div>
</template>

<style scoped>
.vista {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - var(--alto-barra) - var(--seguro-arriba));
  min-height: calc(100dvh - var(--alto-barra) - var(--seguro-arriba));
}

.mapa-caja {
  flex: none;
  height: 34vh;
  min-height: 200px;
  max-height: 300px;
  border-bottom: 1px solid var(--borde);
}

.contenido {
  flex: 1;
  padding: 1rem;
  /* Deja lugar a la barra de accion y a la navegacion del pie. */
  padding-bottom: calc(var(--alto-pie) + var(--seguro-abajo) + 6rem);
  max-width: 720px;
  margin-inline: auto;
  width: 100%;
}

.ubicacion { margin-bottom: 1.25rem; }

.coordenadas {
  margin: 0.25rem 0 0.5rem;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.ubicacion .boton { margin-top: 0.5rem; }

.nota {
  margin: 0.35rem 0 0;
  padding: 0.5rem 0.65rem;
  border-radius: var(--radio-chico);
  font-size: 0.8125rem;
  font-weight: 600;
}

.nota--error { background: var(--rojo-suave); color: var(--rojo); }
.nota--atencion { background: var(--ambar-suave); color: var(--ambar); }

.campo [aria-invalid='true'] { border-color: var(--rojo); }

/* La accion principal no se busca scrolleando: esta siempre ahi. */
.acciones {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(var(--alto-pie) + var(--seguro-abajo));
  z-index: 15;
  padding: 0.6rem 1rem;
  background: var(--superficie);
  border-top: 1px solid var(--borde);
}

.faltante { margin: 0.35rem 0 0; color: var(--rojo); text-align: center; }
</style>
