// SPDX-FileCopyrightText: 2026 GoDoWorks
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FechaHora, Punto, Uuid } from './tipos'

/** Identificador unico generado en el dispositivo. */
export function nuevoUuid(): Uuid {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // Respaldo para navegadores viejos o contextos sin https.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function ahora(): FechaHora {
  return new Date().toISOString()
}

/** Suma dias habiles no: dias corridos, que es como corren los plazos del acta. */
export function sumarDias(desde: FechaHora, dias: number): FechaHora {
  const f = new Date(desde)
  f.setDate(f.getDate() + dias)
  return f.toISOString()
}

export function formatearFecha(f: FechaHora | undefined): string {
  if (!f) return '—'
  return new Date(f).toLocaleDateString('es-UY', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

export function formatearFechaHora(f: FechaHora | undefined): string {
  if (!f) return '—'
  return new Date(f).toLocaleString('es-UY', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/** Distancia en metros entre dos puntos (formula del haversine). */
export function distanciaMetros(a: Punto, b: Punto): number {
  const R = 6371000
  const rad = (g: number) => (g * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** sha256 en hexadecimal. Sirve para probar que una foto no se altero. */
export async function calcularHash(contenido: Blob): Promise<string> {
  const buffer = await contenido.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Ubicacion actual del dispositivo. Nunca lanza: si no hay GPS, devuelve undefined. */
export function ubicacionActual(): Promise<Punto | undefined> {
  return new Promise((resolver) => {
    if (!('geolocation' in navigator)) return resolver(undefined)
    navigator.geolocation.getCurrentPosition(
      (p) => resolver({
        lat: p.coords.latitude,
        lon: p.coords.longitude,
        precision: p.coords.accuracy,
      }),
      () => resolver(undefined),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    )
  })
}
