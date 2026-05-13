// backend/features/usuarios/usuarios.schema.js

import { z } from "zod";

// Cambio de rol: solo aceptamos los tres valores definidos en el enum Rol del schema.prisma.
// Si añadimos un rol nuevo en BD, también hay que añadirlo aquí (sin un acoplamiento
// más sofisticado tipo importar el enum desde Prisma, que para este tamaño es overkill).
export const esquemaCambioRol = z.object({
  rol: z.enum(["OPERARIO", "TECNICO", "ADMIN"], {
    errorMap: () => ({
      message: "Rol inválido. Debe ser OPERARIO, TECNICO o ADMIN",
    }),
  }),
});

// Activación/desactivación: campo booleano explícito.
// No usamos "toggle" porque sería una operación dependiente del estado previo,
// menos predecible para el cliente (que tendría que consultar antes para saber qué va a pasar).
export const esquemaActivacion = z.object({
  activo: z.boolean({
    errorMap: () => ({ message: "El campo 'activo' debe ser booleano" }),
  }),
});

// Filtros del listado. Los parámetros vienen de req.query como strings,
// así que usamos coerce.boolean() y z.enum() para convertir/validar.
// Todos opcionales: el listado sin filtros devuelve todos los usuarios paginados.
export const esquemaFiltrosUsuarios = z.object({
  rol: z.enum(["OPERARIO", "TECNICO", "ADMIN"]).optional(),
  // z.coerce.boolean es resbaladizo (cualquier string no-vacío → true).
  // Por eso parseamos a mano: solo "true" y "false" exactos cuentan.
  activo: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});
