<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
/**
 * Puerta de entrada de la demostracion.
 *
 * En una instalacion real esta pantalla no existe: cada persona entra con su
 * usuario y el sistema le muestra lo suyo. Aca las tres puertas estan abiertas
 * a proposito, para que quien evalua el proyecto pueda recorrer los tres
 * roles sin que nadie le explique donde queda cada cosa.
 */

interface Puerta {
  a: string
  rol: string
  titulo: string
  descripcion: string
  puntos: string[]
}

const puertas: Puerta[] = [
  {
    a: '/tareas',
    rol: 'Inspector',
    titulo: 'Salgo a la calle',
    descripcion: 'Lo que usa quien inspecciona, desde el celular y sin depender de la señal.',
    puntos: [
      'Las tareas del día, ordenadas por prioridad',
      'Checklist, fotos con ubicación y hora, y firma',
      'El acta en PDF, con su plazo',
    ],
  },
  {
    a: '/planificacion',
    rol: 'Supervisor',
    titulo: 'Planifico y controlo',
    descripcion: 'Lo que usa quien reparte el trabajo y responde por los números.',
    puntos: [
      'Qué falta inspeccionar y hace cuánto',
      'Cómo está repartida la carga del equipo',
      'Tiempos de respuesta y cobertura por zona',
    ],
  },
  {
    a: '/reclamo/nuevo',
    rol: 'Vecino',
    titulo: 'Reporto un problema',
    descripcion: 'Lo que ve la ciudadanía. No muestra nada interno de la intendencia.',
    puntos: [
      'Reportar qué pasa y dónde',
      'Un código corto para seguirlo',
      'En qué anda, en cada paso',
    ],
  },
]
</script>

<template>
  <div class="portada">
    <header class="encabezado">
      <svg class="marca" viewBox="0 0 64 64" role="img" aria-label="Tero">
        <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" stroke-width="2.5" />
        <path d="M14 44c0-8 5-14 13-14 6 0 10 3 12 7l-2 9c-3 2-7 3-11 3-7 0-12-2-12-5z" fill="currentColor" />
        <circle cx="30" cy="27" r="8.5" fill="currentColor" />
        <path d="M25 20c-3-3-7-5-11-5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
        <path d="M38 25l11 3-11 3z" fill="currentColor" />
        <circle cx="33" cy="25" r="1.9" fill="var(--papel)" />
        <path d="M25 45l-2 11M33 45l2 11" fill="none" stroke="var(--rojo)" stroke-width="2.6" stroke-linecap="round" />
      </svg>
      <div>
        <h1>Tero</h1>
        <p class="lema">Inspecciones municipales</p>
      </div>
    </header>

    <p class="entrada">
      Esto es una <strong>demostración</strong>. Elegí desde dónde querés mirarla.
    </p>

    <div class="puertas">
      <RouterLink v-for="p in puertas" :key="p.a" :to="p.a" class="puerta">
        <span class="etiqueta">{{ p.rol }}</span>
        <h2>{{ p.titulo }}</h2>
        <p>{{ p.descripcion }}</p>
        <ul>
          <li v-for="punto in p.puntos" :key="punto">{{ punto }}</li>
        </ul>
        <span class="ir">Entrar →</span>
      </RouterLink>
    </div>

    <footer class="pie-portada">
      <p>
        En una instalación real cada persona entra con su usuario y ve solo lo suyo. Acá las tres
        puertas están abiertas para que puedas recorrer todo.
      </p>
      <p>
        Los datos son inventados y quedan en este dispositivo. No se envía nada a ningún servidor.
      </p>
      <p>
        <a href="https://github.com/godoworks/Tero">Código abierto bajo AGPL-3.0</a>
      </p>
    </footer>
  </div>
</template>

<style scoped>
.portada {
  max-width: 62rem;
  margin-inline: auto;
  padding: 2rem 1rem calc(var(--seguro-abajo) + 3rem);
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.encabezado { display: flex; align-items: center; gap: 0.9rem; }
.marca { width: 46px; height: 46px; flex: none; color: var(--tinta); }
.encabezado h1 { font-size: 2rem; letter-spacing: -0.03em; }
.lema { margin: 0; color: var(--apagado); font-size: 0.9375rem; }

.entrada { margin: 0; font-size: 1.0625rem; }

.puertas {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15.5rem, 1fr));
  gap: 1rem;
}

.puerta {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1.25rem;
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  text-decoration: none;
  color: inherit;
  box-shadow: var(--sombra);
}

.puerta:hover { border-color: var(--tinta); }

.puerta h2 { font-size: 1.125rem; }
.puerta > p { margin: 0; color: var(--apagado); font-size: 0.9375rem; }

.puerta ul {
  margin: 0.35rem 0 0;
  padding-left: 1.1rem;
  color: var(--apagado);
  font-size: 0.875rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.ir { margin-top: auto; padding-top: 0.9rem; color: var(--rojo); font-weight: 700; font-size: 0.9375rem; }

.pie-portada {
  border-top: 1px solid var(--filete);
  padding-top: 1.25rem;
  color: var(--apagado);
  font-size: 0.875rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.pie-portada p { margin: 0; }
.pie-portada a { color: inherit; }
</style>
