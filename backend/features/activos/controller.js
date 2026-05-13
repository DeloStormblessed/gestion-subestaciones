// backend/features/activos/controller.js

import {
  listarActivos,
  obtenerActivo,
  crearActivo,
  editarActivo,
  listarHistorialActivo,
} from "./service.js";
import { filtrosListadoActivosSchema } from "./schema.js";
import { EntradaInvalida } from "../../lib/errores.js";

export async function getActivos(req, res, next) {
  try {
    // Los query params llegan como strings; el schema los coacciona a sus
    // tipos reales (number, boolean) y aplica defaults de paginación.
    // safeParse en vez de parse para devolver 400 con mensaje claro en vez de
    // un throw genérico de Zod.
    const resultado = filtrosListadoActivosSchema.safeParse(req.query);
    if (!resultado.success) {
      throw new EntradaInvalida(resultado.error.errors[0].message);
    }

    const respuesta = await listarActivos(resultado.data);
    res.json(respuesta);
  } catch (err) {
    next(err);
  }
}

export async function getActivo(req, res, next) {
  try {
    const activo = await obtenerActivo(req.params.id);
    res.json(activo);
  } catch (err) {
    next(err);
  }
}

export async function postActivo(req, res, next) {
  try {
    // req.body ya fue validado por el middleware validate(crearActivoSchema)
    // en routes.js. req.user.id viene del middleware verificarToken: es el
    // autor de la OT INSTALACION que se crea automáticamente.
    const activo = await crearActivo(req.body, req.usuario.id);
    res.status(201).json(activo);
  } catch (err) {
    next(err);
  }
}

export async function putActivo(req, res, next) {
  try {
    const activo = await editarActivo(req.params.id, req.body);
    res.json(activo);
  } catch (err) {
    next(err);
  }
}

export async function getHistorialActivo(req, res, next) {
  try {
    // Reutilizamos el schema de filtros para parsear solo pagina y limite.
    // pick es más explícito que filtrar manualmente; si el cliente manda
    // otros filtros en este endpoint los ignoramos en silencio (el historial
    // de un activo no admite filtros adicionales en el scope §9).
    const paginacionSchema = filtrosListadoActivosSchema.pick({
      pagina: true,
      limite: true,
    });
    const resultado = paginacionSchema.safeParse(req.query);
    if (!resultado.success) {
      throw new EntradaInvalida(resultado.error.errors[0].message);
    }

    const respuesta = await listarHistorialActivo(
      req.params.id,
      resultado.data,
    );
    res.json(respuesta);
  } catch (err) {
    next(err);
  }
}
