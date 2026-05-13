import { z } from "zod";

// Schema para POST /api/v1/etiquetas.
// nombre tiene @unique en BD: la duplicación se detecta a nivel Prisma (P2002)
// y la convierte el errorHandler en Conflicto 409. Aquí solo validamos forma.
export const crearEtiquetaSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, "El nombre debe tener al menos 2 caracteres")
    .max(50),
  // color es opcional en el modelo (preparación para frontend futuro, scope §6.3).
  // Si viene, validamos formato hex (#RGB o #RRGGBB) para evitar basura.
  color: z
    .string()
    .regex(
      /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/,
      "color debe ser un hex válido (#RGB o #RRGGBB)",
    )
    .optional(),
});

// Schema para POST /api/v1/activos/:id/etiquetas.
// Body: { etiquetaIds: [1, 3, 5] } — semántica de reemplazo total del conjunto.
// Ints (no cuids) porque Etiqueta.id es autoincrement (única entidad así, scope §4).
export const asociarEtiquetasSchema = z.object({
  etiquetaIds: z
    .array(
      z.number().int().positive("etiquetaIds debe contener enteros positivos"),
    )
    // Array vacío permitido: vale para "quitarle todas las etiquetas a este activo".
    .max(50, "No se pueden asociar más de 50 etiquetas a un activo"),
});
