import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.js";
import app from "../app.js";
import { limpiarBD } from "./lib/limpiar-bd.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

// Fixtures que vamos a reutilizar en todos los describes.
let tokenOperario;
let tecnico;
let otroTecnico;
let subestacion;
let activoA;
let activoB;
// Guardamos referencias a OTs concretas para poder filtrar por sus atributos.
let otInspeccionEnero;
let otCorrectivoFebrero;
let otPreventivoMarzo;

beforeAll(async () => {
  // Limpieza en orden de dependencias: OTs → activos → subestaciones → usuarios.
  // onDelete: Restrict bloquea cualquier otro orden.
  await limpiarBD();

  const hash = await bcrypt.hash("password123", 10);

  const operario = await prisma.usuario.create({
    data: {
      email: "op@test.com",
      passwordHash: hash,
      nombre: "Op",
      rol: "OPERARIO",
    },
  });
  tecnico = await prisma.usuario.create({
    data: {
      email: "t1@test.com",
      passwordHash: hash,
      nombre: "Tec1",
      rol: "TECNICO",
    },
  });
  otroTecnico = await prisma.usuario.create({
    data: {
      email: "t2@test.com",
      passwordHash: hash,
      nombre: "Tec2",
      rol: "TECNICO",
    },
  });

  tokenOperario = jwt.sign(
    { id: operario.id, email: operario.email, rol: operario.rol },
    process.env.JWT_SECRET,
  );

  subestacion = await prisma.subestacion.create({
    data: {
      codigo: "SUB-001",
      nombre: "Sub Test",
      ubicacion: "X",
      tensionNominal: 132,
    },
  });

  // Dos activos distintos para poder filtrar por activoId.
  activoA = await prisma.activo.create({
    data: {
      codigo: "ACT-A",
      tipo: "TRANSFORMADOR_POTENCIA",
      fabricante: "F",
      fechaPuestaEnServicio: new Date("2024-01-01"),
      fechaProximaInspeccion: new Date("2027-01-01"),
      subestacionId: subestacion.id,
    },
  });
  activoB = await prisma.activo.create({
    data: {
      codigo: "ACT-B",
      tipo: "SECCIONADOR",
      fabricante: "F",
      fechaPuestaEnServicio: new Date("2024-01-01"),
      fechaProximaInspeccion: new Date("2027-01-01"),
      subestacionId: subestacion.id,
    },
  });

  // Creamos OTs directamente con prisma (saltando el flujo de POST) para
  // controlar exactamente las fechaIntervencion: necesitamos OTs en meses
  // concretos para testear el filtro por rango.
  // Nota: en producción esto pasaría por el service con reglas A/B; aquí
  // testeamos solo el listado, no la creación, así que el bypass es legítimo.
  otInspeccionEnero = await prisma.ordenTrabajo.create({
    data: {
      tipo: "INSPECCION",
      descripcion: "Insp enero",
      resultado: "OK",
      estadoAnterior: "EN_SERVICIO",
      estadoNuevo: "EN_SERVICIO",
      fechaIntervencion: new Date("2026-01-15T10:00:00Z"),
      activoId: activoA.id,
      autorId: tecnico.id,
    },
  });
  otCorrectivoFebrero = await prisma.ordenTrabajo.create({
    data: {
      tipo: "CORRECTIVO",
      descripcion: "Corr feb",
      estadoAnterior: "AVERIADO",
      estadoNuevo: "FUERA_DE_SERVICIO",
      fechaIntervencion: new Date("2026-02-20T10:00:00Z"),
      activoId: activoA.id,
      autorId: otroTecnico.id,
    },
  });
  otPreventivoMarzo = await prisma.ordenTrabajo.create({
    data: {
      tipo: "PREVENTIVO",
      descripcion: "Prev marzo",
      estadoAnterior: "EN_SERVICIO",
      estadoNuevo: "FUERA_DE_SERVICIO",
      fechaIntervencion: new Date("2026-03-10T10:00:00Z"),
      activoId: activoB.id,
      autorId: tecnico.id,
    },
  });
});

afterAll(async () => {
  await limpiarBD();
  await prisma.$disconnect();
});

describe("GET /api/v1/ordenes-trabajo — autorización y estructura", () => {
  it("devuelve 401 sin token", async () => {
    const res = await request(app).get("/api/v1/ordenes-trabajo");
    expect(res.status).toBe(401);
  });

  it("OPERARIO puede listar (cualquier rol autenticado)", async () => {
    const res = await request(app)
      .get("/api/v1/ordenes-trabajo")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(200);
  });

  it("respuesta tiene forma { datos, paginacion }", async () => {
    const res = await request(app)
      .get("/api/v1/ordenes-trabajo")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.body).toHaveProperty("datos");
    expect(res.body).toHaveProperty("paginacion");
    expect(res.body.paginacion).toMatchObject({
      pagina: 1,
      limite: 20,
      total: 3,
      totalPaginas: 1,
    });
  });

  it("cada OT incluye activo y autor sin passwordHash", async () => {
    const res = await request(app)
      .get("/api/v1/ordenes-trabajo")
      .set("Authorization", `Bearer ${tokenOperario}`);
    const ot = res.body.datos[0];
    expect(ot.activo).toMatchObject({ codigo: expect.any(String) });
    expect(ot.autor).toMatchObject({ nombre: expect.any(String) });
    expect(ot.autor).not.toHaveProperty("passwordHash");
  });

  it("orden por fechaIntervencion descendente", async () => {
    const res = await request(app)
      .get("/api/v1/ordenes-trabajo")
      .set("Authorization", `Bearer ${tokenOperario}`);
    const fechas = res.body.datos.map((ot) =>
      new Date(ot.fechaIntervencion).getTime(),
    );
    // La OT más reciente (marzo) debe ir primero.
    expect(fechas).toEqual([...fechas].sort((a, b) => b - a));
  });
});

describe("GET /api/v1/ordenes-trabajo — filtros", () => {
  it("filtra por tipo", async () => {
    const res = await request(app)
      .get("/api/v1/ordenes-trabajo?tipo=CORRECTIVO")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.body.datos).toHaveLength(1);
    expect(res.body.datos[0].id).toBe(otCorrectivoFebrero.id);
  });

  it("filtra por autorId", async () => {
    const res = await request(app)
      .get(`/api/v1/ordenes-trabajo?autorId=${tecnico.id}`)
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.body.datos).toHaveLength(2);
    expect(res.body.datos.every((ot) => ot.autorId === tecnico.id)).toBe(true);
  });

  it("filtra por activoId", async () => {
    const res = await request(app)
      .get(`/api/v1/ordenes-trabajo?activoId=${activoB.id}`)
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.body.datos).toHaveLength(1);
    expect(res.body.datos[0].id).toBe(otPreventivoMarzo.id);
  });

  it("filtra por rango de fechas (gte fechaDesde, lt fechaHasta+1día)", async () => {
    // Rango cerrado en febrero: solo debería entrar la OT del 20 de febrero.
    const res = await request(app)
      .get(
        "/api/v1/ordenes-trabajo?fechaDesde=2026-02-01&fechaHasta=2026-02-28",
      )
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.body.datos).toHaveLength(1);
    expect(res.body.datos[0].id).toBe(otCorrectivoFebrero.id);
  });

  it("fechaHasta es inclusivo del día completo", async () => {
    // OT registrada el 2026-01-15 a las 10:00. Con fechaHasta=2026-01-15
    // tiene que aparecer (sin el ajuste de +24h en el service, no aparecería).
    const res = await request(app)
      .get(
        "/api/v1/ordenes-trabajo?fechaDesde=2026-01-01&fechaHasta=2026-01-15",
      )
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.body.datos).toHaveLength(1);
    expect(res.body.datos[0].id).toBe(otInspeccionEnero.id);
  });

  it("combina varios filtros (activoId + tipo)", async () => {
    const res = await request(app)
      .get(`/api/v1/ordenes-trabajo?activoId=${activoA.id}&tipo=INSPECCION`)
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.body.datos).toHaveLength(1);
    expect(res.body.datos[0].id).toBe(otInspeccionEnero.id);
  });

  it("devuelve 400 si fechaDesde > fechaHasta", async () => {
    const res = await request(app)
      .get(
        "/api/v1/ordenes-trabajo?fechaDesde=2026-12-01&fechaHasta=2026-01-01",
      )
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(400);
  });

  it("devuelve 400 con tipo inválido", async () => {
    const res = await request(app)
      .get("/api/v1/ordenes-trabajo?tipo=INVENTADO")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(400);
  });

  it("devuelve 400 con autorId no-CUID", async () => {
    const res = await request(app)
      .get("/api/v1/ordenes-trabajo?autorId=123")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/ordenes-trabajo — paginación", () => {
  it("respeta limite=2", async () => {
    const res = await request(app)
      .get("/api/v1/ordenes-trabajo?limite=2")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.body.datos).toHaveLength(2);
    expect(res.body.paginacion).toMatchObject({
      pagina: 1,
      limite: 2,
      total: 3,
      totalPaginas: 2,
    });
  });

  it("respeta pagina=2", async () => {
    const res = await request(app)
      .get("/api/v1/ordenes-trabajo?limite=2&pagina=2")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.body.datos).toHaveLength(1);
    expect(res.body.paginacion.pagina).toBe(2);
  });

  it("devuelve 400 si limite > 100", async () => {
    const res = await request(app)
      .get("/api/v1/ordenes-trabajo?limite=500")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(400);
  });
});
