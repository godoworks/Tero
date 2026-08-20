<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: CC-BY-4.0
-->

# Tero

**Plataforma abierta de inspecciones municipales.**
*El tero avisa.*

[![Licencia: AGPL-3.0-or-later](https://img.shields.io/badge/licencia-AGPL--3.0--or--later-C6362C)](LICENSE)
[![REUSE](https://img.shields.io/badge/REUSE-conforme-2F5D4E)](https://reuse.software/)

Tero digitaliza el ciclo completo de una inspección municipal: el objeto del
territorio, la recorrida, el acta con su plazo, la reinspección y los indicadores.
Funciona desde el navegador del celular, **también sin señal**.

📄 **[Ver la presentación del proyecto](https://godoworks.github.io/Tero/)**

## Por qué existe

En casi toda intendencia la recorrida se anota en papel, el reclamo del vecino se
pierde entre direcciones y no hay forma de responder con datos cuántas inspecciones
se hicieron ni en cuánto tiempo. Las herramientas que resuelven eso son caras,
cerradas, y atan al gobierno local al proveedor que se las vendió.

Tero es la otra opción: **código abierto, sin costo de licencias y sin dependencia
del implementador**. Si mañana la intendencia quiere seguir sola o con otro
proveedor, el sistema sigue funcionando.

## Qué hace

- **Registro territorial** — comercios, obras, luminarias, contenedores,
  señalización y paradores, cada uno con su ficha, su ubicación y su historia.
- **Checklists por dirección** — cada área define los suyos sin programar, con
  versionado, porque un acta vieja tiene que poder reconstruirse tal como se emitió.
- **Inspección en campo** — desde el navegador del celular, con o sin conexión:
  checklist, fotos con ubicación y hora, firma en pantalla.
- **Acta digital** — PDF numerado, faltas constatadas, plazo de subsanación y
  notificación.
- **Reinspección automática** — vencido el plazo, el caso vuelve a la lista solo.
- **Trazabilidad** — historial inmutable por objeto, auditable.
- **Indicadores** — cumplimiento, tiempos de respuesta, cobertura por zona.

Ver el [ROADMAP](ROADMAP.md) para el alcance del piloto y lo que viene después.

## Empezar

**La aplicación de campo** corre sin ninguna instalación previa más que Node:

```bash
git clone https://github.com/godoworks/Tero.git
cd Tero/app-campo
npm install
npm run dev
```

Se abre en el navegador y funciona sin conexión: los datos quedan en el
dispositivo. Para probarlo de verdad, abrila en el celular y apagá los datos.

**La infraestructura del backend**, para cuando exista la API:

```bash
cp .env.example .env
docker compose up -d
```

Detalle y resolución de problemas en
[`documentacion/instalacion.md`](documentacion/instalacion.md).

> **Estado del proyecto.** La aplicación de campo está en construcción y ya se
> puede usar. El backend está definido —modelo de datos, especificación de API e
> infraestructura— pero todavía no implementado: hoy la aplicación guarda todo en
> el dispositivo. Ver [ROADMAP](ROADMAP.md).

## Cómo está organizado

| Carpeta | Qué hay |
|---|---|
| `app-campo/` | La aplicación de campo: lo que usa el inspector en la calle |
| `docs/` | La presentación del proyecto, publicada en GitHub Pages |
| `documentacion/` | Modelo de datos, instalación, replicación y API |
| `docker/` | Configuración de los contenedores |

Dentro de `app-campo/src` hay dos archivos que conviene leer antes que ningún
otro, porque son el contrato del que dependen todos los demás:
`dominio/tipos.ts` y `datos/contratos.ts`.

## Cómo está hecho

Todo el stack es de código abierto, sin ninguna pieza propietaria. No es una
postura estética: una sola dependencia cerrada haría que Tero dejara de ser
adoptable por un gobierno que necesita auditar lo que usa.

| Capa | Elección | Licencia |
|---|---|---|
| Base de datos | PostgreSQL + PostGIS | PostgreSQL / GPL-2.0 |
| Caché y cola | **Valkey** — no Redis | BSD-3-Clause |
| Archivos | MinIO | AGPL-3.0 |
| Identidad | Keycloak (OpenID Connect) | Apache-2.0 |
| Mapas | Leaflet + OpenStreetMap | BSD-2-Clause / ODbL |
| Backend | PHP 8.3 + Laravel | MIT |
| Aplicación de campo | Vue 3 + Vite, instalable en el celular | MIT |

## Documentación

| | |
|---|---|
| [Instalación](documentacion/instalacion.md) | Levantar el entorno |
| [Modelo de datos](documentacion/modelo-de-datos.md) | Las tablas y las dos decisiones que sostienen el resto |
| [Replicación](documentacion/replicacion.md) | Cómo lo adopta otra intendencia |
| [API](documentacion/api/openapi.yaml) | Especificación OpenAPI (borrador) |

## Contribuir

Se contribuye con [DCO](CONTRIBUTING.md) — `git commit -s` —, no con CLA. El
proyecto trabaja en español: issues, commits y documentación.

Leé [CONTRIBUTING.md](CONTRIBUTING.md), el [código de conducta](CODE_OF_CONDUCT.md)
y la [gobernanza](GOVERNANCE.md). Para reportar un problema de seguridad, ver
[SECURITY.md](SECURITY.md).

## Licencia

- **Código:** [AGPL-3.0-or-later](LICENSE)
- **Documentación:** CC BY 4.0
- **Especificación de la API:** Apache-2.0

La AGPL significa que cualquier gobierno puede usar, estudiar, modificar y
compartir Tero sin costo ni obligaciones. Y que **quien lo ofrezca como servicio a
terceros queda obligado a publicar sus mejoras**: la herramienta no puede volverse
privada, ni siquiera por quien la escribió.

## Contexto

Tero se presenta al piloto de código abierto de **GovTech Connect · CIIAR Uruguay**,
programa financiado por BID Lab y ejecutado por la Red de Innovación Local, que
reúne a trece gobiernos locales uruguayos.

---

Desarrollado por [GoDoWorks](https://godoworks.com) · Uruguay
