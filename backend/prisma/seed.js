import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { obtenerIntervaloInspeccion } from "../lib/intervalos-inspeccion.js";

const prisma = new PrismaClient();

// Fechas relativas a "ahora" para que el dashboard siempre tenga datos
// dentro de la ventana de 30 días, sin importar cuándo se corra el seed.
const ahora = new Date();
const enDias = (d) => new Date(ahora.getTime() + d * 24 * 60 * 60 * 1000);

// Limpieza en cascada respetando las FK con onDelete: Restrict.
// Orden: OTs → Activos (limpia N:M con Etiquetas) → Etiquetas → Subestaciones → Usuarios.
async function limpiar() {
  await prisma.ordenTrabajo.deleteMany();
  await prisma.activo.deleteMany();
  await prisma.etiqueta.deleteMany();
  await prisma.subestacion.deleteMany();
  await prisma.usuario.deleteMany();
}

async function crearUsuarios() {
  // Tres contraseñas hasheadas. bcrypt.hash es costoso (10 rondas), así que las generamos
  // una vez y reutilizamos por rol.
  const passwordAdmin = await bcrypt.hash("admin123", 10);
  const passwordTecnico = await bcrypt.hash("tecnico123", 10);
  const passwordOperario = await bcrypt.hash("operario123", 10);

  const admin = await prisma.usuario.create({
    data: {
      email: "admin@gmao.com",
      passwordHash: passwordAdmin,
      nombre: "Ana Administradora",
      rol: "ADMIN",
    },
  });
  const tecnico1 = await prisma.usuario.create({
    data: {
      email: "tecnico@gmao.com",
      passwordHash: passwordTecnico,
      nombre: "Tomás Técnico",
      rol: "TECNICO",
    },
  });
  const tecnico2 = await prisma.usuario.create({
    data: {
      email: "tecnico2@gmao.com",
      passwordHash: passwordTecnico,
      nombre: "Teresa Técnica",
      rol: "TECNICO",
    },
  });
  const operario1 = await prisma.usuario.create({
    data: {
      email: "operario@gmao.com",
      passwordHash: passwordOperario,
      nombre: "Óscar Operario",
      rol: "OPERARIO",
    },
  });
  const operario2 = await prisma.usuario.create({
    data: {
      email: "operario2@gmao.com",
      passwordHash: passwordOperario,
      nombre: "Olivia Operaria",
      rol: "OPERARIO",
    },
  });

  return { admin, tecnico1, tecnico2, operario1, operario2 };
}

async function crearSubestaciones() {
  // Códigos siguiendo nomenclatura sectorial: SE-<zona>-<tensión nominal kV>.
  const norte = await prisma.subestacion.create({
    data: {
      codigo: "SE-NORTE-220",
      nombre: "Subestación Norte 220kV",
      ubicacion: "Madrid",
      tensionNominal: 220,
    },
  });
  const levante = await prisma.subestacion.create({
    data: {
      codigo: "SE-LEVANTE-132",
      nombre: "Subestación Levante 132kV",
      ubicacion: "Valencia",
      tensionNominal: 132,
    },
  });
  const costa = await prisma.subestacion.create({
    data: {
      codigo: "SE-COSTA-66",
      nombre: "Subestación Costa 66kV",
      ubicacion: "Málaga",
      tensionNominal: 66,
    },
  });
  // Una subestación inactiva (soft delete) para demostrar el campo `activa: false`.
  // No tiene activos asociados — un GMAO real no tendría activos vivos en una subestación retirada.
  const industrial = await prisma.subestacion.create({
    data: {
      codigo: "SE-INDUSTRIAL-45",
      nombre: "Subestación Polígono Industrial 45kV",
      ubicacion: "Sevilla",
      tensionNominal: 45,
      activa: false,
    },
  });

  return { norte, levante, costa, industrial };
}

async function crearEtiquetas() {
  // 4 etiquetas con color (anticipación para el frontend futuro).
  const critico = await prisma.etiqueta.create({
    data: { nombre: "Crítico", color: "#dc2626" },
  });
  const garantia = await prisma.etiqueta.create({
    data: { nombre: "Garantía vigente", color: "#16a34a" },
  });
  const postTormenta = await prisma.etiqueta.create({
    data: { nombre: "Revisión post-tormenta", color: "#eab308" },
  });
  const pendienteBaja = await prisma.etiqueta.create({
    data: { nombre: "Pendiente de baja", color: "#6b7280" },
  });

  return { critico, garantia, postTormenta, pendienteBaja };
}

// Crea un activo + su OT de INSTALACION inicial. El estado final del activo se ajusta
// con OTs posteriores (no en este helper) si tiene que terminar AVERIADO, FUERA, etc.
//
// estadoAnterior de la INSTALACION = DADO_DE_BAJA: es lo que dice la matriz de Regla A.
// Conceptualmente "el activo nace en estado virtual DADO_DE_BAJA y la INSTALACION lo
// trae a EN_SERVICIO". Feo narrativamente pero coherente con la matriz.
async function crearActivoConInstalacion(datos, autorId) {
  const {
    codigo,
    tipo,
    fabricante,
    modelo,
    numeroSerie,
    subestacionId,
    diasDesdePuestaEnServicio,
  } = datos;

  const fechaPuestaEnServicio = enDias(diasDesdePuestaEnServicio);
  // fechaProximaInspeccion inicial = puesta en servicio + intervalo del tipo.
  // Después algunos activos tendrán INSPECCIONes que la recalcularán.
  const fechaProximaInspeccion = new Date(
    fechaPuestaEnServicio.getTime() +
      obtenerIntervaloInspeccion(tipo) * 24 * 60 * 60 * 1000,
  );

  const activo = await prisma.activo.create({
    data: {
      codigo,
      tipo,
      fabricante,
      modelo,
      numeroSerie,
      fechaPuestaEnServicio,
      fechaProximaInspeccion,
      estado: "EN_SERVICIO", // arranca siempre EN_SERVICIO; OTs posteriores lo moverán
      subestacionId,
    },
  });

  await prisma.ordenTrabajo.create({
    data: {
      tipo: "INSTALACION",
      descripcion: `Puesta en servicio de ${codigo}`,
      estadoAnterior: "DADO_DE_BAJA",
      estadoNuevo: "EN_SERVICIO",
      fechaIntervencion: fechaPuestaEnServicio,
      createdAt: fechaPuestaEnServicio,
      activoId: activo.id,
      autorId,
    },
  });

  return activo;
}

async function crearActivos(usuarios, subs) {
  // --- EN_SERVICIO con inspección al día (8 activos, cubren los 6 tipos) ---

  const ac01 = await crearActivoConInstalacion(
    {
      codigo: "T-NORTE-01",
      tipo: "TRANSFORMADOR_POTENCIA",
      fabricante: "Siemens",
      modelo: "TR-220-40",
      numeroSerie: "SN-2024-001",
      subestacionId: subs.norte.id,
      diasDesdePuestaEnServicio: -120,
    },
    usuarios.tecnico1.id,
  );

  const ac02 = await crearActivoConInstalacion(
    {
      codigo: "T-NORTE-02",
      tipo: "TRANSFORMADOR_POTENCIA",
      fabricante: "ABB",
      modelo: "TR-220-50",
      numeroSerie: "SN-2024-002",
      subestacionId: subs.norte.id,
      diasDesdePuestaEnServicio: -100,
    },
    usuarios.tecnico1.id,
  );

  const ac03 = await crearActivoConInstalacion(
    {
      codigo: "QA-NORTE-01",
      tipo: "INTERRUPTOR_AUTOMATICO",
      fabricante: "Schneider",
      modelo: "SF6-220",
      numeroSerie: "SN-2024-003",
      subestacionId: subs.norte.id,
      diasDesdePuestaEnServicio: -200,
    },
    usuarios.tecnico2.id,
  );

  const ac04 = await crearActivoConInstalacion(
    {
      codigo: "QA-LEVANTE-01",
      tipo: "INTERRUPTOR_AUTOMATICO",
      fabricante: "ABB",
      modelo: "SF6-132",
      numeroSerie: "SN-2024-004",
      subestacionId: subs.levante.id,
      diasDesdePuestaEnServicio: -180,
    },
    usuarios.tecnico2.id,
  );

  const ac05 = await crearActivoConInstalacion(
    {
      codigo: "QB-LEVANTE-01",
      tipo: "SECCIONADOR",
      fabricante: "Hitachi",
      modelo: "SC-132",
      numeroSerie: "SN-2024-005",
      subestacionId: subs.levante.id,
      diasDesdePuestaEnServicio: -60,
    },
    usuarios.tecnico1.id,
  );

  const ac06 = await crearActivoConInstalacion(
    {
      codigo: "F-COSTA-01",
      tipo: "PARARRAYOS",
      fabricante: "Siemens",
      modelo: "PR-66",
      numeroSerie: "SN-2024-006",
      subestacionId: subs.costa.id,
      diasDesdePuestaEnServicio: -300,
    },
    usuarios.tecnico2.id,
  );

  const ac07 = await crearActivoConInstalacion(
    {
      codigo: "TT-COSTA-01",
      tipo: "TRANSFORMADOR_MEDIDA",
      fabricante: "Arteche",
      modelo: "TM-66",
      numeroSerie: "SN-2024-007",
      subestacionId: subs.costa.id,
      diasDesdePuestaEnServicio: -250,
    },
    usuarios.tecnico1.id,
  );

  const ac08 = await crearActivoConInstalacion(
    {
      codigo: "C-LEVANTE-01",
      tipo: "BATERIA_CONDENSADORES",
      fabricante: "ABB",
      modelo: "BC-132",
      numeroSerie: "SN-2024-008",
      subestacionId: subs.levante.id,
      diasDesdePuestaEnServicio: -150,
    },
    usuarios.tecnico2.id,
  );

  // --- EN_SERVICIO con inspección VENCIDA (3 activos, alimentan el top del dashboard) ---

  const ac09 = await crearActivoConInstalacion(
    {
      codigo: "T-LEVANTE-01",
      tipo: "TRANSFORMADOR_POTENCIA",
      fabricante: "Hitachi",
      modelo: "TR-132-30",
      numeroSerie: "SN-2024-009",
      subestacionId: subs.levante.id,
      diasDesdePuestaEnServicio: -200,
    },
    usuarios.tecnico1.id,
  );
  await prisma.activo.update({
    where: { id: ac09.id },
    data: { fechaProximaInspeccion: enDias(-5) },
  });

  const ac10 = await crearActivoConInstalacion(
    {
      codigo: "QB-COSTA-01",
      tipo: "SECCIONADOR",
      fabricante: "Schneider",
      modelo: "SC-66",
      numeroSerie: "SN-2024-010",
      subestacionId: subs.costa.id,
      diasDesdePuestaEnServicio: -100,
    },
    usuarios.tecnico2.id,
  );
  await prisma.activo.update({
    where: { id: ac10.id },
    data: { fechaProximaInspeccion: enDias(-25) },
  });

  const ac11 = await crearActivoConInstalacion(
    {
      codigo: "QA-NORTE-02",
      tipo: "INTERRUPTOR_AUTOMATICO",
      fabricante: "Siemens",
      modelo: "SF6-220-G2",
      numeroSerie: "SN-2024-011",
      subestacionId: subs.norte.id,
      diasDesdePuestaEnServicio: -400,
    },
    usuarios.tecnico1.id,
  );
  await prisma.activo.update({
    where: { id: ac11.id },
    data: { fechaProximaInspeccion: enDias(-90) },
  });

  // --- AVERIADO (2 activos) ---

  const ac12 = await crearActivoConInstalacion(
    {
      codigo: "T-NORTE-03",
      tipo: "TRANSFORMADOR_POTENCIA",
      fabricante: "ABB",
      modelo: "TR-220-60",
      numeroSerie: "SN-2024-012",
      subestacionId: subs.norte.id,
      diasDesdePuestaEnServicio: -90,
    },
    usuarios.tecnico1.id,
  );
  await prisma.activo.update({
    where: { id: ac12.id },
    data: { estado: "AVERIADO" },
  });

  const ac13 = await crearActivoConInstalacion(
    {
      codigo: "F-LEVANTE-01",
      tipo: "PARARRAYOS",
      fabricante: "ABB",
      modelo: "PR-132",
      numeroSerie: "SN-2024-013",
      subestacionId: subs.levante.id,
      diasDesdePuestaEnServicio: -160,
    },
    usuarios.tecnico2.id,
  );
  await prisma.activo.update({
    where: { id: ac13.id },
    data: { estado: "AVERIADO" },
  });

  // --- FUERA_DE_SERVICIO (2 activos) ---

  const ac14 = await crearActivoConInstalacion(
    {
      codigo: "QA-COSTA-01",
      tipo: "INTERRUPTOR_AUTOMATICO",
      fabricante: "Hitachi",
      modelo: "SF6-66",
      numeroSerie: "SN-2024-014",
      subestacionId: subs.costa.id,
      diasDesdePuestaEnServicio: -220,
    },
    usuarios.tecnico1.id,
  );
  await prisma.activo.update({
    where: { id: ac14.id },
    data: { estado: "FUERA_DE_SERVICIO" },
  });

  const ac15 = await crearActivoConInstalacion(
    {
      codigo: "T-NORTE-04",
      tipo: "TRANSFORMADOR_POTENCIA",
      fabricante: "Siemens",
      modelo: "TR-220-45",
      numeroSerie: "SN-2024-015",
      subestacionId: subs.norte.id,
      diasDesdePuestaEnServicio: -140,
    },
    usuarios.tecnico2.id,
  );
  await prisma.activo.update({
    where: { id: ac15.id },
    data: { estado: "FUERA_DE_SERVICIO" },
  });

  // --- DADO_DE_BAJA (3 activos). AC-018 (TT-NORTE-01) tiene además inspección vencida:
  // caso crítico para verificar que el dashboard NO lo incluye en vencidas ni en el top.
  const ac16 = await crearActivoConInstalacion(
    {
      codigo: "C-NORTE-01",
      tipo: "BATERIA_CONDENSADORES",
      fabricante: "ABB",
      modelo: "BC-66-OLD",
      numeroSerie: "SN-2022-016",
      subestacionId: subs.norte.id,
      diasDesdePuestaEnServicio: -800,
    },
    usuarios.tecnico1.id,
  );
  await prisma.activo.update({
    where: { id: ac16.id },
    data: { estado: "DADO_DE_BAJA" },
  });

  const ac17 = await crearActivoConInstalacion(
    {
      codigo: "QB-LEVANTE-02",
      tipo: "SECCIONADOR",
      fabricante: "Schneider",
      modelo: "SC-220-OLD",
      numeroSerie: "SN-2022-017",
      subestacionId: subs.levante.id,
      diasDesdePuestaEnServicio: -600,
    },
    usuarios.tecnico2.id,
  );
  await prisma.activo.update({
    where: { id: ac17.id },
    data: { estado: "DADO_DE_BAJA" },
  });

  const ac18 = await crearActivoConInstalacion(
    {
      codigo: "TT-NORTE-01",
      tipo: "TRANSFORMADOR_MEDIDA",
      fabricante: "Arteche",
      modelo: "TM-220-OLD",
      numeroSerie: "SN-2022-018",
      subestacionId: subs.norte.id,
      diasDesdePuestaEnServicio: -700,
    },
    usuarios.tecnico1.id,
  );
  await prisma.activo.update({
    where: { id: ac18.id },
    data: { estado: "DADO_DE_BAJA", fechaProximaInspeccion: enDias(-50) },
  });

  return {
    ac01,
    ac02,
    ac03,
    ac04,
    ac05,
    ac06,
    ac07,
    ac08,
    ac09,
    ac10,
    ac11,
    ac12,
    ac13,
    ac14,
    ac15,
    ac16,
    ac17,
    ac18,
  };
}

async function crearOtsAdicionales(activos, usuarios) {
  // Helper local: crea una OT con los campos comunes. Reduce ruido en las llamadas.
  const crearOT = (datos) =>
    prisma.ordenTrabajo.create({
      data: {
        ...datos,
        fechaIntervencion: datos.fechaIntervencion ?? datos.createdAt,
      },
    });

  // INSPECCIONes recientes (últimos 30 días) con OK para los activos EN_SERVICIO al día.
  // Esto alimenta otsUltimos30DiasPorTipo.INSPECCION en el dashboard.
  await crearOT({
    tipo: "INSPECCION",
    resultado: "CONFORME",
    descripcion: "Inspección rutinaria trimestral",
    estadoAnterior: "EN_SERVICIO",
    estadoNuevo: "EN_SERVICIO",
    createdAt: enDias(-7),
    activoId: activos.ac01.id,
    autorId: usuarios.operario1.id,
  });
  await crearOT({
    tipo: "INSPECCION",
    resultado: "CONFORME",
    descripcion: "Inspección rutinaria",
    estadoAnterior: "EN_SERVICIO",
    estadoNuevo: "EN_SERVICIO",
    createdAt: enDias(-12),
    activoId: activos.ac03.id,
    autorId: usuarios.operario2.id,
  });
  await crearOT({
    tipo: "INSPECCION",
    resultado: "CONFORME",
    descripcion: "Inspección post-mantenimiento",
    estadoAnterior: "EN_SERVICIO",
    estadoNuevo: "EN_SERVICIO",
    createdAt: enDias(-3),
    activoId: activos.ac06.id,
    autorId: usuarios.operario1.id,
  });
  await crearOT({
    tipo: "INSPECCION",
    resultado: "CONFORME",
    descripcion: "Inspección rutinaria",
    estadoAnterior: "EN_SERVICIO",
    estadoNuevo: "EN_SERVICIO",
    createdAt: enDias(-20),
    activoId: activos.ac08.id,
    autorId: usuarios.tecnico2.id,
  });

  // 1 PREVENTIVO reciente sobre AC-002 (lo dejó FUERA y luego volvió — pero como queremos
  // que esté EN_SERVICIO ahora, simulamos que también se hizo un CORRECTIVO que lo devolvió).
  // Más simple: PREVENTIVO sobre el AC-014 que sí está FUERA.
  await crearOT({
    tipo: "PREVENTIVO",
    descripcion:
      "Mantenimiento preventivo programado: cambio de aceite y filtros",
    estadoAnterior: "EN_SERVICIO",
    estadoNuevo: "FUERA_DE_SERVICIO",
    createdAt: enDias(-10),
    activoId: activos.ac14.id,
    autorId: usuarios.tecnico1.id,
  });

  // CORRECTIVO sobre AC-015 (estaba averiado y se corrigió, pero aún no vuelve a EN_SERVICIO).
  // Histórico: INSPECCION (averia detectada) -> CORRECTIVO (a FUERA, esperando puesta en servicio).
  // Histórico de AC-015: INSPECCION NO_CONFORME → CORRECTIVO (queda FUERA_DE_SERVICIO).
  await crearOT({
    tipo: "INSPECCION",
    resultado: "NO_CONFORME",
    descripcion: "Fuga de aceite detectada en arqueta inferior",
    estadoAnterior: "EN_SERVICIO",
    estadoNuevo: "AVERIADO",
    createdAt: enDias(-8),
    activoId: activos.ac15.id,
    autorId: usuarios.operario2.id,
  });

  await crearOT({
    tipo: "CORRECTIVO",
    descripcion: "Reparación de junta inferior y reposición de aceite",
    estadoAnterior: "AVERIADO",
    estadoNuevo: "FUERA_DE_SERVICIO",
    createdAt: enDias(-3),
    activoId: activos.ac15.id,
    autorId: usuarios.tecnico2.id,
  });

  // INSPECCIONes NO_CONFORME que explican los AVERIADO actuales (AC-012, AC-013).
  await crearOT({
    tipo: "INSPECCION",
    resultado: "NO_CONFORME",
    descripcion: "Anomalía térmica detectada en bobinado primario",
    estadoAnterior: "EN_SERVICIO",
    estadoNuevo: "AVERIADO",
    createdAt: enDias(-5),
    activoId: activos.ac12.id,
    autorId: usuarios.operario1.id,
  });
  await crearOT({
    tipo: "INSPECCION",
    resultado: "NO_CONFORME",
    descripcion: "Pararrayos fracturado por descarga atmosférica",
    estadoAnterior: "EN_SERVICIO",
    estadoNuevo: "AVERIADO",
    createdAt: enDias(-15),
    activoId: activos.ac13.id,
    autorId: usuarios.tecnico2.id,
  });

  // BAJAs de los DADO_DE_BAJA. Repartidas en el tiempo: AC-016 hace 60 días (fuera de la
  // ventana de 30), AC-017 hace 25 días (dentro de la ventana), AC-018 hace 10 días (dentro).
  // Así el dashboard mostrará BAJA: 2 en otsUltimos30DiasPorTipo, no 3.
  await crearOT({
    tipo: "BAJA",
    descripcion: "Retirada por fin de vida útil",
    estadoAnterior: "EN_SERVICIO",
    estadoNuevo: "DADO_DE_BAJA",
    createdAt: enDias(-60),
    activoId: activos.ac16.id,
    autorId: usuarios.admin.id,
  });
  await crearOT({
    tipo: "BAJA",
    descripcion: "Sustituido por modelo nuevo de mayor capacidad",
    estadoAnterior: "EN_SERVICIO",
    estadoNuevo: "DADO_DE_BAJA",
    createdAt: enDias(-25),
    activoId: activos.ac17.id,
    autorId: usuarios.admin.id,
  });
  await crearOT({
    tipo: "BAJA",
    descripcion: "Daños irreparables por sobretensión",
    estadoAnterior: "AVERIADO",
    estadoNuevo: "DADO_DE_BAJA",
    createdAt: enDias(-10),
    activoId: activos.ac18.id,
    autorId: usuarios.tecnico1.id,
  });

  // Una INSPECCION antigua (fuera de la ventana de 30 días) para demostrar que el dashboard
  // la ignora en otsUltimos30DiasPorTipo aunque sí aparezca si se consulta el histórico del activo.
  // INSPECCION antigua (fuera de la ventana de 30 días): el dashboard la ignora
  // en otsUltimos30DiasPorTipo aunque aparezca en el histórico del activo.
  await crearOT({
    tipo: "INSPECCION",
    resultado: "CONFORME",
    descripcion: "Inspección anterior",
    estadoAnterior: "EN_SERVICIO",
    estadoNuevo: "EN_SERVICIO",
    createdAt: enDias(-45),
    activoId: activos.ac01.id,
    autorId: usuarios.operario1.id,
  });
}

async function asociarEtiquetas(activos, etiquetas) {
  // Activos críticos: los dos transformadores de 220 kV de la Norte.
  // AC-002 lleva además "Garantía vigente" (instalación reciente) — demuestra cardinalidad N:M.
  await prisma.activo.update({
    where: { id: activos.ac01.id },
    data: { etiquetas: { connect: [{ id: etiquetas.critico.id }] } },
  });
  await prisma.activo.update({
    where: { id: activos.ac02.id },
    data: {
      etiquetas: {
        connect: [{ id: etiquetas.critico.id }, { id: etiquetas.garantia.id }],
      },
    },
  });

  // Pararrayos: revisión post-tormenta (caso típico de campo).
  await prisma.activo.update({
    where: { id: activos.ac06.id },
    data: { etiquetas: { connect: [{ id: etiquetas.postTormenta.id }] } },
  });

  // Averiado crítico (transformador potencia averiado en SE Norte).
  await prisma.activo.update({
    where: { id: activos.ac12.id },
    data: { etiquetas: { connect: [{ id: etiquetas.critico.id }] } },
  });

  // Fuera de servicio esperando baja.
  await prisma.activo.update({
    where: { id: activos.ac14.id },
    data: { etiquetas: { connect: [{ id: etiquetas.pendienteBaja.id }] } },
  });
}

async function main() {
  console.log("🧹 Limpiando base de datos...");
  await limpiar();

  console.log("👥 Creando usuarios...");
  const usuarios = await crearUsuarios();

  console.log("🏭 Creando subestaciones...");
  const subs = await crearSubestaciones();

  console.log("🏷️  Creando etiquetas...");
  const etiquetas = await crearEtiquetas();

  console.log("⚡ Creando activos (con OT de INSTALACION cada uno)...");
  const activos = await crearActivos(usuarios, subs);

  console.log("📋 Creando órdenes de trabajo históricas...");
  await crearOtsAdicionales(activos, usuarios);

  console.log("🔗 Asociando etiquetas a activos...");
  await asociarEtiquetas(activos, etiquetas);

  // Conteos finales para el log de salida. Útil al profesor: ve de un vistazo qué hay.
  const [nUsuarios, nSubs, nSubsActivas, nActivos, nEtiquetas, nOTs] =
    await Promise.all([
      prisma.usuario.count(),
      prisma.subestacion.count(),
      prisma.subestacion.count({ where: { activa: true } }),
      prisma.activo.count(),
      prisma.etiqueta.count(),
      prisma.ordenTrabajo.count(),
    ]);

  console.log("");
  console.log("✅ Seed completado");
  console.log(
    `   ${nUsuarios} usuarios | ${nSubs} subestaciones (${nSubsActivas} activas) | ${nActivos} activos | ${nEtiquetas} etiquetas | ${nOTs} órdenes de trabajo`,
  );
  console.log("");
  console.log("👤 Credenciales de prueba:");
  console.log("   ADMIN:    admin@gmao.com / admin123");
  console.log("   TECNICO:  tecnico@gmao.com / tecnico123");
  console.log("   TECNICO:  tecnico2@gmao.com / tecnico123");
  console.log("   OPERARIO: operario@gmao.com / operario123");
  console.log("   OPERARIO: operario2@gmao.com / operario123");
}

main()
  .catch((err) => {
    console.error("❌ Error en el seed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
