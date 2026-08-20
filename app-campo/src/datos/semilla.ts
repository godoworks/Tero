// SPDX-FileCopyrightText: 2026 GoDoWorks
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Datos de demostracion.
 *
 * Todo lo de aca es inventado: el organismo se llama "Intendencia
 * Demostracion" a proposito, y ninguna direccion, padron ni razon social
 * corresponde a algo real. Las coordenadas caen sobre la costa uruguaya para
 * que el mapa se vea creible, repartidas en unos tres kilometros.
 *
 * Las fechas son relativas al dia en que se siembra: las inspecciones
 * asignadas caen HOY (si no, la bandeja del inspector aparece vacia en la
 * demostracion) y las cerradas se reparten en los ultimos sesenta dias para
 * que el tablero tenga una tendencia que mostrar.
 */

import type {
  ClaveTipoObjeto, EventoAuditoria, FechaHora, FormularioVersion, Inspeccion,
  ObjetoInspeccionable, Organismo, Pregunta, Punto, Respuesta,
  ResultadoInspeccion, TipoInspeccion, TipoObjeto, Uuid, Zona,
} from '@/dominio/tipos'
import { nuevoUuid, sumarDias } from '@/dominio/utilidades'

export interface DatosSemilla {
  organismo: Organismo
  zonas: Zona[]
  tiposObjeto: TipoObjeto[]
  objetos: ObjetoInspeccionable[]
  formularioVersiones: FormularioVersion[]
  tiposInspeccion: TipoInspeccion[]
  inspecciones: Inspeccion[]
  respuestas: Respuesta[]
  auditoria: EventoAuditoria[]
}

// ── Azar reproducible ─────────────────────────────────────────────────

/**
 * Generador con semilla fija (xorshift32).
 *
 * Se usa en lugar de `Math.random` para que la demostracion sea siempre la
 * misma: si las luminarias saltan de lugar entre dos cargas, cualquier captura
 * de pantalla o prueba manual deja de significar nada.
 */
function crearAzar(semilla: number): () => number {
  let estado = semilla >>> 0
  return () => {
    estado ^= estado << 13
    estado >>>= 0
    estado ^= estado >>> 17
    estado ^= estado << 5
    estado >>>= 0
    return estado / 0x1_0000_0000
  }
}

function entre(azar: () => number, minimo: number, maximo: number): number {
  return minimo + azar() * (maximo - minimo)
}

function elegir<T>(azar: () => number, opciones: readonly T[]): T {
  return opciones[Math.floor(azar() * opciones.length)]!
}

// ── Fechas ────────────────────────────────────────────────────────────

/** Dias hacia atras (positivo) o hacia adelante (negativo), a una hora dada. */
function fechaRelativa(dias: number, hora = 9, minuto = 0): FechaHora {
  const f = new Date()
  f.setDate(f.getDate() - dias)
  f.setHours(hora, minuto, 0, 0)
  return f.toISOString()
}

// ── Territorio ────────────────────────────────────────────────────────

interface Recuadro {
  latMin: number
  latMax: number
  lonMin: number
  lonMax: number
}

/**
 * Contorno poligonal derivado del recuadro de la zona.
 *
 * Es un pentagono, no un rectangulo: alcanza para que el mapa no parezca una
 * grilla de cajas y no obliga a arrastrar geometria catastral de verdad.
 */
function contornoDe(r: Recuadro): Punto[] {
  const latMedia = (r.latMin + r.latMax) / 2
  return [
    { lat: r.latMin, lon: r.lonMin },
    { lat: r.latMin, lon: r.lonMax },
    { lat: latMedia, lon: r.lonMax + 0.0018 },
    { lat: r.latMax, lon: r.lonMax },
    { lat: r.latMax, lon: r.lonMin },
    { lat: r.latMin, lon: r.lonMin },
  ]
}

interface DefinicionZona {
  nombre: string
  recuadro: Recuadro
  calles: readonly string[]
}

const DEFINICIONES_ZONA: readonly DefinicionZona[] = [
  {
    nombre: 'Centro',
    recuadro: { latMin: -34.9560, latMax: -34.9450, lonMin: -54.9480, lonMax: -54.9340 },
    calles: ['Av. de la Costa', 'Calle Los Ceibos', 'Calle 12 de Octubre', 'Av. Principal'],
  },
  {
    nombre: 'Rambla Este',
    recuadro: { latMin: -34.9600, latMax: -34.9500, lonMin: -54.9340, lonMax: -54.9210 },
    calles: ['Rambla de los Pescadores', 'Calle Las Gaviotas', 'Calle del Faro'],
  },
  {
    nombre: 'Playa Mansa',
    recuadro: { latMin: -34.9480, latMax: -34.9380, lonMin: -54.9540, lonMax: -54.9420 },
    calles: ['Av. de las Dunas', 'Calle Los Médanos', 'Calle Las Toninas'],
  },
  {
    nombre: 'Barrio Norte',
    recuadro: { latMin: -34.9420, latMax: -34.9320, lonMin: -54.9400, lonMax: -54.9260 },
    calles: ['Av. del Molino', 'Calle Los Aromos', 'Calle Los Talas'],
  },
  {
    nombre: 'Parque Industrial',
    recuadro: { latMin: -34.9580, latMax: -34.9480, lonMin: -54.9600, lonMax: -54.9480 },
    calles: ['Camino de los Galpones', 'Calle Industrial 2', 'Ruta Vieja km 3'],
  },
]

interface DefinicionTipoObjeto {
  clave: ClaveTipoObjeto
  nombre: string
  icono: string
  prefijo: string
  cantidad: number
}

const DEFINICIONES_TIPO_OBJETO: readonly DefinicionTipoObjeto[] = [
  { clave: 'luminaria', nombre: 'Luminaria', icono: 'bombilla', prefijo: 'LUM', cantidad: 12 },
  { clave: 'contenedor', nombre: 'Contenedor de residuos', icono: 'contenedor', prefijo: 'CON', cantidad: 8 },
  { clave: 'comercio', nombre: 'Comercio', icono: 'tienda', prefijo: 'COM', cantidad: 9 },
  { clave: 'obra', nombre: 'Obra', icono: 'obra', prefijo: 'OBR', cantidad: 5 },
  { clave: 'senalizacion', nombre: 'Señalización vial', icono: 'senal', prefijo: 'SEN', cantidad: 5 },
  { clave: 'parador', nombre: 'Parador', icono: 'sombrilla', prefijo: 'PAR', cantidad: 3 },
]

const NOMBRES_COMERCIO = [
  'Panadería La Espiga', 'Almacén Don Elías', 'Bar El Ancla', 'Ferretería El Tornillo',
  'Rotisería La Brasa', 'Kiosco La Esquina', 'Heladería Polar', 'Farmacia de la Costa',
  'Librería El Faro',
] as const

const NOMBRES_PARADOR = ['Parador Los Médanos', 'Parador El Timón', 'Parador La Caleta'] as const

const CLASES_SENAL = ['PARE', 'Ceda el paso', 'Velocidad máxima 45', 'Zona escolar', 'No estacionar'] as const

function atributosDe(
  clave: ClaveTipoObjeto,
  indice: number,
  azar: () => number,
): Record<string, string | number | boolean> {
  switch (clave) {
    case 'luminaria':
      return {
        potenciaW: elegir(azar, [70, 100, 150, 250]),
        tecnologia: elegir(azar, ['LED', 'sodio', 'mercurio']),
        alturaM: Math.round(entre(azar, 4, 10)),
        brazoDoble: azar() > 0.7,
      }
    case 'contenedor':
      return {
        capacidadLitros: elegir(azar, [770, 1100, 2400]),
        material: elegir(azar, ['plástico', 'metálico']),
        conTapa: azar() > 0.2,
      }
    case 'comercio':
      return {
        rut: `21${String(500000 + indice * 137).padStart(6, '0')}0016`,
        rubro: elegir(azar, ['gastronomía', 'almacén', 'indumentaria', 'servicios']),
        habilitacionVence: fechaRelativa(-Math.round(entre(azar, -120, 400))).slice(0, 10),
      }
    case 'obra':
      return {
        numeroPermiso: `PC-${2025 + (indice % 2)}-${String(1200 + indice * 7).padStart(4, '0')}`,
        superficieM2: Math.round(entre(azar, 90, 1800)),
        pisos: Math.round(entre(azar, 1, 8)),
      }
    case 'senalizacion':
      return {
        clase: elegir(azar, CLASES_SENAL),
        material: elegir(azar, ['chapa reflectiva', 'aluminio']),
        alturaM: 2.2,
      }
    case 'parador':
      return {
        temporada: 'verano',
        superficieM2: Math.round(entre(azar, 60, 240)),
        concesionHasta: fechaRelativa(-Math.round(entre(azar, 60, 500))).slice(0, 10),
      }
  }
}

function denominacionDe(clave: ClaveTipoObjeto, indice: number, direccion: string): string {
  switch (clave) {
    case 'luminaria': return `Luminaria ${direccion}`
    case 'contenedor': return `Contenedor ${direccion}`
    case 'comercio': return NOMBRES_COMERCIO[indice % NOMBRES_COMERCIO.length]!
    case 'obra': return `Obra en ${direccion}`
    case 'senalizacion': return `Señal vertical ${direccion}`
    case 'parador': return NOMBRES_PARADOR[indice % NOMBRES_PARADOR.length]!
  }
}

// ── Formularios ───────────────────────────────────────────────────────

/**
 * Identidad tipada. Solo sirve para que un error en una pregunta se marque en
 * esa pregunta y no en el array entero, que con formularios largos es la
 * diferencia entre encontrar el error y buscarlo.
 */
function pregunta(p: Pregunta): Pregunta {
  return p
}

function formularioAlumbrado(vigenteDesde: FechaHora): FormularioVersion {
  return {
    id: nuevoUuid(),
    formularioId: nuevoUuid(),
    version: 3,
    titulo: 'Mantenimiento de alumbrado público',
    vigenteDesde,
    secciones: [
      {
        id: 'alu-s1',
        titulo: 'Identificación y soporte',
        preguntas: [
          pregunta({
            id: 'alu-p1', tipo: 'si_no', obligatoria: true,
            texto: '¿La columna presenta corrosión, golpes o falta de fijación?',
            respuestaQueIncumple: 'si', incumplimientoId: 'alu-columna',
          }),
          pregunta({
            id: 'alu-p2', tipo: 'si_no_na', obligatoria: true,
            texto: '¿La tapa del registro eléctrico está cerrada y con tornillo?',
            respuestaQueIncumple: 'no', incumplimientoId: 'alu-tapa',
          }),
          pregunta({
            id: 'alu-p3', tipo: 'foto', obligatoria: true,
            texto: 'Fotografía general de la columna',
          }),
        ],
      },
      {
        id: 'alu-s2',
        titulo: 'Funcionamiento',
        preguntas: [
          pregunta({
            id: 'alu-p4', tipo: 'opciones', obligatoria: true,
            texto: 'Estado de encendido',
            opciones: ['enciende', 'no enciende', 'intermitente', 'no verificable de día'],
            respuestaQueIncumple: 'no enciende', incumplimientoId: 'alu-apagada',
          }),
          pregunta({
            id: 'alu-p5', tipo: 'numero', obligatoria: false,
            texto: 'Potencia de la lámpara instalada (W)',
          }),
          pregunta({
            id: 'alu-p6', tipo: 'si_no', obligatoria: true,
            texto: '¿La óptica está entera y bien sujeta?',
            respuestaQueIncumple: 'no', incumplimientoId: 'alu-optica',
          }),
        ],
      },
      {
        id: 'alu-s3',
        titulo: 'Entorno',
        preguntas: [
          pregunta({
            id: 'alu-p7', tipo: 'si_no', obligatoria: false,
            texto: '¿Hay follaje que obstruya el haz lumínico?',
            respuestaQueIncumple: 'si', incumplimientoId: 'alu-follaje',
          }),
          pregunta({
            id: 'alu-p8', tipo: 'texto', obligatoria: false,
            texto: 'Referencia del punto (esquina o padrón más cercano)',
          }),
        ],
      },
    ],
    incumplimientos: [
      {
        id: 'alu-apagada',
        descripcion: 'Luminaria fuera de servicio en horario nocturno',
        normativa: 'Digesto Departamental, art. 214 (Decreto Departamental 3.482/2018)',
        plazoSubsanacionDias: 10,
        gravedad: 'grave',
      },
      {
        id: 'alu-columna',
        descripcion: 'Columna con corrosión avanzada o fijación deficiente',
        normativa: 'Digesto Departamental, art. 216 (Decreto Departamental 3.482/2018)',
        plazoSubsanacionDias: 15,
        gravedad: 'muy_grave',
      },
      {
        id: 'alu-tapa',
        descripcion: 'Tapa de registro eléctrico abierta o faltante, con conductores accesibles',
        normativa: 'Digesto Departamental, art. 219 (Decreto Departamental 3.482/2018)',
        plazoSubsanacionDias: 3,
        gravedad: 'muy_grave',
      },
      {
        id: 'alu-optica',
        descripcion: 'Óptica rota, suelta o con ingreso de agua',
        normativa: 'Digesto Departamental, art. 221',
        plazoSubsanacionDias: 20,
        gravedad: 'leve',
      },
      {
        id: 'alu-follaje',
        descripcion: 'Follaje que obstruye la iluminación de la calzada',
        normativa: 'Digesto Departamental, art. 118 (poda de arbolado público)',
        plazoSubsanacionDias: 30,
        gravedad: 'leve',
      },
    ],
  }
}

function formularioObra(vigenteDesde: FechaHora): FormularioVersion {
  return {
    id: nuevoUuid(),
    formularioId: nuevoUuid(),
    version: 2,
    titulo: 'Control de obra en curso',
    vigenteDesde,
    secciones: [
      {
        id: 'obr-s1',
        titulo: 'Documentación',
        preguntas: [
          pregunta({
            id: 'obr-p1', tipo: 'si_no', obligatoria: true,
            texto: '¿Exhibe el permiso de construcción vigente?',
            respuestaQueIncumple: 'no', incumplimientoId: 'obr-permiso',
          }),
          pregunta({
            id: 'obr-p2', tipo: 'texto', obligatoria: false,
            texto: 'Número de permiso declarado por el responsable',
          }),
          pregunta({
            id: 'obr-p3', tipo: 'si_no', obligatoria: true,
            texto: '¿El cartel de obra está colocado y legible desde la vía pública?',
            respuestaQueIncumple: 'no', incumplimientoId: 'obr-cartel',
          }),
        ],
      },
      {
        id: 'obr-s2',
        titulo: 'Seguridad en obra',
        preguntas: [
          pregunta({
            id: 'obr-p4', tipo: 'si_no', obligatoria: true,
            texto: '¿El vallado perimetral cubre todo el frente de la obra?',
            respuestaQueIncumple: 'no', incumplimientoId: 'obr-vallado',
          }),
          pregunta({
            id: 'obr-p5', tipo: 'si_no_na', obligatoria: true,
            texto: '¿Los andamios tienen bandeja o malla de protección?',
            respuestaQueIncumple: 'no', incumplimientoId: 'obr-andamio',
          }),
          pregunta({
            id: 'obr-p6', tipo: 'numero', obligatoria: false,
            texto: 'Cantidad de trabajadores presentes al momento de la visita',
          }),
        ],
      },
      {
        id: 'obr-s3',
        titulo: 'Vía pública',
        preguntas: [
          pregunta({
            id: 'obr-p7', tipo: 'opciones', obligatoria: true,
            texto: 'Ancho libre para la circulación peatonal',
            opciones: ['más de 1,20 m', 'entre 0,90 y 1,20 m', 'menos de 0,90 m'],
            respuestaQueIncumple: 'menos de 0,90 m', incumplimientoId: 'obr-vereda',
          }),
          pregunta({
            id: 'obr-p8', tipo: 'foto', obligatoria: true,
            texto: 'Fotografía del frente de obra',
          }),
        ],
      },
    ],
    incumplimientos: [
      {
        id: 'obr-permiso',
        descripcion: 'Obra sin permiso de construcción vigente exhibido en el lugar',
        normativa: 'Digesto Departamental, art. 34 (Decreto Departamental 3.117/2016)',
        plazoSubsanacionDias: 5,
        gravedad: 'muy_grave',
      },
      {
        id: 'obr-cartel',
        descripcion: 'Falta el cartel de obra reglamentario o es ilegible',
        normativa: 'Digesto Departamental, art. 37',
        plazoSubsanacionDias: 10,
        gravedad: 'leve',
      },
      {
        id: 'obr-vallado',
        descripcion: 'Vallado perimetral inexistente o incompleto',
        normativa: 'Digesto Departamental, art. 41 (Decreto Departamental 3.117/2016)',
        plazoSubsanacionDias: 2,
        gravedad: 'muy_grave',
      },
      {
        id: 'obr-andamio',
        descripcion: 'Andamio sin protección contra caída de materiales',
        normativa: 'Digesto Departamental, art. 46',
        plazoSubsanacionDias: 2,
        gravedad: 'grave',
      },
      {
        id: 'obr-vereda',
        descripcion: 'Ocupación de la vereda que reduce el paso peatonal por debajo del mínimo',
        normativa: 'Digesto Departamental, art. 44',
        plazoSubsanacionDias: 3,
        gravedad: 'grave',
      },
    ],
  }
}

function formularioComercio(vigenteDesde: FechaHora): FormularioVersion {
  return {
    id: nuevoUuid(),
    formularioId: nuevoUuid(),
    version: 1,
    titulo: 'Habilitación de comercio',
    vigenteDesde,
    secciones: [
      {
        id: 'com-s1',
        titulo: 'Documentación',
        preguntas: [
          pregunta({
            id: 'com-p1', tipo: 'si_no', obligatoria: true,
            texto: '¿Exhibe la habilitación comercial vigente?',
            respuestaQueIncumple: 'no', incumplimientoId: 'com-habilitacion',
          }),
          pregunta({
            id: 'com-p2', tipo: 'texto', obligatoria: false,
            texto: 'Razón social declarada',
          }),
          pregunta({
            id: 'com-p3', tipo: 'opciones', obligatoria: true,
            texto: 'Rubro constatado en el local',
            opciones: ['gastronomía', 'almacén', 'indumentaria', 'servicios', 'otro'],
          }),
        ],
      },
      {
        id: 'com-s2',
        titulo: 'Higiene y seguridad',
        preguntas: [
          pregunta({
            id: 'com-p4', tipo: 'si_no', obligatoria: true,
            texto: '¿El extintor está presente, señalizado y con carga vigente?',
            respuestaQueIncumple: 'no', incumplimientoId: 'com-extintor',
          }),
          pregunta({
            id: 'com-p5', tipo: 'si_no_na', obligatoria: true,
            texto: '¿El personal cuenta con carné de salud vigente?',
            respuestaQueIncumple: 'no', incumplimientoId: 'com-sanitaria',
          }),
          pregunta({
            id: 'com-p6', tipo: 'numero', obligatoria: false,
            texto: 'Cantidad de personas trabajando en el local',
          }),
        ],
      },
      {
        id: 'com-s3',
        titulo: 'Cartelería y ocupación',
        preguntas: [
          pregunta({
            id: 'com-p7', tipo: 'si_no', obligatoria: true,
            texto: '¿Ocupa la vereda con mesas, cartelería o mercadería sin permiso?',
            respuestaQueIncumple: 'si', incumplimientoId: 'com-vereda',
          }),
          pregunta({
            id: 'com-p8', tipo: 'foto', obligatoria: true,
            texto: 'Fotografía del frente del local',
          }),
        ],
      },
    ],
    incumplimientos: [
      {
        id: 'com-habilitacion',
        descripcion: 'Local en funcionamiento sin habilitación comercial vigente',
        normativa: 'Digesto Departamental, art. 88 (Decreto Departamental 3.290/2017)',
        plazoSubsanacionDias: 15,
        gravedad: 'muy_grave',
      },
      {
        id: 'com-extintor',
        descripcion: 'Extintor ausente, vencido o sin señalizar',
        normativa: 'Digesto Departamental, art. 92',
        plazoSubsanacionDias: 5,
        gravedad: 'grave',
      },
      {
        id: 'com-sanitaria',
        descripcion: 'Personal sin carné de salud vigente',
        normativa: 'Digesto Departamental, art. 95',
        plazoSubsanacionDias: 20,
        gravedad: 'grave',
      },
      {
        id: 'com-vereda',
        descripcion: 'Ocupación de la vereda sin permiso municipal',
        normativa: 'Digesto Departamental, art. 101',
        plazoSubsanacionDias: 3,
        gravedad: 'leve',
      },
    ],
  }
}

// ── Respuestas sinteticas ─────────────────────────────────────────────

/** Valores de ejemplo para las preguntas abiertas, por id de pregunta. */
const VALORES_LIBRES: Record<string, string | number> = {
  'alu-p5': 100,
  'alu-p8': 'Frente al padrón 4512, esquina con calle interior',
  'obr-p2': 'PC-2025-1834',
  'obr-p6': 4,
  'com-p2': 'Servicios del Este S.R.L.',
  'com-p6': 3,
}

/** Respuesta que NO constata falta, deducida de la propia pregunta. */
function valorConforme(p: Pregunta): string | number | boolean | null {
  switch (p.tipo) {
    case 'si_no':
    case 'si_no_na':
      return p.respuestaQueIncumple === 'si' ? 'no' : 'si'
    case 'opciones': {
      const validas = (p.opciones ?? []).filter((o) => o !== p.respuestaQueIncumple)
      return validas[0] ?? null
    }
    case 'numero':
    case 'texto':
      return VALORES_LIBRES[p.id] ?? (p.tipo === 'numero' ? 0 : 'Sin observaciones')
    case 'foto':
      // La foto no vive en la respuesta: vive en `evidencias`, con su hash.
      return null
  }
}

function armarRespuesta(
  inspeccionUuid: Uuid,
  formulario: FormularioVersion,
  incumplimientoIds: string[],
  opciones: { parcial?: boolean; observaciones?: string } = {},
): Respuesta {
  const datos: Record<string, string | number | boolean | null> = {}
  const secciones = opciones.parcial
    // Una inspeccion en campo tiene el formulario a medio llenar: se corta la
    // ultima seccion para que la vista pueda mostrar "reanudar" con sentido.
    ? formulario.secciones.slice(0, formulario.secciones.length - 1)
    : formulario.secciones

  for (const seccion of secciones) {
    for (const p of seccion.preguntas) {
      const constata = p.incumplimientoId !== undefined
        && incumplimientoIds.includes(p.incumplimientoId)
      datos[p.id] = constata ? (p.respuestaQueIncumple ?? true) : valorConforme(p)
    }
  }

  return {
    inspeccionUuid,
    formularioVersionId: formulario.id,
    datos,
    observaciones: opciones.observaciones,
    incumplimientoIds,
  }
}

// ── Construccion ──────────────────────────────────────────────────────

const INSPECTORA = 'ines.rodriguez'
const INSPECTOR_SUPLENTE = 'martin.silva'

export function construirSemilla(): DatosSemilla {
  const azar = crearAzar(20260420)

  const organismo: Organismo = {
    id: nuevoUuid(),
    nombre: 'Intendencia Demostración',
    tipo: 'intendencia',
  }

  const zonas: Zona[] = DEFINICIONES_ZONA.map((d) => ({
    id: nuevoUuid(),
    organismoId: organismo.id,
    nombre: d.nombre,
    contorno: contornoDe(d.recuadro),
  }))

  const tiposObjeto: TipoObjeto[] = DEFINICIONES_TIPO_OBJETO.map((d) => ({
    id: nuevoUuid(),
    organismoId: organismo.id,
    clave: d.clave,
    nombre: d.nombre,
    icono: d.icono,
  }))

  // ── Objetos inspeccionables ──
  const objetos: ObjetoInspeccionable[] = []
  const porClave: Record<string, ObjetoInspeccionable[]> = {}

  DEFINICIONES_TIPO_OBJETO.forEach((definicion, indiceTipo) => {
    const tipo = tiposObjeto[indiceTipo]!
    porClave[definicion.clave] = []

    for (let i = 0; i < definicion.cantidad; i++) {
      // Se rota entre zonas para que ningun tipo quede concentrado en una sola
      // y el filtro por zona del mapa tenga algo que mostrar siempre.
      const indiceZona = (i + indiceTipo) % DEFINICIONES_ZONA.length
      const zona = zonas[indiceZona]!
      const definicionZona = DEFINICIONES_ZONA[indiceZona]!
      const r = definicionZona.recuadro

      const ubicacion: Punto = {
        lat: Number(entre(azar, r.latMin, r.latMax).toFixed(6)),
        lon: Number(entre(azar, r.lonMin, r.lonMax).toFixed(6)),
      }
      const direccion = `${elegir(azar, definicionZona.calles)} ${Math.round(entre(azar, 120, 2480))}`

      const objeto: ObjetoInspeccionable = {
        id: nuevoUuid(),
        organismoId: organismo.id,
        tipoObjetoId: tipo.id,
        codigo: `${definicion.prefijo}-${String(i + 1).padStart(4, '0')}`,
        denominacion: denominacionDe(definicion.clave, i, direccion),
        ubicacion,
        direccion,
        zonaId: zona.id,
        atributos: atributosDe(definicion.clave, i, azar),
        // Los objetos existen desde antes que la aplicacion: vienen del padron.
        estado: i === definicion.cantidad - 1 && definicion.clave === 'contenedor'
          ? 'inactivo'
          : 'activo',
        creadoEn: fechaRelativa(Math.round(entre(azar, 120, 900)), 10),
      }

      objetos.push(objeto)
      porClave[definicion.clave]!.push(objeto)
    }
  })

  // ── Formularios y tipos de inspeccion ──
  const fvAlumbrado = formularioAlumbrado(fechaRelativa(400, 8))
  const fvObra = formularioObra(fechaRelativa(300, 8))
  const fvComercio = formularioComercio(fechaRelativa(150, 8))
  const formularioVersiones = [fvAlumbrado, fvObra, fvComercio]

  const idTipoObjeto = (clave: ClaveTipoObjeto): Uuid =>
    tiposObjeto.find((t) => t.clave === clave)!.id

  const tiAlumbrado: TipoInspeccion = {
    id: nuevoUuid(),
    organismoId: organismo.id,
    nombre: 'Mantenimiento de alumbrado',
    direccionResponsable: 'Dirección de Alumbrado Público',
    formularioVersionId: fvAlumbrado.id,
    plazoSubsanacionDias: 15,
    tipoObjetoIds: [idTipoObjeto('luminaria')],
  }
  const tiObra: TipoInspeccion = {
    id: nuevoUuid(),
    organismoId: organismo.id,
    nombre: 'Control de obra',
    direccionResponsable: 'Dirección de Obras',
    formularioVersionId: fvObra.id,
    plazoSubsanacionDias: 10,
    tipoObjetoIds: [idTipoObjeto('obra')],
  }
  const tiComercio: TipoInspeccion = {
    id: nuevoUuid(),
    organismoId: organismo.id,
    nombre: 'Habilitación de comercio',
    direccionResponsable: 'Dirección de Habilitaciones y Contralor',
    formularioVersionId: fvComercio.id,
    plazoSubsanacionDias: 20,
    // El mismo tramite alcanza a los paradores de playa.
    tipoObjetoIds: [idTipoObjeto('comercio'), idTipoObjeto('parador')],
  }
  const tiposInspeccion = [tiAlumbrado, tiObra, tiComercio]

  // ── Inspecciones ──
  const inspecciones: Inspeccion[] = []
  const respuestas: Respuesta[] = []
  const auditoria: EventoAuditoria[] = []

  const luminarias = porClave['luminaria']!
  const comercios = porClave['comercio']!
  const obras = porClave['obra']!
  const paradores = porClave['parador']!

  const anotar = (
    entidadId: string,
    accion: string,
    ocurridoEn: FechaHora,
    actor: string,
    detalle?: string,
  ): void => {
    auditoria.push({
      id: nuevoUuid(),
      organismoId: organismo.id,
      entidad: 'inspeccion',
      entidadId,
      accion,
      detalle,
      actor,
      ocurridoEn,
    })
  }

  interface Plan {
    tipo: TipoInspeccion
    formulario: FormularioVersion
    objeto: ObjetoInspeccionable
    estado: Inspeccion['estado']
    prioridad: Inspeccion['prioridad']
    origen: Inspeccion['origen']
    /** Dias hacia atras; negativo para el futuro. */
    dias: number
    hora: number
    minuto?: number
    asignadoA?: string
    resultado?: ResultadoInspeccion
    incumplimientos?: string[]
    observaciones?: string
    parcial?: boolean
  }

  const planes: Plan[] = [
    // Tareas de hoy: es lo que abre la aplicacion en la bandeja del inspector.
    { tipo: tiAlumbrado, formulario: fvAlumbrado, objeto: luminarias[0]!, estado: 'asignada', prioridad: 'media', origen: 'plan', dias: 0, hora: 8, minuto: 30, asignadoA: INSPECTORA },
    { tipo: tiAlumbrado, formulario: fvAlumbrado, objeto: luminarias[1]!, estado: 'asignada', prioridad: 'alta', origen: 'reclamo', dias: 0, hora: 9, minuto: 15, asignadoA: INSPECTORA },
    { tipo: tiAlumbrado, formulario: fvAlumbrado, objeto: luminarias[2]!, estado: 'asignada', prioridad: 'media', origen: 'plan', dias: 0, hora: 10, minuto: 0, asignadoA: INSPECTORA },
    { tipo: tiComercio, formulario: fvComercio, objeto: comercios[0]!, estado: 'asignada', prioridad: 'alta', origen: 'reclamo', dias: 0, hora: 11, minuto: 30, asignadoA: INSPECTORA },
    { tipo: tiComercio, formulario: fvComercio, objeto: paradores[0]!, estado: 'asignada', prioridad: 'media', origen: 'plan', dias: 0, hora: 14, minuto: 0, asignadoA: INSPECTORA },
    { tipo: tiObra, formulario: fvObra, objeto: obras[0]!, estado: 'asignada', prioridad: 'urgente', origen: 'oficio', dias: 0, hora: 16, minuto: 0, asignadoA: INSPECTORA },

    // Empezadas y sin cerrar: el formulario quedo a medio llenar.
    { tipo: tiAlumbrado, formulario: fvAlumbrado, objeto: luminarias[3]!, estado: 'en_campo', prioridad: 'media', origen: 'plan', dias: 0, hora: 7, minuto: 45, asignadoA: INSPECTORA, parcial: true },
    { tipo: tiComercio, formulario: fvComercio, objeto: comercios[1]!, estado: 'en_campo', prioridad: 'alta', origen: 'reclamo', dias: 0, hora: 12, minuto: 15, asignadoA: INSPECTORA, parcial: true },

    // Cerradas, repartidas en los ultimos 60 dias para que el tablero muestre
    // tendencia y no un unico pico.
    { tipo: tiAlumbrado, formulario: fvAlumbrado, objeto: luminarias[4]!, estado: 'cerrada', prioridad: 'alta', origen: 'reclamo', dias: 2, hora: 20, asignadoA: INSPECTORA, resultado: 'no_conforme', incumplimientos: ['alu-apagada', 'alu-optica'], observaciones: 'Se constata la luminaria apagada y la óptica suelta. Se notifica al encargado de cuadrilla.' },
    { tipo: tiComercio, formulario: fvComercio, objeto: comercios[2]!, estado: 'cerrada', prioridad: 'media', origen: 'plan', dias: 6, hora: 11, asignadoA: INSPECTORA, resultado: 'con_observaciones', incumplimientos: ['com-vereda'], observaciones: 'Mesas sobre la vereda sin permiso de ocupación. Se intima a retirarlas.' },
    { tipo: tiObra, formulario: fvObra, objeto: obras[1]!, estado: 'cerrada', prioridad: 'urgente', origen: 'oficio', dias: 11, hora: 9, asignadoA: INSPECTORA, resultado: 'no_conforme', incumplimientos: ['obr-permiso', 'obr-vallado'], observaciones: 'Obra sin permiso exhibido y con vallado incompleto sobre la vereda.' },
    { tipo: tiAlumbrado, formulario: fvAlumbrado, objeto: luminarias[5]!, estado: 'cerrada', prioridad: 'baja', origen: 'plan', dias: 17, hora: 21, asignadoA: INSPECTORA, resultado: 'conforme', incumplimientos: [] },
    { tipo: tiComercio, formulario: fvComercio, objeto: comercios[3]!, estado: 'cerrada', prioridad: 'alta', origen: 'reclamo', dias: 24, hora: 16, asignadoA: INSPECTORA, resultado: 'no_conforme', incumplimientos: ['com-habilitacion', 'com-extintor'], observaciones: 'Local funcionando sin habilitación vigente y con extintor vencido.' },
    { tipo: tiAlumbrado, formulario: fvAlumbrado, objeto: luminarias[6]!, estado: 'cerrada', prioridad: 'media', origen: 'plan', dias: 33, hora: 20, asignadoA: INSPECTOR_SUPLENTE, resultado: 'con_observaciones', incumplimientos: ['alu-follaje'], observaciones: 'Se solicita poda del arbolado que tapa la luminaria.' },
    { tipo: tiObra, formulario: fvObra, objeto: obras[2]!, estado: 'cerrada', prioridad: 'media', origen: 'plan', dias: 45, hora: 10, asignadoA: INSPECTORA, resultado: 'conforme', incumplimientos: [] },
    { tipo: tiComercio, formulario: fvComercio, objeto: paradores[1]!, estado: 'cerrada', prioridad: 'baja', origen: 'plan', dias: 57, hora: 15, asignadoA: INSPECTOR_SUPLENTE, resultado: 'conforme', incumplimientos: [] },

    // Programada y no ejecutada: quedo vencida.
    { tipo: tiObra, formulario: fvObra, objeto: obras[3]!, estado: 'vencida', prioridad: 'alta', origen: 'oficio', dias: 20, hora: 9, asignadoA: INSPECTORA },

    // Reclamo recien ingresado, todavia sin inspector asignado.
    { tipo: tiComercio, formulario: fvComercio, objeto: comercios[4]!, estado: 'pendiente', prioridad: 'media', origen: 'reclamo', dias: -2, hora: 10 },
  ]

  for (const plan of planes) {
    const momento = fechaRelativa(plan.dias, plan.hora, plan.minuto ?? 0)
    const cerrada = plan.estado === 'cerrada'
    // La orden se genera unos dias antes de la visita, como en la realidad.
    const creadaEn = sumarDias(momento, -3)

    const inspeccion: Inspeccion = {
      uuid: nuevoUuid(),
      organismoId: organismo.id,
      objetoId: plan.objeto.id,
      tipoInspeccionId: plan.tipo.id,
      formularioVersionId: plan.formulario.id,
      origen: plan.origen,
      estado: plan.estado,
      prioridad: plan.prioridad,
      asignadoA: plan.asignadoA,
      programadaPara: momento,
      ejecutadaEn: cerrada ? momento : undefined,
      ubicacionEjecucion: cerrada
        ? {
            lat: Number((plan.objeto.ubicacion.lat + entre(azar, -0.00012, 0.00012)).toFixed(6)),
            lon: Number((plan.objeto.ubicacion.lon + entre(azar, -0.00012, 0.00012)).toFixed(6)),
            precision: Math.round(entre(azar, 4, 18)),
          }
        : undefined,
      resultado: plan.resultado,
      creadaEn,
      actualizadaEn: cerrada ? momento : creadaEn,
    }
    inspecciones.push(inspeccion)

    if (cerrada || plan.parcial) {
      respuestas.push(
        armarRespuesta(inspeccion.uuid, plan.formulario, plan.incumplimientos ?? [], {
          parcial: plan.parcial,
          observaciones: plan.observaciones,
        }),
      )
    }

    const actor = plan.asignadoA ?? 'sistema'
    anotar(inspeccion.uuid, 'creada', creadaEn, 'sistema', `Origen: ${plan.origen}`)
    if (plan.asignadoA) {
      anotar(inspeccion.uuid, 'asignada', creadaEn, 'planificacion', `Asignada a ${plan.asignadoA}`)
    }
    if (cerrada) {
      anotar(
        inspeccion.uuid,
        'cerrada',
        momento,
        actor,
        `Resultado: ${plan.resultado} · ${(plan.incumplimientos ?? []).length} incumplimiento(s)`,
      )
    }
    if (plan.estado === 'vencida') {
      anotar(inspeccion.uuid, 'vencida', momento, 'sistema', 'Venció el plazo sin ejecución')
    }
  }

  return {
    organismo,
    zonas,
    tiposObjeto,
    objetos,
    formularioVersiones,
    tiposInspeccion,
    inspecciones,
    respuestas,
    auditoria,
  }
}
