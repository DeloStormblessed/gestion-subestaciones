import { Router } from "express";
import { listar, detalle, crear, editar, activacion } from "./controller.js";
import { verificarToken, requireRol } from "../../middleware/auth.js";
import validate from "../../middleware/validate.js";
import {
  crearSubestacionSchema,
  editarSubestacionSchema,
  activacionSchema,
} from "./schema.js";

const router = Router();

// Lectura: cualquier rol autenticado. Escritura: solo ADMIN (scope §5 y §9).
router.get("/", verificarToken, listar);
router.get("/:id", verificarToken, detalle);
router.post(
  "/",
  verificarToken,
  requireRol("ADMIN"),
  validate(crearSubestacionSchema),
  crear,
);
router.put(
  "/:id",
  verificarToken,
  requireRol("ADMIN"),
  validate(editarSubestacionSchema),
  editar,
);
router.patch(
  "/:id/activacion",
  verificarToken,
  requireRol("ADMIN"),
  validate(activacionSchema),
  activacion,
);

export default router;
