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
