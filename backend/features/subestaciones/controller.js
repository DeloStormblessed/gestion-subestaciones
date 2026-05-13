import {
  listarSubestaciones,
  obtenerSubestacion,
  crearSubestacion,
  editarSubestacion,
  cambiarActivacion,
} from "./service.js";
import { filtrosListadoSchema } from "./schema.js";
import { leerPaginacion, formatearRespuesta } from "../../lib/paginacion.js";
import { EntradaInvalida } from "../../lib/errores.js";

export async function listar(req, res, next) {
  try {
    // Los filtros van en query, no en body: el middleware 'validate' no los cubre.
    // Mismo patrón consolidado en la feature usuarios.
    const resultado = filtrosListadoSchema.safeParse(req.query);
    if (!resultado.success) {
      throw new EntradaInvalida(resultado.error.errors[0].message);
    }
    const { pagina, limite } = leerPaginacion(req.query);
    const { total, datos } = await listarSubestaciones({
      filtros: resultado.data,
      pagina,
      limite,
    });
    res.json(formatearRespuesta({ datos, total, pagina, limite }));
  } catch (err) {
    next(err);
  }
}

export async function detalle(req, res, next) {
  try {
    const subestacion = await obtenerSubestacion(req.params.id);
    res.json(subestacion);
  } catch (err) {
    next(err);
  }
}

export async function crear(req, res, next) {
  try {
    const subestacion = await crearSubestacion(req.body);
    res.status(201).json(subestacion);
  } catch (err) {
    next(err);
  }
}

export async function editar(req, res, next) {
  try {
    const subestacion = await editarSubestacion(req.params.id, req.body);
    res.json(subestacion);
  } catch (err) {
    next(err);
  }
}

export async function activacion(req, res, next) {
  try {
    const subestacion = await cambiarActivacion(req.params.id, req.body.activa);
    res.json(subestacion);
  } catch (err) {
    next(err);
  }
}
