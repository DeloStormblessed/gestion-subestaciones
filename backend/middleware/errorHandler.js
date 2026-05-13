// backend/middleware/errorHandler.js

import { ErrorHTTP, Conflicto, NoEncontrado } from "../lib/errores.js";

// Middleware de error de Express. Debe ir registrado el ÚLTIMO en app.js,
// después de todas las rutas. Express lo identifica por tener 4 parámetros.
//
// Convierte cualquier error que llegue por `next(err)` en una respuesta JSON
// uniforme: { error: "mensaje legible" } con el status HTTP adecuado.
//
// eslint-disable-next-line no-unused-vars (el 4º param 'next' es obligatorio
// para que Express reconozca esto como error handler, aunque no lo usemos).
function errorHandler(err, req, res, next) {
  // Errores conocidos de Prisma → mapearlos a nuestros errores personalizados.
  // P2002: violación de unique constraint (email duplicado, código de activo duplicado…).
  // P2025: registro no encontrado (lo lanza findUniqueOrThrow, update sobre id inexistente…).
  if (err.code === "P2002") {
    const campo = err.meta?.target?.join(", ") ?? "campo único";
    err = new Conflicto(`Ya existe un recurso con ese ${campo}`);
  } else if (err.code === "P2025") {
    err = new NoEncontrado("Recurso no encontrado");
  }

  // Nuestros errores personalizados llevan status y mensaje listos para servir.
  if (err instanceof ErrorHTTP) {
    return res.status(err.status).json({ error: err.message });
  }

  // Error no reconocido: lo loggeamos íntegro en consola (stack incluido) para
  // poder debuguearlo, pero al cliente solo le devolvemos un mensaje genérico.
  // Nunca filtrar detalles internos al cliente.
  console.error("[errorHandler] Error no controlado:", err);
  return res.status(500).json({ error: "Error interno del servidor" });
}

export default errorHandler;
