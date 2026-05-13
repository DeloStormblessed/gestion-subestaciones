// backend/features/auth/auth.routes.js

import { Router } from "express";
import validate from "../../middleware/validate.js";
import { verificarToken } from "../../middleware/auth.js";
import { esquemaRegistro, esquemaLogin } from "./auth.schema.js";
import * as authController from "./auth.controller.js";

const router = Router();

// Rutas públicas: no requieren token.
router.post("/registro", validate(esquemaRegistro), authController.registrar);
router.post("/login", validate(esquemaLogin), authController.login);

// Ruta protegida: cualquier usuario autenticado puede consultar su propio perfil.
router.get("/perfil", verificarToken, authController.obtenerPerfil);

export default router;
