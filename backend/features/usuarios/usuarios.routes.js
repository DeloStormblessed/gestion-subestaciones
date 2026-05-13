// backend/features/usuarios/usuarios.routes.js

import { Router } from "express";
import validate from "../../middleware/validate.js";
import { verificarToken, requireRol } from "../../middleware/auth.js";
import { esquemaCambioRol, esquemaActivacion } from "./usuarios.schema.js";
import * as usuariosController from "./usuarios.controller.js";

const router = Router();

// Todas las rutas de usuarios son ADMIN-only (scope §9).
// Aplicamos los dos middlewares globalmente a este router para no repetirlos en cada ruta.
router.use(verificarToken, requireRol("ADMIN"));

router.get("/", usuariosController.listar);
router.get("/:id", usuariosController.obtenerPorId);
router.patch(
  "/:id/rol",
  validate(esquemaCambioRol),
  usuariosController.cambiarRol,
);
router.patch(
  "/:id/activacion",
  validate(esquemaActivacion),
  usuariosController.cambiarActivacion,
);

export default router;
