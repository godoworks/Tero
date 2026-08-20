<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
/**
 * Ficha de un objeto inspeccionable: que es, donde esta, que le pasó.
 *
 * La pantalla se lee de arriba abajo —identificacion, mapa, historial— pero la
 * accion que trae al inspector hasta aca (iniciar la inspeccion) esta fija
 * abajo y no se pierde nunca de vista.
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import MapaBase, { type MarcadorMapa } from '@/componentes/MapaBase.vue'
import { almacen } from '@/datos/almacen'
import { ahora, formatearFecha, formatearFechaHora, nuevoUuid, ubicacionActual } from '@/dominio/utilidades'
import type {
  ClaveTipoObjeto, EstadoInspeccion, EventoAuditoria, Inspeccion,
  ObjetoInspeccionable, ResultadoInspeccion, TipoInspeccion, TipoObjeto, Zona,
} from '@/dominio/tipos'

const props = defineProps<{ id: string }>()

/** Mientras no haya sesion, todo lo que se audita queda a nombre del rol. */
const ACTOR = 'inspector'

const COLOR_TIPO: Record<ClaveTipoObjeto, string> = {
  luminaria: 'var(--ambar)',
  contenedor: 'var(--verde)',
  obra: 'var(--rojo)',
  comercio: 'var(--estado-asignada)',
  senalizacion: 'var(--tinta)',
  parador: 'var(--apagado)',
}

const NOMBRE_ESTADO: Record<EstadoInspeccion, string> = {
  pendiente: 'Pendiente',
  asignada: 'Asignada',
  en_campo: 'En campo',
  cerrada: 'Cerrada',
  vencida: 'Vencida',
}

const NOMBRE_RESULTADO: Record<ResultadoInspeccion, string> = {
  conforme: 'Conforme',
  con_observaciones: 'Con observaciones',
  no_conforme: 'No conforme',
}

const NOMBRE_ESTADO_OBJETO: Record<ObjetoInspeccionable['estado'], string> = {
  activo: 'Activo',
  inactivo: 'Inactivo',
  baja: 'Dado de baja',
}

/**
 * Nombres legibles de las acciones que se auditan. Lo que no este listado se
 * muestra igual, sin guiones bajos: mas vale un nombre feo que un hueco.
 */
const NOMBRE_ACCION: Record<string, string> = {
  alta: 'Alta del objeto',
  inspeccion_iniciada: 'Inspección iniciada',
  inspeccion_cerrada: 'Inspección cerrada',
  acta_emitida: 'Acta emitida',
}

function nombreAccion(accion: string): string {
  const conocida = NOMBRE_ACCION[accion]
  if (conocida) return conocida
  const legible = accion.replace(/_/g, ' ')
  return legible.charAt(0).toUpperCase() + legible.slice(1)
}

const NOMBRE_ORIGEN: Record<Inspeccion['origen'], string> = {
  plan: 'Plan anual',
  reclamo: 'Reclamo',
  oficio: 'De oficio',
}

const enrutador = useRouter()

const objeto = ref<ObjetoInspeccionable | null>(null)
const tipo = ref<TipoObjeto | null>(null)
const zona = ref<Zona | null>(null)
const inspecciones = ref<Inspeccion[]>([])
const eventos = ref<EventoAuditoria[]>([])
const tiposInspeccion = ref<TipoInspeccion[]>([])
const tipoInspeccionElegido = ref<string>('')

const cargando = ref(true)
const noExiste = ref(false)
const errorGeneral = ref('')
const iniciando = ref(false)

const color = computed(() => (tipo.value ? COLOR_TIPO[tipo.value.clave] : 'var(--apagado)'))

const marcadores = computed<MarcadorMapa[]>(() =>
  objeto.value
    ? [{
        id: objeto.value.id,
        punto: objeto.value.ubicacion,
        color: color.value,
        etiqueta: objeto.value.denominacion,
      }]
    : [],
)

const atributos = computed<Array<[string, string]>>(() => {
  const datos = objeto.value?.atributos ?? {}
  return Object.entries(datos).map(([clave, valor]) => [clave, String(valor)])
})

function fechaDeInspeccion(inspeccion: Inspeccion): string {
  return formatearFecha(inspeccion.ejecutadaEn ?? inspeccion.programadaPara ?? inspeccion.creadaEn)
}

async function cargar(id: string) {
  cargando.value = true
  noExiste.value = false
  errorGeneral.value = ''
  try {
    const encontrado = await almacen.territorio.objeto(id)
    if (!encontrado) {
      noExiste.value = true
      return
    }
    objeto.value = encontrado

    const [tipos, zonas, listaInspecciones, historial, tiposIns] = await Promise.all([
      almacen.territorio.tiposObjeto(),
      almacen.territorio.zonas(),
      almacen.inspecciones.listar({ objetoId: id }),
      almacen.auditoria.historial('objeto', id),
      almacen.formularios.tiposInspeccion(),
    ])

    tipo.value = tipos.find((t) => t.id === encontrado.tipoObjetoId) ?? null
    zona.value = zonas.find((z) => z.id === encontrado.zonaId) ?? null

    inspecciones.value = [...listaInspecciones].sort((a, b) =>
      b.creadaEn.localeCompare(a.creadaEn),
    )
    eventos.value = [...historial].sort((a, b) => b.ocurridoEn.localeCompare(a.ocurridoEn))

    tiposInspeccion.value = tiposIns.filter((t) =>
      t.tipoObjetoIds.includes(encontrado.tipoObjetoId),
    )
    tipoInspeccionElegido.value = tiposInspeccion.value[0]?.id ?? ''
  } catch {
    errorGeneral.value = 'No se pudo leer la ficha desde el dispositivo. Recargá la pantalla.'
  } finally {
    cargando.value = false
  }
}

async function iniciarInspeccion() {
  const actual = objeto.value
  const tipoIns = tiposInspeccion.value.find((t) => t.id === tipoInspeccionElegido.value)
  if (!actual || !tipoIns || iniciando.value) return

  iniciando.value = true
  errorGeneral.value = ''

  const momento = ahora()
  const inspeccion: Inspeccion = {
    uuid: nuevoUuid(),
    organismoId: actual.organismoId,
    objetoId: actual.id,
    tipoInspeccionId: tipoIns.id,
    // Se congela contra que version del formulario se va a trabajar: un acta
    // vieja tiene que poder reconstruirse tal cual se emitio.
    formularioVersionId: tipoIns.formularioVersionId,
    origen: 'oficio',
    estado: 'asignada',
    prioridad: 'media',
    asignadoA: ACTOR,
    creadaEn: momento,
    actualizadaEn: momento,
  }

  try {
    await almacen.inspecciones.guardar(inspeccion)
    // El GPS no puede demorar el inicio: si no contesta, la inspeccion arranca igual.
    const donde = await ubicacionActual()
    await almacen.auditoria.registrar({
      organismoId: actual.organismoId,
      entidad: 'inspeccion',
      entidadId: inspeccion.uuid,
      accion: 'inspeccion_iniciada',
      detalle: `${tipoIns.nombre} sobre ${actual.codigo}`,
      actor: ACTOR,
      ubicacion: donde,
    })
    enrutador.push(`/inspeccion/${inspeccion.uuid}`)
  } catch {
    errorGeneral.value = 'No se pudo crear la inspección en el dispositivo. Volvé a intentar.'
    iniciando.value = false
  }
}

watch(() => props.id, cargar, { immediate: true })
</script>

<template>
  <div class="vista">
    <div v-if="noExiste" class="contenido">
      <div class="vacio">
        <p>Ese objeto no está guardado en este dispositivo.</p>
        <RouterLink class="boton" to="/mapa">Volver al mapa</RouterLink>
      </div>
    </div>

    <template v-else-if="objeto">
      <div class="contenido">
        <section class="tarjeta">
          <div class="fila">
            <span class="punto-tipo" :style="{ background: color }" aria-hidden="true" />
            <span class="etiqueta crece">{{ tipo?.nombre ?? 'Sin tipo' }}</span>
            <span class="distintivo">{{ NOMBRE_ESTADO_OBJETO[objeto.estado] }}</span>
          </div>

          <h2 class="nombre">{{ objeto.denominacion }}</h2>
          <p class="codigo">{{ objeto.codigo }}</p>

          <dl class="datos">
            <div>
              <dt class="etiqueta">Dirección</dt>
              <dd>{{ objeto.direccion }}</dd>
            </div>
            <div>
              <dt class="etiqueta">Zona</dt>
              <dd>{{ zona?.nombre ?? 'Sin zona asignada' }}</dd>
            </div>
            <div>
              <dt class="etiqueta">Coordenadas</dt>
              <dd class="mono">
                {{ objeto.ubicacion.lat.toFixed(5) }}, {{ objeto.ubicacion.lon.toFixed(5) }}
              </dd>
            </div>
            <div>
              <dt class="etiqueta">Dado de alta</dt>
              <dd>{{ formatearFecha(objeto.creadoEn) }}</dd>
            </div>
            <div v-for="[clave, valor] in atributos" :key="clave">
              <dt class="etiqueta">{{ clave }}</dt>
              <dd>{{ valor }}</dd>
            </div>
          </dl>
        </section>

        <div class="mapa-chico">
          <MapaBase
            :centro="objeto.ubicacion"
            :zoom="17"
            :marcadores="marcadores"
            :interactivo="false"
          />
        </div>

        <section class="bloque">
          <h3>Inspecciones</h3>
          <p v-if="inspecciones.length === 0" class="chico tenue">
            Este objeto todavía no tiene inspecciones registradas.
          </p>
          <ul v-else class="lista">
            <li v-for="inspeccion in inspecciones" :key="inspeccion.uuid">
              <RouterLink class="tarjeta enlace" :to="`/inspeccion/${inspeccion.uuid}`">
                <div class="fila">
                  <span class="distintivo" :class="`distintivo--${inspeccion.estado}`">
                    {{ NOMBRE_ESTADO[inspeccion.estado] }}
                  </span>
                  <span class="crece chico tenue">{{ NOMBRE_ORIGEN[inspeccion.origen] }}</span>
                  <span class="chico tenue">{{ fechaDeInspeccion(inspeccion) }}</span>
                </div>
                <p v-if="inspeccion.resultado" class="resultado">
                  {{ NOMBRE_RESULTADO[inspeccion.resultado] }}
                </p>
              </RouterLink>
            </li>
          </ul>
        </section>

        <section class="bloque">
          <h3>Auditoría</h3>
          <p v-if="eventos.length === 0" class="chico tenue">
            Sin movimientos registrados sobre este objeto.
          </p>
          <ul v-else class="lista lista--auditoria">
            <li v-for="evento in eventos" :key="evento.id" class="tarjeta">
              <p class="accion">{{ nombreAccion(evento.accion) }}</p>
              <p v-if="evento.detalle" class="chico">{{ evento.detalle }}</p>
              <p class="chico tenue">
                {{ evento.actor }} · {{ formatearFechaHora(evento.ocurridoEn) }}
              </p>
            </li>
          </ul>
        </section>

        <p v-if="errorGeneral" class="nota nota--error">{{ errorGeneral }}</p>
      </div>

      <div class="acciones">
        <div v-if="tiposInspeccion.length > 1" class="campo campo--compacto">
          <label for="tipo-inspeccion">Tipo de inspección</label>
          <select id="tipo-inspeccion" v-model="tipoInspeccionElegido">
            <option v-for="t in tiposInspeccion" :key="t.id" :value="t.id">
              {{ t.nombre }}
            </option>
          </select>
        </div>

        <button
          type="button"
          class="boton boton--ancho"
          :disabled="iniciando || tiposInspeccion.length === 0"
          @click="iniciarInspeccion"
        >
          {{ iniciando ? 'Creando…' : 'Iniciar inspección' }}
        </button>

        <p v-if="tiposInspeccion.length === 0 && !cargando" class="chico tenue sin-tipo">
          No hay tipos de inspección configurados para {{ tipo?.nombre ?? 'este tipo de objeto' }}.
        </p>
      </div>
    </template>

    <div v-else class="contenido">
      <p class="vacio">Leyendo la ficha…</p>
    </div>
  </div>
</template>

<style scoped>
.vista { min-height: 100%; }

.contenido {
  padding: 1rem;
  padding-bottom: calc(var(--alto-pie) + var(--seguro-abajo) + 7rem);
  max-width: 720px;
  margin-inline: auto;
}

.punto-tipo {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex: none;
}

.nombre { margin: 0.5rem 0 0.15rem; }

.codigo {
  margin: 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--apagado);
}

.datos {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.75rem;
  margin: 1rem 0 0;
}

.datos dt { margin-bottom: 0.1rem; }
.datos dd { margin: 0; font-weight: 600; }
.mono { font-variant-numeric: tabular-nums; }

.mapa-chico {
  height: 190px;
  margin-top: 1rem;
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  overflow: hidden;
}

.bloque { margin-top: 1.5rem; }
.bloque h3 { margin-bottom: 0.6rem; }

.lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.enlace {
  display: block;
  text-decoration: none;
  color: inherit;
}

.resultado { margin: 0.5rem 0 0; font-weight: 700; }

.lista--auditoria .accion {
  margin: 0 0 0.15rem;
  font-weight: 700;
}

.lista--auditoria p { margin: 0; }

.nota {
  margin-top: 1rem;
  padding: 0.5rem 0.65rem;
  border-radius: var(--radio-chico);
  font-size: 0.8125rem;
  font-weight: 600;
}

.nota--error { background: var(--rojo-suave); color: var(--rojo); }

/* Iniciar la inspeccion es lo que trae al inspector a esta pantalla: no puede
   depender de que haya scrolleado hasta el final. */
.acciones {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(var(--alto-pie) + var(--seguro-abajo));
  z-index: 15;
  padding: 0.6rem 1rem;
  background: var(--superficie);
  border-top: 1px solid var(--borde);
}

.campo--compacto { margin-bottom: 0.5rem; }
.sin-tipo { margin: 0.4rem 0 0; text-align: center; }
</style>
