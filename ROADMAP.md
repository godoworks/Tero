<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: CC-BY-4.0
-->

# Roadmap

Tero se construye por rebanadas verticales: cada etapa deja algo que un inspector
puede usar en la calle, no una capa técnica a la espera de la siguiente.

## Estado

| | |
|---|---|
| Etapa | Andamiaje del proyecto |
| Próximo hito | Rebanada vertical demostrable |
| Contexto | Postulación al piloto de código abierto de GovTech Connect · CIIAR Uruguay |

## Alcance del piloto (MVP)

Estos siete módulos son el compromiso del piloto. Todo lo demás es posterior.

| Módulo | Qué resuelve |
|---|---|
| **Registro territorial** | Objetos inspeccionables georreferenciados: comercios, obras, luminarias, contenedores, señalización, paradores |
| **Catálogo de inspecciones** | Tipos de inspección y checklists versionados, definidos por cada dirección sin programar |
| **Planificación y asignación** | Zonas, cuadrillas, calendario y prioridad |
| **Inspección en campo** | Desde el navegador del celular, con o sin conexión: checklist, fotos con ubicación y hora, firma en pantalla |
| **Acta digital** | PDF numerado, faltas constatadas, plazo de subsanación y notificación |
| **Trazabilidad y auditoría** | Historial inmutable por objeto, con adjuntos y estados |
| **Tablero de indicadores** | Cumplimiento, tiempos de respuesta, cobertura por zona y mapa de calor |

## Después del piloto

- **Canal ciudadano.** Reporte web georreferenciado y consulta pública del estado
  del reclamo. Alternativa: integración con FixMyStreet, ya probado en Uruguay
  como *porMiBarrio*.
- **Interoperabilidad profunda.** Integración con expediente electrónico, GIS y
  padrón de cada gobierno local.
- **Identidad estatal.** Autenticación con ID Uruguay vía OpenID Connect.
- **Datos abiertos.** Publicación automática de indicadores no sensibles en CKAN.
- **Multi-organismo en producción.** Varias intendencias sobre una misma
  instalación, para que las más chicas puedan compartir infraestructura.
- **Candidatura a Bien Público Digital** ante la Digital Public Goods Alliance.

## Lo que Tero no va a ser

Decirlo evita discusiones repetidas:

- **No es un sistema de expediente electrónico.** Se integra con el que ya tenga
  el gobierno local.
- **No es un ERP municipal.** Hace inspecciones, y las hace bien.
- **No va a tener funciones que dependan de servicios propietarios.** Si algo solo
  funciona pagándole a un proveedor, no entra al núcleo.

## Etapas de construcción

| Etapa | Entrega | Por qué en este orden |
|---|---|---|
| 1 | Registro territorial y mapa | Sin objetos no hay nada que inspeccionar |
| 2 | Formularios versionados, trabajo sin conexión y sincronización | Es la pieza más difícil y la que define el producto: se ataca temprano |
| 3 | Acta digital, plazos y reinspección | Es el momento en que la intendencia deja de imprimir |
| 4 | Tablero de indicadores | Es lo que mide el impacto y lo que mira la dirección |
| 5 | Documentación, manuales y guía de replicación | Es lo que permite que otra intendencia lo adopte sin nosotros |
