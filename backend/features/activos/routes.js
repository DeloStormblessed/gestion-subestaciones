// backend/features/activos/routes.js

import { Router } from "express";
import {
  getActivos,
  getActivo,
  postActivo,
  putActivo,
  getHistorialActivo,
} from "./controller.js";
import { verificarToken, requireRol } from "../../middleware/auth.js";
import validate from "../../middleware/validate.js";
import { crearActivoSchema, editarActivoSchema } from "./schema.js";

// Añadir a los imports existentes:
import { postOrdenTrabajo } from "./controller.js";
import { crearOrdenTrabajoSchema } from "./schema.js";
import { Prohibido } from "../../lib/errores.js";

const router = Router();

// GET /api/v1/activos -- listado con filtros + paginación. Cualquier rol
// autenticado puede consultar (scope §9). Los filtros se validan en el
// controller con safeParse para distinguirlos del body (que no hay).
router.get("/", verificarToken, getActivos);

// GET /api/v1/activos/:id -- detalle + últimas 10 OTs + etiquetas.
router.get("/:id", verificarToken, getActivo);

// POST /api/v1/activos -- crea activo + OT INSTALACION atómica. Solo TECNICO
// y ADMIN: dar de alta equipamiento eléctrico es responsabilidad técnica, no
// de operario de consulta.
router.post(
  "/",
  verificarToken,
  requireRol("TECNICO", "ADMIN"),
  validate(crearActivoSchema),
  postActivo,
);

// PUT /api/v1/activos/:id -- editar datos descriptivos (fabricante, modelo).
// Mismos roles que crear: cambiar la ficha técnica es operación técnica.
router.put(
  "/:id",
  verificarToken,
  requireRol("TECNICO", "ADMIN"),
  validate(editarActivoSchema),
  putActivo,
);

// GET /api/v1/activos/:id/ordenes-trabajo -- historial paginado completo.
// Cualquier rol autenticado: la trazabilidad es información de consulta.
router.get("/:id/ordenes-trabajo", verificarToken, getHistorialActivo);

// POST /api/v1/activos/:id/ordenes-trabajo -- pendiente para Conversación B.
// Aquí entran regla A (transiciones), regla B (bloqueo por inspección
// vencida), webhook condicional y snapshot de estado. Lo dejamos sin montar
// hasta tener el service correspondiente.

export default router;

// Middleware de autorización híbrida para crear OTs (scope §5 + §9).
//
// La regla mezcla rol Y contenido del body, por eso no encaja en
// requireRol() genérico:
//   - OPERARIO: solo OTs de tipo INSPECCION.
//   - TECNICO y ADMIN: cualquier tipo.
//
// Va DESPUÉS del validate, así req.body.tipo ya está validado y
// normalizado por Zod cuando llegamos aquí.
function autorizarCreacionOT(req, res, next) {
  const { rol } = req.usuario;
  const { tipo } = req.body;

  if (rol === "TECNICO" || rol === "ADMIN") {
    return next();
  }

  if (rol === "OPERARIO" && tipo === "INSPECCION") {
    return next();
  }

  return next(
    new Prohibido("Los operarios solo pueden registrar OTs de tipo INSPECCION"),
  );
}

// features/activos/routes.js (continuación)

router.post(
  "/:id/ordenes-trabajo",
  verificarToken,
  validate(crearOrdenTrabajoSchema),
  autorizarCreacionOT,
  postOrdenTrabajo,
);
