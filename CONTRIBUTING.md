<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: CC-BY-4.0
-->

# Cómo contribuir a Tero

Gracias por el interés. Tero se construye para que cualquier gobierno local pueda
usarlo, adaptarlo y mantenerlo, así que toda contribución que empuje en esa
dirección es bienvenida: código, documentación, traducciones, reportes de errores
o simplemente contar cómo se usa en tu intendencia.

**El proyecto trabaja en español.** Issues, commits, comentarios de código y
documentación se escriben en español. Es un bien público uruguayo antes que un
proyecto para desarrolladores anglosajones.

## Antes de escribir código

1. **Abrí un issue primero** si el cambio es más que un arreglo menor. Sirve para
   acordar el enfoque antes de que alguien invierta horas.
2. **Mirá el [ROADMAP](ROADMAP.md)**. Si lo que querés hacer ya está previsto para
   otra etapa, decilo en el issue: quizá se pueda adelantar.
3. **Revisá el modelo de datos** en [`documentacion/modelo-de-datos.md`](documentacion/modelo-de-datos.md).
   Hay dos decisiones que no se negocian sin discusión previa: los formularios son
   inmutables y versionados, y la sincronización se resuelve por idempotencia. Ambas
   sostienen la validez jurídica del acta y el trabajo sin conexión.

## El certificado de origen (DCO)

Tero **no usa un CLA**. Usa el
[Developer Certificate of Origin](https://developercertificate.org/): al firmar cada
commit declarás que tenés derecho a aportar ese código bajo la licencia del proyecto.

Firmar es agregar una línea al mensaje del commit, y `git` lo hace solo:

```bash
git commit -s -m "Agrega validación de plazos de subsanación"
```

Eso deja al pie del mensaje:

```
Signed-off-by: Nombre Apellido <correo@ejemplo.com>
```

Un commit sin `Signed-off-by` no se puede integrar. Si te olvidaste:

```bash
git commit --amend -s --no-edit
```

## Licencia de lo que aportás

- **Código:** AGPL-3.0-or-later
- **Documentación:** CC BY 4.0

Todo archivo nuevo lleva su cabecera SPDX desde el primer commit. Para un archivo
de código:

```php
// SPDX-FileCopyrightText: 2026 Nombre Apellido
// SPDX-License-Identifier: AGPL-3.0-or-later
```

`reuse lint` corre en cada pull request y falla si falta la cabecera. No es
burocracia: una licencia ambigua es motivo de descarte cuando un gobierno evalúa
adoptar la herramienta.

## Reglas del repositorio

- **Ninguna dependencia con licencia no aprobada por la OSI.** En particular: Redis
  (desde 2024 es RSALv2/SSPL) — usamos Valkey; nada de Google Maps o Mapbox — usamos
  MapLibre sobre OpenStreetMap; nada de servicios cerrados de push o SMS.
- **Ninguna función de inteligencia artificial sobre APIs propietarias** dentro del
  núcleo. Si aporta valor, va como complemento externo y opcional, o corre sobre
  modelos de pesos abiertos.
- **Ningún dato real** de una intendencia, un vecino o un cliente entra al
  repositorio. Los datos de demostración son sintéticos.
- **Ninguna clave, credencial ni endpoint interno** en el código ni en el historial.

## Estilo

- PHP: PSR-12. Clases en `PascalCase`, métodos y variables en `camelCase`.
- Base de datos: tablas y columnas en `snake_case`, en español.
- Commits: una línea de resumen en imperativo, y si hace falta, un cuerpo que
  explique **por qué**, no qué. El diff ya dice qué.

## Reportar un error

Abrí un issue contando qué esperabas, qué pasó y cómo reproducirlo. Si es un
problema de seguridad, **no abras un issue público**: seguí lo que dice
[SECURITY.md](SECURITY.md).
