// backend/tests/usuarios.test.js

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import app from "../app.js";
import { limpiarBD } from "./lib/limpiar-bd.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-usuarios";

let tokenAdmin, tokenTecnico, tokenOperario;
let idAdmin, idTecnico, idOperario, idObjetivo;

// Helper para firmar tokens en tests sin pasar por /login (más rápido).
const firmar = (id, rol) =>
  jwt.sign({ id, email: `${id}@test.com`, rol }, process.env.JWT_SECRET);

beforeAll(async () => {
  await limpiarBD();

  const hash = await bcrypt.hash("password123", 10);

  // Creamos un usuario de cada rol para los tests de autorización.
  const admin = await prisma.usuario.create({
    data: {
      email: "admin@test.com",
      passwordHash: hash,
      nombre: "Admin Test",
      rol: "ADMIN",
    },
  });
  const tecnico = await prisma.usuario.create({
    data: {
      email: "tecnico@test.com",
      passwordHash: hash,
      nombre: "Tecnico Test",
      rol: "TECNICO",
    },
  });
  const operario = await prisma.usuario.create({
    data: {
      email: "operario@test.com",
      passwordHash: hash,
      nombre: "Operario Test",
      rol: "OPERARIO",
    },
  });
  // Usuario "víctima" sobre el que el ADMIN ejecutará los cambios.
  const objetivo = await prisma.usuario.create({
    data: {
      email: "objetivo@test.com",
      passwordHash: hash,
      nombre: "Objetivo",
      rol: "OPERARIO",
    },
  });

  idAdmin = admin.id;
  idTecnico = tecnico.id;
  idOperario = operario.id;
  idObjetivo = objetivo.id;
  tokenAdmin = firmar(admin.id, "ADMIN");
  tokenTecnico = firmar(tecnico.id, "TECNICO");
  tokenOperario = firmar(operario.id, "OPERARIO");
});

afterAll(async () => {
  await limpiarBD();
  await prisma.$disconnect();
});

describe("Autorización (todas las rutas son ADMIN-only)", () => {
  it("OPERARIO recibe 403 al listar usuarios", async () => {
    const res = await request(app)
      .get("/api/v1/usuarios")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(403);
  });

  it("TECNICO recibe 403 al listar usuarios", async () => {
    const res = await request(app)
      .get("/api/v1/usuarios")
      .set("Authorization", `Bearer ${tokenTecnico}`);
    expect(res.status).toBe(403);
  });

  it("sin token recibe 401", async () => {
    const res = await request(app).get("/api/v1/usuarios");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/usuarios", () => {
  it("ADMIN obtiene listado paginado con estructura { datos, paginacion }", async () => {
    const res = await request(app)
      .get("/api/v1/usuarios")
      .set("Authorization", `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("datos");
    expect(res.body).toHaveProperty("paginacion");
    expect(res.body.paginacion).toMatchObject({ pagina: 1, limite: 20 });
    expect(res.body.paginacion.total).toBeGreaterThanOrEqual(4);
  });

  it("ningún usuario devuelto incluye passwordHash", async () => {
    const res = await request(app)
      .get("/api/v1/usuarios")
      .set("Authorization", `Bearer ${tokenAdmin}`);
    for (const u of res.body.datos) {
      expect(u).not.toHaveProperty("passwordHash");
    }
  });

  it("filtra por rol", async () => {
    const res = await request(app)
      .get("/api/v1/usuarios?rol=OPERARIO")
      .set("Authorization", `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.datos.every((u) => u.rol === "OPERARIO")).toBe(true);
  });

  it("respeta limite del query string", async () => {
    const res = await request(app)
      .get("/api/v1/usuarios?limite=2")
      .set("Authorization", `Bearer ${tokenAdmin}`);
    expect(res.body.datos.length).toBeLessThanOrEqual(2);
    expect(res.body.paginacion.limite).toBe(2);
  });
});

describe("GET /api/v1/usuarios/:id", () => {
  it("ADMIN obtiene detalle por id", async () => {
    const res = await request(app)
      .get(`/api/v1/usuarios/${idObjetivo}`)
      .set("Authorization", `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("objetivo@test.com");
    expect(res.body).not.toHaveProperty("passwordHash");
  });

  it("404 si el id no existe", async () => {
    const res = await request(app)
      .get("/api/v1/usuarios/id-falso-cuid")
      .set("Authorization", `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/v1/usuarios/:id/rol", () => {
  it("ADMIN puede promover un OPERARIO a TECNICO", async () => {
    const res = await request(app)
      .patch(`/api/v1/usuarios/${idObjetivo}/rol`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ rol: "TECNICO" });
    expect(res.status).toBe(200);
    expect(res.body.rol).toBe("TECNICO");
  });

  it("422 si el ADMIN intenta cambiar su propio rol", async () => {
    const res = await request(app)
      .patch(`/api/v1/usuarios/${idAdmin}/rol`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ rol: "OPERARIO" });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("propio rol");
  });

  it("400 si el rol enviado no es válido", async () => {
    const res = await request(app)
      .patch(`/api/v1/usuarios/${idObjetivo}/rol`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ rol: "SUPERHEROE" });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/v1/usuarios/:id/activacion", () => {
  it("ADMIN puede desactivar a otro usuario", async () => {
    const res = await request(app)
      .patch(`/api/v1/usuarios/${idObjetivo}/activacion`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ activo: false });
    expect(res.status).toBe(200);
    expect(res.body.activo).toBe(false);
  });

  it("ADMIN puede reactivar a un usuario desactivado", async () => {
    const res = await request(app)
      .patch(`/api/v1/usuarios/${idObjetivo}/activacion`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ activo: true });
    expect(res.status).toBe(200);
    expect(res.body.activo).toBe(true);
  });

  it("422 si el ADMIN intenta desactivarse a sí mismo", async () => {
    const res = await request(app)
      .patch(`/api/v1/usuarios/${idAdmin}/activacion`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ activo: false });
    expect(res.status).toBe(422);
  });

  it("400 si el body no es booleano", async () => {
    const res = await request(app)
      .patch(`/api/v1/usuarios/${idObjetivo}/activacion`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ activo: "yes" });
    expect(res.status).toBe(400);
  });
});
