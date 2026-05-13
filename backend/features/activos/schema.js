// backend/features/activos/schema.js

import { z } from "zod";

// Enums replicados aquí en vez de importarlos de @prisma/client para mantener
// la capa de validación independiente del ORM (mismo patrón que en subestaciones).
const TIPOS_ACTIVO = [
  "TRANSFORMADOR_POTENCIA",
  "INTERRUPTOR_AUTOMATICO",
  "SECCIONADOR",
  "PARARRAYOS",
  "TRANSFORMADOR_MEDIDA",
  "BATERIA_CONDENSADORES",
];

const ESTADOS_ACTIVO = [
  "EN_SERVICIO",
  "AVERIADO",
  "FUERA_DE_SERVICIO",
  "DADO_DE_BAJA",
];

export const crearActivoSchema = z.object({
  codigo: z
    .string()
    .min(3, "El código debe tener al menos 3 caracteres")
    .max(50, "El código no puede exceder 50 caracteres"),
  tipo: z.enum(TIPOS_ACTIVO, {
    errorMap: () => ({ message: "Tipo de activo inválido" }),
  }),
  fabricante: z
    .string()
    .min(2, "El fabricante debe tener al menos 2 caracteres")
    .max(100),
  modelo: z.string().max(100).optional(),
  numeroSerie: z.string().max(100).optional(),
  // coerce.date acepta tanto Date como strings ISO ("2024-01-15") del JSON
  fechaPuestaEnServicio: z.coerce.date({
    errorMap: () => ({ message: "fechaPuestaEnServicio inválida" }),
  }),
  subestacionId: z.string().min(1, "subestacionId es requerido"),
});

export const editarActivoSchema = z
  .object({
    fabricante: z.string().min(2).max(100).optional(),
    modelo: z.string().max(100).nullable().optional(),
  })
  .refine((datos) => Object.keys(datos).length > 0, {
    message: "Debe proporcionar al menos un campo a editar",
  });

export const filtrosListadoActivosSchema = z.object({
  // Paginación: defaults 1/20, máximo 100 (convención del scope §11)
  pagina: z.coerce.number().int().positive().default(1),
  limite: z.coerce.number().int().positive().max(100).default(20),

  // Filtros de dominio
  subestacionId: z.string().optional(),
  tipo: z.enum(TIPOS_ACTIVO).optional(),
  estado: z.enum(ESTADOS_ACTIVO).optional(),
  etiqueta: z.string().optional(), // por nombre, no por id

  // Búsqueda textual sobre codigo, fabricante, modelo y numeroSerie.
  // Estos cuatro son los identificadores que un técnico recordaría buscar
  // en campo; nombre/descripción no existen en el modelo.
  busqueda: z.string().min(1).optional(),

  // Booleano por query string: "true" / "false" -> boolean
  inspeccionVencida: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

// features/activos/schema.js (ampliación)
//
// Añadir al final del archivo, junto a los schemas existentes.

import { z } from "zod";

// Schema para POST /api/v1/activos/:id/ordenes-trabajo (scope §9).
//
// La relación tipo <-> resultado es la única validación cruzada:
//  - INSPECCION exige `resultado` ('OK' | 'AVERIA_DETECTADA').
//  - Cualquier otro tipo NO debe llevar `resultado` (sería ruido en BD).
// Las reglas de negocio (transiciones, regla B) viven en el service,
// no aquí: este schema solo valida forma, no semántica de dominio.
export const crearOrdenTrabajoSchema = z
  .object({
    tipo: z.enum(
      ["INSPECCION", "PREVENTIVO", "CORRECTIVO", "INSTALACION", "BAJA"],
      { errorMap: () => ({ message: "Tipo de OT inválido" }) },
    ),
    descripcion: z
      .string()
      .min(3, "La descripción debe tener al menos 3 caracteres")
      .max(1000, "La descripción no puede superar los 1000 caracteres"),
    resultado: z.enum(["OK", "AVERIA_DETECTADA"]).optional(),
    // Opcional: si no viene, Prisma usa @default(now()).
    // Coerce permite recibir string ISO desde JSON y convertirlo a Date.
    fechaIntervencion: z.coerce.date().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.tipo === "INSPECCION" && !data.resultado) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resultado"],
        message: "El resultado es obligatorio para OTs de tipo INSPECCION",
      });
    }
    if (data.tipo !== "INSPECCION" && data.resultado !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resultado"],
        message: "El campo resultado solo aplica a OTs de tipo INSPECCION",
      });
    }
  });
