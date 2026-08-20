<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
/**
 * Alta de un reclamo del vecino.
 *
 * Esta es la punta que abre el circuito: alguien reporta algo, eso se
 * convierte en una inspeccion sobre un objeto del territorio y la trazabilidad
 * vuelve a esta misma persona por el codigo de seguimiento.
 *
 * Quien la usa no tuvo ninguna capacitacion: puede ser un vecino con el
 * telefono en la calle o quien atiende el telefono en la intendencia mientras
 * escucha a alguien del otro lado. Por eso:
 *
 *  - Se piden tres cosas y dos son opcionales. Un formulario largo es un
 *    reclamo que no entra.
 *  - La ubicacion no se escribe: sale del GPS al abrir y se corrige tocando el
 *    mapa. Nadie sabe de memoria la altura exacta de la calle.
 *  - El contacto es opcional de verdad. Un reclamo anonimo tiene que poder
 *    entrar, porque hay cosas que la gente no denuncia con nombre y apellido.
 *  - Al confirmar, lo unico grande en pantalla es el codigo, porque es lo unico
 *    que la persona se tiene que llevar.
 */
import { computed, reactive, ref, shallowRef } from 'vue'
import MapaBase from '@/componentes/MapaBase.vue'
import { almacen } from '@/datos/almacen'
import type { Reclamo } from '@/datos/contratos'
import { ubicacionActual } from '@/dominio/utilidades'
import type { Punto } from '@/dominio/tipos'

/** Mientras no haya sesion, lo que se audita queda a nombre del rol. */
const ACTOR = 'vecino'

/** Por encima de esta precision conviene corregir el punto a mano. */
const PRECISION_DUDOSA = 40

/** Menos que esto no alcanza para que un inspector sepa a que va. */
const LARGO_MINIMO = 10

const buscandoGps = ref(false)
const gpsFallo = ref(false)
const ubicacionEsDelGps = ref(false)
const guardando = ref(false)
const errorGeneral = ref('')

/** Cuando existe, el reclamo ya entro y la pantalla pasa a mostrar el codigo. */
const registrado = ref<Reclamo | null>(null)
const copiado = ref(false)

const forma = reactive({
  descripcion: '',
  referencia: '',
  nombre: '',
  telefono: '',
})

const pideContacto = ref(false)

/**
 * El punto va en `shallowRef` y no en `ref` a proposito.
 *
 * `ref` de un objeto lo envuelve en un Proxy reactivo, y IndexedDB guarda con
 * el algoritmo de clonado estructurado, que no sabe clonar un Proxy: guardar
 * el punto tal como sale de un `ref` falla con `DataCloneError`. Con
 * `shallowRef` lo que se lee es el objeto plano original.
 *
 * Ademas es lo correcto en sí: el punto nunca se muta campo por campo, se
 * reemplaza entero, asi que no hace falta reactividad profunda.
 */
const ubicacion = shallowRef<Punto | null>(null)
/** Ultima lectura del GPS. Se sigue mostrando despues de corregir a mano. */
const puntoGps = shallowRef<Punto | null>(null)
const centro = shallowRef<Punto | null>(null)

const tocado = reactive<Record<string, boolean>>({})
const intentoEnviar = ref(false)

function marcarTocado(campo: string) {
  tocado[campo] = true
}

function seVe(campo: string): boolean {
  return intentoEnviar.value || tocado[campo] === true
}

// ── Validacion ──────────────────────────────────────────────────────
// Los mensajes dicen que hacer, no que falta. «Campo requerido» no le sirve a
// nadie que esta parado en la vereda con una mano ocupada.

const errores = computed<Record<string, string>>(() => {
  const e: Record<string, string> = {}

  if (forma.descripcion.trim().length < LARGO_MINIMO) {
    e.descripcion =
      'Contá con tus palabras qué está pasando, por ejemplo «la luz de la esquina ' +
      'está apagada hace una semana».'
  }

  if (!ubicacion.value) {
    e.ubicacion =
      'Falta el lugar. Tocá «Usar mi ubicación» si estás ahí, o marcá el punto en el mapa.'
  }

  // El telefono solo se valida si la persona decidio dejarlo.
  const telefono = forma.telefono.trim()
  if (telefono && telefono.replace(/[^0-9]/g, '').length < 8) {
    e.telefono = 'Ese teléfono parece incompleto. Escribilo con la característica, o dejalo vacío.'
  }

  return e
})

const hayErrores = computed(() => Object.keys(errores.value).length > 0)

const avisoPrecision = computed<string>(() => {
  const punto = ubicacion.value
  if (!punto || !ubicacionEsDelGps.value || punto.precision === undefined) return ''
  if (punto.precision <= PRECISION_DUDOSA) return ''
  return (
    `El teléfono ubica el punto con un margen de ${Math.round(punto.precision)} metros. ` +
    'Si quedó lejos del lugar, corregilo tocando el mapa.'
  )
})

// ── Ubicacion ───────────────────────────────────────────────────────

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
    ubicacion.value = punto
    ubicacionEsDelGps.value = true
    centro.value = { lat: punto.lat, lon: punto.lon }
  } finally {
    buscandoGps.value = false
  }
}

function alElegirEnMapa(punto: Punto) {
  // Un punto marcado a dedo no informa precision: lo puso quien estaba mirando
  // el problema.
  ubicacion.value = { lat: punto.lat, lon: punto.lon }
  ubicacionEsDelGps.value = false
  marcarTocado('ubicacion')
}

// ── Envio ───────────────────────────────────────────────────────────

async function enviar() {
  intentoEnviar.value = true
  if (hayErrores.value || guardando.value) return

  const punto = ubicacion.value
  if (!punto) return

  guardando.value = true
  errorGeneral.value = ''

  try {
    const reclamo = await almacen.reclamos.registrar({
      descripcion: forma.descripcion,
      ubicacion: punto,
      referencia: forma.referencia,
      contacto: { nombre: forma.nombre, telefono: forma.telefono },
    })

    // La auditoria deja constancia de que el reclamo entro, con el codigo y no
    // con el contacto: quien reclamo no tiene por que quedar registrado en un
    // historial que despues se lee para otras cosas.
    await almacen.auditoria.registrar({
      organismoId: reclamo.organismoId,
      entidad: 'reclamo',
      entidadId: reclamo.id,
      accion: 'alta',
      detalle: reclamo.codigo,
      actor: ACTOR,
      ubicacion: punto,
    })

    registrado.value = reclamo
  } catch {
    errorGeneral.value =
      'No se pudo guardar el reclamo en este dispositivo. Fijate que haya espacio libre y probá de nuevo.'
  } finally {
    guardando.value = false
  }
}

async function copiarCodigo() {
  const reclamo = registrado.value
  if (!reclamo) return
  try {
    await navigator.clipboard.writeText(reclamo.codigo)
    copiado.value = true
  } catch {
    // Sin permiso de portapapeles (pasa fuera de https) no hay nada que
    // avisar: el codigo esta ahi arriba, en grande, para anotarlo a mano.
    copiado.value = false
  }
}

function cargarOtro() {
  registrado.value = null
  copiado.value = false
  intentoEnviar.value = false
  errorGeneral.value = ''
  forma.descripcion = ''
  forma.referencia = ''
  forma.nombre = ''
  forma.telefono = ''
  pideContacto.value = false
  for (const clave of Object.keys(tocado)) delete tocado[clave]
}

// El GPS se pide apenas se abre: quien reclama suele estar en el lugar.
tomarDelGps()
</script>

<template>
  <!-- ── Confirmacion ─────────────────────────────────────────────── -->
  <div v-if="registrado" class="contenido recibo">
    <p class="recibo__titulo">Listo, tu reclamo entró</p>

    <div class="tarjeta codigo-caja">
      <p class="etiqueta">Código de seguimiento</p>
      <p class="codigo">{{ registrado.codigo }}</p>
      <p class="chico tenue">
        Anotalo o sacale una foto. Con este código podés consultar en qué anda tu
        reclamo cuando quieras, sin dar ningún dato más.
      </p>
      <button type="button" class="boton boton--secundario boton--ancho" @click="copiarCodigo">
        {{ copiado ? 'Copiado' : 'Copiar el código' }}
      </button>
    </div>

    <p class="chico tenue reportado">Reportaste: «{{ registrado.descripcion }}»</p>

    <div class="apilado">
      <router-link
        class="boton boton--ancho"
        :to="{ path: '/reclamo/estado', query: { codigo: registrado.codigo } }"
      >
        Ver el estado de mi reclamo
      </router-link>
      <button type="button" class="boton boton--secundario boton--ancho" @click="cargarOtro">
        Cargar otro reclamo
      </button>
    </div>
  </div>

  <!-- ── Formulario ───────────────────────────────────────────────── -->
  <div v-else class="vista">
    <div class="mapa-caja">
      <MapaBase
        :centro="centro"
        :zoom="17"
        :punto-elegido="ubicacion"
        :punto-propio="ubicacionEsDelGps ? null : puntoGps"
        elegible
        @elegir="alElegirEnMapa"
      />
    </div>

    <div class="contenido">
      <p class="intro">
        Contanos qué está pasando y dónde. Te damos un código para que puedas
        seguir tu reclamo.
      </p>

      <form novalidate @submit.prevent="enviar">
        <div class="campo">
          <label for="descripcion">¿Qué está pasando?</label>
          <textarea
            id="descripcion"
            v-model="forma.descripcion"
            rows="4"
            placeholder="La luz de la esquina está apagada hace una semana"
            :aria-invalid="seVe('descripcion') && !!errores.descripcion"
            @blur="marcarTocado('descripcion')"
          />
          <p v-if="seVe('descripcion') && errores.descripcion" class="nota nota--error">
            {{ errores.descripcion }}
          </p>
        </div>

        <div class="tarjeta ubicacion">
          <p class="etiqueta">¿Dónde es?</p>
          <p v-if="ubicacion" class="coordenadas">
            {{ ubicacion.lat.toFixed(5) }}, {{ ubicacion.lon.toFixed(5) }}
            <span class="tenue chico">
              · {{ ubicacionEsDelGps ? 'tomado de tu ubicación' : 'marcado en el mapa' }}
            </span>
          </p>
          <p v-else class="chico tenue">Todavía sin lugar.</p>

          <p v-if="avisoPrecision" class="nota nota--atencion">{{ avisoPrecision }}</p>
          <!-- Si ya hay un punto marcado a mano, el aviso del GPS es ruido. -->
          <p v-if="gpsFallo && !ubicacion" class="nota nota--error">
            No pudimos leer tu ubicación. Activá la ubicación del teléfono, o tocá
            el mapa de arriba para marcar el lugar.
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
            {{ buscandoGps ? 'Buscando…' : 'Usar mi ubicación' }}
          </button>
        </div>

        <div class="campo">
          <label for="referencia">Calle y número, o la esquina (opcional)</label>
          <input
            id="referencia"
            v-model="forma.referencia"
            type="text"
            autocomplete="off"
            placeholder="Rivera y Soca"
          />
          <p class="chico tenue">Ayuda al inspector a llegar sin preguntar.</p>
        </div>

        <!-- El contacto va plegado: pedirlo de entrada hace pensar que es
             obligatorio, y un reclamo anonimo tiene que poder entrar igual. -->
        <div class="tarjeta contacto">
          <button
            type="button"
            class="boton boton--fantasma boton--ancho desplegar"
            :aria-expanded="pideContacto"
            @click="pideContacto = !pideContacto"
          >
            {{ pideContacto ? 'No dejar mis datos' : 'Dejar mi teléfono (opcional)' }}
          </button>

          <div v-if="pideContacto">
            <p class="chico tenue">
              Solo se usa para avisarte de este reclamo. Si preferís no dejarlo, el
              reclamo entra igual y lo seguís con el código.
            </p>
            <div class="campo">
              <label for="nombre">Tu nombre</label>
              <input id="nombre" v-model="forma.nombre" type="text" autocomplete="name" />
            </div>
            <div class="campo">
              <label for="telefono">Tu teléfono</label>
              <input
                id="telefono"
                v-model="forma.telefono"
                type="tel"
                inputmode="tel"
                autocomplete="tel"
                placeholder="099 123 456"
                :aria-invalid="seVe('telefono') && !!errores.telefono"
                @blur="marcarTocado('telefono')"
              />
              <p v-if="seVe('telefono') && errores.telefono" class="nota nota--error">
                {{ errores.telefono }}
              </p>
            </div>
          </div>
        </div>

        <p v-if="errorGeneral" class="nota nota--error">{{ errorGeneral }}</p>
      </form>
    </div>

    <div class="acciones">
      <button
        type="button"
        class="boton boton--ancho"
        :disabled="guardando"
        @click="enviar"
      >
        {{ guardando ? 'Enviando…' : 'Enviar el reclamo' }}
      </button>
      <p v-if="intentoEnviar && hayErrores" class="chico faltante">
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
  height: 30vh;
  min-height: 180px;
  max-height: 280px;
  border-bottom: 1px solid var(--borde);
}

.vista .contenido {
  flex: 1;
  width: 100%;
  /* Deja lugar a la barra de accion y a la navegacion del pie. */
  padding-bottom: calc(var(--alto-pie) + var(--seguro-abajo) + 6rem);
}

.intro { margin: 0 0 1rem; }

.ubicacion { margin-bottom: 1.25rem; }

.coordenadas {
  margin: 0.25rem 0 0.5rem;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.ubicacion .boton { margin-top: 0.5rem; }

.contacto { margin-bottom: 1rem; }
.desplegar { justify-content: flex-start; padding-left: 0; text-decoration: underline; }
.contacto .campo { margin-top: 0.75rem; margin-bottom: 0; }
.contacto .campo + .campo { margin-top: 0.75rem; }

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

/* ── Confirmacion ────────────────────────────────────────────────── */

.recibo { text-align: center; }

.recibo__titulo {
  margin: 0.5rem 0 1rem;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--verde);
}

.codigo-caja {
  border-color: var(--verde);
  background: var(--verde-suave);
  margin-bottom: 1rem;
}

/*
  El codigo es lo unico que la persona se lleva. Va grande, con las letras
  separadas para poder dictarlo por telefono sin equivocarse, y en cifras
  tabulares para que no baile al leerlo.
*/
.codigo {
  margin: 0.35rem 0 0.75rem;
  font-size: 2.5rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  line-height: 1.1;
  color: var(--verde);
  font-variant-numeric: tabular-nums;
  word-break: break-word;
}

.codigo-caja .boton { margin-top: 0.75rem; }

.reportado { margin: 0 0 1.25rem; }
</style>
