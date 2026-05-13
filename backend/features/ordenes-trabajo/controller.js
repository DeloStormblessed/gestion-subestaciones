import { listarOrdenesTrabajo as listarOrdenesTrabajoService } from "./service.js";

// Adaptador HTTP fino. La validación de query la hace el middleware `validate`,
// así que aquí req.query ya viene tipado y con defaults (pagina=1, limite=20).
export const listarOrdenesTrabajo = async (req, res, next) => {
  try {
    const resultado = await listarOrdenesTrabajoService(req.query);
    res.json(resultado);
  } catch (err) {
    next(err);
  }
};
