<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { almacen } from '@/datos/almacen'
import type { Firma, Uuid } from '@/dominio/tipos'
import { ahora, formatearFechaHora } from '@/dominio/utilidades'

/**
 * Firma del interesado, trazada con el dedo o con lapiz sobre la pantalla.
 *
 * La negativa a firmar no es un error: pasa todo el tiempo en la calle y el
 * acta vale igual. Por eso deja constancia y habilita cerrar la inspeccion.
 */

const props = defineProps<{
  inspeccionUuid: Uuid
  soloLectura?: boolean
}>()

const emit = defineEmits<{ (e: 'cambio'): void }>()

const lienzo = ref<HTMLCanvasElement | null>(null)
const firmante = ref('')
const documento = ref('')
const seNego = ref(false)
const hayTrazo = ref(false)
const guardando = ref(false)
const error = ref('')
const firmaGuardada = ref<Firma | undefined>(undefined)
const urlFirma = ref('')

let pincel: CanvasRenderingContext2D | null = null
let trazando = false

function color(ficha: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(ficha).trim()
  return v || '#000'
}

function ajustarLienzo() {
  const nodo = lienzo.value
  if (!nodo) return
  const razon = window.devicePixelRatio || 1
  const ancho = nodo.clientWidth
  const alto = nodo.clientHeight
  if (ancho === 0 || alto === 0) return
  // Redimensionar borra el trazo: si el inspector ya firmo, no se toca.
  if (hayTrazo.value && nodo.width === Math.round(ancho * razon)) return
  if (hayTrazo.value) return
  nodo.width = Math.round(ancho * razon)
  nodo.height = Math.round(alto * razon)
  pincel = nodo.getContext('2d')
  if (!pincel) return
  pincel.scale(razon, razon)
  pincel.lineWidth = 2.5
  pincel.lineCap = 'round'
  pincel.lineJoin = 'round'
  pincel.strokeStyle = color('--tinta')
}

function puntoDe(evento: PointerEvent): { x: number; y: number } {
  const caja = (evento.currentTarget as HTMLCanvasElement).getBoundingClientRect()
  return { x: evento.clientX - caja.left, y: evento.clientY - caja.top }
}

function empezar(evento: PointerEvent) {
  if (props.soloLectura || seNego.value) return
  if (!pincel) ajustarLienzo()
  if (!pincel) return
  trazando = true
  ;(evento.currentTarget as HTMLCanvasElement).setPointerCapture(evento.pointerId)
  const p = puntoDe(evento)
  pincel.beginPath()
  pincel.moveTo(p.x, p.y)
  // Un toque suelto tambien tiene que dejar marca.
  pincel.lineTo(p.x + 0.01, p.y)
  pincel.stroke()
  hayTrazo.value = true
  evento.preventDefault()
}

function seguir(evento: PointerEvent) {
  if (!trazando || !pincel) return
  const p = puntoDe(evento)
  pincel.lineTo(p.x, p.y)
  pincel.stroke()
  evento.preventDefault()
}

function terminar(evento: PointerEvent) {
  if (!trazando) return
  trazando = false
  const nodo = evento.currentTarget as HTMLCanvasElement
  if (nodo.hasPointerCapture(evento.pointerId)) nodo.releasePointerCapture(evento.pointerId)
}

function rehacer() {
  const nodo = lienzo.value
  if (!nodo || !pincel) return
  pincel.clearRect(0, 0, nodo.width, nodo.height)
  hayTrazo.value = false
  ajustarLienzo()
}

function aPng(nodo: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolver, rechazar) => {
    nodo.toBlob((b) => (b ? resolver(b) : rechazar(new Error('No se pudo exportar la firma'))), 'image/png')
  })
}

/** Cuando la persona se niega, igual se genera una imagen que lo diga en el acta. */
async function pngDeNegativa(): Promise<Blob> {
  const nodo = document.createElement('canvas')
  nodo.width = 640
  nodo.height = 200
  const ctx = nodo.getContext('2d')
  if (!ctx) return new Blob([], { type: 'image/png' })
  ctx.fillStyle = color('--tinta')
  ctx.font = 'bold 30px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('SE NEGÓ A FIRMAR', nodo.width / 2, nodo.height / 2)
  return aPng(nodo)
}

const puedeGuardar = computed(() => {
  if (props.soloLectura) return false
  if (firmante.value.trim() === '') return false
  if (seNego.value) return true
  return hayTrazo.value && documento.value.trim() !== ''
})

async function guardar() {
  const nodo = lienzo.value
  if (!puedeGuardar.value) return
  guardando.value = true
  error.value = ''
  try {
    const imagen = seNego.value ? await pngDeNegativa() : await aPng(nodo as HTMLCanvasElement)
    const firma: Firma = {
      inspeccionUuid: props.inspeccionUuid,
      firmante: firmante.value.trim(),
      documento: documento.value.trim(),
      imagen,
      firmadoEn: ahora(),
      seNegoAFirmar: seNego.value,
    }
    await almacen.inspecciones.guardarFirma(firma)
    await almacen.cola.encolar({ tipo: 'firma', entidadUuid: props.inspeccionUuid })
    await cargar()
    emit('cambio')
  } catch {
    error.value = 'No se pudo guardar la firma. Probá de nuevo.'
  } finally {
    guardando.value = false
  }
}

function soltarUrl() {
  if (urlFirma.value) URL.revokeObjectURL(urlFirma.value)
  urlFirma.value = ''
}

async function cargar() {
  const firma = await almacen.inspecciones.firma(props.inspeccionUuid)
  firmaGuardada.value = firma
  soltarUrl()
  if (firma) {
    urlFirma.value = URL.createObjectURL(firma.imagen)
    firmante.value = firma.firmante
    documento.value = firma.documento
    seNego.value = firma.seNegoAFirmar
  }
}

function volverAFirmar() {
  firmaGuardada.value = undefined
  soltarUrl()
  hayTrazo.value = false
  requestAnimationFrame(() => {
    ajustarLienzo()
    rehacer()
  })
}

onMounted(async () => {
  await cargar()
  requestAnimationFrame(ajustarLienzo)
  window.addEventListener('resize', ajustarLienzo)
})

onUnmounted(() => {
  window.removeEventListener('resize', ajustarLienzo)
  soltarUrl()
})
</script>

<template>
  <div class="panel">
    <div v-if="firmaGuardada" class="listo">
      <p class="listo-titulo">
        {{ firmaGuardada.seNegoAFirmar ? 'Constancia de negativa a firmar' : 'Firma registrada' }}
      </p>
      <img v-if="urlFirma" class="firma-hecha" :src="urlFirma" alt="Firma registrada" />
      <p class="chico tenue">
        {{ firmaGuardada.firmante }}
        <template v-if="firmaGuardada.documento"> · Doc. {{ firmaGuardada.documento }}</template>
        <br />
        {{ formatearFechaHora(firmaGuardada.firmadoEn) }}
      </p>
      <button v-if="!soloLectura" type="button" class="boton boton--secundario" @click="volverAFirmar">
        Rehacer la firma
      </button>
    </div>

    <template v-else>
      <div class="campo">
        <label for="firmante">Quién firma</label>
        <input
          id="firmante"
          v-model="firmante"
          type="text"
          autocomplete="name"
          placeholder="Nombre y apellido"
          :disabled="soloLectura"
        />
      </div>

      <div class="campo">
        <label for="documento">Documento</label>
        <input
          id="documento"
          v-model="documento"
          type="text"
          inputmode="numeric"
          placeholder="Cédula o documento"
          :disabled="soloLectura"
        />
      </div>

      <div v-show="!seNego" class="zona-firma">
        <canvas
          ref="lienzo"
          class="lienzo"
          @pointerdown="empezar"
          @pointermove="seguir"
          @pointerup="terminar"
          @pointercancel="terminar"
          @pointerleave="terminar"
        ></canvas>
        <p v-if="!hayTrazo" class="pista">Firmá acá con el dedo</p>
      </div>

      <div class="acciones">
        <button
          v-if="!seNego"
          type="button"
          class="boton boton--secundario"
          :disabled="!hayTrazo"
          @click="rehacer"
        >
          Borrar y rehacer
        </button>
      </div>

      <label class="negativa">
        <input v-model="seNego" type="checkbox" :disabled="soloLectura" />
        <span>
          <strong>Se negó a firmar</strong>
          <span class="chico tenue">Queda constancia en el acta y podés cerrar igual.</span>
        </span>
      </label>

      <p v-if="error" class="error">{{ error }}</p>

      <button
        type="button"
        class="boton boton--ancho"
        :disabled="!puedeGuardar || guardando"
        @click="guardar"
      >
        {{ guardando ? 'Guardando…' : seNego ? 'Dejar constancia' : 'Guardar la firma' }}
      </button>

      <p v-if="!puedeGuardar" class="chico tenue ayuda">
        {{
          firmante.trim() === ''
            ? 'Escribí el nombre de quien atiende para poder seguir.'
            : seNego
              ? ''
              : 'Falta el documento y el trazo de la firma.'
        }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.zona-firma {
  position: relative;
  margin-bottom: 0.75rem;
}

.lienzo {
  display: block;
  width: 100%;
  height: 220px;
  background: var(--superficie);
  border: 2px dashed var(--borde);
  border-radius: var(--radio);
  touch-action: none;
  cursor: crosshair;
}

.pista {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 1.75rem;
  margin: 0;
  text-align: center;
  color: var(--apagado);
  font-size: 0.875rem;
  pointer-events: none;
}

.acciones {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.acciones .boton {
  flex: 1;
}

.negativa {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  background: var(--superficie);
  cursor: pointer;
}

.negativa input {
  width: 26px;
  height: 26px;
  flex: none;
  margin-top: 2px;
  accent-color: var(--rojo);
}

.negativa span {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.error {
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.65rem;
  border-radius: var(--radio-chico);
  background: var(--rojo-suave);
  color: var(--rojo);
  font-size: 0.875rem;
  font-weight: 600;
}

.ayuda {
  margin: 0.5rem 0 0;
  text-align: center;
}

.listo {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  align-items: flex-start;
}

.listo-titulo {
  margin: 0;
  font-weight: 700;
  color: var(--verde);
}

.firma-hecha {
  width: 100%;
  max-height: 200px;
  object-fit: contain;
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: var(--radio);
}
</style>
