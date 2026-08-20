// SPDX-FileCopyrightText: 2026 GoDoWorks
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Configuracion de las pruebas.
 *
 * Va en un archivo aparte y no dentro de `vite.config.ts` a proposito: la
 * configuracion de construccion arrastra el plugin de PWA y el de Vue, que en
 * las pruebas no hacen falta y solo suman tiempo de arranque. Aca solo se
 * declara lo minimo: el alias `@/` y el entorno.
 */

import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Mismo alias que la aplicacion: si las pruebas resolvieran distinto,
    // estarian probando otro codigo del que se publica.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // Todo lo que se prueba aca son funciones puras y generacion de PDF en
    // memoria: no hace falta un DOM.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Las pruebas viven al lado del codigo que prueban, no en una carpeta
    // aparte: asi se ven en la misma pantalla al revisar un cambio.
    globals: false,
  },
})
