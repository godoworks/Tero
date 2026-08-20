<!--
SPDX-FileCopyrightText: 2026 GoDoWorks
SPDX-License-Identifier: CC-BY-4.0
-->

# Gobernanza

## Quién mantiene Tero hoy

**GoDoWorks** inició el proyecto y hoy lo mantiene. Eso significa que revisa e
integra los cambios, decide qué entra en cada versión y sostiene la infraestructura
del repositorio.

Esto es el punto de partida, no el punto de llegada.

## Hacia dónde va

El objetivo declarado es que Tero deje de depender de una sola empresa. El camino
previsto:

1. **Etapa actual — mantenimiento único.** GoDoWorks mantiene, cualquiera contribuye.
2. **Etapa dos — mantenimiento compartido.** Cuando un gobierno local o una
   organización sostenga contribuciones en el tiempo, se le ofrece un lugar en el
   equipo de mantenimiento, con voz y voto sobre el roadmap.
3. **Etapa tres — gobernanza de la coalición.** Si Tero se adopta en varias
   intendencias, el objetivo es un comité con representación de los gobiernos que
   lo usan, porque son quienes cargan con las consecuencias de cada decisión.

## Cómo se toman las decisiones

- Las decisiones técnicas se discuten **en issues públicos**, no en privado.
- Se busca consenso. Si no lo hay, decide el equipo de mantenimiento y **deja
  escrito el porqué** en el issue.
- Los cambios que afecten el modelo de datos, la licencia o la compatibilidad de
  las instalaciones existentes requieren un issue de propuesta y un plazo mínimo de
  dos semanas de discusión antes de integrarse.

## Titularidad y licencia

Las contribuciones se aportan bajo [DCO](CONTRIBUTING.md), conservando cada persona
la autoría de su trabajo, licenciado al proyecto bajo AGPL-3.0-or-later.

**La licencia no se puede volver más restrictiva.** Ningún cambio de gobernanza
puede cerrar el código ya publicado: la AGPL es irrevocable sobre las versiones
liberadas. Cualquier gobierno que hoy use Tero puede seguir usándolo para siempre,
pase lo que pase con este repositorio o con GoDoWorks.

## Independencia del implementador

Tero se diseña para que un gobierno local pueda operarlo sin la empresa que lo
implementó. Se considera **un error del proyecto**, reportable como issue, cualquier
cosa que genere dependencia: funciones que requieran servicios propietarios de un
proveedor, formatos de exportación cerrados, o documentación insuficiente para
operar el sistema con equipo propio.
