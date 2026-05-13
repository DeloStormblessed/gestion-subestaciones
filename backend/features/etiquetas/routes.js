import { Router } from "express";
import {
  listarEtiquetas,
  crearEtiqueta,
  borrarEtiqueta,
} from "./controller.js";
import { verificarToken, requireRol } from "../../middleware/auth.js";
import validate from "../../middleware/validate.js";
import { crearEtiquetaSchema } from "./schema.js";

const router = Router();

// Listado: cualquier rol autenticado puede consultar las etiquetas disponibles.
router.get("/", verificarToken, listarEtiquetas);

// Crear etiqueta: TECNICO y ADMIN. Operarios no crean metadatos.
router.post(
  "/",
  verificarToken,
  requireRol("TECNICO", "ADMIN"),
  validate(crearEtiquetaSchema),
  crearEtiqueta,
);

// Borrar etiqueta: SOLO ADMIN. Único hard delete del proyecto (scope §7).
// La restricción a ADMIN limita el riesgo de borrados accidentales que
// afectarían a múltiples activos (pierden la asociación, aunque los activos
// se conservan intactos).
router.delete("/:id", verificarToken, requireRol("ADMIN"), borrarEtiqueta);

export default router;
