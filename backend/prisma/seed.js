// backend/prisma/seed.js
//
// Seed de datos realistas para demo. Cubre todos los tipos de activo, todos los estados,
// y deja un histórico de OTs que demuestra la trazabilidad y la máquina de estados.
//
// Estrategia: borrado limpio + creación. Idempotente (puedes lanzarlo varias veces).
// No uso upsert porque con datos de demo (varios activos del mismo tipo, OTs encadenadas)
// el upsert se complica más que un borrado limpio.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { obtenerIntervaloInspeccion } from "../lib/intervalos-inspeccion.js";

const prisma = new PrismaClient();

// Helper para construir fechas relativas a hoy sin liarme con timezones.
// "Hace N días" o "en N días".
function diasDesdeHoy(dias) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  return fecha;
}

async function limpiarBD() {
  // Orden importa por las FK con onDelete: Restrict.
  // OTs primero (dependen de Activo y Usuario), luego la tabla puente implícita
  // (Prisma la limpia sola al borrar Activo o Etiqueta), luego el resto.
  await prisma.ordenTrabajo.deleteMany();
  await prisma.activo.deleteMany();
  await prisma.etiqueta.deleteMany();
  await prisma.subestacion.deleteMany();
  await prisma.usuario.deleteMany();
}

async function main() {
  console.log("🧹 Limpiando BD...");
  await limpiarBD();

  // ============================================================
  // Usuarios: uno de cada rol + un par extra para tener variedad de autores en OTs.
  // Nombres realistas (nombre + apellidos en un solo campo, como define el scope §6.2).
  // El email usa el patrón nombre.apellido@gmao.com, también realista.
  // ============================================================
  console.log("👤 Creando usuarios...");

  // Defino los usuarios como datos antes de crearlos. Así puedo iterar después
  // para imprimir el resumen sin hardcodear nada y guardar la password en claro
  // (solo para el log final; en BD va el hash).
  const usuariosSeed = [
    {
      email: "ana.garcia@gmao.com",
      password: "admin123",
      nombre: "Ana García Ruiz",
      rol: "ADMIN",
    },
    {
      email: "tomas.lopez@gmao.com",
      password: "tecnico123",
      nombre: "Tomás López Fernández",
      rol: "TECNICO",
    },
    {
      email: "teresa.martin@gmao.com",
      password: "tecnico123",
      nombre: "Teresa Martín Sanz",
      rol: "TECNICO",
    },
    {
      email: "oscar.romero@gmao.com",
      password: "operario123",
      nombre: "Óscar Romero Díaz",
      rol: "OPERARIO",
    },
    {
      email: "olga.navarro@gmao.com",
      password: "operario123",
      nombre: "Olga Navarro Gil",
      rol: "OPERARIO",
    },
  ];

  // Creo todos en paralelo (independientes entre sí). Hash bcrypt cost 10, igual que el código del profesor.
  const usuariosCreados = await Promise.all(
    usuariosSeed.map(async (u) => {
      const passwordHash = await bcrypt.hash(u.password, 10);
      return prisma.usuario.create({
        data: { email: u.email, passwordHash, nombre: u.nombre, rol: u.rol },
      });
    }),
  );

  // Alias con nombres descriptivos para usarlos como autores de OTs más abajo.
  // Mantengo el orden del array usuariosSeed para que el mapeo sea evidente.
  const [admin, tecnico1, tecnico2, operario1, operario2] = usuariosCreados;

  // ============================================================
  // Subestaciones: 4, con tensiones nominales típicas en la red española
  // ============================================================
  console.log("🏭 Creando subestaciones...");

  const seNorte = await prisma.subestacion.create({
    data: {
      codigo: "SE-MAD-N01",
      nombre: "Subestación Madrid Norte",
      ubicacion: "Alcobendas, Madrid",
      tensionNominal: 220,
    },
  });
  const seSur = await prisma.subestacion.create({
    data: {
      codigo: "SE-MAD-S01",
      nombre: "Subestación Madrid Sur",
      ubicacion: "Getafe, Madrid",
      tensionNominal: 132,
    },
  });
  const seEste = await prisma.subestacion.create({
    data: {
      codigo: "SE-VAL-E01",
      nombre: "Subestación Valencia Este",
      ubicacion: "Sagunto, Valencia",
      tensionNominal: 400,
    },
  });
  // Una desactivada para demostrar el soft delete.
  const seDesmantelada = await prisma.subestacion.create({
    data: {
      codigo: "SE-OLD-001",
      nombre: "Subestación Antigua",
      ubicacion: "Toledo",
      tensionNominal: 66,
      activa: false,
    },
  });

  // ============================================================
  // Etiquetas: metadatos transversales (criticidad, intervención reciente, etc.)
  // ============================================================
  console.log("🏷️  Creando etiquetas...");

  const etCritico = await prisma.etiqueta.create({
    data: { nombre: "Crítico", color: "#dc2626" },
  });
  const etRevisar = await prisma.etiqueta.create({
    data: { nombre: "Revisar", color: "#f59e0b" },
  });
  const etRecienInstalado = await prisma.etiqueta.create({
    data: { nombre: "Recién instalado", color: "#10b981" },
  });
  await prisma.etiqueta.create({
    data: { nombre: "Pendiente garantía", color: "#3b82f6" },
  });

  // ============================================================
  // Activos: 16 totales, cubriendo todos los TipoActivo y los 4 EstadoActivo.
  // Usamos obtenerIntervaloInspeccion() para que fechaProximaInspeccion sea coherente
  // con la lógica que más tarde aplicará la Regla B.
  // ============================================================
  console.log("⚙️  Creando activos...");

  // Helper para no repetir el cálculo: fecha próxima inspección = puesta en servicio + intervalo.
  // En la realidad se recalcula con cada INSPECCION OK, pero para el seed nos basta partir de la instalación.
  const proximaDesdeInstalacion = (tipo, fechaInstalacion) => {
    const dias = obtenerIntervaloInspeccion(tipo);
    const proxima = new Date(fechaInstalacion);
    proxima.setDate(proxima.getDate() + dias);
    return proxima;
  };

  // Activos en SE Madrid Norte (220 kV) — 5 activos en EN_SERVICIO
  const trafo1 = await prisma.activo.create({
    data: {
      codigo: "TRF-N01-001",
      tipo: "TRANSFORMADOR_POTENCIA",
      fabricante: "ABB",
      modelo: "TXP-220-50",
      numeroSerie: "ABB-2022-001",
      fechaPuestaEnServicio: diasDesdeHoy(-400),
      fechaProximaInspeccion: proximaDesdeInstalacion(
        "TRANSFORMADOR_POTENCIA",
        diasDesdeHoy(-400),
      ),
      subestacionId: seNorte.id,
      etiquetas: { connect: [{ id: etCritico.id }] },
    },
  });

  const int1 = await prisma.activo.create({
    data: {
      codigo: "INT-N01-001",
      tipo: "INTERRUPTOR_AUTOMATICO",
      fabricante: "Siemens",
      modelo: "3AP1-FG",
      numeroSerie: "SIE-2021-045",
      fechaPuestaEnServicio: diasDesdeHoy(-800),
      fechaProximaInspeccion: diasDesdeHoy(120), // OK, no vencida
      subestacionId: seNorte.id,
    },
  });

  // Este lo dejamos con inspección VENCIDA (-30 días) para demostrar Regla B
  const sec1 = await prisma.activo.create({
    data: {
      codigo: "SEC-N01-001",
      tipo: "SECCIONADOR",
      fabricante: "Hitachi Energy",
      modelo: "DBF-245",
      fechaPuestaEnServicio: diasDesdeHoy(-200),
      fechaProximaInspeccion: diasDesdeHoy(-30), // ← vencida: ideal para probar Regla B
      subestacionId: seNorte.id,
      etiquetas: { connect: [{ id: etRevisar.id }] },
    },
  });

  await prisma.activo.create({
    data: {
      codigo: "PAR-N01-001",
      tipo: "PARARRAYOS",
      fabricante: "ABB",
      modelo: "PEXLIM-Q",
      fechaPuestaEnServicio: diasDesdeHoy(-150),
      fechaProximaInspeccion: diasDesdeHoy(215),
      subestacionId: seNorte.id,
    },
  });

  await prisma.activo.create({
    data: {
      codigo: "TRM-N01-001",
      tipo: "TRANSFORMADOR_MEDIDA",
      fabricante: "Arteche",
      modelo: "UTF-245",
      fechaPuestaEnServicio: diasDesdeHoy(-15), // recién instalado
      fechaProximaInspeccion: diasDesdeHoy(350),
      subestacionId: seNorte.id,
      etiquetas: { connect: [{ id: etRecienInstalado.id }] },
    },
  });

  // Activos en SE Madrid Sur (132 kV) — incluye uno AVERIADO y uno FUERA_DE_SERVICIO
  const trafo2 = await prisma.activo.create({
    data: {
      codigo: "TRF-S01-001",
      tipo: "TRANSFORMADOR_POTENCIA",
      fabricante: "Siemens",
      modelo: "TR-132-25",
      numeroSerie: "SIE-2020-112",
      fechaPuestaEnServicio: diasDesdeHoy(-1200),
      estado: "AVERIADO", // ← detectado en última inspección (ver OTs más abajo)
      fechaProximaInspeccion: diasDesdeHoy(-5),
      subestacionId: seSur.id,
      etiquetas: { connect: [{ id: etCritico.id }, { id: etRevisar.id }] },
    },
  });

  const int2 = await prisma.activo.create({
    data: {
      codigo: "INT-S01-001",
      tipo: "INTERRUPTOR_AUTOMATICO",
      fabricante: "ABB",
      modelo: "LTB-145",
      fechaPuestaEnServicio: diasDesdeHoy(-600),
      estado: "FUERA_DE_SERVICIO", // en mantenimiento preventivo abierto
      fechaProximaInspeccion: diasDesdeHoy(60),
      subestacionId: seSur.id,
    },
  });

  await prisma.activo.create({
    data: {
      codigo: "BAT-S01-001",
      tipo: "BATERIA_CONDENSADORES",
      fabricante: "Schneider",
      modelo: "VarSet-132",
      fechaPuestaEnServicio: diasDesdeHoy(-300),
      fechaProximaInspeccion: diasDesdeHoy(45),
      subestacionId: seSur.id,
    },
  });

  // Activos en SE Valencia Este (400 kV) — los más críticos, todos en servicio
  const trafo3 = await prisma.activo.create({
    data: {
      codigo: "TRF-E01-001",
      tipo: "TRANSFORMADOR_POTENCIA",
      fabricante: "Hitachi Energy",
      modelo: "TrafoStar-400",
      numeroSerie: "HIT-2023-007",
      fechaPuestaEnServicio: diasDesdeHoy(-90),
      fechaProximaInspeccion: diasDesdeHoy(90),
      subestacionId: seEste.id,
      etiquetas: { connect: [{ id: etCritico.id }] },
    },
  });

  await prisma.activo.create({
    data: {
      codigo: "INT-E01-001",
      tipo: "INTERRUPTOR_AUTOMATICO",
      fabricante: "Siemens",
      modelo: "3AP3-FI",
      fechaPuestaEnServicio: diasDesdeHoy(-100),
      fechaProximaInspeccion: diasDesdeHoy(265),
      subestacionId: seEste.id,
      etiquetas: { connect: [{ id: etCritico.id }] },
    },
  });

  await prisma.activo.create({
    data: {
      codigo: "SEC-E01-001",
      tipo: "SECCIONADOR",
      fabricante: "ABB",
      modelo: "SDF-420",
      fechaPuestaEnServicio: diasDesdeHoy(-50),
      fechaProximaInspeccion: diasDesdeHoy(40),
      subestacionId: seEste.id,
    },
  });

  // Activo DADO_DE_BAJA: en la subestación desmantelada
  const trafoBaja = await prisma.activo.create({
    data: {
      codigo: "TRF-OLD-001",
      tipo: "TRANSFORMADOR_POTENCIA",
      fabricante: "ABB",
      modelo: "Legacy-66",
      fechaPuestaEnServicio: diasDesdeHoy(-5000),
      estado: "DADO_DE_BAJA",
      fechaProximaInspeccion: diasDesdeHoy(-1000), // irrelevante, está dado de baja
      subestacionId: seDesmantelada.id,
    },
  });

  // ============================================================
  // Órdenes de trabajo: histórico realista que demuestra la máquina de estados.
  //
  // Trafo1 (EN_SERVICIO): INSTALACION → INSPECCION OK (hace tiempo) → INSPECCION OK (reciente)
  // Trafo2 (AVERIADO): INSTALACION → INSPECCION OK → INSPECCION AVERIA_DETECTADA (último cambio)
  // Int2 (FUERA_DE_SERVICIO): INSTALACION → PREVENTIVO (le dejó fuera de servicio)
  // TrafoBaja (DADO_DE_BAJA): INSTALACION → varias INSPECCION OK a lo largo de los años → BAJA
  //
  // En cada OT, estadoAnterior y estadoNuevo son SNAPSHOTS: el histórico es autosuficiente
  // aunque mañana cambie la matriz de transiciones (Regla A).
  // ============================================================
  console.log("📋 Creando órdenes de trabajo históricas...");

  // --- Trafo1: vida tranquila ---
  await prisma.ordenTrabajo.create({
    data: {
      tipo: "INSTALACION",
      descripcion: "Puesta en servicio inicial tras montaje",
      estadoAnterior: "EN_SERVICIO",
      estadoNuevo: "EN_SERVICIO",
      // INSTALACION es el caso particular: viene de "nada" pero modelamos el snapshot como EN_SERVICIO→EN_SERVICIO
      // porque el activo nace ya EN_SERVICIO. Es coherente con la matriz de Regla A.
      fechaIntervencion: diasDesdeHoy(-400),
      activoId: trafo1.id,
      autorId: tecnico1.id,
    },
  });
  await prisma.ordenTrabajo.create({
    data: {
      tipo: "INSPECCION",
      descripcion: "Inspección rutinaria semestral",
      resultado: "OK",
      estadoAnterior: "EN_SERVICIO",
      estadoNuevo: "EN_SERVICIO",
      fechaIntervencion: diasDesdeHoy(-220),
      activoId: trafo1.id,
      autorId: operario1.id,
    },
  });
  await prisma.ordenTrabajo.create({
    data: {
      tipo: "INSPECCION",
      descripcion: "Inspección semestral, todo correcto",
      resultado: "OK",
      estadoAnterior: "EN_SERVICIO",
      estadoNuevo: "EN_SERVICIO",
      fechaIntervencion: diasDesdeHoy(-40),
      activoId: trafo1.id,
      autorId: operario2.id,
    },
  });

  // --- Trafo2: acaba averiado ---
  await prisma.ordenTrabajo.create({
    data: {
      tipo: "INSTALACION",
      descripcion: "Puesta en servicio inicial",
      estadoAnterior: "EN_SERVICIO",
      estadoNuevo: "EN_SERVICIO",
      fechaIntervencion: diasDesdeHoy(-1200),
      activoId: trafo2.id,
      autorId: tecnico2.id,
    },
  });
  await prisma.ordenTrabajo.create({
    data: {
      tipo: "INSPECCION",
      descripcion: "Inspección semestral",
      resultado: "OK",
      estadoAnterior: "EN_SERVICIO",
      estadoNuevo: "EN_SERVICIO",
      fechaIntervencion: diasDesdeHoy(-365),
      activoId: trafo2.id,
      autorId: operario1.id,
    },
  });
  await prisma.ordenTrabajo.create({
    data: {
      tipo: "INSPECCION",
      descripcion:
        "Inspección detecta sobrecalentamiento en bobinado. Activo marcado como averiado pendiente de revisión correctiva.",
      resultado: "AVERIA_DETECTADA",
      estadoAnterior: "EN_SERVICIO",
      estadoNuevo: "AVERIADO",
      fechaIntervencion: diasDesdeHoy(-5),
      activoId: trafo2.id,
      autorId: operario2.id,
    },
  });

  // --- Int2: actualmente en preventivo (fuera de servicio) ---
  await prisma.ordenTrabajo.create({
    data: {
      tipo: "INSTALACION",
      descripcion: "Puesta en servicio inicial",
      estadoAnterior: "EN_SERVICIO",
      estadoNuevo: "EN_SERVICIO",
      fechaIntervencion: diasDesdeHoy(-600),
      activoId: int2.id,
      autorId: tecnico1.id,
    },
  });
  await prisma.ordenTrabajo.create({
    data: {
      tipo: "PREVENTIVO",
      descripcion:
        "Mantenimiento preventivo programado: sustitución de aceite y revisión de contactos",
      estadoAnterior: "EN_SERVICIO",
      estadoNuevo: "FUERA_DE_SERVICIO",
      fechaIntervencion: diasDesdeHoy(-2),
      activoId: int2.id,
      autorId: tecnico2.id,
    },
  });

  // --- TrafoBaja: ciclo de vida completo cerrado con BAJA ---
  await prisma.ordenTrabajo.create({
    data: {
      tipo: "INSTALACION",
      descripcion: "Puesta en servicio inicial (años 80)",
      estadoAnterior: "EN_SERVICIO",
      estadoNuevo: "EN_SERVICIO",
      fechaIntervencion: diasDesdeHoy(-5000),
      activoId: trafoBaja.id,
      autorId: admin.id,
    },
  });
  await prisma.ordenTrabajo.create({
    data: {
      tipo: "BAJA",
      descripcion:
        "Retirada de servicio tras desmantelamiento de la subestación",
      estadoAnterior: "EN_SERVICIO",
      estadoNuevo: "DADO_DE_BAJA",
      fechaIntervencion: diasDesdeHoy(-365),
      activoId: trafoBaja.id,
      autorId: admin.id,
    },
  });

  // --- Una OT más reciente sobre Trafo3 (Valencia), para que el dashboard tenga actividad ---
  await prisma.ordenTrabajo.create({
    data: {
      tipo: "INSTALACION",
      descripcion: "Puesta en servicio del nuevo trafo de 400 kV",
      estadoAnterior: "EN_SERVICIO",
      estadoNuevo: "EN_SERVICIO",
      fechaIntervencion: diasDesdeHoy(-90),
      activoId: trafo3.id,
      autorId: tecnico1.id,
    },
  });
  // Suprimir warning: sec1 e int1 los declaramos arriba para poder referenciarlos en tests futuros si hace falta
  void sec1;
  void int1;

  // Log final dinámico: construido a partir de los datos reales creados,
  // no de strings hardcodeados que se desincronizan al primer cambio del seed.
  console.log("\n✅ Seed completado");
  console.log("\n👤 Usuarios disponibles:");

  const anchoRol = Math.max(...usuariosSeed.map((u) => u.rol.length));
  const anchoEmail = Math.max(...usuariosSeed.map((u) => u.email.length));
  for (const u of usuariosSeed) {
    console.log(
      `   ${u.rol.padEnd(anchoRol)}  →  ${u.email.padEnd(anchoEmail)}  /  ${u.password}`,
    );
  }

  // Conteos también dinámicos: si añades subestaciones o activos al seed, el resumen se actualiza solo.
  const [nSubestaciones, nActivos, nOTs] = await Promise.all([
    prisma.subestacion.count(),
    prisma.activo.count(),
    prisma.ordenTrabajo.count(),
  ]);
  console.log(
    `\n🏭 ${nSubestaciones} subestaciones, ${nActivos} activos, ${nOTs} órdenes de trabajo`,
  );

  // Estas dos líneas sí siguen siendo hardcoded a propósito: son "pistas" pedagógicas
  // que apuntan a casos concretos diseñados para la demo (probar Regla B, ver un AVERIADO).
  // Si reescribes los activos del seed, aquí toca actualizar a mano — está bien así.
  console.log(
    "🔍 Activo con inspección vencida: SEC-N01-001 (ideal para probar Regla B)",
  );
  console.log("⚠️  Activo averiado: TRF-S01-001");
}

main()
  .catch((err) => {
    console.error("❌ Error en seed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
