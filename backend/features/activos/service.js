// backend/features/activos/service.js

import prisma from "../../lib/prisma.js";
import { NoEncontrado, ReglaNegocio } from "../../lib/errores.js";
import { calcularProximaInspeccion } from "../../lib/intervalos-inspeccion.js";

// features/activos/service.js (ampliación)
//
// Añadir a los imports existentes:
import { aplicarTransicion } from "../../lib/transiciones.js";
import { notificarWebhook } from "../../lib/webhook.js";

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

// features/activos/service.js (continuación)

// Registra una nueva OT sobre un activo (scope §9, reglas A y B).
//
// Orquesta:
//  - Regla B: bloqueo por inspección vencida ANTES de tocar BD.
//  - Regla A: máquina de estados, aplicada DENTRO de $transaction
//    para garantizar atomicidad entre crear OT y actualizar Activo.
//  - Snapshot estadoAnterior/estadoNuevo: el histórico es autosuficiente
//    aunque la matriz de transiciones cambie en el futuro (scope §15).
//  - Recálculo de fechaProximaInspeccion en INSPECCION con resultado OK.
//  - Webhook DESPUÉS del commit en eventos críticos (scope §8).
export async function registrarOrdenTrabajo({ activoId, autorId, datos }) {
  const { tipo, descripcion, resultado, fechaIntervencion } = datos;

  // Carga previa: necesitamos tipo (para intervalo de inspección),
  // estado actual (para regla A) y fechaProximaInspeccion (para regla B).
  const activo = await prisma.activo.findUnique({
    where: { id: activoId },
    select: {
      id: true,
      codigo: true,
      tipo: true,
      estado: true,
      fechaProximaInspeccion: true,
      // Subestación incluida para enriquecer el payload del webhook (scope §8).
      subestacion: {
        select: { id: true, codigo: true, nombre: true },
      },
    },
  });

  if (!activo) {
    throw new NoEncontrado("Activo no encontrado");
  }

  // Regla B (scope §7): bloqueo por inspección vencida.
  // Se evalúa FUERA de la transacción: si falla, no abrimos BD ni
  // disparamos webhook. Fail fast = menos ruido en logs y menos coste.
  if (tipo === "PREVENTIVO" && activo.fechaProximaInspeccion < new Date()) {
    throw new ReglaNegocio(
      "Activo con inspección vencida; debe realizarse una INSPECCION antes de un mantenimiento preventivo",
    );
  }

  // Regla A dentro de $transaction: crear OT y actualizar Activo
  // deben ser atómicos. Si la transición es inválida, lanzamos
  // ReglaNegocio y Prisma hace rollback automático.
  const otCreada = await prisma.$transaction(async (tx) => {
    // aplicarTransicion es función pura: sin BD, sin Express.
    // Devuelve { estadoNuevo } o { error }.
    // aplicarTransicion es función pura (scope §7 regla A): devuelve
    // directamente el estadoNuevo o lanza ReglaNegocio si la celda
    // de la matriz es prohibida. Si lanza dentro de $transaction,
    // Prisma hace rollback automático.
    const estadoNuevo = aplicarTransicion(activo.estado, tipo, resultado);

    // Recálculo de fechaProximaInspeccion: solo cuando una INSPECCION
    // termina OK. Si AVERIA_DETECTADA, el activo pasa a AVERIADO y la
    // próxima inspección se reprogramará cuando vuelva a EN_SERVICIO
    // (no es responsabilidad de este endpoint).
    const nuevaFechaInspeccion =
      tipo === "INSPECCION" && resultado === "CONFORME"
        ? calcularProximaInspeccion(new Date(), activo.tipo)
        : null;

    // Crear la OT con snapshot del estado antes/después.
    // El snapshot hace al histórico autosuficiente: si mañana cambia
    // la matriz de transiciones, las OTs antiguas siguen siendo
    // consultables sin reproducir la lógica vigente.
    const ot = await tx.ordenTrabajo.create({
      data: {
        tipo,
        descripcion,
        resultado: resultado ?? null,
        estadoAnterior: activo.estado,
        estadoNuevo,
        // Si no viene en el body, Prisma usa @default(now()).
        ...(fechaIntervencion && { fechaIntervencion }),
        activoId: activo.id,
        autorId,
      },
      include: {
        autor: { select: { id: true, nombre: true, email: true } },
      },
    });

    // Actualizar el activo: estado siempre, fechaProximaInspeccion solo
    // si toca recalcularla. Si no toca, no la pisamos.
    await tx.activo.update({
      where: { id: activo.id },
      data: {
        estado: estadoNuevo,
        ...(nuevaFechaInspeccion && {
          fechaProximaInspeccion: nuevaFechaInspeccion,
        }),
      },
    });

    return ot;
  });

  // Webhook DESPUÉS del commit (scope §8). Si lo disparáramos dentro
  // de la transacción y luego hiciera rollback, habríamos notificado
  // un evento que no ocurrió. Async no bloqueante: no se hace await,
  // el usuario recibe la respuesta sin esperar a n8n.
  const esCorrectivo = tipo === "CORRECTIVO";
  const esInspeccionConAveria =
    tipo === "INSPECCION" && resultado === "NO_CONFORME";

  if (esCorrectivo || esInspeccionConAveria) {
    const evento = esCorrectivo ? "ot.correctivo" : "ot.averia_detectada";
    notificarWebhook(evento, {
      activo: {
        id: activo.id,
        codigo: activo.codigo,
        tipo: activo.tipo,
        estadoAnterior: otCreada.estadoAnterior,
        estadoNuevo: otCreada.estadoNuevo,
      },
      subestacion: {
        id: activo.subestacion.id,
        codigo: activo.subestacion.codigo,
        nombre: activo.subestacion.nombre,
      },
      ordenTrabajo: {
        id: otCreada.id,
        tipo: otCreada.tipo,
        descripcion: otCreada.descripcion,
        resultado: otCreada.resultado,
        autorId: otCreada.autorId,
      },
    });
  }

  return otCreada;
}
