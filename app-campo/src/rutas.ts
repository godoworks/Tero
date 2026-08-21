// SPDX-FileCopyrightText: 2026 GoDoWorks
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

/**
 * Se usa historial por hash a proposito: la aplicacion se publica en GitHub
 * Pages, que no puede reescribir rutas del lado del servidor. Con hash, entrar
 * directo a una ruta profunda funciona igual, tambien sin conexion.
 */

const rutas: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'portada',
    component: () => import('@/vistas/Portada.vue'),
    meta: { titulo: 'Tero', publico: true },
  },
  {
    path: '/tareas',
    name: 'tareas',
    component: () => import('@/vistas/MisTareas.vue'),
    meta: { titulo: 'Mis tareas' },
  },
  {
    path: '/mapa',
    name: 'mapa',
    component: () => import('@/vistas/MapaTerritorio.vue'),
    meta: { titulo: 'Territorio' },
  },
  {
    path: '/objeto/nuevo',
    name: 'objeto-nuevo',
    component: () => import('@/vistas/ObjetoAlta.vue'),
    meta: { titulo: 'Nuevo objeto' },
  },
  {
    path: '/objeto/:id',
    name: 'objeto',
    component: () => import('@/vistas/ObjetoFicha.vue'),
    props: true,
    meta: { titulo: 'Ficha del objeto' },
  },
  {
    path: '/inspeccion/:uuid',
    name: 'inspeccion',
    component: () => import('@/vistas/InspeccionCampo.vue'),
    props: true,
    meta: { titulo: 'Inspección' },
  },
  {
    path: '/inspeccion/:uuid/acta',
    name: 'acta',
    component: () => import('@/vistas/ActaEmision.vue'),
    props: true,
    meta: { titulo: 'Acta' },
  },
  // Canal ciudadano. Son las unicas pantallas que no usa personal municipal,
  // asi que quedan fuera de la navegacion del inspector: se llega por enlace
  // directo, que es como el vecino las va a recibir.
  {
    path: '/reclamo/nuevo',
    name: 'reclamo-nuevo',
    component: () => import('@/vistas/ReclamoNuevo.vue'),
    meta: { titulo: 'Reportar un problema', publico: true },
  },
  {
    path: '/reclamo/estado',
    name: 'reclamo-estado',
    component: () => import('@/vistas/ReclamoEstado.vue'),
    meta: { titulo: 'Seguimiento del reclamo', publico: true },
  },
  {
    path: '/planificacion',
    name: 'planificacion',
    component: () => import('@/vistas/Planificacion.vue'),
    meta: { titulo: 'Planificación' },
  },
  // Edicion de checklists. Es lo que permite que cada direccion arme sus
  // propios formularios sin programar, y lo que sostiene la promesa de que
  // un acta vieja pueda reconstruirse: publicar crea una version nueva y
  // nunca modifica una publicada.
  {
    path: '/formularios',
    name: 'formularios',
    component: () => import('@/vistas/Formularios.vue'),
    meta: { titulo: 'Formularios' },
  },
  {
    path: '/formularios/:tipoInspeccionId/editar',
    name: 'formulario-editar',
    component: () => import('@/vistas/FormularioEditor.vue'),
    props: true,
    meta: { titulo: 'Editar checklist' },
  },
  {
    path: '/formularios/:formularioId/versiones',
    name: 'formulario-versiones',
    component: () => import('@/vistas/FormularioVersiones.vue'),
    props: true,
    meta: { titulo: 'Versiones del checklist' },
  },
  {
    path: '/tablero',
    name: 'tablero',
    component: () => import('@/vistas/Tablero.vue'),
    meta: { titulo: 'Tablero' },
  },
  { path: '/:resto(.*)*', redirect: '/tareas' },
]

export const enrutador = createRouter({
  history: createWebHashHistory(),
  routes: rutas,
  scrollBehavior: () => ({ top: 0 }),
})
