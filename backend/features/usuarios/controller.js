// backend/features/usuarios/usuarios.controller.js

import * as usuariosService from "./service.js";
import { leerPaginacion, formatearRespuesta } from "../../lib/paginacion.js";
import { esquemaFiltrosUsuarios } from "./schema.js";
import { EntradaInvalida } from "../../lib/errores.js";

export async function listar(req, res, next) {
  try {
    // Los filtros vienen por query, no por body, así que se validan aquí
    // (el middleware `validate` solo cubre body). Mantenemos coherencia
    // lanzando EntradaInvalida en caso de error de validación.
    const parseo = esquemaFiltrosUsuarios.safeParse(req.query);
    if (!parseo.success) {
      return next(new EntradaInvalida(parseo.error.errors[0].message));
    }

    const { pagina, limite, salto } = leerPaginacion(req.query);
    const resultado = await usuariosService.listar({
      filtros: parseo.data,
      pagina,
      limite,
      salto,
    });
    res.json(formatearRespuesta(resultado));
  } catch (err) {
    next(err);
  }
}

export async function obtenerPorId(req, res, next) {
  try {
    const usuario = await usuariosService.obtenerPorId(req.params.id);
    res.json(usuario);
  } catch (err) {
    next(err);
  }
}

export async function cambiarRol(req, res, next) {
  try {
    const actualizado = await usuariosService.cambiarRol({
      idObjetivo: req.params.id,
      idSolicitante: req.usuario.id, // viene del JWT (middleware verificarToken)
      nuevoRol: req.body.rol,
    });
    res.json(actualizado);
  } catch (err) {
    next(err);
  }
}

export async function cambiarActivacion(req, res, next) {
  try {
    const actualizado = await usuariosService.cambiarActivacion({
      idObjetivo: req.params.id,
      idSolicitante: req.usuario.id,
      activo: req.body.activo,
    });
    res.json(actualizado);
  } catch (err) {
    next(err);
  }
}
