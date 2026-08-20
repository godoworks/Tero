<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { almacen } from '@/datos/almacen'
import type { Evidencia, Uuid } from '@/dominio/tipos'
import { ahora, calcularHash, formatearFechaHora, nuevoUuid, ubicacionActual } from '@/dominio/utilidades'

/**
 * Captura de fotos con constancia de donde y cuando se tomaron.
 *
 * Dos cosas que no son opcionales en campo:
 *  - La foto se achica y se comprime antes de guardarla. Una inspeccion con
 *    ocho fotos de 4 MB no entra en el dispositivo ni sube nunca.
 *  - La ubicacion y la hora se toman en el momento del disparo, no cuando la
 *    evidencia se sincroniza: lo que vale es cuando se vio el hecho.
 */

const LADO_MAXIMO = 1600
const CALIDAD = 0.8

const props = defineProps<{
  inspeccionUuid: Uuid
  /** Si viene, las fotos quedan atadas a esa pregunta del checklist. */
  preguntaId?: string
  soloLectura?: boolean
  compacto?: boolean
}>()

const emit = defineEmits<{ (e: 'cambio'): void }>()

const fotos = ref<Evidencia[]>([])
const urls = ref<Record<string, string>>({})
const procesando = ref(0)
const error = ref('')
const entrada = ref<HTMLInputElement | null>(null)

function soltarUrls() {
  for (const url of Object.values(urls.value)) URL.revokeObjectURL(url)
  urls.value = {}
}

async function cargar() {
  const todas = await almacen.inspecciones.evidencias(props.inspeccionUuid)
  const propias = todas.filter(
    (e) => e.tipo === 'foto' && (props.preguntaId ? e.preguntaId === props.preguntaId : true),
  )
  soltarUrls()
  const nuevas: Record<string, string> = {}
  for (const e of propias) nuevas[e.id] = URL.createObjectURL(e.contenido)
  urls.value = nuevas
  fotos.value = propias.sort((a, b) => a.tomadaEn.localeCompare(b.tomadaEn))
}

/** Achica al lado mayor pedido y comprime a JPEG. Devuelve el blob listo para guardar. */
async function comprimir(archivo: File): Promise<Blob> {
  const fuente = await dibujable(archivo)
  const ancho = fuente.width
  const alto = fuente.height
  const escala = Math.min(1, LADO_MAXIMO / Math.max(ancho, alto))
  const lienzo = document.createElement('canvas')
  lienzo.width = Math.max(1, Math.round(ancho * escala))
  lienzo.height = Math.max(1, Math.round(alto * escala))
  const pincel = lienzo.getContext('2d')
  if (!pincel) return archivo
  pincel.drawImage(fuente, 0, 0, lienzo.width, lienzo.height)
  if ('close' in fuente) fuente.close()
  const blob = await new Promise<Blob | null>((resolver) =>
    lienzo.toBlob(resolver, 'image/jpeg', CALIDAD),
  )
  return blob ?? archivo
}

async function dibujable(archivo: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(archivo, { imageOrientation: 'from-image' })
    } catch {
      // Algunos navegadores viejos no aceptan las opciones: se sigue por el camino largo.
    }
  }
  const url = URL.createObjectURL(archivo)
  try {
    return await new Promise<HTMLImageElement>((resolver, rechazar) => {
      const img = new Image()
      img.onload = () => resolver(img)
      img.onerror = () => rechazar(new Error('No se pudo leer la imagen'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function alElegirArchivos(evento: Event) {
  const destino = evento.target as HTMLInputElement
  const archivos = Array.from(destino.files ?? [])
  destino.value = ''
  if (archivos.length === 0) return

  error.value = ''
  procesando.value += archivos.length

  // La ubicacion se pide una sola vez para toda la tanda: es el mismo lugar.
  const punto = await ubicacionActual()
  const tomadaEn = ahora()

  for (const archivo of archivos) {
    try {
      const contenido = await comprimir(archivo)
      const evidencia: Evidencia = {
        id: nuevoUuid(),
        inspeccionUuid: props.inspeccionUuid,
        tipo: 'foto',
        contenido,
        ubicacion: punto,
        tomadaEn,
        hash: await calcularHash(contenido),
        preguntaId: props.preguntaId,
      }
      await almacen.inspecciones.guardarEvidencia(evidencia)
      await almacen.cola.encolar({ tipo: 'evidencia', entidadUuid: evidencia.id })
    } catch {
      error.value = 'No se pudo guardar una de las fotos. Probá sacarla de nuevo.'
    } finally {
      procesando.value -= 1
    }
  }

  await cargar()
  emit('cambio')
}

async function borrar(evidencia: Evidencia) {
  if (!window.confirm('¿Borrar esta foto?')) return
  await almacen.inspecciones.borrarEvidencia(evidencia.id)
  await cargar()
  emit('cambio')
}

function abrirCamara() {
  entrada.value?.click()
}

function pesoLegible(blob: Blob): string {
  const kb = blob.size / 1024
  return kb < 1024 ? Math.round(kb) + ' kB' : (kb / 1024).toFixed(1) + ' MB'
}

watch(() => [props.inspeccionUuid, props.preguntaId], cargar, { immediate: true })

onUnmounted(soltarUrls)
</script>

<template>
  <div class="captura" :class="{ 'captura--compacto': compacto }">
    <input
      ref="entrada"
      class="entrada-oculta"
      type="file"
      accept="image/*"
      capture="environment"
      multiple
      @change="alElegirArchivos"
    />

    <button
      v-if="!soloLectura"
      type="button"
      class="boton disparador"
      :disabled="procesando > 0"
      @click="abrirCamara"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 8h3l2-3h8l2 3h3v11H3z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
      {{ procesando > 0 ? 'Guardando foto…' : compacto ? 'Sacar foto' : 'Sacar una foto' }}
    </button>

    <p v-if="error" class="error">{{ error }}</p>

    <p v-if="fotos.length === 0 && procesando === 0" class="sin-fotos">
      {{ soloLectura ? 'No se cargaron fotos.' : 'Todavía no hay fotos. Sacá una del hecho que estás constatando.' }}
    </p>

    <ul v-else class="galeria">
      <li v-for="foto in fotos" :key="foto.id" class="miniatura">
        <img :src="urls[foto.id]" :alt="'Foto tomada el ' + formatearFechaHora(foto.tomadaEn)" />
        <div class="pie-foto">
          <span>{{ formatearFechaHora(foto.tomadaEn) }}</span>
          <span class="tenue">
            {{ foto.ubicacion ? 'Con ubicación' : 'Sin ubicación' }} · {{ pesoLegible(foto.contenido) }}
          </span>
        </div>
        <button
          v-if="!soloLectura"
          type="button"
          class="borrar"
          :aria-label="'Borrar la foto de ' + formatearFechaHora(foto.tomadaEn)"
          @click="borrar(foto)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.captura {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.entrada-oculta {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.disparador {
  width: 100%;
}

.captura--compacto .disparador {
  min-height: 48px;
  background: var(--superficie);
  color: var(--tinta);
  border-color: var(--borde);
}

.error {
  margin: 0;
  padding: 0.5rem 0.65rem;
  border-radius: var(--radio-chico);
  background: var(--rojo-suave);
  color: var(--rojo);
  font-size: 0.875rem;
  font-weight: 600;
}

.sin-fotos {
  margin: 0;
  color: var(--apagado);
  font-size: 0.875rem;
}

.galeria {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.6rem;
}

.miniatura {
  position: relative;
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  overflow: hidden;
  background: var(--superficie);
}

.miniatura img {
  display: block;
  width: 100%;
  height: 120px;
  object-fit: cover;
}

.pie-foto {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.35rem 0.5rem;
  font-size: 0.6875rem;
  line-height: 1.3;
}

.borrar {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: var(--tinta);
  color: var(--papel);
  cursor: pointer;
  opacity: 0.9;
}
</style>
