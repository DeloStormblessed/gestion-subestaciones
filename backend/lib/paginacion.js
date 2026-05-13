// backend/lib/paginacion.js
//
// Helper de paginación offset-based. Define el contrato del scope §11:
//   Query:    ?pagina=1&limite=20  (defaults 1/20, máximo limite=100)
//   Respuesta: { datos: [...], paginacion: { pagina, limite, total, totalPaginas } }
//
// Centralizar aquí permite que ningún service tenga que pensar en parsear query strings
// ni en construir el wrapper de respuesta — solo se preocupa de obtener datos.

const PAGINA_DEFECTO = 1;
const LIMITE_DEFECTO = 20;
const LIMITE_MAXIMO = 100;

// Extrae y normaliza pagina/limite desde req.query.
// - Si no llegan: defaults.
// - Si llegan basura ("abc", -3, 0): se aplican mínimos sensatos.
// - Si limite supera el máximo: se capa silenciosamente (mejor UX que un 400).
//
// Devuelve también `salto` (=skip de Prisma) precalculado para el service.
export function leerPaginacion(query) {
  // Number() de "abc" → NaN; NaN || N → N. Cubre tanto undefined como basura.
  let pagina = Math.floor(Number(query.pagina)) || PAGINA_DEFECTO;
  let limite = Math.floor(Number(query.limite)) || LIMITE_DEFECTO;

  if (pagina < 1) pagina = PAGINA_DEFECTO;
  if (limite < 1) limite = LIMITE_DEFECTO;
  if (limite > LIMITE_MAXIMO) limite = LIMITE_MAXIMO;

  return { pagina, limite, salto: (pagina - 1) * limite };
}

// Empaqueta los resultados de una consulta paginada en la estructura estándar.
// El service llama a prisma.X.findMany + prisma.X.count en paralelo y nos pasa ambos.
export function formatearRespuesta({ datos, total, pagina, limite }) {
  return {
    datos,
    paginacion: {
      pagina,
      limite,
      total,
      totalPaginas: Math.ceil(total / limite) || 1, // si total=0, mostramos 1 página (no 0)
    },
  };
}
