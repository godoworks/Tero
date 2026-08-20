-- SPDX-FileCopyrightText: 2026 GoDoWorks
-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Se ejecuta una sola vez, cuando el volumen de la base se crea vacío.

-- Extensiones territoriales sobre la base de Tero.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Base propia para el servicio de identidad.
CREATE DATABASE keycloak OWNER CURRENT_USER;
