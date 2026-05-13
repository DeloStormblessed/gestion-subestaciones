// backend/tests/infraestructura.test.js
//
// Tests de humo de la infraestructura común: errores, validate, auth.
// No prueba ningún endpoint real — solo que las piezas integradas con Express
// producen las respuestas HTTP correctas. Una vez tengamos features de verdad,
// estos tests son redundantes y se pueden eliminar (o dejarlos como red de seguridad).

import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";

import errorHandler from "../middleware/errorHandler.js";
import validate from "../middleware/validate.js";
import { verificarToken, requireRol } from "../middleware/auth.js";
import { NoEncontrado, ReglaNegocio } from "../lib/errores.js";

// JWT_SECRET para los tests. En tests no leemos del .env real para que sean reproducibles.
process.env.JWT_SECRET = "test-secret-infraestructura";

// Montamos una app mínima con rutas que ejercitan cada pieza.
function crearApp() {
  const app = express();
  app.use(express.json());

  // Ruta que lanza nuestros errores personalizados → debe traducirlos a HTTP correcto.
  app.get("/lanza-404", (req, res, next) =>
    next(new NoEncontrado("No existe")),
  );
  app.get("/lanza-422", (req, res, next) =>
    next(new ReglaNegocio("Regla rota")),
  );

  // Ruta con validate: solo pasa si el body cumple el schema.
  const schema = z.object({ nombre: z.string().min(3, "Mínimo 3 caracteres") });
  app.post("/valida", validate(schema), (req, res) =>
    res.json({ ok: true, datos: req.body }),
  );

  // Ruta protegida: requiere token y rol ADMIN.
  app.get("/solo-admin", verificarToken, requireRol("ADMIN"), (req, res) =>
    res.json({ ok: true, usuario: req.usuario }),
  );

  app.use(errorHandler);
  return app;
}

describe("Infraestructura común", () => {
  let app;
  beforeAll(() => {
    app = crearApp();
  });

  describe("errorHandler + errores personalizados", () => {
    it("traduce NoEncontrado a HTTP 404 con mensaje", async () => {
      const res = await request(app).get("/lanza-404");
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "No existe" });
    });

    it("traduce ReglaNegocio a HTTP 422", async () => {
      const res = await request(app).get("/lanza-422");
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("Regla rota");
    });
  });

  describe("validate", () => {
    it("acepta body válido y lo deja en req.body", async () => {
      const res = await request(app).post("/valida").send({ nombre: "Pepe" });
      expect(res.status).toBe(200);
      expect(res.body.datos).toEqual({ nombre: "Pepe" });
    });

    it("rechaza body inválido con 400 y mensaje del campo", async () => {
      const res = await request(app).post("/valida").send({ nombre: "Pe" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("nombre");
      expect(res.body.error).toContain("Mínimo 3 caracteres");
    });
  });

  describe("verificarToken + requireRol", () => {
    it("401 si no hay token", async () => {
      const res = await request(app).get("/solo-admin");
      expect(res.status).toBe(401);
    });

    it("401 si el token es inválido", async () => {
      const res = await request(app)
        .get("/solo-admin")
        .set("Authorization", "Bearer token-falso");
      expect(res.status).toBe(401);
    });

    it("403 si el token es válido pero el rol no es ADMIN", async () => {
      const token = jwt.sign(
        { id: "x", rol: "OPERARIO" },
        process.env.JWT_SECRET,
      );
      const res = await request(app)
        .get("/solo-admin")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it("200 si el rol es ADMIN", async () => {
      const token = jwt.sign(
        { id: "u1", rol: "ADMIN" },
        process.env.JWT_SECRET,
      );
      const res = await request(app)
        .get("/solo-admin")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.usuario.rol).toBe("ADMIN");
    });
  });
});
