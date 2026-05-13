// backend/features/activos/service.js

import prisma from "../../lib/prisma.js";
import { NoEncontrado } from "../../lib/errores.js";
import { calcularProximaInspeccion } from "../../lib/intervalos-inspeccion.js";

// Helper local de formato de paginación. La firma coincide con el resto de
// listados del proyecto (scope §11). Si en algún momento se repite por tercera
// vez, lo subimos a lib/paginacion.js.
function formatearPaginacion(pagina, limite, total) {
  return {
    pagina,
    limite,
    total,
    totalPaginas: Math.ceil(total / limite),
  };
}

export async function listarActivos(filtros) {
  const {
    pagina,
    limite,
    subestacionId,
    tipo,
    estado,
    etiqueta,
    busqueda,
    inspeccionVencida,
  } = filtros;

  // Construcción del where dinámico: cada filtro se añade solo si vino informado.
  // El patrón `...(cond && { campo: valor })` evita inyectar `undefined` en el where.
  const where = {
    ...(subestacionId && { subestacionId }),
    ...(tipo && { tipo }),
    ...(estado && { estado }),
    // Filtro por nombre de etiqueta vía relación M:N (el id interno no se expone).
    ...(etiqueta && { etiquetas: { some: { nombre: etiqueta } } }),
    // Inspección vencida: fechaProximaInspeccion en el pasado. Si el flag es
    // false no filtramos (no es "solo no vencidas", es "indiferente").
    ...(inspeccionVencida && { fechaProximaInspeccion: { lt: new Date() } }),
    // Búsqueda textual simple sobre los cuatro identificadores que un técnico
    // recordaría. mode: 'insensitive' hace la comparación case-insensitive
    // (requiere Postgres, que es nuestro motor).
    ...(busqueda && {
      OR: [
        { codigo: { contains: busqueda, mode: "insensitive" } },
        { fabricante: { contains: busqueda, mode: "insensitive" } },
        { modelo: { contains: busqueda, mode: "insensitive" } },
        { numeroSerie: { contains: busqueda, mode: "insensitive" } },
      ],
    }),
  };

  // findMany + count en paralelo: una sola ida-vuelta a Postgres conceptual,
  // dos queries lanzadas a la vez con Promise.all.
  const [datos, total] = await Promise.all([
    prisma.activo.findMany({
      where,
      skip: (pagina - 1) * limite,
      take: limite,
      orderBy: { codigo: "asc" },
      include: {
        subestacion: { select: { id: true, codigo: true, nombre: true } },
        etiquetas: true,
      },
    }),
    prisma.activo.count({ where }),
  ]);

  return {
    datos,
    paginacion: formatearPaginacion(pagina, limite, total),
  };
}

export async function obtenerActivo(id) {
  const activo = await prisma.activo.findUnique({
    where: { id },
    include: {
      subestacion: { select: { id: true, codigo: true, nombre: true } },
      etiquetas: true,
      // Últimas 10 OTs ordenadas por fecha de intervención desc. Incluimos
      // autor (id/nombre/email) para que el frontend futuro lo muestre sin
      // un segundo round-trip.
      ordenesTrabajo: {
        take: 10,
        orderBy: { fechaIntervencion: "desc" },
        include: {
          autor: { select: { id: true, nombre: true, email: true } },
        },
      },
    },
  });

  if (!activo) {
    throw new NoEncontrado("Activo no encontrado");
  }

  return activo;
}

export async function crearActivo(datos, autorId) {
  const {
    codigo,
    tipo,
    fabricante,
    modelo,
    numeroSerie,
    fechaPuestaEnServicio,
    subestacionId,
  } = datos;

  // fechaProximaInspeccion la calcula el service, no el cliente: depende del
  // tipo de activo (lib/intervalos-inspeccion.js) y se cuenta desde la puesta
  // en servicio. Aceptarla del cliente sería un agujero para saltarse la regla.
  const fechaProximaInspeccion = calcularProximaInspeccion(
    fechaPuestaEnServicio,
    tipo,
  );

  // Transacción atómica: el activo y su OT INSTALACION nacen juntos o no nacen.
  // Si la creación de la OT falla (por ejemplo, autorId inexistente por una
  // race condition con desactivación de usuario), el activo tampoco se crea.
  const [activo] = await prisma.$transaction(async (tx) => {
    const nuevoActivo = await tx.activo.create({
      data: {
        codigo,
        tipo,
        fabricante,
        modelo,
        numeroSerie,
        fechaPuestaEnServicio,
        fechaProximaInspeccion,
        subestacionId,
        // estado por defecto EN_SERVICIO (schema Prisma); no lo pasamos
        // explícitamente para que el default quede como única fuente de verdad.
      },
      include: {
        subestacion: { select: { id: true, codigo: true, nombre: true } },
        etiquetas: true,
      },
    });

    // OT INSTALACION inicial. estadoAnterior = DADO_DE_BAJA es una convención
    // documentada en el scope: la matriz de transiciones modela INSTALACION
    // como DADO_DE_BAJA -> EN_SERVICIO, y respetamos esa semántica también
    // para el alta inicial para que la matriz sea la única fuente de verdad.
    await tx.ordenTrabajo.create({
      data: {
        tipo: "INSTALACION",
        descripcion: `Puesta en servicio del activo ${codigo}`,
        estadoAnterior: "DADO_DE_BAJA",
        estadoNuevo: "EN_SERVICIO",
        activoId: nuevoActivo.id,
        autorId,
      },
    });

    return [nuevoActivo];
  });

  return activo;
}

export async function editarActivo(id, datos) {
  // Verificamos existencia antes de update para devolver 404 explícito en vez
  // de depender del P2025 de Prisma. Mismo patrón que en subestaciones.
  const existe = await prisma.activo.findUnique({ where: { id } });
  if (!existe) {
    throw new NoEncontrado("Activo no encontrado");
  }

  return prisma.activo.update({
    where: { id },
    data: datos,
    include: {
      subestacion: { select: { id: true, codigo: true, nombre: true } },
      etiquetas: true,
    },
  });
}

export async function listarHistorialActivo(activoId, paginacion) {
  const { pagina, limite } = paginacion;

  // Verificación previa para 404 explícito. Si el activo no existe, una página
  // vacía sería ambigua (¿no existe? ¿no tiene OTs?). Mejor un error claro.
  const existe = await prisma.activo.findUnique({
    where: { id: activoId },
    select: { id: true },
  });
  if (!existe) {
    throw new NoEncontrado("Activo no encontrado");
  }

  const [datos, total] = await Promise.all([
    prisma.ordenTrabajo.findMany({
      where: { activoId },
      skip: (pagina - 1) * limite,
      take: limite,
      orderBy: { fechaIntervencion: "desc" },
      include: {
        autor: { select: { id: true, nombre: true, email: true } },
      },
    }),
    prisma.ordenTrabajo.count({ where: { activoId } }),
  ]);

  return {
    datos,
    paginacion: formatearPaginacion(pagina, limite, total),
  };
}
