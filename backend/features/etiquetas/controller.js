import {
  listarEtiquetas as listarEtiquetasService,
  crearEtiqueta as crearEtiquetaService,
  borrarEtiqueta as borrarEtiquetaService,
  asociarEtiquetasAActivo as asociarEtiquetasAActivoService,
} from "./service.js";

export const listarEtiquetas = async (req, res, next) => {
  try {
    const etiquetas = await listarEtiquetasService();
    res.json(etiquetas);
  } catch (err) {
    next(err);
  }
};

export const crearEtiqueta = async (req, res, next) => {
  try {
    const etiqueta = await crearEtiquetaService(req.body);
    res.status(201).json(etiqueta);
  } catch (err) {
    next(err);
  }
};

export const borrarEtiqueta = async (req, res, next) => {
  try {
    // Etiqueta.id es Int autoincrement: convertimos el param de URL a número.
    // Si el cliente manda algo no numérico ("abc"), Number(...) → NaN y
    // Prisma fallará en el findUniqueOrThrow con 404. Suficientemente claro.
    await borrarEtiquetaService(Number(req.params.id));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

// Este controller pertenece al endpoint anidado POST /activos/:id/etiquetas.
// Vive aquí porque la lógica de asociación es asunto de la feature etiquetas,
// aunque la ruta cuelgue de activos (decisión de routing, no de dominio).
export const asociarEtiquetasAActivo = async (req, res, next) => {
  try {
    const activo = await asociarEtiquetasAActivoService(
      req.params.id, // cuid de activo, no se transforma
      req.body.etiquetaIds,
    );
    res.json(activo);
  } catch (err) {
    next(err);
  }
};
