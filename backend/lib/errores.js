// backend/lib/errores.js

// Errores personalizados del dominio. Los services lanzan estos;
// el errorHandler central los traduce a respuesta HTTP.
//
// Ventaja vs. el patrón del profesor (que hace `res.status(401).json(...)`
// dentro del controller): la lógica de negocio en el service queda libre de
// objetos req/res, es testeable sin Express, y los mensajes se centralizan.

// Base abstracta. No se instancia directamente; sirve para que el errorHandler
// pueda detectar "esto es un error de los míos" con un único `instanceof ErrorHTTP`.
export class ErrorHTTP extends Error {
  constructor(mensaje, status) {
    super(mensaje);
    this.name = this.constructor.name;
    this.status = status;
  }
}

export class EntradaInvalida extends ErrorHTTP {
  // 400: payload mal formado o falla la validación Zod (lo lanza el middleware validate).
  constructor(mensaje = "Entrada inválida") {
    super(mensaje, 400);
  }
}

export class NoAutorizado extends ErrorHTTP {
  // 401: no hay token, token mal formado, o token expirado.
  constructor(mensaje = "No autorizado") {
    super(mensaje, 401);
  }
}

export class Prohibido extends ErrorHTTP {
  // 403: token válido pero el rol no tiene permiso para esta acción.
  constructor(mensaje = "Acceso denegado") {
    super(mensaje, 403);
  }
}

export class NoEncontrado extends ErrorHTTP {
  // 404: el recurso solicitado no existe.
  constructor(mensaje = "Recurso no encontrado") {
    super(mensaje, 404);
  }
}

export class Conflicto extends ErrorHTTP {
  // 409: duplicado de un campo único (email, codigo de activo, etc.).
  // También lo emite el errorHandler al capturar el código Prisma P2002.
  constructor(mensaje = "Conflicto con el estado actual del recurso") {
    super(mensaje, 409);
  }
}

export class ReglaNegocio extends ErrorHTTP {
  // 422: la petición está sintácticamente bien pero viola una regla de dominio.
  // Casos típicos: transición de estado inválida (Regla A), PREVENTIVO sobre activo
  // con inspección vencida (Regla B). Es el error "más interesante" del proyecto.
  constructor(mensaje = "Regla de negocio violada") {
    super(mensaje, 422);
  }
}
