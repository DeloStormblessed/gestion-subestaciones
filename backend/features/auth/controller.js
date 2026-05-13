// backend/features/auth/auth.controller.js
//
// Adaptador HTTP fino: extrae datos de req, llama al service, devuelve respuesta.
// Cualquier lógica de negocio que veas aquí es un mal olor — debería estar en el service.
//
// Patrón try/catch + next(err): Express 4 no captura excepciones de funciones async,
// así que envolvemos cada controller. En Express 5 esto será automático.

import * as authService from "./service.js";

export async function registrar(req, res, next) {
  try {
    const resultado = await authService.registrar(req.body);
    // 201 Created: hemos creado un recurso (el usuario) en respuesta a esta petición.
    res.status(201).json(resultado);
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const resultado = await authService.login(req.body);
    res.json(resultado);
  } catch (err) {
    next(err);
  }
}

export async function obtenerPerfil(req, res, next) {
  try {
    // req.usuario lo deja el middleware verificarToken con el payload del JWT.
    const usuario = await authService.obtenerPerfil(req.usuario.id);
    res.json(usuario);
  } catch (err) {
    next(err);
  }
}
