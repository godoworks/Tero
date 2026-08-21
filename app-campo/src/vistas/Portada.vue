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
  /** Identifica la puerta: elige su icono y su color. */
  clave: 'inspector' | 'supervisor' | 'vecino'
  a: string
  rol: string
  titulo: string
  descripcion: string
  puntos: string[]
}

const puertas: Puerta[] = [
  {
    clave: 'inspector',
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
    clave: 'supervisor',
    a: '/planificacion',
    rol: 'Supervisor',
    titulo: 'Planifico y controlo',
    descripcion: 'Lo que usa quien reparte el trabajo y responde por los números.',
    puntos: [
      'Qué falta inspeccionar y hace cuánto',
      'Cómo está repartida la carga del equipo',
      'Tiempos de respuesta y cobertura por zona',
      'Armar los checklists de cada dirección, sin programar',
    ],
  },
  {
    clave: 'vecino',
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
      <RouterLink
        v-for="p in puertas"
        :key="p.a"
        :to="p.a"
        class="puerta"
        :class="'puerta--' + p.clave"
      >
        <!--
          Cada puerta usa el mismo icono que su destino en la barra inferior:
          quien entra por acá reconoce después dónde estaba parado.
        -->
        <span class="icono" aria-hidden="true">
          <!-- Inspector: el portapapeles del checklist -->
          <svg v-if="p.clave === 'inspector'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 3h6a1 1 0 011 1v1H8V4a1 1 0 011-1z" />
            <path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
            <path d="M8.5 13l2 2 4.5-4.5" />
          </svg>
          <!-- Supervisor: el calendario de la planificación -->
          <svg v-else-if="p.clave === 'supervisor'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 2v3M16 2v3M3 9h18" />
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M9 14l2 2 4-4" />
          </svg>
          <!-- Vecino: el globo con el que se avisa algo -->
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a8 8 0 01-8 8H8l-4 3v-4.5A8 8 0 0113 4a8 8 0 018 8z" />
            <path d="M13 8.5v4" />
            <path d="M13 15.5h.01" />
          </svg>
        </span>
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

.puerta:hover { border-color: var(--acento); }

/*
 * Un color por audiencia. Son tres personas distintas, no tres botones
 * iguales, y el color es lo que se percibe antes de leer.
 */
.puerta--inspector  { --acento: var(--inspector-tinta);  --neon: var(--neon-inspector); }
.puerta--supervisor { --acento: var(--supervisor-tinta); --neon: var(--neon-supervisor); }
.puerta--vecino     { --acento: var(--vecino-tinta);     --neon: var(--neon-vecino); }

.icono {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-bottom: 0.35rem;
  border-radius: 12px;
  /* El icono se enciende sobre un chip oscuro. Sobre el fondo claro el
     neon no se leeria; sobre el oscuro es exactamente donde funciona. */
  background: var(--tinta);
  color: var(--neon);
  box-shadow: 0 0 16px -4px var(--neon);
}

.icono svg { width: 23px; height: 23px; }

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

.ir { margin-top: auto; padding-top: 0.9rem; color: var(--acento); font-weight: 700; font-size: 0.9375rem; }

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
