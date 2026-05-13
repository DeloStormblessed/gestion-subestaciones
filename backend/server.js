// server.js — entry point del servidor.
// Carga variables de entorno desde .env y arranca Express en el puerto configurado.
import 'dotenv/config'
import app from './app.js'

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`)
})
