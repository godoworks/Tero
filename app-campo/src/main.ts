// SPDX-FileCopyrightText: 2026 GoDoWorks
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createApp } from 'vue'
import App from './App.vue'
import { enrutador } from './rutas'
import { almacen } from './datos/almacen'
import './estilos/base.css'

async function arrancar() {
  // Los datos de demostracion se cargan una sola vez, la primera vez que la
  // aplicacion se abre en este dispositivo.
  await almacen.prepararDatosIniciales()

  createApp(App).use(enrutador).mount('#app')
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
