<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: CC-BY-4.0
-->

# Modelo de datos

Las tablas y columnas se nombran en español y en `snake_case`. Todo cuelga de un
`organismo`, que es lo que permite que una instalación sirva a más de un gobierno
local sin mezclar datos.

## Dos decisiones que sostienen todo lo demás

Antes de las tablas, conviene entender por qué el modelo tiene la forma que tiene.

### Los formularios son inmutables

Un `formulario_version` **no se edita nunca**: se crea una versión nueva. Cada
inspección guarda contra qué versión se completó.

La razón no es técnica sino jurídica. Un acta emitida hace ocho meses tiene que
poder reconstruirse tal como se emitió, con las preguntas y los plazos que estaban
vigentes ese día. Si los formularios se editaran en el lugar, el histórico entero
perdería validez ante un recurso administrativo. Es más incómodo de programar y no
es negociable.

### La sincronización se resuelve por idempotencia

El trabajo sin conexión no se resuelve con transacciones distribuidas. Se resuelve
así: el celular genera un `uuid` para cada inspección y lo reenvía hasta recibir
confirmación; el servidor descarta lo que ya tiene por ese `uuid`.

Funciona porque **cada inspección tiene un único dueño en campo**. No hay dos
inspectores completando la misma inspección al mismo tiempo, así que no existe el
conflicto de escritura concurrente que haría falta resolver. Reconocer eso temprano
simplifica el problema entero.

## Territorio

### `organismo`
El gobierno local. Raíz de todos los datos.

| Campo | Notas |
|---|---|
| `id` | |
| `nombre` | «Intendencia de …», «Municipio de …» |
| `tipo` | `intendencia` \| `municipio` |
| `configuracion` | `jsonb`: preferencias, numeración de actas, marca |

### `zona`
División operativa de inspección.

| Campo | Notas |
|---|---|
| `organismo_id` | |
| `nombre` | |
| `geom` | `POLYGON` — PostGIS |

### `tipo_objeto`
Qué clase de cosas se inspeccionan: luminaria, contenedor, obra, comercio,
señalización, parador. Cada organismo define los suyos.

### `objeto_inspeccionable`
La cosa concreta que se inspecciona. Es el centro del modelo.

| Campo | Notas |
|---|---|
| `organismo_id`, `tipo_objeto_id` | |
| `codigo` | Padrón, número de habilitación o identificador propio |
| `denominacion` | |
| `geom` | `POINT` o `POLYGON` |
| `direccion` | |
| `atributos` | `jsonb`: lo propio de cada tipo, sin migrar la tabla |
| `estado` | `activo` \| `inactivo` \| `baja` |

> `atributos` en `jsonb` es deliberado: una luminaria tiene potencia y una obra
> tiene número de permiso, y no tiene sentido una tabla por cada tipo. Lo que sí
> va en columnas propias es todo lo que se consulta o se filtra seguido.

## Inspecciones

### `formulario` y `formulario_version`
El checklist de una dirección. `formulario` es la identidad; `formulario_version`
es la definición concreta —preguntas, tipos de respuesta, faltas posibles— y **es
inmutable**.

### `tipo_inspeccion`
Qué inspección se hace y con qué formulario.

| Campo | Notas |
|---|---|
| `formulario_version_id` | La versión vigente |
| `direccion_responsable` | |
| `plazo_subsanacion_dias` | Valor por defecto, la falta puede pisarlo |

### `inspeccion`

| Campo | Notas |
|---|---|
| `uuid` | Generado en el celular; clave de la sincronización |
| `objeto_id`, `tipo_inspeccion_id` | |
| `origen` | `plan` \| `reclamo` \| `oficio` |
| `estado` | `pendiente` \| `asignada` \| `en_campo` \| `cerrada` \| `vencida` |
| `prioridad` | |
| `asignado_a` | `usuario_id` |
| `programada_para`, `ejecutada_en` | |
| `geom_ejecucion` | Dónde estaba el inspector al cerrarla |
| `resultado` | `conforme` \| `con_observaciones` \| `no_conforme` |
| `padre_id` | Si es una reinspección, apunta a la original |

### `respuesta`
Lo completado en el checklist: `inspeccion_id`, `formulario_version_id` y los
datos en `jsonb`.

### `evidencia`

| Campo | Notas |
|---|---|
| `inspeccion_id`, `tipo` | `foto` \| `video` \| `audio` |
| `ruta` | En el almacenamiento de archivos |
| `geom`, `tomada_en` | Dónde y cuándo se tomó, no cuándo se subió |
| `hash` | `sha256`, para poder probar que no se alteró |

### `firma`
`inspeccion_id`, `firmante`, `documento`, `imagen`, `firmado_en`.

### `incumplimiento`
Catálogo de faltas del organismo, con su plazo y su encuadre normativo, vinculado
a la inspección que las constató.

### `acta`

| Campo | Notas |
|---|---|
| `inspeccion_id` | |
| `numero` | Correlativo por organismo |
| `pdf` | Ruta del archivo |
| `emitida_en`, `plazo_subsanacion`, `notificada_en` | |

## Trazabilidad

### `evento_auditoria`
Tabla de solo agregado: quién, qué, cuándo y desde dónde. No se actualiza ni se
borra. Es lo que permite reconstruir qué pasó cuando alguien lo discute.

## Fase posterior

### `reclamo`
El canal ciudadano. Entra un reporte georreferenciado y dispara una inspección,
que después devuelve el estado al vecino. Ver [ROADMAP](../ROADMAP.md).

## Índices que importan desde el principio

- `objeto_inspeccionable.geom` — índice GiST. Sin esto, cualquier consulta por
  zona recorre la tabla entera.
- `inspeccion (organismo_id, estado, asignado_a)` — la lista del día del
  inspector es la consulta más frecuente del sistema.
- `inspeccion (organismo_id, plazo_vencimiento)` — la busca el proceso que agenda
  las reinspecciones, y corre seguido.
- `inspeccion.uuid` — único. Es lo que hace idempotente la sincronización.
- `evento_auditoria (organismo_id, creado_en)` — la tabla que más crece; sin
  índice por fecha, el historial se vuelve impagable.
