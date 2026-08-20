// SPDX-FileCopyrightText: 2026 GoDoWorks
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pruebas de las utilidades del dominio.
 *
 * `sumarDias` es lo que convierte «15 dias corridos» en una fecha impresa en un
 * acta con validez administrativa, asi que lo que se prueba aca son justamente
 * los bordes donde este tipo de funcion falla: el cambio de mes, el cambio de
 * año y el 29 de febrero.
 */

import { describe, expect, it } from 'vitest'
import type { Punto } from './tipos'
import { distanciaMetros, sumarDias } from './utilidades'

// ── Ayudantes ─────────────────────────────────────────────────────────

/** Mediodia UTC: lejos de la medianoche en cualquier huso, asi la fecha civil no baila. */
function mediodiaDe(fecha: string): string {
  return `${fecha}T12:00:00.000Z`
}

/** La parte de fecha (AAAA-MM-DD) del instante devuelto. */
function diaDe(instante: string): string {
  return instante.slice(0, 10)
}

function punto(lat: number, lon: number): Punto {
  return { lat, lon }
}

// ── sumarDias ─────────────────────────────────────────────────────────

describe('sumarDias', () => {
  it('un plazo que arranca a fin de mes vence en el mes siguiente', () => {
    expect(diaDe(sumarDias(mediodiaDe('2026-01-31'), 1))).toBe('2026-02-01')
  })

  it('un plazo que cruza diciembre vence en el año siguiente', () => {
    expect(diaDe(sumarDias(mediodiaDe('2025-12-30'), 5))).toBe('2026-01-04')
  })

  it('un plazo de treinta dias sobre febrero corto cae en marzo', () => {
    expect(diaDe(sumarDias(mediodiaDe('2026-02-10'), 30))).toBe('2026-03-12')
  })

  it('en año bisiesto el 29 de febrero existe y se cuenta', () => {
    expect(diaDe(sumarDias(mediodiaDe('2024-02-28'), 1))).toBe('2024-02-29')
  })

  it('en año no bisiesto el 28 de febrero salta directo a marzo', () => {
    expect(diaDe(sumarDias(mediodiaDe('2026-02-28'), 1))).toBe('2026-03-01')
  })

  it('los plazos se cuentan corridos, sin saltear fines de semana', () => {
    // 2026-05-01 es viernes: siete dias corridos son el viernes siguiente.
    expect(diaDe(sumarDias(mediodiaDe('2026-05-01'), 7))).toBe('2026-05-08')
  })

  it('un desplazamiento negativo retrocede y tambien cruza el año', () => {
    // Lo usa la semilla para fechar la orden de inspeccion antes de la visita.
    expect(diaDe(sumarDias(mediodiaDe('2026-01-02'), -3))).toBe('2025-12-30')
  })

  it('sumar cero dias no mueve el instante', () => {
    const origen = mediodiaDe('2026-08-20')
    expect(sumarDias(origen, 0)).toBe(origen)
  })

  it('la hora del dia se conserva: el plazo no se corre a medianoche', () => {
    const resultado = sumarDias('2026-08-20T15:45:00.000Z', 10)
    expect(resultado).toBe('2026-08-30T15:45:00.000Z')
  })

  it('devuelve una fecha ISO en UTC, que es como se guarda todo en el modelo', () => {
    expect(sumarDias(mediodiaDe('2026-03-05'), 2))
      .toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})

// ── distanciaMetros ───────────────────────────────────────────────────

describe('distanciaMetros', () => {
  it('un grado de latitud son unos 111 kilometros', () => {
    // Meridiano: pi * 6371000 / 180 = 111194,9 m. Tolerancia de un metro.
    expect(distanciaMetros(punto(0, 0), punto(1, 0))).toBeCloseTo(111194.9, 0)
  })

  it('el mismo punto esta a cero metros de si mismo', () => {
    const p = punto(-34.9011, -56.1645)
    expect(distanciaMetros(p, p)).toBe(0)
  })

  it('la distancia no depende del orden de los puntos', () => {
    const a = punto(-34.9560, -54.9480)
    const b = punto(-34.9450, -54.9340)
    expect(distanciaMetros(a, b)).toBeCloseTo(distanciaMetros(b, a), 6)
  })

  it('mide bien una distancia corta, que es la escala de una inspeccion', () => {
    // Cien metros al norte: 100 / 111194,9 grados de latitud.
    const a = punto(-34.9000, -56.1600)
    const b = punto(-34.9000 + 100 / 111194.9, -56.1600)
    expect(distanciaMetros(a, b)).toBeCloseTo(100, 1)
  })

  it('cerca del ecuador un grado de longitud tambien son unos 111 kilometros', () => {
    expect(distanciaMetros(punto(0, 0), punto(0, 1))).toBeCloseTo(111194.9, 0)
  })

  it('en la latitud de Uruguay un grado de longitud se acorta por el coseno', () => {
    // A -34,9 grados, cos(34,9) ~ 0,8202: unos 91.200 metros.
    const esperado = 111194.9 * Math.cos((34.9 * Math.PI) / 180)
    expect(distanciaMetros(punto(-34.9, -56.0), punto(-34.9, -55.0)))
      .toBeCloseTo(esperado, -1)
  })

  it('la precision informada por el GPS no altera el calculo', () => {
    const sinPrecision = distanciaMetros(punto(-34.95, -54.94), punto(-34.94, -54.93))
    const conPrecision = distanciaMetros(
      { lat: -34.95, lon: -54.94, precision: 12 },
      { lat: -34.94, lon: -54.93, precision: 40 },
    )
    expect(conPrecision).toBe(sinPrecision)
  })
})
