<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: CC-BY-4.0
-->

# Cómo adopta Tero otra intendencia

Este documento existe porque el objetivo de Tero no es funcionar en una ciudad.
Es funcionar en la segunda sin empezar de nuevo.

## Lo que no hay que hacer

**No hace falta un fork.** Tero es multi-organismo desde el diseño: cada gobierno
local es un `organismo` con sus zonas, sus tipos de objeto, sus formularios y sus
usuarios. Dos intendencias pueden compartir una instalación —útil para gobiernos
chicos que no quieren sostener infraestructura— o tener una cada una.

Si terminás necesitando modificar el código para adaptarlo a tu realidad, **eso es
un issue del proyecto**, no una tarea tuya: significa que algo que debería ser
configuración está escrito a mano.

## Los cuatro pasos

### 1. Levantar el entorno

Ver [instalación](instalacion.md). Con Docker, es un comando.

### 2. Cargar el territorio

Lo que se inspecciona tiene que existir antes en el sistema. Se importa desde CSV
o GeoJSON: comercios habilitados, obras, luminarias, contenedores, señalización.

Si el gobierno local ya tiene un GIS, la importación sale de ahí. Si no tiene nada,
se puede arrancar con una sola categoría —la que más duele— y sumar el resto
después. **No hace falta tener todo el territorio cargado para empezar a usarlo.**

### 3. Definir los formularios

Cada dirección arma sus propios checklists sin programar. Un formulario tiene sus
preguntas, sus faltas posibles y sus plazos de subsanación.

Los formularios se pueden exportar e importar entre instalaciones: si otra
intendencia ya armó el checklist de inspección de obra, se toma como punto de
partida en vez de escribirlo de cero. **Ésta es la parte que más trabajo ahorra
entre gobiernos, y es la razón principal de que Tero sea abierto.**

### 4. Cargar zonas y personas

Las zonas son polígonos sobre el mapa. Cada inspector se asocia a las suyas.

## Qué se comparte entre gobiernos

| Se comparte | No se comparte |
|---|---|
| Formularios y checklists | Datos de personas y comercios |
| Catálogos de faltas y plazos | Actas y expedientes |
| Tipos de objeto inspeccionable | Usuarios y credenciales |
| Manuales y materiales de capacitación | Indicadores nominales |
| Mejoras al código | |

La separación importa: lo que ahorra trabajo entre intendencias es el
**conocimiento del proceso**, no los datos de los vecinos, que no salen nunca de
la instalación de cada gobierno.

## Independencia

Si tu intendencia decide seguir sin quien se lo implementó:

- Los datos están en PostgreSQL, exportables a CSV y GeoJSON en cualquier momento.
- Las fotos y actas son archivos comunes en un almacenamiento estándar.
- El código está publicado bajo AGPL: cualquier proveedor puede tomarlo y seguir.
- No hay claves de licencia, activación ni servicios propietarios que apagar.

Esto no es un gesto de buena voluntad: está en la [gobernanza](../GOVERNANCE.md)
y cualquier cosa que lo contradiga se considera un error del proyecto.
