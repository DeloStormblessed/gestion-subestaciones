import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import app from "../app.js";
import { limpiarBD } from "./lib/limpiar-bd.js";

// Tokens precomputados para cada rol, generados en beforeAll. Evita hacer login en cada test.
let tokenOperario;
let tokenTecnico;
let tokenAdmin;

// Subestación de referencia creada en beforeAll para los tests de GET/PUT/PATCH.
// Otros tests crean sus propias subestaciones para no depender de orden de ejecución.
let subestacionBaseId;

// Subestación con activo asociado: la usamos para verificar la regla §7
// (no se puede desactivar si tiene activos no dados de baja).
let subestacionConActivoId;

beforeAll(async () => {
  await limpiarBD();

  // Tres usuarios, uno por rol. Password compartido porque solo necesitamos los JWT.
  const passwordHash = await bcrypt.hash("password123", 10);
  const [operario, tecnico, admin] = await Promise.all([
    prisma.usuario.create({
      data: {
        email: "operario.subs@test.com",
        passwordHash,
        nombre: "Op Test",
        rol: "OPERARIO",
      },
    }),
    prisma.usuario.create({
      data: {
        email: "tecnico.subs@test.com",
        passwordHash,
        nombre: "Tec Test",
        rol: "TECNICO",
      },
    }),
    prisma.usuario.create({
      data: {
        email: "admin.subs@test.com",
        passwordHash,
        nombre: "Adm Test",
        rol: "ADMIN",
      },
    }),
  ]);

  // Firmamos los tokens directamente para no acoplar estos tests al endpoint de login.
  // Si /auth/login se rompe, estos tests siguen siendo válidos.
  const firmar = (u) =>
    jwt.sign({ id: u.id, email: u.email, rol: u.rol }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
  tokenOperario = firmar(operario);
  tokenTecnico = firmar(tecnico);
  tokenAdmin = firmar(admin);

  // Subestación base para GETs, PUTs y PATCHs sin activos asociados.
  const base = await prisma.subestacion.create({
    data: {
      codigo: "SUB-BASE-001",
      nombre: "Base de Tests",
      ubicacion: "Madrid",
      tensionNominal: 132,
    },
  });
  subestacionBaseId = base.id;

  // Subestación con un activo EN_SERVICIO para probar el bloqueo de la regla §7.
  const conActivo = await prisma.subestacion.create({
    data: {
      codigo: "SUB-CON-ACT-001",
      nombre: "Con Activo",
      ubicacion: "Barcelona",
      tensionNominal: 220,
    },
  });
  subestacionConActivoId = conActivo.id;

  await prisma.activo.create({
    data: {
      codigo: "ACT-TEST-001",
      tipo: "TRANSFORMADOR_POTENCIA",
      fabricante: "Test Co",
      fechaPuestaEnServicio: new Date(),
      fechaProximaInspeccion: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
      estado: "EN_SERVICIO",
      subestacionId: conActivo.id,
    },
  });
});

afterAll(async () => {
  await limpiarBD();
  await prisma.$disconnect();
});

describe("GET /api/v1/subestaciones", () => {
  it("devuelve 401 sin token", async () => {
    const res = await request(app).get("/api/v1/subestaciones");
    expect(res.status).toBe(401);
  });

  it("OPERARIO puede listar (lectura abierta a cualquier rol autenticado)", async () => {
    const res = await request(app)
      .get("/api/v1/subestaciones")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(200);
    // Estructura paginada del scope §11: datos + paginacion con sus 4 campos.
    expect(res.body).toHaveProperty("datos");
    expect(res.body).toHaveProperty("paginacion");
    expect(res.body.paginacion).toMatchObject({
      pagina: 1,
      limite: 20,
      total: expect.any(Number),
      totalPaginas: expect.any(Number),
    });
    expect(Array.isArray(res.body.datos)).toBe(true);
  });

  it("filtra por activa=true", async () => {
    // Las dos subestaciones del beforeAll están activas; no se cuelan inactivas.
    const res = await request(app)
      .get("/api/v1/subestaciones?activa=true")
      .set("Authorization", `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.datos.every((s) => s.activa === true)).toBe(true);
  });

  it("filtra por tensionMin", async () => {
    // SUB-CON-ACT-001 tiene 220 kV, SUB-BASE-001 tiene 132 kV.
    // Con tensionMin=200 solo debe devolver la de 220.
    const res = await request(app)
      .get("/api/v1/subestaciones?tensionMin=200")
      .set("Authorization", `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.datos.every((s) => s.tensionNominal >= 200)).toBe(true);
  });
});

describe("GET /api/v1/subestaciones/:id", () => {
  it("devuelve 401 sin token", async () => {
    const res = await request(app).get(
      `/api/v1/subestaciones/${subestacionBaseId}`,
    );
    expect(res.status).toBe(401);
  });

  it("devuelve 404 si la subestación no existe", async () => {
    // cuid con formato válido pero inexistente; testeamos el camino NoEncontrado del service.
    const res = await request(app)
      .get("/api/v1/subestaciones/cmxxxxxxxxxxxxxxxxxxxxxxx")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(404);
  });

  it("devuelve la subestación con sus activos (scope §9)", async () => {
    const res = await request(app)
      .get(`/api/v1/subestaciones/${subestacionConActivoId}`)
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(subestacionConActivoId);
    // El detalle DEBE incluir el array de activos, aunque esté vacío.
    expect(res.body).toHaveProperty("activos");
    expect(res.body.activos.length).toBeGreaterThan(0);
    expect(res.body.activos[0]).toHaveProperty("codigo", "ACT-TEST-001");
  });
});

describe("POST /api/v1/subestaciones", () => {
  it("devuelve 401 sin token", async () => {
    const res = await request(app).post("/api/v1/subestaciones").send({
      codigo: "SUB-NEW-001",
      nombre: "Nueva",
      ubicacion: "Sevilla",
      tensionNominal: 66,
    });
    expect(res.status).toBe(401);
  });

  it("devuelve 403 si el rol no es ADMIN (OPERARIO)", async () => {
    const res = await request(app)
      .post("/api/v1/subestaciones")
      .set("Authorization", `Bearer ${tokenOperario}`)
      .send({
        codigo: "SUB-NEW-002",
        nombre: "Nueva",
        ubicacion: "Sevilla",
        tensionNominal: 66,
      });
    expect(res.status).toBe(403);
  });

  it("devuelve 403 si el rol no es ADMIN (TECNICO)", async () => {
    // TECNICO también está fuera del scope de gestión de subestaciones (scope §5/§9).
    const res = await request(app)
      .post("/api/v1/subestaciones")
      .set("Authorization", `Bearer ${tokenTecnico}`)
      .send({
        codigo: "SUB-NEW-003",
        nombre: "Nueva",
        ubicacion: "Sevilla",
        tensionNominal: 66,
      });
    expect(res.status).toBe(403);
  });

  it("devuelve 400 si faltan campos requeridos", async () => {
    const res = await request(app)
      .post("/api/v1/subestaciones")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ codigo: "SUB-INV-001" }); // sin nombre, ubicacion, tensionNominal
    expect(res.status).toBe(400);
  });

  it("ADMIN crea una subestación correctamente", async () => {
    const res = await request(app)
      .post("/api/v1/subestaciones")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({
        codigo: "SUB-OK-001",
        nombre: "Subestación OK",
        ubicacion: "Valencia",
        tensionNominal: 400,
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      codigo: "SUB-OK-001",
      tensionNominal: 400,
      activa: true,
    });
    expect(res.body).toHaveProperty("id");
  });

  it("devuelve 409 si el código ya existe", async () => {
    // SUB-OK-001 se acaba de crear en el test anterior; el @unique de Prisma lanza P2002.
    const res = await request(app)
      .post("/api/v1/subestaciones")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({
        codigo: "SUB-OK-001",
        nombre: "Otra",
        ubicacion: "Bilbao",
        tensionNominal: 132,
      });
    expect(res.status).toBe(409);
  });
});

describe("PUT /api/v1/subestaciones/:id", () => {
  it("devuelve 403 si el rol no es ADMIN", async () => {
    const res = await request(app)
      .put(`/api/v1/subestaciones/${subestacionBaseId}`)
      .set("Authorization", `Bearer ${tokenTecnico}`)
      .send({ nombre: "Renombrada" });
    expect(res.status).toBe(403);
  });

  it("devuelve 404 si la subestación no existe", async () => {
    // El service hace findUnique previo para devolver 404 explícito en vez de P2025.
    const res = await request(app)
      .put("/api/v1/subestaciones/cmxxxxxxxxxxxxxxxxxxxxxxx")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ nombre: "Renombrada" });
    expect(res.status).toBe(404);
  });

  it("ADMIN edita una subestación correctamente (edición parcial)", async () => {
    // Creamos una subestación específica para este test: así no rompemos los ids
    // que usan otros bloques y verificamos que partial() de Zod acepta solo un campo.
    const creada = await prisma.subestacion.create({
      data: {
        codigo: "SUB-EDIT-001",
        nombre: "Original",
        ubicacion: "Madrid",
        tensionNominal: 132,
      },
    });

    const res = await request(app)
      .put(`/api/v1/subestaciones/${creada.id}`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ nombre: "Renombrada", tensionNominal: 220 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: creada.id,
      codigo: "SUB-EDIT-001", // no enviado → no cambia
      nombre: "Renombrada",
      tensionNominal: 220,
      ubicacion: "Madrid", // no enviado → no cambia
    });
  });
});

describe("PATCH /api/v1/subestaciones/:id/activacion", () => {
  it("devuelve 403 si el rol no es ADMIN", async () => {
    const res = await request(app)
      .patch(`/api/v1/subestaciones/${subestacionBaseId}/activacion`)
      .set("Authorization", `Bearer ${tokenOperario}`)
      .send({ activa: false });
    expect(res.status).toBe(403);
  });

  it("devuelve 404 si la subestación no existe", async () => {
    const res = await request(app)
      .patch("/api/v1/subestaciones/cmxxxxxxxxxxxxxxxxxxxxxxx/activacion")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ activa: false });
    expect(res.status).toBe(404);
  });

  it("devuelve 422 al desactivar una subestación con activos en operación (regla §7)", async () => {
    // SUB-CON-ACT-001 tiene un activo EN_SERVICIO desde beforeAll.
    // Debe rechazarse con ReglaNegocio → 422.
    const res = await request(app)
      .patch(`/api/v1/subestaciones/${subestacionConActivoId}/activacion`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ activa: false });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/activo/i);
  });

  it("ADMIN desactiva una subestación sin activos vivos", async () => {
    // Subestación dedicada al test, sin activos, para no interferir con otros.
    const creada = await prisma.subestacion.create({
      data: {
        codigo: "SUB-DEACT-001",
        nombre: "Para desactivar",
        ubicacion: "Zaragoza",
        tensionNominal: 66,
      },
    });

    const res = await request(app)
      .patch(`/api/v1/subestaciones/${creada.id}/activacion`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ activa: false });

    expect(res.status).toBe(200);
    expect(res.body.activa).toBe(false);
  });

  it("la regla §7 solo aplica al desactivar; reactivar siempre es seguro", async () => {
    // Una subestación inactiva (incluso si tuviera activos) puede reactivarse sin chequeo.
    // El service solo cuenta activos vivos cuando activa===false.
    const creada = await prisma.subestacion.create({
      data: {
        codigo: "SUB-REACT-001",
        nombre: "Para reactivar",
        ubicacion: "Zaragoza",
        tensionNominal: 66,
        activa: false,
      },
    });

    const res = await request(app)
      .patch(`/api/v1/subestaciones/${creada.id}/activacion`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ activa: true });

    expect(res.status).toBe(200);
    expect(res.body.activa).toBe(true);
  });
});
