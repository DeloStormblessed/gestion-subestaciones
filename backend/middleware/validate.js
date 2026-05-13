// backend/middleware/validate.js

import { EntradaInvalida } from "../lib/errores.js";

// Helper interno que aplica la validación contra un "target" del request
// (body o query). Centralizamos aquí la lógica de extracción de error y
// reasignación, para que `validate` y `validateQuery` solo se diferencien
// en qué parte del request miran.
const construirValidador = (target) => (schema) => (req, res, next) => {
  const resultado = schema.safeParse(req[target]);

  if (!resultado.success) {
    // Tomamos solo el primer error: en una API REST devolver una lista de errores
    // es UX de formulario, no de API. Cliente arregla uno, vuelve a intentar.
    const primero = resultado.error.errors[0];
    // `path` indica el campo afectado (ej: ["email"]); útil cuando el mensaje es genérico.
    const campo = primero.path.join(".");
    const mensaje = campo ? `${campo}: ${primero.message}` : primero.message;
    return next(new EntradaInvalida(mensaje));
  }

  // Reasignamos req[target] con los datos parseados: incluye coerciones
  // (string → number en query) y defaults (pagina=1, limite=20) aplicados por Zod.
  // Importante en query: sin esto, el controller seguiría viendo strings.
  req[target] = resultado.data;
  next();
};

// Factory para body. Default export para mantener compatibilidad con los
// imports existentes (`import validate from '../middleware/validate.js'`).
const validate = construirValidador("body");

// Factory para query params. Misma mecánica, distinto target.
// Necesario porque req.query llega siempre como strings y los listados
// con filtros (paginación, fechas, enums) requieren coerción + defaults.
export const validateQuery = construirValidador("query");

export default validate;
