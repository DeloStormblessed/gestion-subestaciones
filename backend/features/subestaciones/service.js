import prisma from "../../lib/prisma.js";
import { NoEncontrado, ReglaNegocio } from "../../lib/errores.js";

// Select explícito para todas las respuestas. Si mañana se añade un campo sensible
// al modelo (notas internas, coste, etc.), no se filtra por accidente.
const seleccionPublica = {
  id: true,
  codigo: true,
  nombre: true,
  ubicacion: true,
  tensionNominal: true,
  activa: true,
  createdAt: true,
  updatedAt: true,
};

export async function listarSubestaciones({ filtros, pagina, limite }) {
  const where = {};
  if (filtros.activa !== undefined) where.activa = filtros.activa === "true";
  if (filtros.tensionMin || filtros.tensionMax) {
    where.tensionNominal = {};
    if (filtros.tensionMin) where.tensionNominal.gte = filtros.tensionMin;
    if (filtros.tensionMax) where.tensionNominal.lte = filtros.tensionMax;
  }

  // count + findMany en paralelo: una sola ronda hacia la BD para datos y total.
  const [total, datos] = await Promise.all([
    prisma.subestacion.count({ where }),
    prisma.subestacion.findMany({
      where,
      select: seleccionPublica,
      skip: (pagina - 1) * limite,
      take: limite,
      orderBy: { codigo: "asc" }, // código es el identificador funcional del operario
    }),
  ]);

  return { total, datos };
}

export async function obtenerSubestacion(id) {
  const subestacion = await prisma.subestacion.findUnique({
    where: { id },
    select: {
      ...seleccionPublica,
      // Scope §9: el detalle incluye los activos de la subestación.
      // Select explícito también aquí; no devolvemos campos internos del Activo.
      activos: {
        select: {
          id: true,
          codigo: true,
          tipo: true,
          estado: true,
          fechaProximaInspeccion: true,
        },
        orderBy: { codigo: "asc" },
      },
    },
  });
  if (!subestacion) throw new NoEncontrado("Subestación no encontrada");
  return subestacion;
}

export async function crearSubestacion(datos) {
  // Código duplicado → P2002 → Conflicto 409 vía errorHandler. No hace falta tratarlo aquí.
  return prisma.subestacion.create({
    data: datos,
    select: seleccionPublica,
  });
}

export async function editarSubestacion(id, datos) {
  // findUnique previo: devolvemos 404 explícito en vez de dejar que update lance P2025.
  // Ambos funcionan, pero 'NoEncontrado' deja el flujo más legible y consistente.
  const existe = await prisma.subestacion.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existe) throw new NoEncontrado("Subestación no encontrada");
  return prisma.subestacion.update({
    where: { id },
    data: datos,
    select: seleccionPublica,
  });
}

export async function cambiarActivacion(id, activa) {
  const subestacion = await prisma.subestacion.findUnique({
    where: { id },
    select: { id: true, activa: true },
  });
  if (!subestacion) throw new NoEncontrado("Subestación no encontrada");

  // Regla scope §7: una subestación con activos vivos no se puede desactivar.
  // Razón: la desactivación es soft delete; si hay activos operativos, marcar la subestación
  // como inactiva crearía un estado incoherente (activos "huérfanos" en una sub apagada).
  // El check solo aplica al desactivar; reactivar es siempre seguro.
  if (activa === false) {
    const activosVivos = await prisma.activo.count({
      where: {
        subestacionId: id,
        estado: { not: "DADO_DE_BAJA" },
      },
    });
    if (activosVivos > 0) {
      throw new ReglaNegocio(
        `No se puede desactivar la subestación: tiene ${activosVivos} activo(s) en operación. Dé de baja los activos primero.`,
      );
    }
  }

  return prisma.subestacion.update({
    where: { id },
    data: { activa },
    select: seleccionPublica,
  });
}
