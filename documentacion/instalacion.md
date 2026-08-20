<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: CC-BY-4.0
-->

# Instalación

Tero se instala con Docker. No hace falta instalar PHP, PostgreSQL ni nada más en
la máquina.

## Requisitos

- Docker con Compose v2 (`docker compose version` tiene que responder)
- 4 GB de memoria disponibles
- Puertos libres: 5432, 6379, 8080, 9000 y 9001 (se pueden cambiar en el `.env`)

## Levantar el entorno

```bash
git clone https://github.com/godoworks/Tero.git
cd Tero
cp .env.example .env
docker compose up -d
```

La primera vez tarda unos minutos porque descarga las imágenes. Para ver cómo va:

```bash
docker compose ps
docker compose logs -f
```

## Qué queda funcionando

| Servicio | Para qué | Dónde |
|---|---|---|
| Base de datos | Datos y territorio (PostGIS) | `localhost:5432` |
| Caché y cola | Trabajos en segundo plano (Valkey) | `localhost:6379` |
| Archivos | Fotos, firmas y actas (MinIO) | consola en `localhost:9001` |
| Identidad | Usuarios y permisos (Keycloak) | `localhost:8080` |

Las credenciales de desarrollo están en el `.env.example`. **Son para desarrollo
local y no sirven para producción**: en una instalación real hay que cambiarlas
todas y no exponer estos puertos a internet.

## Estado actual

> El servicio de la aplicación todavía no está en el `docker-compose.yml`: se
> agrega junto con el esqueleto del backend. Hoy este entorno levanta la
> infraestructura sobre la que se construye. Ver [ROADMAP](../ROADMAP.md).

## Apagar y limpiar

```bash
docker compose down          # detiene los servicios, conserva los datos
docker compose down -v       # borra también los datos: se empieza de cero
```

## Problemas frecuentes

**Un puerto está ocupado.** Cambiá el puerto correspondiente en el `.env` y volvé
a levantar. No hace falta tocar el `docker-compose.yml`.

**La identidad no arranca.** Keycloak espera a que la base esté lista y crea su
propia base de datos en el primer arranque. Si el volumen quedó a medio crear de
un intento anterior, `docker compose down -v` y volver a empezar lo resuelve.

**PostGIS no aparece.** Las extensiones se crean una sola vez, cuando el volumen
de la base nace vacío. Si la base ya existía sin PostGIS, hay que recrear el
volumen o crear la extensión a mano.
