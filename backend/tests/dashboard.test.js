import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.js";
import app from "../app.js";
import { limpiarBD } from "./lib/limpiar-bd.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

let tokenOperario, tokenAdmin;
let subestacionId;
let activoEnServicioId, activoAveriadoId, activoFueraId, activoBajaId;
let activoVencido1Id, activoVencido2Id, activoVencidoBajaId;

beforeAll(async () => {
  await limpiarBD();

  // Usuarios mínimos: uno OPERARIO (para probar acceso por rol más bajo) y un ADMIN
  // que firmará todas las OTs del seed (así no hay que crear un TECNICO también).
  const hashed = await bcrypt.hash("password123", 10);
  const operario = await prisma.usuario.create({
    data: {
      email: "op@test.com",
      passwordHash: hashed,
      nombre: "Operario",
      rol: "OPERARIO",
    },
  });
  const admin = await prisma.usuario.create({
    data: {
      email: "admin@test.com",
      passwordHash: hashed,
      nombre: "Admin",
      rol: "ADMIN",
    },
  });
  tokenOperario = jwt.sign(
    { id: operario.id, email: operario.email, rol: operario.rol },
    process.env.JWT_SECRET,
  );
  tokenAdmin = jwt.sign(
    { id: admin.id, email: admin.email, rol: admin.rol },
    process.env.JWT_SECRET,
  );

  const subestacion = await prisma.subestacion.create({
    data: {
      codigo: "SE-TEST",
      nombre: "Subestación Test",
      ubicacion: "Test",
      tensionNominal: 132,
    },
  });
  subestacionId = subestacion.id;

  // Helper local para crear activos. fechaPuestaEnServicio en el pasado, fechaProximaInspeccion
  // parametrizable: positiva = futuro (no vencido), negativa = pasado (vencido).
  const ahora = new Date();
  const enDias = (d) => new Date(ahora.getTime() + d * 24 * 60 * 60 * 1000);

  const crearActivo = (codigo, estado, diasHastaInspeccion) =>
    prisma.activo.create({
      data: {
        codigo,
        tipo: "TRANSFORMADOR_POTENCIA",
        fabricante: "TestFab",
        fechaPuestaEnServicio: enDias(-365),
        fechaProximaInspeccion: enDias(diasHastaInspeccion),
        estado,
        subestacionId,
      },
    });

  // Dataset de activos diseñado para producir métricas verificables:
  //
  // activosPorEstado esperado:
  //   EN_SERVICIO:       3  (1 con inspección al día + 2 vencidos)
  //   AVERIADO:          1
  //   FUERA_DE_SERVICIO: 1
  //   DADO_DE_BAJA:      2  (1 sin vencer + 1 vencido — este último NO debe aparecer en el top)
  //
  // inspeccionesVencidas esperado: 2 (los dos EN_SERVICIO vencidos; el DADO_DE_BAJA vencido se excluye)
  // topInspeccionesAtrasadas esperado: 2 activos, ordenados por mayor retraso primero
  //   activoVencido1 → 30 días de retraso (más antiguo, primero en el top)
  //   activoVencido2 → 10 días de retraso (segundo)

  const activoEnServicio = await crearActivo("AC-001", "EN_SERVICIO", 60);
  activoEnServicioId = activoEnServicio.id;

  const activoVencido1 = await crearActivo("AC-002", "EN_SERVICIO", -30); // más atrasado
  activoVencido1Id = activoVencido1.id;

  const activoVencido2 = await crearActivo("AC-003", "EN_SERVICIO", -10); // menos atrasado
  activoVencido2Id = activoVencido2.id;

  const activoAveriado = await crearActivo("AC-004", "AVERIADO", 30);
  activoAveriadoId = activoAveriado.id;

  const activoFuera = await crearActivo("AC-005", "FUERA_DE_SERVICIO", 30);
  activoFueraId = activoFuera.id;

  const activoBaja = await crearActivo("AC-006", "DADO_DE_BAJA", 30);
  activoBajaId = activoBaja.id;

  // Caso clave del filtro: DADO_DE_BAJA + vencido. NO debe aparecer en el top ni contar
  // en inspeccionesVencidas. Si aparece, es que falla el filtro `estado: { not: 'DADO_DE_BAJA' }`.
  const activoVencidoBaja = await crearActivo("AC-007", "DADO_DE_BAJA", -50);
  activoVencidoBajaId = activoVencidoBaja.id;

  // OTs para la ventana de 30 días.
  //
  // otsUltimos30DiasPorTipo esperado:
  //   INSPECCION:  2 (dentro de la ventana)
  //   PREVENTIVO:  1
  //   CORRECTIVO:  1
  //   INSTALACION: 1
  //   BAJA:        0  ← clave presente con 0, regla de "siempre todas las claves del enum"
  //
  // Además se crea 1 OT antigua (35 días) que NO debe contar en los conteos pero SÍ puede
  // aparecer en "últimas 10 OTs" si cabe (hay 5 más recientes, así que no debería caber).
  const crearOT = (activoId, tipo, diasDesdeHoy, extra = {}) =>
    prisma.ordenTrabajo.create({
      data: {
        tipo,
        descripcion: `OT ${tipo}`,
        estadoAnterior: "EN_SERVICIO",
        estadoNuevo: "EN_SERVICIO",
        fechaIntervencion: enDias(diasDesdeHoy),
        createdAt: enDias(diasDesdeHoy),
        activoId,
        autorId: admin.id,
        ...extra,
      },
    });

  await crearOT(activoEnServicioId, "INSPECCION", -1, {
    resultado: "CONFORME",
  });
  await crearOT(activoEnServicioId, "INSPECCION", -2, {
    resultado: "CONFORME",
  });
  await crearOT(activoEnServicioId, "PREVENTIVO", -3);
  await crearOT(activoEnServicioId, "CORRECTIVO", -4);
  await crearOT(activoEnServicioId, "INSTALACION", -5);

  // OT fuera de la ventana de 30 días: 35 días atrás. No debe contar en otsUltimos30Dias.
  await crearOT(activoEnServicioId, "CORRECTIVO", -35);
});

afterAll(async () => {
  await limpiarBD();
  await prisma.$disconnect();
});

describe("GET /api/v1/dashboard", () => {
  it("devuelve 401 sin token", async () => {
    const res = await request(app).get("/api/v1/dashboard");
    expect(res.status).toBe(401);
  });

  it("cualquier rol autenticado puede consultarlo (OPERARIO incluido)", async () => {
    // Scope §9: el dashboard es accesible para cualquier rol. Este test blinda esa decisión:
    // si alguien añade requireRol('TECNICO', 'ADMIN') por error, este test falla.
    const res = await request(app)
      .get("/api/v1/dashboard")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(200);
  });

  it("responde con la estructura completa del dashboard", async () => {
    const res = await request(app)
      .get("/api/v1/dashboard")
      .set("Authorization", `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("activosPorEstado");
    expect(res.body).toHaveProperty("inspeccionesVencidas");
    expect(res.body).toHaveProperty("topInspeccionesAtrasadas");
    expect(res.body).toHaveProperty("otsUltimos30DiasPorTipo");
    expect(res.body).toHaveProperty("ultimasOrdenesTrabajo");
  });
});

describe("Dashboard — activosPorEstado", () => {
  it("cuenta correctamente cada estado e incluye SIEMPRE todas las claves del enum", async () => {
    const res = await request(app)
      .get("/api/v1/dashboard")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    // Conteos exactos del seed (3 EN_SERVICIO, 1 AVERIADO, 1 FUERA, 2 DADO_DE_BAJA).
    expect(res.body.activosPorEstado).toEqual({
      EN_SERVICIO: 3,
      AVERIADO: 1,
      FUERA_DE_SERVICIO: 1,
      DADO_DE_BAJA: 2,
    });
  });

  it("incluye estados con conteo 0 (regla: todas las claves siempre presentes)", async () => {
    // Vacíamos solo los activos AVERIADO y FUERA_DE_SERVICIO para verificar que sus claves
    // siguen apareciendo a 0. Restauramos al final para no romper otros tests del describe.
    await prisma.activo.updateMany({
      where: { estado: { in: ["AVERIADO", "FUERA_DE_SERVICIO"] } },
      data: { estado: "EN_SERVICIO" },
    });

    const res = await request(app)
      .get("/api/v1/dashboard")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    expect(res.body.activosPorEstado).toHaveProperty("AVERIADO", 0);
    expect(res.body.activosPorEstado).toHaveProperty("FUERA_DE_SERVICIO", 0);

    // Restauración: los IDs que cambiamos vuelven a su estado original.
    await prisma.activo.update({
      where: { id: activoAveriadoId },
      data: { estado: "AVERIADO" },
    });
    await prisma.activo.update({
      where: { id: activoFueraId },
      data: { estado: "FUERA_DE_SERVICIO" },
    });
  });
});

describe("Dashboard — inspeccionesVencidas y topInspeccionesAtrasadas", () => {
  it("cuenta 2 inspecciones vencidas (excluye DADO_DE_BAJA)", async () => {
    const res = await request(app)
      .get("/api/v1/dashboard")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    // Hay 3 activos con fechaProximaInspeccion vencida en el seed:
    //   activoVencido1 (EN_SERVICIO, -30 días)  → cuenta
    //   activoVencido2 (EN_SERVICIO, -10 días)  → cuenta
    //   activoVencidoBaja (DADO_DE_BAJA, -50 días) → NO cuenta
    expect(res.body.inspeccionesVencidas).toBe(2);
  });

  it("top muestra activos vencidos ordenados de más atrasado a menos", async () => {
    const res = await request(app)
      .get("/api/v1/dashboard")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    const top = res.body.topInspeccionesAtrasadas;
    expect(top).toHaveLength(2);
    expect(top[0].codigo).toBe("AC-002"); // -30 días → más atrasado, primero
    expect(top[1].codigo).toBe("AC-003"); // -10 días → segundo
  });

  it("el top NUNCA incluye activos DADO_DE_BAJA aunque su inspección esté vencida", async () => {
    // Test redundante con el anterior, pero blinda explícitamente la regla del filtro.
    // Si mañana alguien quita el `estado: { not: 'DADO_DE_BAJA' }` del where, este test cae.
    const res = await request(app)
      .get("/api/v1/dashboard")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    const codigos = res.body.topInspeccionesAtrasadas.map((a) => a.codigo);
    expect(codigos).not.toContain("AC-007");
  });

  it("cada activo del top incluye diasDeRetraso calculado en backend", async () => {
    const res = await request(app)
      .get("/api/v1/dashboard")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    const top = res.body.topInspeccionesAtrasadas;
    // Margen de ±1 día para evitar flakiness por la fecha exacta del runtime de test.
    expect(top[0].diasDeRetraso).toBeGreaterThanOrEqual(29);
    expect(top[0].diasDeRetraso).toBeLessThanOrEqual(31);
    expect(top[1].diasDeRetraso).toBeGreaterThanOrEqual(9);
    expect(top[1].diasDeRetraso).toBeLessThanOrEqual(11);
  });

  it("cada activo del top incluye la subestación (accionabilidad de un vistazo)", async () => {
    const res = await request(app)
      .get("/api/v1/dashboard")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    expect(res.body.topInspeccionesAtrasadas[0].subestacion).toMatchObject({
      codigo: "SE-TEST",
      nombre: "Subestación Test",
    });
  });
});

describe("Dashboard — otsUltimos30DiasPorTipo", () => {
  it("cuenta solo OTs dentro de la ventana de 30 días y rellena tipos sin datos con 0", async () => {
    const res = await request(app)
      .get("/api/v1/dashboard")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    // En el seed metimos 5 OTs dentro de la ventana (2 INSPECCION, 1 PREVENTIVO, 1 CORRECTIVO,
    // 1 INSTALACION) y 1 fuera (-35 días, CORRECTIVO antiguo). El conteo debe ignorar la antigua.
    // BAJA no aparece en el seed → debe estar presente con valor 0.
    expect(res.body.otsUltimos30DiasPorTipo).toEqual({
      INSPECCION: 2,
      PREVENTIVO: 1,
      CORRECTIVO: 1,
      INSTALACION: 1,
      BAJA: 0,
    });
  });
});

describe("Dashboard — ultimasOrdenesTrabajo", () => {
  it("devuelve las últimas OTs ordenadas por createdAt descendente", async () => {
    const res = await request(app)
      .get("/api/v1/dashboard")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    const ultimas = res.body.ultimasOrdenesTrabajo;
    expect(ultimas.length).toBeGreaterThan(0);
    expect(ultimas.length).toBeLessThanOrEqual(10);

    // Verifica el orden descendente comparando timestamps consecutivos.
    for (let i = 0; i < ultimas.length - 1; i++) {
      const a = new Date(ultimas[i].createdAt).getTime();
      const b = new Date(ultimas[i + 1].createdAt).getTime();
      expect(a).toBeGreaterThanOrEqual(b);
    }
  });

  it("cada OT incluye activo (código, tipo) y autor (nombre) para que sea legible sin joins adicionales", async () => {
    const res = await request(app)
      .get("/api/v1/dashboard")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    const primera = res.body.ultimasOrdenesTrabajo[0];
    expect(primera.activo).toHaveProperty("codigo");
    expect(primera.activo).toHaveProperty("tipo");
    expect(primera.autor).toHaveProperty("nombre");
  });
});
