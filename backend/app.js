// app.js — configuración de la aplicación Express.
// Separado de server.js para poder importar `app` en los tests sin levantar el servidor.
import express from 'express'

const app = express()

// Middleware para parsear JSON en el body de las peticiones.
app.use(express.json())

// Health-check: ruta mínima para verificar que el servidor responde.
// Útil para monitorización y para confirmar que el setup funciona antes de añadir features.
app.get('/api/v1/health', (req, res) => {
  res.json({ estado: 'ok', timestamp: new Date().toISOString() })
})

export default app
