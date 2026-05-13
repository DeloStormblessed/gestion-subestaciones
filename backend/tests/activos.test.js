// backend/features/activos/activos.test.js

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.js";
import app from "../app.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

let tokenOperario, tokenTecnico, tokenAdmin;
let subestacionId, otraSubestacionId;
let activoExistenteId;

beforeAll(async () => {
  // Orden de limpieza respetando FKs: OTs -> activos -> subestaciones ->
  // usuarios. El pendiente apuntado de homogeneizar esto se aborda al final
  // del proyecto; de momento mantenemos el patrón explícito por suite.
  await prisma.ordenTrabajo.deleteMany();
  await prisma.activo.deleteMany();
  await prisma.subestacion.deleteMany();
  await prisma.usuario.deleteMany();

  const hash = await bcrypt.hash("password123", 10);

  const operario = await prisma.usuario.create({
    data: {
      email: "operario@test.com",
      passwordHash: hash,
      nombre: "Op",
      rol: "OPERARIO",
    },
  });
  const tecnico = await prisma.usuario.create({
    data: {
      email: "tecnico@test.com",
      passwordHash: hash,
      nombre: "Tec",
      rol: "TECNICO",
    },
  });
  const admin = await prisma.usuario.create({
    data: {
      email: "admin@test.com",
      passwordHash: hash,
      nombre: "Adm",
      rol: "ADMIN",
    },
  });

  // Firmamos los tokens con la misma estructura que el controller de auth:
  // id, email, rol. Si en algún sitio el payload se llamó "role" en inglés,
  // hay que verificar coherencia con verificarToken.
  const firmar = (u) =>
    jwt.sign({ id: u.id, email: u.email, rol: u.rol }, process.env.JWT_SECRET);
  tokenOperario = firmar(operario);
  tokenTecnico = firmar(tecnico);
  tokenAdmin = firmar(admin);

  // Dos subestaciones para poder probar filtros por subestacionId.
  const sub1 = await prisma.subestacion.create({
    data: {
      codigo: "SUB-001",
      nombre: "Norte",
      ubicacion: "Madrid",
      tensionNominal: 220,
    },
  });
  const sub2 = await prisma.subestacion.create({
    data: {
      codigo: "SUB-002",
      nombre: "Sur",
      ubicacion: "Sevilla",
      tensionNominal: 132,
    },
  });
  subestacionId = sub1.id;
  otraSubestacionId = sub2.id;

  // Activo base preexistente para los GET y el PUT (no nace por endpoint,
  // así que tampoco genera OT INSTALACION; eso lo probamos por separado en POST).
  const activo = await prisma.activo.create({
    data: {
      codigo: "TR-001",
      tipo: "TRANSFORMADOR_POTENCIA",
      fabricante: "ABB",
      modelo: "TRO-220",
      numeroSerie: "SN-ABB-001",
      fechaPuestaEnServicio: new Date("2024-01-15"),
      // Vencida a propósito para poder testear el filtro inspeccionVencida=true
      fechaProximaInspeccion: new Date("2024-07-15"),
      subestacionId,
    },
  });
  activoExistenteId = activo.id;

  // Un segundo activo en la otra subestación para probar filtros que segmenten.
  await prisma.activo.create({
    data: {
      codigo: "INT-001",
      tipo: "INTERRUPTOR_AUTOMATICO",
      fabricante: "Siemens",
      modelo: "SION-145",
      fechaPuestaEnServicio: new Date("2025-06-01"),
      fechaProximaInspeccion: new Date("2026-06-01"),
      subestacionId: otraSubestacionId,
    },
  });
});

afterAll(async () => {
  await prisma.ordenTrabajo.deleteMany();
  await prisma.activo.deleteMany();
  await prisma.subestacion.deleteMany();
  await prisma.usuario.deleteMany();
  await prisma.$disconnect();
});

describe("GET /api/v1/activos", () => {
  it("devuelve 401 sin token", async () => {
    const res = await request(app).get("/api/v1/activos");
    expect(res.status).toBe(401);
  });

  it("lista activos con token de cualquier rol", async () => {
    const res = await request(app)
      .get("/api/v1/activos")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.datos)).toBe(true);
    expect(res.body.datos.length).toBeGreaterThanOrEqual(2);
    expect(res.body.paginacion).toMatchObject({ pagina: 1, limite: 20 });
  });

  it("filtra por subestacionId", async () => {
    const res = await request(app)
      .get(`/api/v1/activos?subestacionId=${subestacionId}`)
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(200);
    // Todos los devueltos deben pertenecer a la subestación pedida
    expect(res.body.datos.every((a) => a.subestacionId === subestacionId)).toBe(
      true,
    );
  });

  it("filtra por tipo", async () => {
    const res = await request(app)
      .get("/api/v1/activos?tipo=TRANSFORMADOR_POTENCIA")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(200);
    expect(
      res.body.datos.every((a) => a.tipo === "TRANSFORMADOR_POTENCIA"),
    ).toBe(true);
  });

  it("filtra por inspeccionVencida=true", async () => {
    const res = await request(app)
      .get("/api/v1/activos?inspeccionVencida=true")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(200);
    // TR-001 tiene fechaProximaInspeccion en 2024-07-15 (vencida);
    // INT-001 la tiene en 2026 (no vencida). Solo debe salir TR-001.
    expect(res.body.datos.length).toBe(1);
    expect(res.body.datos[0].codigo).toBe("TR-001");
  });

  it("busca por texto en codigo/fabricante/modelo", async () => {
    const res = await request(app)
      .get("/api/v1/activos?busqueda=siemens")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(200);
    expect(res.body.datos.length).toBe(1);
    expect(res.body.datos[0].fabricante).toBe("Siemens");
  });

  it("aplica paginación con limite=1", async () => {
    const res = await request(app)
      .get("/api/v1/activos?limite=1")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(200);
    expect(res.body.datos.length).toBe(1);
    expect(res.body.paginacion.totalPaginas).toBeGreaterThanOrEqual(2);
  });
});

describe("GET /api/v1/activos/:id", () => {
  it("devuelve detalle con subestacion, etiquetas y ordenesTrabajo", async () => {
    const res = await request(app)
      .get(`/api/v1/activos/${activoExistenteId}`)
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(200);
    expect(res.body.codigo).toBe("TR-001");
    expect(res.body).toHaveProperty("subestacion");
    expect(res.body).toHaveProperty("etiquetas");
    expect(res.body).toHaveProperty("ordenesTrabajo");
  });

  it("devuelve 404 si el activo no existe", async () => {
    const res = await request(app)
      .get("/api/v1/activos/inexistente-xyz")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/activos", () => {
  it("devuelve 403 si el rol es OPERARIO", async () => {
    const res = await request(app)
      .post("/api/v1/activos")
      .set("Authorization", `Bearer ${tokenOperario}`)
      .send({
        codigo: "TR-999",
        tipo: "TRANSFORMADOR_POTENCIA",
        fabricante: "ABB",
        fechaPuestaEnServicio: "2025-01-01",
        subestacionId,
      });
    expect(res.status).toBe(403);
  });

  it("TECNICO crea activo y dispara OT INSTALACION automática", async () => {
    const res = await request(app)
      .post("/api/v1/activos")
      .set("Authorization", `Bearer ${tokenTecnico}`)
      .send({
        codigo: "SEC-001",
        tipo: "SECCIONADOR",
        fabricante: "Schneider",
        modelo: "SEC-72",
        fechaPuestaEnServicio: "2025-01-01",
        subestacionId,
      });
    expect(res.status).toBe(201);
    expect(res.body.codigo).toBe("SEC-001");
    expect(res.body.estado).toBe("EN_SERVICIO");

    // Verificamos en BD que la OT INSTALACION se creó con el snapshot correcto.
    // Probar la atomicidad de la transacción comprobando el lado "se creó"; el
    // lado "no se creó si falla" requiere forzar un fallo y se cubre en
    // Conversación B (cuando tengamos errores de regla A).
    const ots = await prisma.ordenTrabajo.findMany({
      where: { activoId: res.body.id },
    });
    expect(ots.length).toBe(1);
    expect(ots[0].tipo).toBe("INSTALACION");
    expect(ots[0].estadoAnterior).toBe("DADO_DE_BAJA");
    expect(ots[0].estadoNuevo).toBe("EN_SERVICIO");
  });

  it("calcula fechaProximaInspeccion segun tipo (SECCIONADOR = 90 dias)", async () => {
    const res = await request(app)
      .post("/api/v1/activos")
      .set("Authorization", `Bearer ${tokenTecnico}`)
      .send({
        codigo: "SEC-002",
        tipo: "SECCIONADOR",
        fabricante: "Schneider",
        fechaPuestaEnServicio: "2025-01-01",
        subestacionId,
      });
    expect(res.status).toBe(201);
    // 90 dias despues de 2025-01-01 = 2025-04-01
    const proxima = new Date(res.body.fechaProximaInspeccion);
    expect(proxima.toISOString().slice(0, 10)).toBe("2025-04-01");
  });

  it("devuelve 400 si faltan campos obligatorios", async () => {
    const res = await request(app)
      .post("/api/v1/activos")
      .set("Authorization", `Bearer ${tokenTecnico}`)
      .send({ codigo: "INCOMPLETO" });
    expect(res.status).toBe(400);
  });

  it("devuelve 409 para codigo duplicado", async () => {
    const res = await request(app)
      .post("/api/v1/activos")
      .set("Authorization", `Bearer ${tokenTecnico}`)
      .send({
        codigo: "TR-001", // ya existe del seed beforeAll
        tipo: "TRANSFORMADOR_POTENCIA",
        fabricante: "ABB",
        fechaPuestaEnServicio: "2025-01-01",
        subestacionId,
      });
    expect(res.status).toBe(409);
  });
});

describe("PUT /api/v1/activos/:id", () => {
  it("devuelve 403 si el rol es OPERARIO", async () => {
    const res = await request(app)
      .put(`/api/v1/activos/${activoExistenteId}`)
      .set("Authorization", `Bearer ${tokenOperario}`)
      .send({ fabricante: "Hackeado" });
    expect(res.status).toBe(403);
  });

  it("TECNICO edita fabricante y modelo", async () => {
    const res = await request(app)
      .put(`/api/v1/activos/${activoExistenteId}`)
      .set("Authorization", `Bearer ${tokenTecnico}`)
      .send({ fabricante: "ABB Renovado", modelo: "TRO-220-R2" });
    expect(res.status).toBe(200);
    expect(res.body.fabricante).toBe("ABB Renovado");
    expect(res.body.modelo).toBe("TRO-220-R2");
  });

  it("devuelve 400 si el body esta vacio", async () => {
    const res = await request(app)
      .put(`/api/v1/activos/${activoExistenteId}`)
      .set("Authorization", `Bearer ${tokenTecnico}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("devuelve 404 si el activo no existe", async () => {
    const res = await request(app)
      .put("/api/v1/activos/inexistente-xyz")
      .set("Authorization", `Bearer ${tokenTecnico}`)
      .send({ fabricante: "Cualquiera" });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/activos/:id/ordenes-trabajo", () => {
  it("devuelve historial paginado de un activo", async () => {
    const res = await request(app)
      .get(`/api/v1/activos/${activoExistenteId}/ordenes-trabajo`)
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.datos)).toBe(true);
    expect(res.body.paginacion).toHaveProperty("total");
  });

  it("devuelve 404 si el activo no existe", async () => {
    const res = await request(app)
      .get("/api/v1/activos/inexistente-xyz/ordenes-trabajo")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(404);
  });
});
