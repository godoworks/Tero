<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Checklist from '@/componentes/Checklist.vue'
import CapturaFotos from '@/componentes/CapturaFotos.vue'
import PanelFirma from '@/componentes/PanelFirma.vue'
import { almacen } from '@/datos/almacen'
import type {
  Firma,
  FormularioVersion,
  Incumplimiento,
  Inspeccion,
  ObjetoInspeccionable,
  Pregunta,
  ResultadoInspeccion,
  TipoInspeccion,
} from '@/dominio/tipos'
import { ahora, formatearFechaHora, ubicacionActual } from '@/dominio/utilidades'

/**
 * Ejecucion de la inspeccion en la calle.
 *
 * La premisa de toda esta vista: el trabajo del inspector no se pierde nunca.
 * Se puede cortar la señal, apagarse la pantalla o entrar una llamada; cuando
 * vuelve, tiene que encontrar todo como lo dejo. Por eso cada respuesta se
 * guarda sola, con un respiro corto, y ademas se fuerza el guardado cuando la
 * pantalla se va a segundo plano.
 */

type Valor = string | number | boolean | null

const props = defineProps<{ uuid: string }>()

const enrutador = useRouter()

const PASOS = [
  { clave: 'checklist', titulo: 'Checklist' },
  { clave: 'fotos', titulo: 'Fotos' },
  { clave: 'firma', titulo: 'Firma' },
  { clave: 'cierre', titulo: 'Cerrar' },
] as const

type Paso = (typeof PASOS)[number]['clave']

const inspeccion = ref<Inspeccion | undefined>(undefined)
const objeto = ref<ObjetoInspeccionable | undefined>(undefined)
const tipoInspeccion = ref<TipoInspeccion | undefined>(undefined)
const formulario = ref<FormularioVersion | undefined>(undefined)
const firma = ref<Firma | undefined>(undefined)

const datos = ref<Record<string, Valor>>({})
const observaciones = ref('')
const fotosPorPregunta = ref<Record<string, number>>({})
const totalFotos = ref(0)

const paso = ref<Paso>('checklist')
const faltante = ref<string | null>(null)
const cargando = ref(true)
const error = ref('')
const guardando = ref(false)
const guardadoEn = ref<string | null>(null)
const errorGuardado = ref('')
const mensajeCierre = ref('')
const cerrando = ref(false)

const soloLectura = computed(() => inspeccion.value?.estado === 'cerrada')

const actor = computed(() => inspeccion.value?.asignadoA ?? 'inspector')

// ── Carga ───────────────────────────────────────────────────────────

async function cargar() {
  cargando.value = true
  error.value = ''
  try {
    const i = await almacen.inspecciones.obtener(props.uuid)
    if (!i) {
      error.value = 'No encontramos esta inspección en el teléfono.'
      return
    }
    inspeccion.value = i

    const [obj, tipo, form, respuesta] = await Promise.all([
      almacen.territorio.objeto(i.objetoId),
      almacen.formularios.tipoInspeccion(i.tipoInspeccionId),
      almacen.formularios.formularioVersion(i.formularioVersionId),
      almacen.inspecciones.respuesta(i.uuid),
    ])
    objeto.value = obj
    tipoInspeccion.value = tipo
    formulario.value = form
    datos.value = { ...(respuesta?.datos ?? {}) }
    observaciones.value = respuesta?.observaciones ?? ''

    await Promise.all([recargarEvidencias(), recargarFirma()])
    if (i.estado === 'cerrada') paso.value = 'cierre'
  } catch {
    error.value = 'No se pudo abrir la inspección.'
  } finally {
    cargando.value = false
  }
}

async function recargarEvidencias() {
  const lista = await almacen.inspecciones.evidencias(props.uuid)
  const fotos = lista.filter((e) => e.tipo === 'foto')
  totalFotos.value = fotos.length
  const cuenta: Record<string, number> = {}
  for (const e of fotos) {
    if (e.preguntaId) cuenta[e.preguntaId] = (cuenta[e.preguntaId] ?? 0) + 1
  }
  fotosPorPregunta.value = cuenta
}

async function recargarFirma() {
  firma.value = await almacen.inspecciones.firma(props.uuid)
}

// ── Faltas constatadas, en vivo ─────────────────────────────────────

const preguntas = computed<Pregunta[]>(
  () => formulario.value?.secciones.flatMap((s) => s.preguntas) ?? [],
)

function respondida(p: Pregunta): boolean {
  if (p.tipo === 'foto') return (fotosPorPregunta.value[p.id] ?? 0) > 0
  const v = datos.value[p.id]
  return v !== null && v !== undefined && v !== ''
}

const obligatoriasPendientes = computed(() =>
  preguntas.value.filter((p) => p.obligatoria && !respondida(p)),
)

const incumplimientos = computed<Incumplimiento[]>(() => {
  const form = formulario.value
  if (!form) return []
  const porId = new Map(form.incumplimientos.map((i) => [i.id, i]))
  const salida: Incumplimiento[] = []
  for (const p of preguntas.value) {
    if (!p.respuestaQueIncumple || !p.incumplimientoId) continue
    const v = datos.value[p.id]
    if (v === null || v === undefined || v === '') continue
    if (String(v) !== p.respuestaQueIncumple) continue
    const falta = porId.get(p.incumplimientoId)
    if (falta && !salida.some((f) => f.id === falta.id)) salida.push(falta)
  }
  return salida
})

const resultado = computed<ResultadoInspeccion>(() => {
  if (incumplimientos.value.length === 0) return 'conforme'
  const grave = incumplimientos.value.some(
    (i) => i.gravedad === 'grave' || i.gravedad === 'muy_grave',
  )
  return grave ? 'no_conforme' : 'con_observaciones'
})

const TEXTO_RESULTADO: Record<ResultadoInspeccion, string> = {
  conforme: 'Sin faltas',
  con_observaciones: 'Con observaciones',
  no_conforme: 'Con faltas graves',
}

const TEXTO_GRAVEDAD: Record<Incumplimiento['gravedad'], string> = {
  leve: 'Leve',
  grave: 'Grave',
  muy_grave: 'Muy grave',
}

// ── Guardado automatico ─────────────────────────────────────────────

let temporizador: number | undefined
let ultimoEncolado = 0

function programarGuardado() {
  if (soloLectura.value) return
  if (temporizador) window.clearTimeout(temporizador)
  temporizador = window.setTimeout(() => void guardar(), 600)
}

async function guardar(forzarCola = false) {
  const i = inspeccion.value
  if (!i || soloLectura.value) return
  if (temporizador) {
    window.clearTimeout(temporizador)
    temporizador = undefined
  }
  guardando.value = true
  errorGuardado.value = ''
  try {
    await almacen.inspecciones.guardarRespuesta({
      inspeccionUuid: i.uuid,
      formularioVersionId: i.formularioVersionId,
      datos: { ...datos.value },
      observaciones: observaciones.value.trim() === '' ? undefined : observaciones.value,
      incumplimientoIds: incumplimientos.value.map((f) => f.id),
    })
    // La cola es de solo agregado: no hace falta anotar cada tecla, alcanza con
    // que el cambio quede encolado cada tanto y siempre al cerrar.
    if (forzarCola || Date.now() - ultimoEncolado > 15000) {
      await almacen.cola.encolar({ tipo: 'respuesta', entidadUuid: i.uuid })
      ultimoEncolado = Date.now()
    }
    await asegurarEnCampo()
    guardadoEn.value = ahora()
  } catch {
    errorGuardado.value = 'No se pudo guardar en el teléfono. Volvé a intentar.'
  } finally {
    guardando.value = false
  }
}

/** La primera respuesta marca que la inspeccion ya se esta haciendo en la calle. */
async function asegurarEnCampo() {
  const i = inspeccion.value
  if (!i || i.estado === 'en_campo' || i.estado === 'cerrada') return
  const actualizada: Inspeccion = { ...i, estado: 'en_campo', actualizadaEn: ahora() }
  await almacen.inspecciones.guardar(actualizada)
  await almacen.cola.encolar({ tipo: 'inspeccion', entidadUuid: i.uuid })
  await almacen.auditoria.registrar({
    organismoId: i.organismoId,
    entidad: 'inspeccion',
    entidadId: i.uuid,
    accion: 'iniciar_en_campo',
    actor: actor.value,
  })
  inspeccion.value = actualizada
}

function alResponder(preguntaId: string, valor: Valor) {
  datos.value = { ...datos.value, [preguntaId]: valor }
  if (faltante.value === preguntaId) faltante.value = null
  mensajeCierre.value = ''
  programarGuardado()
}

function alEscribirObservaciones(evento: Event) {
  observaciones.value = (evento.target as HTMLTextAreaElement).value
  programarGuardado()
}

async function alCambiarFotos() {
  await recargarEvidencias()
  programarGuardado()
}

function alOcultarPantalla() {
  if (document.visibilityState === 'hidden') void guardar(true)
}

function alSalirDeLaPagina() {
  void guardar(true)
}

// ── Cierre ──────────────────────────────────────────────────────────

function irA(destino: Paso) {
  paso.value = destino
  window.scrollTo({ top: 0 })
}

const pasoActual = computed(() => PASOS.findIndex((p) => p.clave === paso.value))

const siguientePaso = computed(() =>
  pasoActual.value >= 0 && pasoActual.value < PASOS.length - 1
    ? PASOS[pasoActual.value + 1]
    : undefined,
)

async function cerrar() {
  const i = inspeccion.value
  if (!i || cerrando.value) return
  await guardar(true)

  const pendiente = obligatoriasPendientes.value[0]
  if (pendiente) {
    faltante.value = pendiente.id
    mensajeCierre.value = 'Falta responder: ' + pendiente.texto
    irA('checklist')
    return
  }

  if (!firma.value) {
    mensajeCierre.value =
      'Falta la firma. Si la persona no quiere firmar, marcá "Se negó a firmar" y queda constancia.'
    irA('firma')
    return
  }

  cerrando.value = true
  mensajeCierre.value = ''
  try {
    const ubicacion = await ubicacionActual()
    const momento = ahora()
    const cerrada: Inspeccion = {
      ...i,
      estado: 'cerrada',
      resultado: resultado.value,
      ejecutadaEn: momento,
      ubicacionEjecucion: ubicacion,
      actualizadaEn: momento,
    }
    await almacen.inspecciones.guardar(cerrada)
    await almacen.cola.encolar({ tipo: 'inspeccion', entidadUuid: i.uuid })
    await almacen.auditoria.registrar({
      organismoId: i.organismoId,
      entidad: 'inspeccion',
      entidadId: i.uuid,
      accion: 'cerrar',
      detalle:
        TEXTO_RESULTADO[resultado.value] +
        ', ' +
        incumplimientos.value.length +
        ' faltas constatadas, ' +
        totalFotos.value +
        ' fotos',
      actor: actor.value,
      ubicacion,
    })
    inspeccion.value = cerrada
    await enrutador.push('/inspeccion/' + i.uuid + '/acta')
  } catch {
    mensajeCierre.value = 'No se pudo cerrar la inspección. Probá de nuevo.'
  } finally {
    cerrando.value = false
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', alOcultarPantalla)
  window.addEventListener('pagehide', alSalirDeLaPagina)
  void cargar()
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', alOcultarPantalla)
  window.removeEventListener('pagehide', alSalirDeLaPagina)
  if (temporizador) {
    window.clearTimeout(temporizador)
    void guardar(true)
  }
})
</script>

<template>
  <div class="contenido pantalla">
    <p v-if="cargando" class="vacio">Abriendo la inspección…</p>

    <div v-else-if="error" class="aviso-error">
      <p>{{ error }}</p>
      <RouterLink class="boton boton--secundario" to="/tareas">Volver a mis tareas</RouterLink>
    </div>

    <template v-else-if="inspeccion && formulario">
      <header class="cabecera">
        <p class="denominacion">{{ objeto?.denominacion ?? 'Objeto sin ficha' }}</p>
        <p class="direccion">{{ objeto?.direccion ?? 'Sin dirección cargada' }}</p>
        <div class="cabecera-marcas">
          <span class="distintivo" :class="'distintivo--' + inspeccion.estado">
            {{ inspeccion.estado === 'cerrada' ? 'Cerrada' : 'En curso' }}
          </span>
          <span class="chico tenue">{{ tipoInspeccion?.nombre ?? 'Inspección' }}</span>
        </div>
      </header>

      <div v-if="soloLectura" class="cerrada-aviso">
        <p>
          Esta inspección se cerró el {{ formatearFechaHora(inspeccion.ejecutadaEn) }}. Se puede
          mirar, no cambiar.
        </p>
        <RouterLink class="boton" :to="'/inspeccion/' + inspeccion.uuid + '/acta'">
          Ver el acta
        </RouterLink>
      </div>

      <nav class="pasos" aria-label="Pasos de la inspección">
        <button
          v-for="(p, indice) in PASOS"
          :key="p.clave"
          type="button"
          class="paso"
          :class="{ 'paso--activo': paso === p.clave }"
          :aria-current="paso === p.clave"
          @click="irA(p.clave)"
        >
          <span class="paso-numero">{{ indice + 1 }}</span>
          {{ p.titulo }}
        </button>
      </nav>

      <p v-if="incumplimientos.length > 0" class="faltas-vivo">
        <strong>
          {{ incumplimientos.length === 1 ? '1 falta constatada' : incumplimientos.length + ' faltas constatadas' }}
        </strong>
        <span class="chico">Se van sumando con lo que vas respondiendo.</span>
      </p>

      <!-- Paso 1: checklist -->
      <section v-show="paso === 'checklist'">
        <Checklist
          :formulario="formulario"
          :datos="datos"
          :inspeccion-uuid="inspeccion.uuid"
          :fotos-por-pregunta="fotosPorPregunta"
          :faltante="faltante"
          :solo-lectura="soloLectura"
          @responder="alResponder"
          @cambio-fotos="alCambiarFotos"
        />

        <div class="campo observaciones">
          <label for="observaciones">Observaciones</label>
          <textarea
            id="observaciones"
            :value="observaciones"
            rows="3"
            placeholder="Lo que haga falta aclarar de lo que viste"
            :disabled="soloLectura"
            @input="alEscribirObservaciones"
          ></textarea>
        </div>
      </section>

      <!-- Paso 2: fotos -->
      <section v-show="paso === 'fotos'" class="apilado">
        <h2>Fotos de la inspección</h2>
        <p class="chico tenue">
          Cada foto guarda dónde y cuándo se sacó. Se achican solas para que entren en el teléfono.
        </p>
        <CapturaFotos
          :inspeccion-uuid="inspeccion.uuid"
          :solo-lectura="soloLectura"
          @cambio="alCambiarFotos"
        />
      </section>

      <!-- Paso 3: firma -->
      <section v-show="paso === 'firma'" class="apilado">
        <h2>Firma de quien atiende</h2>
        <PanelFirma
          :inspeccion-uuid="inspeccion.uuid"
          :solo-lectura="soloLectura"
          @cambio="recargarFirma"
        />
      </section>

      <!-- Paso 4: cierre -->
      <section v-show="paso === 'cierre'" class="apilado">
        <h2>Antes de cerrar</h2>

        <div class="tarjeta resumen" :class="'resumen--' + resultado">
          <span class="etiqueta">Resultado</span>
          <strong class="resumen-titulo">{{ TEXTO_RESULTADO[resultado] }}</strong>
          <ul v-if="incumplimientos.length > 0" class="faltas">
            <li v-for="falta in incumplimientos" :key="falta.id">
              <strong>{{ falta.descripcion }}</strong>
              <span class="chico tenue">
                {{ falta.normativa }} · {{ TEXTO_GRAVEDAD[falta.gravedad] }} · plazo
                {{ falta.plazoSubsanacionDias }} días
              </span>
            </li>
          </ul>
          <p v-else class="chico tenue">No se constató ninguna falta.</p>
        </div>

        <ul class="repaso">
          <li :class="obligatoriasPendientes.length === 0 ? 'bien' : 'mal'">
            {{
              obligatoriasPendientes.length === 0
                ? 'Checklist completo'
                : 'Faltan ' + obligatoriasPendientes.length + ' respuestas obligatorias'
            }}
            <button
              v-if="obligatoriasPendientes.length > 0"
              type="button"
              class="ir"
              @click="irA('checklist')"
            >
              Ir
            </button>
          </li>
          <li :class="totalFotos > 0 ? 'bien' : 'aviso'">
            {{ totalFotos === 0 ? 'Sin fotos' : totalFotos === 1 ? '1 foto' : totalFotos + ' fotos' }}
            <button type="button" class="ir" @click="irA('fotos')">Ir</button>
          </li>
          <li :class="firma ? 'bien' : 'mal'">
            {{
              !firma
                ? 'Falta la firma'
                : firma.seNegoAFirmar
                  ? 'Consta que se negó a firmar'
                  : 'Firmada por ' + firma.firmante
            }}
            <button v-if="!soloLectura" type="button" class="ir" @click="irA('firma')">Ir</button>
          </li>
        </ul>
      </section>
    </template>

    <div v-if="!cargando && !error && inspeccion" class="barra-accion">
      <p v-if="mensajeCierre" class="mensaje-cierre">{{ mensajeCierre }}</p>
      <p v-else-if="errorGuardado" class="mensaje-cierre">{{ errorGuardado }}</p>
      <p v-else-if="!soloLectura" class="estado-guardado">
        <span v-if="guardando">Guardando…</span>
        <span v-else-if="guardadoEn">Guardado en el teléfono · {{ formatearFechaHora(guardadoEn) }}</span>
        <span v-else>Todo lo que respondas se guarda solo</span>
      </p>

      <button
        v-if="soloLectura"
        type="button"
        class="boton boton--ancho"
        @click="enrutador.push('/inspeccion/' + inspeccion.uuid + '/acta')"
      >
        Ver el acta
      </button>
      <button
        v-else-if="paso === 'cierre'"
        type="button"
        class="boton boton--ancho"
        :disabled="cerrando"
        @click="cerrar"
      >
        {{ cerrando ? 'Cerrando…' : 'Cerrar la inspección' }}
      </button>
      <button
        v-else-if="siguientePaso"
        type="button"
        class="boton boton--ancho"
        @click="irA(siguientePaso.clave)"
      >
        Seguir con {{ siguientePaso.titulo.toLowerCase() }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.pantalla {
  padding-bottom: calc(var(--alto-pie) + var(--seguro-abajo) + 8rem);
}

.cabecera {
  margin-bottom: 0.85rem;
}

.denominacion {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  line-height: 1.25;
}

.direccion {
  margin: 0.15rem 0 0;
  color: var(--apagado);
}

.cabecera-marcas {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.cerrada-aviso {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  align-items: flex-start;
  padding: 0.75rem;
  margin-bottom: 0.85rem;
  border-radius: var(--radio);
  background: var(--verde-suave);
}

.cerrada-aviso p {
  margin: 0;
}

.pasos {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.35rem;
  margin-bottom: 0.85rem;
}

.paso {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  min-height: 56px;
  padding: 0.4rem 0.2rem;
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  background: var(--superficie);
  color: var(--apagado);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.paso--activo {
  background: var(--tinta);
  border-color: var(--tinta);
  color: var(--papel);
}

.paso-numero {
  font-size: 0.9375rem;
  font-weight: 700;
}

.faltas-vivo {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  margin: 0 0 0.85rem;
  padding: 0.6rem 0.75rem;
  border-radius: var(--radio);
  background: var(--ambar-suave);
  color: var(--tinta);
  border-left: 4px solid var(--ambar);
}

.observaciones {
  margin-top: 1.25rem;
}

.resumen {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  border-left: 4px solid var(--apagado);
}

.resumen--conforme {
  border-left-color: var(--verde);
}

.resumen--con_observaciones {
  border-left-color: var(--ambar);
}

.resumen--no_conforme {
  border-left-color: var(--rojo);
}

.resumen-titulo {
  font-size: 1.125rem;
}

.faltas {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.faltas li {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--filete);
}

.repaso {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.repaso li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-height: 52px;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  background: var(--superficie);
  font-weight: 600;
}

.repaso .bien {
  border-left: 4px solid var(--verde);
}

.repaso .aviso {
  border-left: 4px solid var(--ambar);
}

.repaso .mal {
  border-left: 4px solid var(--rojo);
}

.ir {
  min-height: 44px;
  padding: 0 0.9rem;
  border: 1px solid var(--borde);
  border-radius: var(--radio-chico);
  background: var(--superficie-2);
  color: var(--tinta);
  font-weight: 700;
  cursor: pointer;
}

.barra-accion {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(var(--alto-pie) + var(--seguro-abajo));
  z-index: 15;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.6rem 1rem;
  background: var(--superficie);
  border-top: 1px solid var(--borde);
  box-shadow: var(--sombra);
}

.estado-guardado {
  margin: 0;
  font-size: 0.75rem;
  color: var(--apagado);
  text-align: center;
}

.mensaje-cierre {
  margin: 0;
  padding: 0.4rem 0.55rem;
  border-radius: var(--radio-chico);
  background: var(--rojo-suave);
  color: var(--rojo);
  font-size: 0.8125rem;
  font-weight: 600;
  text-align: center;
}

.aviso-error {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: flex-start;
  padding: 1rem;
  border-radius: var(--radio);
  background: var(--rojo-suave);
  color: var(--rojo);
  font-weight: 600;
}
</style>
