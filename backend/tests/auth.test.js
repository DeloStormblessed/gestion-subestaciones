// backend/tests/auth.test.js
//
// Tests de integración de la feature auth. Tocan BD real.
// Regla de diseño: cada bloque describe crea su propio fixture en su beforeAll,
// con emails únicos. Cero dependencias entre bloques → orden de ejecución irrelevante.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.js";
import app from "../app.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-auth";

beforeAll(async () => {
  await prisma.ordenTrabajo.deleteMany();
  await prisma.activo.deleteMany();
  await prisma.etiqueta.deleteMany();
  await prisma.subestacion.deleteMany();
  await prisma.usuario.deleteMany();
});

afterAll(async () => {
  await prisma.ordenTrabajo.deleteMany();
  await prisma.activo.deleteMany();
  await prisma.etiqueta.deleteMany();
  await prisma.subestacion.deleteMany();
  await prisma.usuario.deleteMany();
  await prisma.$disconnect();
});

describe("POST /api/v1/auth/registro", () => {
  it("registra un nuevo usuario con rol OPERARIO por defecto", async () => {
    const res = await request(app).post("/api/v1/auth/registro").send({
      email: "registro-feliz@test.com",
      password: "password123",
      nombre: "Nuevo Usuario",
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("token");
    expect(res.body.usuario.rol).toBe("OPERARIO");
    expect(res.body.usuario).not.toHaveProperty("passwordHash");
    expect(res.body.usuario).not.toHaveProperty("password");
  });

  it("ignora el rol enviado en el body (siempre crea como OPERARIO)", async () => {
    const res = await request(app).post("/api/v1/auth/registro").send({
      email: "registro-hacker@test.com",
      password: "password123",
      nombre: "Intento Admin",
      rol: "ADMIN",
    });
    expect(res.status).toBe(201);
    expect(res.body.usuario.rol).toBe("OPERARIO");
  });

  it("devuelve 400 si la contraseña es demasiado corta", async () => {
    const res = await request(app).post("/api/v1/auth/registro").send({
      email: "registro-corto@test.com",
      password: "123",
      nombre: "Corto",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("contraseña");
  });

  it("devuelve 400 si el email es inválido", async () => {
    const res = await request(app).post("/api/v1/auth/registro").send({
      email: "no-es-email",
      password: "password123",
      nombre: "Inválido",
    });
    expect(res.status).toBe(400);
  });

  it("devuelve 409 si el email ya existe", async () => {
    // Test autoabastecido: creamos primero el usuario que luego intentamos duplicar.
    await request(app).post("/api/v1/auth/registro").send({
      email: "registro-duplicado@test.com",
      password: "password123",
      nombre: "Original",
    });

    const res = await request(app).post("/api/v1/auth/registro").send({
      email: "registro-duplicado@test.com",
      password: "password123",
      nombre: "Duplicado",
    });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/v1/auth/login", () => {
  // Fixture propio del bloque: usuario con email único para login.
  // Lo creamos directamente en BD con bcrypt para no depender del endpoint de registro.
  beforeAll(async () => {
    const hash = await bcrypt.hash("password123", 10);
    await prisma.usuario.create({
      data: {
        email: "login-activo@test.com",
        passwordHash: hash,
        nombre: "Login Activo",
        rol: "OPERARIO",
      },
    });
    await prisma.usuario.create({
      data: {
        email: "login-desactivado@test.com",
        passwordHash: hash,
        nombre: "Login Desactivado",
        rol: "OPERARIO",
        activo: false,
      },
    });
  });

  it("devuelve 200 + token con credenciales correctas", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({
      email: "login-activo@test.com",
      password: "password123",
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    expect(res.body.usuario).not.toHaveProperty("passwordHash");
  });

  it("devuelve 401 con contraseña incorrecta", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({
      email: "login-activo@test.com",
      password: "incorrecta",
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Credenciales incorrectas");
  });

  it("devuelve 401 con email inexistente (mismo mensaje, no enumeración)", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({
      email: "no-existe@test.com",
      password: "password123",
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Credenciales incorrectas");
  });

  it("devuelve 401 si el usuario está desactivado", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({
      email: "login-desactivado@test.com",
      password: "password123",
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/auth/perfil", () => {
  // Fixture propio: creamos usuario y obtenemos token logueando.
  let tokenValido;

  beforeAll(async () => {
    const hash = await bcrypt.hash("password123", 10);
    await prisma.usuario.create({
      data: {
        email: "perfil@test.com",
        passwordHash: hash,
        nombre: "Perfil Test",
        rol: "OPERARIO",
      },
    });
    const res = await request(app).post("/api/v1/auth/login").send({
      email: "perfil@test.com",
      password: "password123",
    });
    tokenValido = res.body.token;
  });

  it("devuelve los datos del usuario autenticado", async () => {
    const res = await request(app)
      .get("/api/v1/auth/perfil")
      .set("Authorization", `Bearer ${tokenValido}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("perfil@test.com");
    expect(res.body.rol).toBe("OPERARIO");
    expect(res.body).not.toHaveProperty("passwordHash");
  });

  it("devuelve 401 sin token", async () => {
    const res = await request(app).get("/api/v1/auth/perfil");
    expect(res.status).toBe(401);
  });

  it("devuelve 401 con token inválido", async () => {
    const res = await request(app)
      .get("/api/v1/auth/perfil")
      .set("Authorization", "Bearer token-falso");
    expect(res.status).toBe(401);
  });
});
