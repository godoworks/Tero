// SPDX-FileCopyrightText: 2026 GoDoWorks
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createApp } from 'vue'
import App from './App.vue'
import { enrutador } from './rutas'
import { almacen } from './datos/almacen'
import { revisarVencimientos } from './servicios/reinspeccion'
import './estilos/base.css'

async function arrancar() {
  // Los datos de demostracion se cargan una sola vez, la primera vez que la
  // aplicacion se abre en este dispositivo.
  await almacen.prepararDatosIniciales()

  createApp(App).use(enrutador).mount('#app')

  // Las reinspecciones se generan al abrir la aplicacion, despues de montar:
  // el inspector no tiene que esperar a que esto termine para ver su lista.
  // Es idempotente, asi que correrlo en cada arranque no duplica nada.
  revisarVencimientos()
    .then((resumen) => {
      if (resumen.creadas > 0) {
        console.info(`Tero: se agendaron ${resumen.creadas} reinspecciones por plazo vencido`)
      }
    })
    .catch((error) => {
      // Que falle no puede dejar al inspector sin aplicacion: sus tareas del
      // dia ya estan en pantalla.
      console.error('Tero: no se pudieron revisar los plazos vencidos', error)
    })
}

arrancar().catch((error) => {
  console.error('No se pudo iniciar Tero', error)
  const destino = document.getElementById('app')
  if (destino) {
    destino.innerHTML =
      '<div style="padding:2rem;font-family:sans-serif">' +
      '<h1>No se pudo iniciar</h1>' +
      '<p>Recargá la página. Si sigue fallando, borrá los datos del sitio.</p>' +
      '</div>'
  }
})
