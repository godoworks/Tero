// SPDX-FileCopyrightText: 2026 GoDoWorks
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Convierte cualquier valor en dato plano, apto para guardar en IndexedDB.
 *
 * Existe por un problema que falla tarde y mal: Vue envuelve en un Proxy todo
 * objeto que se guarda en un `ref`, y el algoritmo de clonado estructurado que
 * usa IndexedDB **no puede clonar un Proxy**. Guardar algo que salio de un
 * `ref` revienta con `DataCloneError`, en tiempo de ejecucion, sin que el
 * compilador diga nada y con un mensaje que no menciona ni a Vue ni al `ref`.
 *
 * Se resuelve aca, en la unica puerta de entrada al almacenamiento, y no
 * pidiendole a cada vista que use `shallowRef` o que se acuerde de llamar a
 * `toRaw`: una regla que hay que recordar en cada pantalla nueva es una regla
 * que alguien va a olvidar.
 *
 * Los binarios (fotos, firmas, actas) pasan por referencia: son inmutables en
 * la practica y copiarlos costaria memoria sin ganar nada.
 */
export function aDatoPlano<T>(valor: T): T {
  return copiar(valor) as T
}

function copiar(valor: unknown): unknown {
  if (valor === null || typeof valor !== 'object') return valor

  if (
    valor instanceof Blob ||
    valor instanceof ArrayBuffer ||
    valor instanceof Date ||
    ArrayBuffer.isView(valor)
  ) {
    return valor
  }

  if (Array.isArray(valor)) return valor.map(copiar)

  const salida: Record<string, unknown> = {}
  for (const [clave, dato] of Object.entries(valor as Record<string, unknown>)) {
    salida[clave] = copiar(dato)
  }
  return salida
}
