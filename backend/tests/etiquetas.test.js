import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.js";
import app from "../app.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

let tokenOperario, tokenTecnico, tokenAdmin;
let subestacion, activo;

beforeAll(async () => {
  // Limpieza completa en orden de FKs.
  await prisma.ordenTrabajo.deleteMany();
  await prisma.activo.deleteMany();
  await prisma.subestacion.deleteMany();
  await prisma.usuario.deleteMany();
  await prisma.etiqueta.deleteMany();

  const hash = await bcrypt.hash("password123", 10);
  const operario = await prisma.usuario.create({
    data: {
      email: "op@et.com",
      passwordHash: hash,
      nombre: "Op",
      rol: "OPERARIO",
    },
  });
  const tecnico = await prisma.usuario.create({
    data: {
      email: "tec@et.com",
      passwordHash: hash,
      nombre: "Tec",
      rol: "TECNICO",
    },
  });
  const admin = await prisma.usuario.create({
    data: {
      email: "adm@et.com",
      passwordHash: hash,
      nombre: "Adm",
      rol: "ADMIN",
    },
  });

  tokenOperario = jwt.sign(
    { id: operario.id, email: operario.email, rol: operario.rol },
    process.env.JWT_SECRET,
  );
  tokenTecnico = jwt.sign(
    { id: tecnico.id, email: tecnico.email, rol: tecnico.rol },
    process.env.JWT_SECRET,
  );
  tokenAdmin = jwt.sign(
    { id: admin.id, email: admin.email, rol: admin.rol },
    process.env.JWT_SECRET,
  );

  subestacion = await prisma.subestacion.create({
    data: {
      codigo: "SUB-ET",
      nombre: "Sub Et",
      ubicacion: "X",
      tensionNominal: 132,
    },
  });
  activo = await prisma.activo.create({
    data: {
      codigo: "ACT-ET-1",
      tipo: "TRANSFORMADOR_POTENCIA",
      fabricante: "F",
      fechaPuestaEnServicio: new Date("2024-01-01"),
      fechaProximaInspeccion: new Date("2027-01-01"),
      subestacionId: subestacion.id,
    },
  });
});

// Limpiamos etiquetas entre tests para que cada uno arranque con tabla vacía.
// Las etiquetas son metadato, no tienen restricción de borrado, y así evitamos
// que los names únicos colisionen entre describes.
beforeEach(async () => {
  // Desasociar primero del activo (tabla join) para no dejar referencias colgando.
  await prisma.activo.update({
    where: { id: activo.id },
    data: { etiquetas: { set: [] } },
  });
  await prisma.etiqueta.deleteMany();
});

afterAll(async () => {
  await prisma.ordenTrabajo.deleteMany();
  await prisma.activo.deleteMany();
  await prisma.subestacion.deleteMany();
  await prisma.usuario.deleteMany();
  await prisma.etiqueta.deleteMany();
  await prisma.$disconnect();
});

describe("GET /api/v1/etiquetas", () => {
  it("devuelve 401 sin token", async () => {
    const res = await request(app).get("/api/v1/etiquetas");
    expect(res.status).toBe(401);
  });

  it("OPERARIO puede listar", async () => {
    await prisma.etiqueta.create({
      data: { nombre: "critica", color: "#FF0000" },
    });
    const res = await request(app)
      .get("/api/v1/etiquetas")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ nombre: "critica", color: "#FF0000" });
  });

  it("incluye _count de activos asociados", async () => {
    const et = await prisma.etiqueta.create({ data: { nombre: "urgente" } });
    await prisma.activo.update({
      where: { id: activo.id },
      data: { etiquetas: { connect: { id: et.id } } },
    });
    const res = await request(app)
      .get("/api/v1/etiquetas")
      .set("Authorization", `Bearer ${tokenOperario}`);
    expect(res.body[0]._count.activos).toBe(1);
  });
});

describe("POST /api/v1/etiquetas", () => {
  it("devuelve 403 si OPERARIO intenta crear", async () => {
    const res = await request(app)
      .post("/api/v1/etiquetas")
      .set("Authorization", `Bearer ${tokenOperario}`)
      .send({ nombre: "noop" });
    expect(res.status).toBe(403);
  });

  it("TECNICO puede crear", async () => {
    const res = await request(app)
      .post("/api/v1/etiquetas")
      .set("Authorization", `Bearer ${tokenTecnico}`)
      .send({ nombre: "mantenimiento", color: "#00AAFF" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      nombre: "mantenimiento",
      color: "#00AAFF",
    });
  });

  it("color es opcional", async () => {
    const res = await request(app)
      .post("/api/v1/etiquetas")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ nombre: "sin-color" });
    expect(res.status).toBe(201);
    expect(res.body.color).toBeNull();
  });

  it("devuelve 400 si color tiene formato inválido", async () => {
    const res = await request(app)
      .post("/api/v1/etiquetas")
      .set("Authorization", `Bearer ${tokenTecnico}`)
      .send({ nombre: "mala", color: "rojo" });
    expect(res.status).toBe(400);
  });

  it("devuelve 409 si el nombre ya existe", async () => {
    await prisma.etiqueta.create({ data: { nombre: "duplicada" } });
    const res = await request(app)
      .post("/api/v1/etiquetas")
      .set("Authorization", `Bearer ${tokenTecnico}`)
      .send({ nombre: "duplicada" });
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/v1/etiquetas/:id", () => {
  it("devuelve 403 si TECNICO intenta borrar", async () => {
    const et = await prisma.etiqueta.create({ data: { nombre: "borrame" } });
    const res = await request(app)
      .delete(`/api/v1/etiquetas/${et.id}`)
      .set("Authorization", `Bearer ${tokenTecnico}`);
    expect(res.status).toBe(403);
  });

  it("ADMIN puede borrar", async () => {
    const et = await prisma.etiqueta.create({ data: { nombre: "borrame" } });
    const res = await request(app)
      .delete(`/api/v1/etiquetas/${et.id}`)
      .set("Authorization", `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(204);
    const sigue = await prisma.etiqueta.findUnique({ where: { id: et.id } });
    expect(sigue).toBeNull();
  });

  it("borrar etiqueta asociada NO borra el activo, solo la asociación", async () => {
    const et = await prisma.etiqueta.create({ data: { nombre: "temp" } });
    await prisma.activo.update({
      where: { id: activo.id },
      data: { etiquetas: { connect: { id: et.id } } },
    });

    await request(app)
      .delete(`/api/v1/etiquetas/${et.id}`)
      .set("Authorization", `Bearer ${tokenAdmin}`);

    // El activo sigue vivo, solo perdió la etiqueta.
    const activoTrasBorrado = await prisma.activo.findUnique({
      where: { id: activo.id },
      include: { etiquetas: true },
    });
    expect(activoTrasBorrado).not.toBeNull();
    expect(activoTrasBorrado.etiquetas).toHaveLength(0);
  });

  it("devuelve 404 si la etiqueta no existe", async () => {
    const res = await request(app)
      .delete("/api/v1/etiquetas/999999")
      .set("Authorization", `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/activos/:id/etiquetas (asociación)", () => {
  it("devuelve 403 si OPERARIO intenta asociar", async () => {
    const res = await request(app)
      .post(`/api/v1/activos/${activo.id}/etiquetas`)
      .set("Authorization", `Bearer ${tokenOperario}`)
      .send({ etiquetaIds: [] });
    expect(res.status).toBe(403);
  });

  it("TECNICO puede asociar etiquetas (reemplazo total)", async () => {
    const et1 = await prisma.etiqueta.create({ data: { nombre: "e1" } });
    const et2 = await prisma.etiqueta.create({ data: { nombre: "e2" } });

    const res = await request(app)
      .post(`/api/v1/activos/${activo.id}/etiquetas`)
      .set("Authorization", `Bearer ${tokenTecnico}`)
      .send({ etiquetaIds: [et1.id, et2.id] });

    expect(res.status).toBe(200);
    expect(res.body.etiquetas).toHaveLength(2);
    expect(res.body.etiquetas.map((e) => e.id).sort()).toEqual(
      [et1.id, et2.id].sort(),
    );
  });

  it("semántica de reemplazo: las anteriores no en el array se eliminan", async () => {
    const et1 = await prisma.etiqueta.create({ data: { nombre: "e1" } });
    const et2 = await prisma.etiqueta.create({ data: { nombre: "e2" } });
    const et3 = await prisma.etiqueta.create({ data: { nombre: "e3" } });

    // Estado inicial: activo asociado a e1 y e2.
    await prisma.activo.update({
      where: { id: activo.id },
      data: { etiquetas: { set: [{ id: et1.id }, { id: et2.id }] } },
    });

    // Reemplazo: ahora solo debe quedar e3.
    const res = await request(app)
      .post(`/api/v1/activos/${activo.id}/etiquetas`)
      .set("Authorization", `Bearer ${tokenTecnico}`)
      .send({ etiquetaIds: [et3.id] });

    expect(res.body.etiquetas).toHaveLength(1);
    expect(res.body.etiquetas[0].id).toBe(et3.id);
  });

  it("array vacío quita todas las etiquetas", async () => {
    const et = await prisma.etiqueta.create({ data: { nombre: "temp" } });
    await prisma.activo.update({
      where: { id: activo.id },
      data: { etiquetas: { connect: { id: et.id } } },
    });

    const res = await request(app)
      .post(`/api/v1/activos/${activo.id}/etiquetas`)
      .set("Authorization", `Bearer ${tokenTecnico}`)
      .send({ etiquetaIds: [] });

    expect(res.status).toBe(200);
    expect(res.body.etiquetas).toHaveLength(0);
  });

  it("devuelve 404 si el activo no existe", async () => {
    const res = await request(app)
      .post("/api/v1/activos/cuid-que-no-existe/etiquetas")
      .set("Authorization", `Bearer ${tokenTecnico}`)
      .send({ etiquetaIds: [] });
    expect(res.status).toBe(404);
  });

  it("devuelve 404 si alguna etiqueta del array no existe", async () => {
    const et = await prisma.etiqueta.create({ data: { nombre: "real" } });
    const res = await request(app)
      .post(`/api/v1/activos/${activo.id}/etiquetas`)
      .set("Authorization", `Bearer ${tokenTecnico}`)
      .send({ etiquetaIds: [et.id, 99999] });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/99999/);
  });

  it("devuelve 400 si etiquetaIds contiene no-enteros", async () => {
    const res = await request(app)
      .post(`/api/v1/activos/${activo.id}/etiquetas`)
      .set("Authorization", `Bearer ${tokenTecnico}`)
      .send({ etiquetaIds: ["abc"] });
    expect(res.status).toBe(400);
  });
});
