<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
/**
 * Tablero de indicadores.
 *
 * Esto lo mira un director en una reunion, muchas veces proyectado. De ahi tres
 * decisiones: los valores se leen sin pasar el mouse por encima, los graficos
 * son SVG dibujado a mano (ninguna libreria que haya que descargar, y el
 * tablero tiene que abrir sin conexion) y cuando no hay datos suficientes se
 * dice con todas las letras en vez de mostrar un grafico vacio que parece un
 * problema tecnico.
 */

import { computed, onMounted, ref } from 'vue'
import { almacen } from '@/datos/almacen'
import type {
  EstadoInspeccion, FormularioVersion, Inspeccion, ObjetoInspeccionable,
  Respuesta, ResultadoInspeccion, Zona,
} from '@/dominio/tipos'
import { formatearFecha } from '@/dominio/utilidades'
import { incumplimientosConstatados } from '@/servicios/acta'

const DIA = 86_400_000
const SEMANAS = 8
const ABIERTAS: EstadoInspeccion[] = ['pendiente', 'asignada', 'en_campo']

const cargando = ref(true)
const problema = ref('')
const periodo = ref(90)

const inspecciones = ref<Inspeccion[]>([])
const objetos = ref<ObjetoInspeccionable[]>([])
const zonas = ref<Zona[]>([])
const respuestas = ref(new Map<string, Respuesta>())
const formularios = ref(new Map<string, FormularioVersion>())

const PERIODOS = [
  { dias: 30, texto: '30 días' },
  { dias: 90, texto: '90 días' },
  { dias: 365, texto: '1 año' },
]

// ── Carga ─────────────────────────────────────────────────────────────

async function cargar() {
  cargando.value = true
  problema.value = ''
  try {
    const [lista, listaObjetos, listaZonas] = await Promise.all([
      almacen.inspecciones.listar(),
      almacen.territorio.objetos(),
      almacen.territorio.zonas(),
    ])

    const versiones = [...new Set(lista.map((i) => i.formularioVersionId))]
    const [versionesCargadas, respuestasCargadas] = await Promise.all([
      Promise.all(versiones.map((id) => almacen.formularios.formularioVersion(id))),
      Promise.all(lista.map((i) => almacen.inspecciones.respuesta(i.uuid))),
    ])

    const mapaFormularios = new Map<string, FormularioVersion>()
    for (const version of versionesCargadas) {
      if (version) mapaFormularios.set(version.id, version)
    }
    const mapaRespuestas = new Map<string, Respuesta>()
    for (const respuesta of respuestasCargadas) {
      if (respuesta) mapaRespuestas.set(respuesta.inspeccionUuid, respuesta)
    }

    inspecciones.value = lista
    objetos.value = listaObjetos
    zonas.value = listaZonas
    formularios.value = mapaFormularios
    respuestas.value = mapaRespuestas
  } catch (error) {
    problema.value = error instanceof Error
      ? error.message
      : 'No se pudieron leer los datos del dispositivo.'
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

// ── Recorte del periodo ───────────────────────────────────────────────

/** Fecha con la que cuenta una inspeccion: cuando se hizo, o cuando se creo. */
function fechaDeReferencia(i: Inspeccion): number {
  return new Date(i.ejecutadaEn ?? i.programadaPara ?? i.creadaEn).getTime()
}

const desde = computed(() => Date.now() - periodo.value * DIA)

const delPeriodo = computed(() =>
  inspecciones.value.filter((i) => fechaDeReferencia(i) >= desde.value),
)

const cerradas = computed(() => delPeriodo.value.filter((i) => i.estado === 'cerrada'))
const abiertas = computed(() => delPeriodo.value.filter((i) => ABIERTAS.includes(i.estado)))
const vencidas = computed(() => delPeriodo.value.filter((i) => i.estado === 'vencida'))

/** Dias entre que la inspeccion se creo y que se ejecuto, promediados. */
const promedioRespuesta = computed(() => {
  const tiempos = cerradas.value
    .filter((i) => i.ejecutadaEn)
    .map((i) => (new Date(i.ejecutadaEn as string).getTime() - new Date(i.creadaEn).getTime()) / DIA)
    .filter((dias) => dias >= 0)
  if (!tiempos.length) return undefined
  return tiempos.reduce((suma, dias) => suma + dias, 0) / tiempos.length
})

const tarjetas = computed(() => [
  { clave: 'total', titulo: 'Inspecciones', valor: String(delPeriodo.value.length), pie: 'en el período' },
  { clave: 'cerradas', titulo: 'Cerradas', valor: String(cerradas.value.length), pie: 'con acta o resultado' },
  { clave: 'abiertas', titulo: 'Pendientes', valor: String(abiertas.value.length), pie: 'sin cerrar' },
  { clave: 'vencidas', titulo: 'Vencidas', valor: String(vencidas.value.length), pie: 'fuera de plazo' },
  {
    clave: 'tiempo',
    titulo: 'Tiempo de respuesta',
    valor: promedioRespuesta.value === undefined ? '—' : promedioRespuesta.value.toFixed(1),
    pie: promedioRespuesta.value === undefined ? 'sin cierres todavía' : 'días en promedio',
  },
])

const rangoTexto = computed(
  () => `${formatearFecha(new Date(desde.value).toISOString())} al ${formatearFecha(new Date().toISOString())}`,
)

// ── Evolucion semanal (grafico de lineas) ─────────────────────────────

/** Lunes de la semana de esa fecha. */
function inicioSemana(fecha: Date): Date {
  const dia = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate())
  const corrimiento = (dia.getDay() + 6) % 7
  dia.setDate(dia.getDate() - corrimiento)
  return dia
}

function diaYMes(fecha: Date): string {
  return fecha.toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit' })
}

const semanas = computed(() => {
  const ultima = inicioSemana(new Date())
  const cubos = Array.from({ length: SEMANAS }, (_, indice) => {
    const inicio = new Date(ultima)
    inicio.setDate(inicio.getDate() - (SEMANAS - 1 - indice) * 7)
    const fin = new Date(inicio)
    fin.setDate(fin.getDate() + 7)
    return { inicio, fin, cantidad: 0 }
  })

  for (const i of inspecciones.value) {
    if (i.estado !== 'cerrada' || !i.ejecutadaEn) continue
    const momento = new Date(i.ejecutadaEn).getTime()
    const cubo = cubos.find((c) => momento >= c.inicio.getTime() && momento < c.fin.getTime())
    if (cubo) cubo.cantidad += 1
  }
  return cubos
})

const hayEvolucion = computed(() => semanas.value.some((s) => s.cantidad > 0))

/** Geometria del grafico de lineas, en unidades del viewBox. */
const LINEAS = { ancho: 680, alto: 250, izq: 42, der: 18, arriba: 30, abajo: 40 }

const topeSemanal = computed(() => {
  const maximo = Math.max(...semanas.value.map((s) => s.cantidad), 0)
  return Math.max(4, Math.ceil(maximo / 4) * 4)
})

function alturaLinea(valor: number): number {
  const util = LINEAS.alto - LINEAS.arriba - LINEAS.abajo
  return LINEAS.arriba + util - (valor / topeSemanal.value) * util
}

const puntosSemana = computed(() => {
  const util = LINEAS.ancho - LINEAS.izq - LINEAS.der
  const paso = util / (SEMANAS - 1)
  return semanas.value.map((s, indice) => ({
    clave: s.inicio.toISOString(),
    x: LINEAS.izq + indice * paso,
    y: alturaLinea(s.cantidad),
    cantidad: s.cantidad,
    etiqueta: diaYMes(s.inicio),
  }))
})

const trazoSemanas = computed(() =>
  puntosSemana.value
    .map((p, indice) => `${indice === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' '),
)

const grillaSemanas = computed(() =>
  [0, 1, 2, 3, 4].map((paso) => {
    const valor = (topeSemanal.value / 4) * paso
    return { valor, y: alturaLinea(valor) }
  }),
)

// ── Distribucion por resultado (grafico de barras) ────────────────────

const BARRAS = { ancho: 680, alto: 240, izq: 42, der: 18, arriba: 34, abajo: 52 }

const ETIQUETAS_RESULTADO: Record<ResultadoInspeccion, string> = {
  conforme: 'Conforme',
  con_observaciones: 'Con observaciones',
  no_conforme: 'No conforme',
}

const conResultado = computed(() => cerradas.value.filter((i) => i.resultado))

const topeResultado = computed(() => {
  const maximo = Math.max(
    ...(Object.keys(ETIQUETAS_RESULTADO) as ResultadoInspeccion[]).map(
      (clave) => conResultado.value.filter((i) => i.resultado === clave).length,
    ),
    0,
  )
  return Math.max(4, Math.ceil(maximo / 4) * 4)
})

const barrasResultado = computed(() => {
  const claves = Object.keys(ETIQUETAS_RESULTADO) as ResultadoInspeccion[]
  const util = BARRAS.ancho - BARRAS.izq - BARRAS.der
  const utilAlto = BARRAS.alto - BARRAS.arriba - BARRAS.abajo
  const ranura = util / claves.length
  const ancho = Math.min(120, ranura * 0.52)
  const total = conResultado.value.length

  return claves.map((clave, indice) => {
    const cantidad = conResultado.value.filter((i) => i.resultado === clave).length
    const alto = Math.max((cantidad / topeResultado.value) * utilAlto, 0)
    return {
      clave,
      nombre: ETIQUETAS_RESULTADO[clave],
      cantidad,
      porcentaje: total ? Math.round((cantidad * 100) / total) : 0,
      x: BARRAS.izq + ranura * indice + (ranura - ancho) / 2,
      y: BARRAS.arriba + utilAlto - alto,
      ancho,
      alto,
      centro: BARRAS.izq + ranura * indice + ranura / 2,
    }
  })
})

const grillaResultado = computed(() => {
  const utilAlto = BARRAS.alto - BARRAS.arriba - BARRAS.abajo
  return [0, 1, 2, 3, 4].map((paso) => {
    const valor = (topeResultado.value / 4) * paso
    return { valor, y: BARRAS.arriba + utilAlto - (valor / topeResultado.value) * utilAlto }
  })
})

const baseBarras = computed(() => BARRAS.alto - BARRAS.abajo)

// ── Cobertura por zona ────────────────────────────────────────────────

const cobertura = computed(() => {
  const inspeccionados = new Set(cerradas.value.map((i) => i.objetoId))
  const idsZona = new Set(zonas.value.map((z) => z.id))

  const filas = zonas.value.map((zona) => {
    const propios = objetos.value.filter((o) => o.zonaId === zona.id)
    const cubiertos = propios.filter((o) => inspeccionados.has(o.id)).length
    return {
      clave: zona.id,
      nombre: zona.nombre,
      objetos: propios.length,
      inspeccionados: cubiertos,
      porcentaje: propios.length ? Math.round((cubiertos * 100) / propios.length) : 0,
    }
  })

  const sinZona = objetos.value.filter((o) => !o.zonaId || !idsZona.has(o.zonaId))
  if (sinZona.length) {
    const cubiertos = sinZona.filter((o) => inspeccionados.has(o.id)).length
    filas.push({
      clave: 'sin-zona',
      nombre: 'Sin zona asignada',
      objetos: sinZona.length,
      inspeccionados: cubiertos,
      porcentaje: Math.round((cubiertos * 100) / sinZona.length),
    })
  }

  return filas.sort((a, b) => b.objetos - a.objetos)
})

// ── Incumplimientos mas frecuentes ────────────────────────────────────

const incumplimientosFrecuentes = computed(() => {
  const cuenta = new Map<string, { descripcion: string; cantidad: number }>()

  for (const i of delPeriodo.value) {
    const formulario = formularios.value.get(i.formularioVersionId)
    const respuesta = respuestas.value.get(i.uuid)
    if (!formulario || !respuesta) continue
    for (const incumplimiento of incumplimientosConstatados(formulario, respuesta)) {
      const previo = cuenta.get(incumplimiento.id)
      if (previo) previo.cantidad += 1
      else cuenta.set(incumplimiento.id, { descripcion: incumplimiento.descripcion, cantidad: 1 })
    }
  }

  const ordenados = [...cuenta.entries()]
    .map(([clave, dato]) => ({ clave, ...dato }))
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 5)

  const maximo = ordenados.length ? ordenados[0].cantidad : 0
  return ordenados.map((fila) => ({
    ...fila,
    porcentaje: maximo ? Math.round((fila.cantidad * 100) / maximo) : 0,
  }))
})

const hayDatos = computed(() => inspecciones.value.length > 0)
</script>

<template>
  <div class="tablero">
    <header class="encabezado">
      <div class="crece">
        <h2>Indicadores</h2>
        <p class="chico tenue num">{{ rangoTexto }}</p>
      </div>
      <div class="periodos" role="group" aria-label="Período">
        <button
          v-for="opcion in PERIODOS"
          :key="opcion.dias"
          type="button"
          class="periodo"
          :class="{ 'periodo--activo': periodo === opcion.dias }"
          :aria-pressed="periodo === opcion.dias"
          @click="periodo = opcion.dias"
        >
          {{ opcion.texto }}
        </button>
      </div>
    </header>

    <p v-if="cargando" class="vacio">Calculando indicadores…</p>

    <div v-else-if="problema" class="tarjeta">
      <h3>No se pudo armar el tablero</h3>
      <p class="chico tenue">{{ problema }}</p>
      <button class="boton boton--secundario" type="button" @click="cargar">Reintentar</button>
    </div>

    <p v-else-if="!hayDatos" class="vacio">
      Todavía no hay inspecciones registradas en el dispositivo. El tablero se llena
      solo a medida que se cierran inspecciones.
    </p>

    <template v-else>
      <section class="resumen">
        <article v-for="t in tarjetas" :key="t.clave" class="tarjeta indicador" :class="'indicador--' + t.clave">
          <p class="etiqueta">{{ t.titulo }}</p>
          <p class="indicador-valor num">{{ t.valor }}</p>
          <p class="chico tenue">{{ t.pie }}</p>
        </article>
      </section>

      <section class="tarjeta">
        <h3>Inspecciones cerradas por semana</h3>
        <p class="chico tenue">Últimas {{ SEMANAS }} semanas, sin importar el período elegido.</p>

        <p v-if="!hayEvolucion" class="sin-datos">
          No hay inspecciones cerradas en las últimas {{ SEMANAS }} semanas: no hay
          evolución que mostrar todavía.
        </p>

        <svg
          v-else
          class="grafico"
          :viewBox="`0 0 ${LINEAS.ancho} ${LINEAS.alto}`"
          role="img"
          aria-label="Evolución de inspecciones cerradas por semana"
        >
          <g class="grilla">
            <line
              v-for="linea in grillaSemanas"
              :key="'g' + linea.valor"
              :x1="LINEAS.izq"
              :x2="LINEAS.ancho - LINEAS.der"
              :y1="linea.y"
              :y2="linea.y"
            />
          </g>
          <g class="eje-texto num">
            <text
              v-for="linea in grillaSemanas"
              :key="'e' + linea.valor"
              :x="LINEAS.izq - 8"
              :y="linea.y + 4"
              text-anchor="end"
            >{{ linea.valor }}</text>
          </g>

          <path :d="trazoSemanas" class="trazo" />

          <g>
            <circle v-for="p in puntosSemana" :key="'p' + p.clave" :cx="p.x" :cy="p.y" r="4.5" class="punto" />
            <text
              v-for="p in puntosSemana"
              :key="'v' + p.clave"
              :x="p.x"
              :y="p.y - 12"
              text-anchor="middle"
              class="valor num"
            >{{ p.cantidad }}</text>
            <text
              v-for="p in puntosSemana"
              :key="'x' + p.clave"
              :x="p.x"
              :y="LINEAS.alto - 14"
              text-anchor="middle"
              class="eje-texto num"
            >{{ p.etiqueta }}</text>
          </g>

          <line
            class="eje"
            :x1="LINEAS.izq"
            :x2="LINEAS.ancho - LINEAS.der"
            :y1="LINEAS.alto - LINEAS.abajo"
            :y2="LINEAS.alto - LINEAS.abajo"
          />
        </svg>
      </section>

      <section class="tarjeta">
        <h3>Distribución por resultado</h3>
        <p class="chico tenue">
          Sobre {{ conResultado.length }} inspecciones cerradas con resultado en el período.
        </p>

        <p v-if="!conResultado.length" class="sin-datos">
          Ninguna inspección cerrada del período tiene resultado cargado.
        </p>

        <svg
          v-else
          class="grafico"
          :viewBox="`0 0 ${BARRAS.ancho} ${BARRAS.alto}`"
          role="img"
          aria-label="Distribución de inspecciones por resultado"
        >
          <g class="grilla">
            <line
              v-for="linea in grillaResultado"
              :key="'gb' + linea.valor"
              :x1="BARRAS.izq"
              :x2="BARRAS.ancho - BARRAS.der"
              :y1="linea.y"
              :y2="linea.y"
            />
          </g>
          <g class="eje-texto num">
            <text
              v-for="linea in grillaResultado"
              :key="'eb' + linea.valor"
              :x="BARRAS.izq - 8"
              :y="linea.y + 4"
              text-anchor="end"
            >{{ linea.valor }}</text>
          </g>

          <g v-for="barra in barrasResultado" :key="barra.clave">
            <rect
              :x="barra.x"
              :y="barra.y"
              :width="barra.ancho"
              :height="barra.alto"
              class="barra"
              :class="'barra--' + barra.clave"
            />
            <text :x="barra.centro" :y="barra.y - 10" text-anchor="middle" class="valor num">
              {{ barra.cantidad }}
            </text>
            <text :x="barra.centro" :y="baseBarras + 20" text-anchor="middle" class="eje-texto">
              {{ barra.nombre }}
            </text>
            <text :x="barra.centro" :y="baseBarras + 36" text-anchor="middle" class="eje-texto num">
              {{ barra.porcentaje }}%
            </text>
          </g>

          <line
            class="eje"
            :x1="BARRAS.izq"
            :x2="BARRAS.ancho - BARRAS.der"
            :y1="baseBarras"
            :y2="baseBarras"
          />
        </svg>
      </section>

      <section class="tarjeta">
        <h3>Cobertura por zona</h3>
        <p class="chico tenue">Objetos del padrón y cuántos se inspeccionaron en el período.</p>

        <p v-if="!cobertura.length" class="sin-datos">
          No hay objetos cargados en el territorio.
        </p>

        <ul v-else class="lista">
          <li v-for="fila in cobertura" :key="fila.clave" class="fila-zona">
            <div class="fila-cabeza">
              <span class="crece">{{ fila.nombre }}</span>
              <span class="num tenue chico">
                {{ fila.inspeccionados }} de {{ fila.objetos }}
              </span>
              <span class="num porcentaje">{{ fila.porcentaje }}%</span>
            </div>
            <div class="riel">
              <div class="relleno" :style="{ width: fila.porcentaje + '%' }"></div>
            </div>
          </li>
        </ul>
      </section>

      <section class="tarjeta">
        <h3>Incumplimientos más frecuentes</h3>
        <p class="chico tenue">Los cinco que más se repiten en el período.</p>

        <p v-if="!incumplimientosFrecuentes.length" class="sin-datos">
          No se constataron incumplimientos en el período.
        </p>

        <ul v-else class="lista">
          <li v-for="fila in incumplimientosFrecuentes" :key="fila.clave" class="fila-zona">
            <div class="fila-cabeza">
              <span class="crece">{{ fila.descripcion }}</span>
              <span class="num porcentaje">{{ fila.cantidad }}</span>
            </div>
            <div class="riel">
              <div class="relleno relleno--falta" :style="{ width: fila.porcentaje + '%' }"></div>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.tablero {
  padding: 1rem;
  padding-bottom: calc(var(--alto-pie) + var(--seguro-abajo) + 1rem);
  max-width: 960px;
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.num { font-variant-numeric: tabular-nums; }

.encabezado {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.periodos {
  display: flex;
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  overflow: hidden;
  background: var(--superficie);
}

.periodo {
  min-height: 44px;
  padding: 0 0.9rem;
  border: 0;
  background: transparent;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--apagado);
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}

.periodo--activo { background: var(--tinta); color: var(--papel); }

.resumen {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.75rem;
}

.indicador { border-left: 4px solid var(--borde); }
.indicador--cerradas { border-left-color: var(--verde); }
.indicador--abiertas { border-left-color: var(--ambar); }
.indicador--vencidas { border-left-color: var(--rojo); }
.indicador--tiempo { border-left-color: var(--estado-asignada); }

.indicador-valor {
  margin: 0.2rem 0 0.1rem;
  font-size: 2.5rem;
  line-height: 1.05;
  font-weight: 700;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}

.indicador p:last-child { margin: 0; }

section h3 { margin-bottom: 0.15rem; }
section > p.chico { margin: 0 0 0.5rem; }

.grafico {
  width: 100%;
  height: auto;
  display: block;
  margin-top: 0.5rem;
  overflow: visible;
}

.grilla line { stroke: var(--filete); stroke-width: 1; }
.eje { stroke: var(--borde); stroke-width: 1.5; }

.eje-texto {
  font-size: 12px;
  fill: var(--apagado);
  font-variant-numeric: tabular-nums;
}

.valor {
  font-size: 14px;
  font-weight: 700;
  fill: var(--tinta);
  font-variant-numeric: tabular-nums;
}

.trazo {
  fill: none;
  stroke: var(--verde);
  stroke-width: 2.5;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.punto { fill: var(--verde); }

.barra--conforme { fill: var(--verde); }
.barra--con_observaciones { fill: var(--ambar); }
.barra--no_conforme { fill: var(--rojo); }

.sin-datos {
  margin: 0.5rem 0 0;
  padding: 1.25rem 1rem;
  border: 1px dashed var(--borde);
  border-radius: var(--radio-chico);
  text-align: center;
  color: var(--apagado);
  font-size: 0.875rem;
}

.lista { list-style: none; margin: 0.5rem 0 0; padding: 0; }

.fila-zona { padding: 0.55rem 0; border-top: 1px solid var(--filete); }
.fila-zona:first-child { border-top: 0; }

.fila-cabeza {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  margin-bottom: 0.35rem;
  font-size: 0.9375rem;
}

.porcentaje { font-weight: 700; min-width: 3rem; text-align: right; }

.riel {
  height: 8px;
  border-radius: 999px;
  background: var(--superficie-2);
  overflow: hidden;
}

.relleno { height: 100%; background: var(--verde); }
.relleno--falta { background: var(--rojo); }
</style>
