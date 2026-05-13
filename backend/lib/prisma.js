// backend/lib/prisma.js

import { PrismaClient } from "@prisma/client";

// Singleton: una única instancia de PrismaClient para toda la app.
// Importa SIEMPRE desde aquí. No hagas `new PrismaClient()` en otros archivos
// o multiplicarás conexiones y agotarás el pool de Postgres.
const prisma = new PrismaClient();

export default prisma;
