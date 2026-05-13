// backend/features/auth/auth.schema.js

import { z } from "zod";

// Registro: el rol siempre será OPERARIO (lo fija el service, no se acepta del body).
// Esto evita que cualquiera se registre como ADMIN enviando { rol: "ADMIN" }.
export const esquemaRegistro = z.object({
  email: z.string().email("Email con formato inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
});

// Login: validación mínima. El "credenciales incorrectas" lo decide el service
// comparando con la BD; aquí solo aseguramos que llegan los campos.
export const esquemaLogin = z.object({
  email: z.string().email("Email con formato inválido"),
  password: z.string().min(1, "La contraseña es requerida"),
});
