// backend/middleware/auth.js

import jwt from "jsonwebtoken";
import { NoAutorizado, Prohibido } from "../lib/errores.js";

// Extrae el JWT del header Authorization y lo verifica.
// Si es válido, deja los datos del usuario en req.usuario para que los siguientes
// middlewares y los controllers puedan usarlos (sobre todo: req.usuario.id y .rol).
//
// El payload del token contiene { id, email, rol } — lo decidimos así al firmarlo
// en el controller de auth. Mantenerlo mínimo evita filtrar datos sensibles
// y reduce el tamaño del token.
export const verificarToken = (req, res, next) => {
  const cabecera = req.headers.authorization;
  // Formato esperado: "Bearer <token>". Si no llega o no empieza por "Bearer ", error.
  const token = cabecera?.startsWith("Bearer ") ? cabecera.slice(7) : null;
  if (!token) return next(new NoAutorizado("Token requerido"));

  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    // jwt.verify lanza por token mal formado, firma inválida o expirado.
    // No distinguimos los tres casos al cliente — sería filtrar información útil
    // para un atacante (saber si un token expiró vs. si nunca fue válido).
    next(new NoAutorizado("Token inválido o expirado"));
  }
};

// Factory: `requireRol("TECNICO", "ADMIN")` devuelve un middleware que solo deja
// pasar si req.usuario.rol está en la lista. Debe ir DESPUÉS de verificarToken
// en la cadena de middlewares (depende de req.usuario).
//
// Nota: en el scope §5, la autorización es puramente por rol, no por propiedad
// del recurso. Las OTs no son "propias" de un técnico — son de la empresa.
// Si alguna vez hace falta lógica más fina, se hace en el service, no aquí.
export const requireRol =
  (...rolesPermitidos) =>
  (req, res, next) => {
    if (!rolesPermitidos.includes(req.usuario?.rol)) {
      return next(new Prohibido("Acceso denegado para tu rol"));
    }
    next();
  };
