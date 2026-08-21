<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
/**
 * Listado de formularios, la puerta de entrada al editor de checklists.
 *
 * Se agrupa por direccion responsable y no por nombre porque quien entra acá
 * viene a buscar «lo mío»: el de Obras no tiene por qué leer los de Alumbrado.
 *
 * Tres decisiones ordenan la pantalla:
 *
 *  1. De cada formulario se dice enseguida el tamaño real —cuántas preguntas y
 *     cuántas faltas— porque eso es lo que hace largo y caro editarlo, y no el
 *     titulo.
 *  2. Un borrador abierto se avisa con todas las letras. Un borrador olvidado
 *     es trabajo perdido: alguien lo dejo a medias y el checklist sigue
 *     saliendo a campo con la version vieja.
 *  3. Desde acá se edita y se mira el historial, pero nunca se toca una version
 *     publicada: editar abre un borrador nuevo, no modifica lo que rige.
 */

import { computed, onMounted, ref } from 'vue'
import VistaPreviaChecklist from '@/componentes/VistaPreviaChecklist.vue'
import { almacen } from '@/datos/almacen'
import type { RepositorioFormularios } from '@/datos/contratos'
import type {
  BorradorFormulario, FormularioVersion, TipoInspeccion, TipoObjeto, Uuid,
} from '@/dominio/tipos'
import { formatearFecha, formatearFechaHora } from '@/dominio/utilidades'

/** Un formulario con todo lo que hace falta para decidir si abrirlo. */
interface Ficha {
  tipo: TipoInspeccion
  vigente?: FormularioVersion
  /** Trabajo a medio hacer sobre este mismo formulario, si lo hay. */
  borrador?: BorradorFormulario
  objetos: string[]
  secciones: number
  preguntas: number
  obligatorias: number
  faltas: number
}

interface Grupo {
  direccion: string
  fichas: Ficha[]
}

const cargando = ref(true)
const problema = ref('')
const grupos = ref<Grupo[]>([])
/** Borradores cuyo formulario ya no figura en ningun tipo de inspeccion. */
const huerfanos = ref<BorradorFormulario[]>([])
/** Que checklist se esta mirando desplegado. Uno por vez: la lista es larga. */
const desplegado = ref<Uuid | null>(null)

/**
 * La edicion de checklists es una parte del contrato que puede no estar
 * implementada todavia. Si no esta, la pantalla muestra los formularios igual:
 * quedarse sin listado por no poder leer los borradores seria peor.
 */
async function listarBorradores(): Promise<BorradorFormulario[]> {
  const repositorio = almacen.formularios as Partial<RepositorioFormularios>
  if (typeof repositorio.borradores !== 'function') return []
  return repositorio.borradores()
}

async function cargar() {
  cargando.value = true
  problema.value = ''
  try {
    const [tipos, tiposObjeto] = await Promise.all([
      almacen.formularios.tiposInspeccion(),
      almacen.territorio.tiposObjeto(),
    ])

    const versiones = await Promise.all(
      tipos.map((t) => almacen.formularios.formularioVersion(t.formularioVersionId)),
    )
    const borradores = await listarBorradores()

    const nombreObjeto = new Map<Uuid, string>(
      tiposObjeto.map((t: TipoObjeto) => [t.id, t.nombre]),
    )
    const borradorDe = new Map<Uuid, BorradorFormulario>()
    for (const b of borradores) borradorDe.set(b.formularioId, b)

    const fichas: Ficha[] = tipos.map((tipo, i) => {
      const vigente = versiones[i]
      const preguntas = vigente?.secciones.flatMap((s) => s.preguntas) ?? []
      return {
        tipo,
        vigente,
        borrador: vigente ? borradorDe.get(vigente.formularioId) : undefined,
        objetos: tipo.tipoObjetoIds.map((id) => nombreObjeto.get(id) ?? 'Tipo dado de baja'),
        secciones: vigente?.secciones.length ?? 0,
        preguntas: preguntas.length,
        obligatorias: preguntas.filter((p) => p.obligatoria).length,
        faltas: vigente?.incumplimientos.length ?? 0,
      }
    })

    const conFormulario = new Set(
      fichas.flatMap((f) => (f.vigente ? [f.vigente.formularioId] : [])),
    )
    huerfanos.value = borradores.filter((b) => !conFormulario.has(b.formularioId))

    const porDireccion = new Map<string, Ficha[]>()
    for (const ficha of fichas) {
      const direccion = ficha.tipo.direccionResponsable || 'Sin dirección asignada'
      const lista = porDireccion.get(direccion)
      if (lista) lista.push(ficha)
      else porDireccion.set(direccion, [ficha])
    }

    grupos.value = [...porDireccion.entries()]
      .map(([direccion, lista]) => ({
        direccion,
        fichas: lista.sort((a, b) => a.tipo.nombre.localeCompare(b.tipo.nombre, 'es')),
      }))
      .sort((a, b) => a.direccion.localeCompare(b.direccion, 'es'))
  } catch (error) {
    problema.value = 'No se pudieron leer los formularios: ' + String(error)
  } finally {
    cargando.value = false
  }
}

const totalFormularios = computed(() =>
  grupos.value.reduce((suma, g) => suma + g.fichas.length, 0),
)
const totalBorradores = computed(
  () =>
    grupos.value.reduce((suma, g) => suma + g.fichas.filter((f) => f.borrador).length, 0) +
    huerfanos.value.length,
)

function alternar(ficha: Ficha) {
  desplegado.value = desplegado.value === ficha.tipo.id ? null : ficha.tipo.id
}

onMounted(cargar)
</script>

<template>
  <div class="pantalla">
    <header class="cabecera">
      <div class="crece">
        <h2>Formularios de inspección</h2>
        <p class="tenue chico sub">
          Cada dirección arma sus propios checklists. Editar nunca cambia lo que ya rige:
          se trabaja sobre un borrador y recién al publicarlo nace una versión nueva.
        </p>
      </div>
      <p v-if="!cargando" class="tenue chico conteo">
        {{ totalFormularios }}
        {{ totalFormularios === 1 ? 'formulario' : 'formularios' }}
        <template v-if="totalBorradores > 0">
          · {{ totalBorradores }}
          {{ totalBorradores === 1 ? 'borrador abierto' : 'borradores abiertos' }}
        </template>
      </p>
    </header>

    <p v-if="problema" class="nota nota--error" role="alert">{{ problema }}</p>
    <p v-if="cargando" class="vacio">Leyendo los formularios…</p>
    <p v-else-if="totalFormularios === 0" class="vacio">
      Todavía no hay ningún tipo de inspección cargado.
    </p>

    <section v-for="grupo in grupos" :key="grupo.direccion" class="grupo">
      <h3 class="direccion">{{ grupo.direccion }}</h3>

      <article v-for="ficha in grupo.fichas" :key="ficha.tipo.id" class="tarjeta ficha">
        <div class="ficha-cabecera">
          <div class="crece">
            <h4 class="ficha-titulo">{{ ficha.vigente?.titulo ?? ficha.tipo.nombre }}</h4>
            <p
              v-if="ficha.vigente && ficha.vigente.titulo !== ficha.tipo.nombre"
              class="tenue chico sub"
            >
              Tipo de inspección: {{ ficha.tipo.nombre }}
            </p>
          </div>
          <span v-if="ficha.vigente" class="distintivo distintivo--cerrada">
            Versión {{ ficha.vigente.version }} vigente
          </span>
          <span v-else class="distintivo distintivo--vencida">Sin versión publicada</span>
        </div>

        <p v-if="ficha.vigente" class="chico datos">
          <span><strong>{{ ficha.preguntas }}</strong>
            {{ ficha.preguntas === 1 ? 'pregunta' : 'preguntas' }}
            ({{ ficha.obligatorias }} obligatorias)</span>
          <span><strong>{{ ficha.faltas }}</strong>
            {{ ficha.faltas === 1 ? 'falta' : 'faltas' }}</span>
          <span><strong>{{ ficha.secciones }}</strong>
            {{ ficha.secciones === 1 ? 'sección' : 'secciones' }}</span>
          <span>Rige desde el {{ formatearFecha(ficha.vigente.vigenteDesde) }}</span>
        </p>
        <p v-else class="chico alerta">
          No se encontró la versión que este tipo de inspección declara vigente.
        </p>

        <p class="chico aplica">
          <span class="etiqueta">Aplica a</span>
          <span v-for="objeto in ficha.objetos" :key="objeto" class="distintivo">
            {{ objeto }}
          </span>
          <span v-if="ficha.objetos.length === 0" class="tenue">Ningún tipo de objeto</span>
        </p>

        <p v-if="ficha.borrador" class="borrador">
          <span class="borrador-titulo">Hay un borrador sin publicar</span>
          <span>
            Lo dejó {{ ficha.borrador.autor }} · última edición
            {{ formatearFechaHora(ficha.borrador.actualizadoEn) }}
          </span>
          <span>
            Mientras no se publique, las inspecciones salen a campo con la versión
            {{ ficha.vigente?.version }}.
          </span>
        </p>

        <div class="acciones">
          <RouterLink class="boton" :to="'/formularios/' + ficha.tipo.id + '/editar'">
            {{ ficha.borrador ? 'Seguir editando el borrador' : 'Editar' }}
          </RouterLink>
          <RouterLink
            v-if="ficha.vigente"
            class="boton boton--secundario"
            :to="'/formularios/' + ficha.vigente.formularioId + '/versiones'"
          >
            Ver historial de versiones
          </RouterLink>
          <button
            v-if="ficha.vigente"
            type="button"
            class="boton boton--fantasma"
            :aria-expanded="desplegado === ficha.tipo.id"
            @click="alternar(ficha)"
          >
            {{ desplegado === ficha.tipo.id ? 'Ocultar el checklist' : 'Ver el checklist vigente' }}
          </button>
        </div>

        <div v-if="desplegado === ficha.tipo.id && ficha.vigente" class="previa">
          <VistaPreviaChecklist :formulario="ficha.vigente" />
        </div>
      </article>
    </section>

    <section v-if="huerfanos.length > 0" class="grupo">
      <h3 class="direccion">Borradores sin formulario</h3>
      <article v-for="borrador in huerfanos" :key="borrador.id" class="tarjeta ficha">
        <h4 class="ficha-titulo">{{ borrador.titulo || 'Formulario sin título' }}</h4>
        <p class="chico">
          Lo dejó {{ borrador.autor }} · última edición
          {{ formatearFechaHora(borrador.actualizadoEn) }}
        </p>
        <p class="chico tenue">
          Ningún tipo de inspección apunta a este formulario, así que no rige en ninguna
          inspección hasta que se publique.
        </p>
      </article>
    </section>
  </div>
</template>

<style scoped>
.pantalla {
  padding: 1rem;
  padding-bottom: calc(var(--alto-pie) + var(--seguro-abajo) + 2rem);
  max-width: 1100px;
  margin-inline: auto;
}

.cabecera {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

.sub {
  margin: 0.2rem 0 0;
  max-width: 68ch;
}

.conteo {
  margin: 0;
  white-space: nowrap;
}

.nota {
  margin: 0 0 1rem;
  padding: 0.6rem 0.75rem;
  border-radius: var(--radio-chico);
  font-size: 0.875rem;
  font-weight: 600;
}

.nota--error {
  background: var(--rojo-suave);
  color: var(--rojo);
}

.alerta {
  color: var(--rojo);
  font-weight: 600;
}

.grupo {
  margin-bottom: 1.75rem;
}

.direccion {
  margin-bottom: 0.6rem;
  padding-bottom: 0.35rem;
  border-bottom: 2px solid var(--filete);
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--apagado);
}

.ficha {
  margin-bottom: 0.75rem;
}

.ficha-cabecera {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.6rem;
}

.ficha-titulo {
  margin: 0;
  font-size: 1.0625rem;
}

.datos {
  margin: 0.65rem 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
  color: var(--apagado);
}

.datos strong {
  color: var(--tinta);
  font-variant-numeric: tabular-nums;
}

.aplica {
  margin: 0.5rem 0 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.borrador {
  margin: 0.75rem 0 0;
  padding: 0.6rem 0.7rem;
  background: var(--ambar-suave);
  border-radius: var(--radio-chico);
  font-size: 0.875rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.borrador-titulo {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ambar);
}

.acciones {
  margin-top: 0.85rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.previa {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--filete);
}
</style>
