import prisma from "../../lib/prisma.js";
import { NoEncontrado } from "../../lib/errores.js";

// Listado simple: pocas etiquetas en el sistema, no necesita paginación.
// Orden alfabético para que el cliente las muestre estables.
export const listarEtiquetas = async () => {
  return prisma.etiqueta.findMany({
    orderBy: { nombre: "asc" },
    // _count nos da cuántos activos usan cada etiqueta. Útil para UI futura
    // ("Transformador (12)") y para que ADMIN sepa el impacto antes de borrar.
    include: { _count: { select: { activos: true } } },
  });
};

export const crearEtiqueta = async (datos) => {
  // El unique de nombre se valida a nivel BD: si choca, Prisma lanza P2002
  // y el errorHandler lo convierte en Conflicto 409.
  return prisma.etiqueta.create({ data: datos });
};

// Hard delete: único caso en el proyecto (scope §7, metadato sin valor histórico).
// La relación N:M usa tabla join implícita, así que las filas de la join se
// borran automáticamente al borrar la etiqueta — los activos no se ven afectados,
// solo pierden la asociación.
export const borrarEtiqueta = async (id) => {
  // findUniqueOrThrow lanza P2025 → NoEncontrado 404 (vía errorHandler) si no existe.
  // Mejor que un delete a ciegas, que también lanza P2025 pero con mensaje menos claro.
  await prisma.etiqueta.findUniqueOrThrow({ where: { id } });
  await prisma.etiqueta.delete({ where: { id } });
};

// Asociación con semántica de reemplazo total: el activo queda con
// EXACTAMENTE las etiquetas del array (las anteriores que no estén se quitan,
// las nuevas se añaden). Prisma lo resuelve con `set: [...]` en una sola query.
export const asociarEtiquetasAActivo = async (activoId, etiquetaIds) => {
  // 1. Verificamos que el activo existe. findUniqueOrThrow → P2025 → 404.
  await prisma.activo.findUniqueOrThrow({ where: { id: activoId } });

  // 2. Si vienen ids, validamos que TODOS existen antes de tocar nada.
  //    Sin este check, Prisma daría un error genérico al hacer el connect.
  //    Aquí podemos devolver un 404 con mensaje útil indicando qué ids fallan.
  if (etiquetaIds.length > 0) {
    const encontradas = await prisma.etiqueta.findMany({
      where: { id: { in: etiquetaIds } },
      select: { id: true },
    });
    if (encontradas.length !== etiquetaIds.length) {
      const idsEncontrados = new Set(encontradas.map((e) => e.id));
      const idsInexistentes = etiquetaIds.filter(
        (id) => !idsEncontrados.has(id),
      );
      throw new NoEncontrado(
        `Etiquetas inexistentes: ${idsInexistentes.join(", ")}`,
      );
    }
  }

  // 3. set: [...] reemplaza el conjunto entero en una sola operación atómica.
  //    Devolvemos el activo con sus etiquetas actualizadas para que el cliente
  //    vea el resultado sin tener que hacer un GET adicional.
  return prisma.activo.update({
    where: { id: activoId },
    data: {
      etiquetas: {
        set: etiquetaIds.map((id) => ({ id })),
      },
    },
    include: { etiquetas: true },
  });
};
