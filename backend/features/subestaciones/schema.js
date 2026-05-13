import { z } from "zod";

// Códigos GMAO típicos: alfanuméricos con guiones (ej. "SE-MAD-001").
// No fuerzo regex porque el scope no lo exige; el unique de Prisma protege duplicados.
export const crearSubestacionSchema = z.object({
  codigo: z
    .string()
    .trim()
    .min(2, "El código debe tener al menos 2 caracteres")
    .max(20),
  nombre: z
    .string()
    .trim()
    .min(2, "El nombre debe tener al menos 2 caracteres")
    .max(100),
  ubicacion: z
    .string()
    .trim()
    .min(2, "La ubicación debe tener al menos 2 caracteres")
    .max(200),
  // Tensión nominal en kV. Rango defensivo: redes reales van de ~1 kV (BT) a 800 kV (AT).
  tensionNominal: z
    .number()
    .int()
    .positive("La tensión nominal debe ser positiva")
    .max(1000),
});

// Edición: mismos campos, todos opcionales. Mismo patrón que el profe en updateProductSchema.
// Decisión: permitimos cambiar también el código (es un identificador funcional, no técnico).
export const editarSubestacionSchema = crearSubestacionSchema.partial();

// Filtros viajan como query string → todo llega como string, hay que coercer los numéricos.
export const filtrosListadoSchema = z.object({
  activa: z.enum(["true", "false"]).optional(),
  tensionMin: z.coerce.number().int().positive().optional(),
  tensionMax: z.coerce.number().int().positive().optional(),
});

// PATCH /activacion: body explícito con booleano, no inferimos del path.
export const activacionSchema = z.object({
  activa: z.boolean(),
});
