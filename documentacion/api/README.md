<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: CC-BY-4.0
-->

# API de Tero

[`openapi.yaml`](openapi.yaml) es el contrato entre la aplicación de campo y el
backend, y también el punto de integración para cualquier otro sistema del
gobierno local. Está escrito en OpenAPI 3.1.

**La especificación se publica bajo Apache-2.0**, a diferencia del resto del
proyecto, que es AGPL. Es deliberado: quien se integre con Tero no tiene por qué
quedar alcanzado por el copyleft en su propio código.

## Estado

Borrador. Los caminos cubren los siete módulos del alcance del piloto —territorio,
catálogo de inspecciones, planificación, inspección en campo, actas, trazabilidad
e indicadores— más la sincronización que hace posible el trabajo sin señal.

El canal ciudadano (`/reclamos`) está especificado pero **es posterior al
piloto**: figura acá porque la aplicación de campo ya lo implementa contra el
almacenamiento local, no porque forme parte del compromiso del MVP.

Estable en forma, no en detalle: pueden agregarse campos, no cambiar de
significado los que ya están. Ver la sección «Versionado» dentro del propio
archivo.

## Las decisiones que no se van a mover

Están explicadas en la descripción de la especificación, y son las que conviene
mirar primero si el objetivo es integrarse:

| | |
|---|---|
| **Idempotencia** | El identificador lo genera el origen. Reenviar no duplica: devuelve lo que ya existe con `200` en vez de `201` |
| **Territorio** | Geometrías en GeoJSON, WGS 84 (EPSG:4326), `[lon, lat]` |
| **Lecturas de GPS** | Separadas de las geometrías, con la precisión que informó el dispositivo |
| **Multi-organismo** | El organismo sale del token. Ningún camino acepta `organismoId` |
| **Inmutabilidad** | Una versión de formulario publicada no se modifica jamás |

## Autenticación

OpenID Connect contra Keycloak, realm `tero`. El token de acceso es un JWT que
viaja en `Authorization: Bearer`. Del token se leen el organismo (`organismo_id`)
y los roles (`realm_access.roles`): `tero-inspector`, `tero-supervisor`,
`tero-administrador`, `tero-lectura`.

Cada operación declara su rol mínimo en la descripción.

Dos caminos son públicos y no llevan token, los dos del canal ciudadano: el alta
de un reclamo y su consulta por código.

## Cómo se trabaja con el archivo

Validarlo:

```bash
npx @redocly/cli@2 lint documentacion/api/openapi.yaml
```

Corre igual en cada cambio, dentro del workflow `Calidad`: si la especificación
deja de ser válida, se entera quien la rompe y no quien la consume.

Leerlo con formato:

```bash
npx @redocly/cli@2 preview-docs documentacion/api/openapi.yaml
```

Generar un cliente —cualquier lenguaje que soporte OpenAPI 3.1 sirve:

```bash
npx @openapitools/openapi-generator-cli generate \
  -i documentacion/api/openapi.yaml -g typescript-fetch -o /tmp/cliente-tero
```

## Cómo encaja con el resto

La aplicación de campo no habla con la API directamente: habla con las
interfaces de [`app-campo/src/datos/contratos.ts`](../../app-campo/src/datos/contratos.ts),
que hoy tienen una implementación local sobre el dispositivo y mañana tendrán
otra sobre HTTP. Los nombres de los campos de esta especificación coinciden uno a
uno con los de [`app-campo/src/dominio/tipos.ts`](../../app-campo/src/dominio/tipos.ts)
para que esa segunda implementación no tenga que traducir nada.

Las tablas y columnas de la base, en cambio, van en `snake_case` — ver
[modelo de datos](../modelo-de-datos.md). La traducción se paga una vez, en el
backend, y no en cada integración.
