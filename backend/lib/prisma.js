// Cliente Prisma como singleton: una sola instancia para toda la app.
// Crear múltiples PrismaClient agota el pool de conexiones de PostgreSQL.
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export default prisma
