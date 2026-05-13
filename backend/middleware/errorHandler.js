// backend/middleware/errorHandler.js

import { ErrorHTTP, Conflicto, NoEncontrado } from "../lib/errores.js";

// Etiquetas legibles para los campos únicos de Prisma. La clave es el nombre
// de la columna tal como Prisma lo devuelve en err.meta.target; el valor lleva
// el género ('m'/'f') para que el mensaje concuerde con el determinante.
// Si una columna no está aquí, caemos a un mensaje neutro sin género.
const ETIQUETAS_CAMPO_UNICO = {
  email: { etiqueta: "email", genero: "m" },
  codigo: { etiqueta: "código", genero: "m" },
  numeroSerie: { etiqueta: "número de serie", genero: "m" },
  nombre: { etiqueta: "nombre", genero: "m" },
};

function construirMensajeConflicto(target) {
  // target puede venir como string, array (índice compuesto) o undefined.
  const columnas = Array.isArray(target) ? target : target ? [target] : [];
  if (columnas.length === 0) {
    return "Ya existe un recurso con esos datos";
  }
  // Índice compuesto: no intentamos concordar género, mensaje neutro.
  if (columnas.length > 1) {
    return `Ya existe un recurso con esos valores (${columnas.join(", ")})`;
  }
  const info = ETIQUETAS_CAMPO_UNICO[columnas[0]];
  if (!info) {
    return `Ya existe un recurso con ese valor en ${columnas[0]}`;
  }
  const determinante = info.genero === "f" ? "esa" : "ese";
  return `Ya existe un recurso con ${determinante} ${info.etiqueta}`;
}

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
    err = new Conflicto(construirMensajeConflicto(err.meta?.target));
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
