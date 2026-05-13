import { Router } from "express";
import { listarOrdenesTrabajo } from "./controller.js";
import { verificarToken } from "../../middleware/auth.js";
import { validateQuery } from "../../middleware/validate.js";
import { listarOrdenesTrabajoSchema } from "./schema.js";

const router = Router();

// GET /api/v1/ordenes-trabajo
// Único endpoint del feature: listado global con filtros y paginación.
// Sin POST/PUT/DELETE/GET-by-id: las OTs se crean anidadas bajo activo
// (features/activos) y son inmutables (scope §6.3, §13).
// Cualquier rol autenticado puede consultar — el histórico de mantenimiento
// es información operativa compartida, no privada por usuario.
router.get(
  "/",
  verificarToken,
  validateQuery(listarOrdenesTrabajoSchema),
  listarOrdenesTrabajo,
);

export default router;
