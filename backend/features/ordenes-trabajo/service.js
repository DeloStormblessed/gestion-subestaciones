import prisma from "../../lib/prisma.js";

// Listado global de OTs con filtros + paginación.
// Las OTs son inmutables y no se crean/editan/borran aquí: ese flujo vive en
// features/activos (POST anidado bajo activo). Este service solo lee.
export const listarOrdenesTrabajo = async (filtros) => {
  const { tipo, autorId, activoId, fechaDesde, fechaHasta, pagina, limite } =
    filtros;

  // Construcción dinámica del where: solo se incluyen las claves presentes.
  // Para fechaIntervencion combinamos gte/lte en un mismo objeto si vienen ambas.
  const where = {
    ...(tipo && { tipo }),
    ...(autorId && { autorId }),
    ...(activoId && { activoId }),
    ...((fechaDesde || fechaHasta) && {
      fechaIntervencion: {
        ...(fechaDesde && { gte: fechaDesde }),
        // fechaHasta llega como inicio del día (00:00). Para que el filtro sea
        // inclusivo del día entero sumamos 24h y usamos lt en vez de lte.
        // Sin esto, ?fechaHasta=2026-01-31 excluiría todo lo del 31.
        ...(fechaHasta && {
          lt: new Date(fechaHasta.getTime() + 24 * 60 * 60 * 1000),
        }),
      },
    }),
  };

  const skip = (pagina - 1) * limite;

  // findMany + count en paralelo: dos queries independientes, ahorramos un round-trip.
  const [datos, total] = await Promise.all([
    prisma.ordenTrabajo.findMany({
      where,
      skip,
      take: limite,
      orderBy: { fechaIntervencion: "desc" },
      include: {
        activo: {
          select: { id: true, codigo: true, tipo: true, estado: true },
        },
        autor: {
          // Nunca exponer passwordHash en respuestas. Select explícito de campos seguros.
          select: { id: true, nombre: true, email: true, rol: true },
        },
      },
    }),
    prisma.ordenTrabajo.count({ where }),
  ]);

  return {
    datos,
    paginacion: {
      pagina,
      limite,
      total,
      totalPaginas: Math.ceil(total / limite),
    },
  };
};
