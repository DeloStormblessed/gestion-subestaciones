// backend/middleware/validate.js

import { EntradaInvalida } from "../lib/errores.js";

// Factory: `validate(schema)` devuelve un middleware que valida req.body
// contra el schema Zod proporcionado.
//
// Patrón "factory de middlewares": permite parametrizar el middleware
// (con el schema) y reutilizarlo en distintas rutas con distintos esquemas.
//
// Si la validación pasa: reasigna req.body con los datos parseados
// (incluye coerciones y defaults aplicados por Zod) y continúa.
// Si falla: lanza EntradaInvalida con el primer error legible.
const validate = (schema) => (req, res, next) => {
  const resultado = schema.safeParse(req.body);

  if (!resultado.success) {
    // Tomamos solo el primer error: en una API REST devolver una lista de errores
    // es UX de formulario, no de API. Cliente arregla uno, vuelve a intentar.
    const primero = resultado.error.errors[0];
    // `path` indica el campo afectado (ej: ["email"]); útil cuando el mensaje es genérico.
    const campo = primero.path.join(".");
    const mensaje = campo ? `${campo}: ${primero.message}` : primero.message;
    return next(new EntradaInvalida(mensaje));
  }

  req.body = resultado.data;
  next();
};

export default validate;
