<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { almacen } from '@/datos/almacen'

const ruta = useRoute()
const titulo = computed(() => (ruta.meta.titulo as string) ?? 'Tero')

/**
 * Las pantallas del canal ciudadano las usa un vecino, no personal municipal.
 * No corresponde mostrarle la navegacion del inspector ni cuantos cambios
 * quedaron sin sincronizar: no son suyos y no puede hacer nada con esa
 * informacion.
 */
const esPublico = computed(() => ruta.meta.publico === true)

const hayConexion = ref(navigator.onLine)
const pendientes = ref(0)

async function contarPendientes() {
  try {
    pendientes.value = await almacen.cola.cantidadPendiente()
  } catch {
    pendientes.value = 0
  }
}

function alCambiarConexion() {
  hayConexion.value = navigator.onLine
}

let temporizador: number | undefined

onMounted(() => {
  window.addEventListener('online', alCambiarConexion)
  window.addEventListener('offline', alCambiarConexion)
  contarPendientes()
  // La barra tiene que reflejar lo que quedo sin enviar aunque el inspector
  // no navegue a ningun lado.
  temporizador = window.setInterval(contarPendientes, 4000)
})

onUnmounted(() => {
  window.removeEventListener('online', alCambiarConexion)
  window.removeEventListener('offline', alCambiarConexion)
  if (temporizador) window.clearInterval(temporizador)
})
</script>

<template>
  <div class="armazon">
    <header class="barra">
      <div class="marca" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="26" height="26">
          <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" stroke-width="3" />
          <path d="M14 44c0-8 5-14 13-14 6 0 10 3 12 7l-2 9c-3 2-7 3-11 3-7 0-12-2-12-5z" fill="currentColor" />
          <circle cx="30" cy="27" r="8.5" fill="currentColor" />
          <path d="M25 20c-3-3-7-5-11-5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          <path d="M38 25l11 3-11 3z" fill="currentColor" />
          <circle cx="33" cy="25" r="2" fill="var(--tinta)" />
        </svg>
      </div>

      <h1 class="titulo">{{ titulo }}</h1>

      <div class="senales">
        <span
          v-if="pendientes > 0 && !esPublico"
          class="senal senal--pendiente"
          :title="pendientes + ' cambios esperando para sincronizar'"
        >
          {{ pendientes }} sin enviar
        </span>
        <span
          class="senal"
          :class="hayConexion ? 'senal--conectado' : 'senal--sin-senal'"
          :title="hayConexion ? 'Con conexión' : 'Sin conexión: se guarda en el dispositivo'"
        >
          {{ hayConexion ? 'En línea' : 'Sin señal' }}
        </span>
      </div>
    </header>

    <main class="cuerpo">
      <RouterView />
    </main>

    <nav v-if="!esPublico" class="pie" aria-label="Navegación principal">
      <RouterLink to="/tareas" class="pie-enlace">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
        <span>Tareas</span>
      </RouterLink>
      <RouterLink to="/mapa" class="pie-enlace">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
        </svg>
        <span>Mapa</span>
      </RouterLink>
      <RouterLink to="/planificacion" class="pie-enlace">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 2v3M16 2v3M3 8h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" />
          <path d="M9 13l2 2 4-4" />
        </svg>
        <span>Planificar</span>
      </RouterLink>
      <RouterLink to="/tablero" class="pie-enlace">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
        <span>Tablero</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.armazon {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.barra {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  height: calc(var(--alto-barra) + var(--seguro-arriba));
  padding: var(--seguro-arriba) 1rem 0;
  background: var(--tinta);
  color: var(--papel);
}

.marca { display: flex; flex: none; }

.titulo {
  flex: 1;
  min-width: 0;
  font-size: 1.05rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.senales { display: flex; gap: 0.4rem; flex: none; }

.senal {
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.senal--conectado { background: rgba(255, 255, 255, 0.14); color: #cfe6da; }
.senal--sin-senal { background: var(--rojo); color: #fff; }
.senal--pendiente { background: var(--ambar-suave); color: var(--ambar); }

.cuerpo { flex: 1; }

.pie {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  height: calc(var(--alto-pie) + var(--seguro-abajo));
  padding-bottom: var(--seguro-abajo);
  background: var(--superficie);
  border-top: 1px solid var(--borde);
}

.pie-enlace {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  text-decoration: none;
  color: var(--apagado);
  font-size: 0.6875rem;
  font-weight: 600;
}

.pie-enlace.router-link-active { color: var(--rojo); }
</style>
