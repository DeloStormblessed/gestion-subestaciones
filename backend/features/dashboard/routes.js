import { Router } from "express";
import { getDashboard } from "./controller.js";
import { verificarToken } from "../../middleware/auth.js";

const router = Router();

// GET /api/v1/dashboard — cualquier rol autenticado (scope §9).
// No usa requireRol porque el dashboard es informativo y todos los roles lo consumen:
// OPERARIO ve qué inspeccionar, TECNICO planifica intervenciones, ADMIN tiene visión global.
router.get("/", verificarToken, getDashboard);

export default router;
