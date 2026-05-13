import { z } from "zod";
import { TipoOrdenTrabajo } from "@prisma/client";

// Schema de query params para GET /api/v1/ordenes-trabajo.
// .coerce porque todo lo que llega por URL es string; Zod convierte a número/Date.
// Filtramos por fechaIntervencion (no createdAt): la pregunta de negocio típica es
// "qué intervenciones se hicieron en este rango", no "qué se registró en el sistema".
// fechaIntervencion puede diferir de createdAt si la OT se registra a posteriori
// (decisión del scope §6.3).
export const listarOrdenesTrabajoSchema = z
  .object({
    tipo: z.nativeEnum(TipoOrdenTrabajo).optional(),
    autorId: z.string().cuid("autorId debe ser un cuid válido").optional(),
    activoId: z.string().cuid("activoId debe ser un cuid válido").optional(),
    fechaDesde: z.coerce
      .date({ invalid_type_error: "fechaDesde no es una fecha válida" })
      .optional(),
    fechaHasta: z.coerce
      .date({ invalid_type_error: "fechaHasta no es una fecha válida" })
      .optional(),
    pagina: z.coerce.number().int().positive().default(1),
    limite: z.coerce.number().int().positive().max(100).default(20),
  })
  .refine(
    (data) => {
      // Si vienen ambas fechas, el rango tiene que ser coherente.
      if (data.fechaDesde && data.fechaHasta) {
        return data.fechaDesde <= data.fechaHasta;
      }
      return true;
    },
    {
      message: "fechaDesde no puede ser posterior a fechaHasta",
      path: ["fechaDesde"],
    },
  );
