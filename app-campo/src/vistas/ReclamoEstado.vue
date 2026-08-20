<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
/**
 * Consulta publica del estado de un reclamo.
 *
 * Quien entra aca no tiene sesion, no tiene la aplicacion instalada y muchas
 * veces solo tiene un codigo anotado en un papel. Se pide eso y nada mas:
 * ningun documento, ningun telefono, ninguna cuenta.
 *
 * QUE SE MUESTRA Y QUE NO
 *
 * La vista nunca ve un `Reclamo` ni una `Inspeccion`: recibe un
 * `SeguimientoReclamo`, que es una proyeccion armada en el repositorio. Eso
 * hace que filtrar de mas sea imposible desde aca, y no una cuestion de
 * cuidado al escribir el template.
 *
 * Se muestra, porque es informacion sobre SU tramite:
 *  - el codigo y lo que la persona misma reporto;
 *  - donde lo reporto;
 *  - en que paso va, con la fecha de cada paso;
 *  - si un inspector ya fue al lugar;
 *  - si se constato algo que hay que corregir, y hasta cuando hay plazo.
 *
 * No se muestra, y no llega siquiera al navegador:
 *  - el nombre del inspector asignado —el vecino no tiene por que saber quien
 *    fue, y saberlo expone a esa persona—;
 *  - las faltas constatadas, su encuadre normativo y su gravedad: son de un
 *    tercero, muchas veces un comercio identificable, y publicarlas a pedido
 *    de cualquiera que tenga un codigo seria difundir una sancion antes de que
 *    exista resolucion firme;
 *  - el numero de acta, el PDF y las fotos de la inspeccion;
 *  - las observaciones internas del inspector;
 *  - el contacto de quien reclamo: el codigo lo puede tener cualquiera que lo
 *    haya visto anotado, asi que esta pantalla no puede devolver datos
 *    personales de nadie, ni siquiera de quien reporto.
 *
 * El limite es simple: se responde sobre el TRAMITE, nunca sobre las PERSONAS.
 */
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import MapaBase from '@/componentes/MapaBase.vue'
import { almacen, normalizarCodigoReclamo } from '@/datos/almacen'
import type { EstadoReclamo, SeguimientoReclamo } from '@/datos/contratos'
import { formatearFecha, formatearFechaHora } from '@/dominio/utilidades'

const ruta = useRoute()

/** Largo del codigo ya normalizado: el prefijo «RC-» mas cuatro caracteres. */
const LARGO_CODIGO = 7

const codigo = ref('')
const buscando = ref(false)
/** Codigo de la ultima busqueda sin resultado. Se muestra tal como quedo normalizado. */
const sinResultado = ref('')
const errorGeneral = ref('')
const seguimiento = ref<SeguimientoReclamo | null>(null)

/** Que quiere decir cada paso, dicho como se lo diria una persona a otra. */
const EXPLICACION: Record<EstadoReclamo, string> = {
  recibido: 'Tu reclamo quedó registrado y está en la lista para revisar.',
  asignado: 'Hay un inspector con la tarea de ir al lugar.',
  inspeccionado: 'Un inspector ya fue al lugar y dejó constancia de lo que encontró.',
  resuelto: 'El tema quedó cerrado.',
}

async function buscar() {
  const escrito = codigo.value.trim()
  if (!escrito || buscando.value) return

  buscando.value = true
  errorGeneral.value = ''
  sinResultado.value = ''
  seguimiento.value = null

  try {
    const encontrado = await almacen.reclamos.seguimiento(escrito)
    if (encontrado) {
      seguimiento.value = encontrado
    } else {
      // Si lo escrito tiene forma de codigo se repite ya normalizado, para que
      // la persona compare contra su papel. Si no la tiene, se le devuelve tal
      // cual lo escribio: mostrarle un «RC-CUALQUIERA» inventado a partir de su
      // texto solo confunde.
      const normalizado = normalizarCodigoReclamo(escrito)
      sinResultado.value = normalizado.length === LARGO_CODIGO ? normalizado : escrito
    }
  } catch {
    errorGeneral.value = 'No se pudo leer el reclamo en este dispositivo. Probá de nuevo.'
  } finally {
    buscando.value = false
  }
}

// Al volver desde la pantalla de alta el codigo viene en la direccion: la
// persona no tiene que copiarlo a mano justo despues de que se lo dimos.
const precargado = ruta.query.codigo
if (typeof precargado === 'string' && precargado) {
  codigo.value = precargado
  buscar()
}
</script>

<template>
  <div class="contenido">
    <form class="buscador" novalidate @submit.prevent="buscar">
      <div class="campo">
        <label for="codigo">Tu código de seguimiento</label>
        <input
          id="codigo"
          v-model="codigo"
          type="text"
          class="entrada-codigo"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          placeholder="RC-4F7K"
        />
        <p class="chico tenue">
          Es el código que te dimos cuando cargaste el reclamo. Podés escribirlo en
          minúsculas o sin el guion.
        </p>
      </div>
      <button type="submit" class="boton boton--ancho" :disabled="buscando || !codigo.trim()">
        {{ buscando ? 'Buscando…' : 'Ver en qué anda' }}
      </button>
    </form>

    <p v-if="errorGeneral" class="nota nota--error">{{ errorGeneral }}</p>

    <div v-if="sinResultado" class="tarjeta vacio-caja">
      <p class="sin-titulo">No encontramos ningún reclamo con «{{ sinResultado }}»</p>
      <p class="chico tenue">
        Revisá el papel: el código tiene cuatro caracteres después de «RC-» y nunca
        lleva la letra O, la letra I ni los números 0 o 1. Si lo cargaste en otro
        teléfono, consultalo desde ese mismo teléfono.
      </p>
    </div>

    <div v-if="seguimiento" class="resultado">
      <div class="tarjeta cabecera">
        <p class="etiqueta">Reclamo</p>
        <p class="codigo-visto">{{ seguimiento.codigo }}</p>
        <p class="reportado">«{{ seguimiento.descripcion }}»</p>
        <p v-if="seguimiento.referencia" class="chico tenue">{{ seguimiento.referencia }}</p>
        <p class="chico tenue">Lo cargaste el {{ formatearFecha(seguimiento.creadoEn) }}.</p>
      </div>

      <div class="mapa-caja">
        <MapaBase
          :centro="seguimiento.ubicacion"
          :zoom="16"
          :punto-elegido="seguimiento.ubicacion"
          :interactivo="false"
        />
      </div>

      <div class="tarjeta">
        <p class="etiqueta">En qué anda</p>
        <ol class="pasos">
          <li
            v-for="paso in seguimiento.pasos"
            :key="paso.estado"
            class="paso"
            :class="{
              'paso--cumplido': paso.cumplido,
              'paso--actual': paso.estado === seguimiento.estado,
            }"
          >
            <span class="paso__marca" aria-hidden="true" />
            <div class="paso__texto">
              <p class="paso__titulo">
                {{ paso.titulo }}
                <span v-if="paso.estado === seguimiento.estado" class="ahora">ahora</span>
              </p>
              <p v-if="paso.ocurridoEn" class="chico tenue">
                {{ formatearFechaHora(paso.ocurridoEn) }}
              </p>
              <p v-if="paso.estado === seguimiento.estado" class="chico explicacion">
                {{ EXPLICACION[paso.estado] }}
              </p>
            </div>
          </li>
        </ol>
      </div>

      <div v-if="seguimiento.resultado === 'sin_hallazgos'" class="tarjeta desenlace">
        <p class="desenlace__titulo">El inspector no encontró nada para corregir</p>
        <p class="chico">
          Fue al lugar y no constató un incumplimiento. Si el problema sigue, cargá
          un reclamo nuevo contando qué pasa ahora: se vuelve a revisar.
        </p>
      </div>

      <div
        v-else-if="seguimiento.resultado === 'requiere_correccion'"
        class="tarjeta desenlace desenlace--accion"
      >
        <p class="desenlace__titulo">Se constató el problema</p>
        <p class="chico">
          Quedó labrada el acta y se notificó al responsable para que lo corrija.
          <template v-if="seguimiento.plazoHasta">
            Tiene plazo hasta el {{ formatearFecha(seguimiento.plazoHasta) }}.
          </template>
        </p>
      </div>

      <div
        v-else-if="!seguimiento.hayInspeccion"
        class="tarjeta desenlace"
      >
        <p class="desenlace__titulo">Todavía no salió la orden de inspección</p>
        <p class="chico">
          Tu reclamo está en la lista. Cuando se le asigne un inspector vas a verlo
          acá con la fecha.
        </p>
      </div>

      <p class="chico tenue aclaracion">
        No mostramos el nombre del inspector ni el detalle de lo constatado sobre
        terceros. Esta consulta responde por tu trámite, no por las personas
        involucradas.
      </p>
    </div>
  </div>
</template>

<style scoped>
.buscador { margin-bottom: 1rem; }

/* El codigo se escribe caracter por caracter mirando un papel: bien grande y
   con las letras separadas para no perder el renglon. */
.entrada-codigo {
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.nota {
  margin: 0.35rem 0 1rem;
  padding: 0.5rem 0.65rem;
  border-radius: var(--radio-chico);
  font-size: 0.8125rem;
  font-weight: 600;
}

.nota--error { background: var(--rojo-suave); color: var(--rojo); }

.vacio-caja { text-align: center; }
.sin-titulo { margin: 0 0 0.5rem; font-weight: 700; }

.resultado { display: flex; flex-direction: column; gap: 1rem; }

.codigo-visto {
  margin: 0.25rem 0 0.5rem;
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  font-variant-numeric: tabular-nums;
}

.cabecera p { margin: 0 0 0.25rem; }
.reportado { font-weight: 600; }

.mapa-caja {
  height: 180px;
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  overflow: hidden;
}

/* ── Linea de tiempo ─────────────────────────────────────────────── */

.pasos {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
}

.paso {
  position: relative;
  display: flex;
  gap: 0.85rem;
  padding-bottom: 1rem;
}

.paso:last-child { padding-bottom: 0; }

/* El hilo que une los pasos. Se corta en el ultimo. */
.paso:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 8px;
  top: 20px;
  bottom: 0;
  width: 2px;
  background: var(--filete);
}

.paso--cumplido:not(:last-child)::before { background: var(--verde); }

.paso__marca {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  border-radius: 50%;
  border: 2px solid var(--borde);
  background: var(--superficie);
}

.paso--cumplido .paso__marca {
  border-color: var(--verde);
  background: var(--verde);
}

.paso--actual .paso__marca {
  outline: 3px solid var(--verde-suave);
  outline-offset: 1px;
}

.paso__texto { min-width: 0; }
.paso__texto p { margin: 0; }

.paso__titulo { font-weight: 600; color: var(--apagado); }
.paso--cumplido .paso__titulo { color: var(--tinta); }

.ahora {
  margin-left: 0.4rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--verde-suave);
  color: var(--verde);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.explicacion { margin-top: 0.25rem; }

/* ── Desenlace ───────────────────────────────────────────────────── */

.desenlace { background: var(--verde-suave); border-color: var(--verde); }
.desenlace--accion { background: var(--ambar-suave); border-color: var(--ambar); }

.desenlace__titulo { margin: 0 0 0.35rem; font-weight: 700; }
.desenlace p:last-child { margin: 0; }

.aclaracion { margin: 0; }
</style>
