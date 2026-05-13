// backend/features/activos/activos.test.js

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.js";
import app from "../app.js";

// tests/integration/activos.test.js (ampliación)
//
// Añadir al inicio del archivo, junto a los imports existentes:

import { notificarWebhook } from "../lib/webhook.js";
// ↑ Ajusta la ruta a tu estructura real (lib/webhook.js desde tests/integration).
// Lo correcto es: '../../lib/webhook.js'

// Mock del módulo completo. notificarWebhook pasa a ser un vi.fn().
// Lo importamos arriba para poder asertar sobre sus llamadas.
vi.mock("../lib/webhook.js", () => ({
  notificarWebhook: vi.fn(),
}));

beforeEach(() => {
  // Reseteamos el mock antes de cada test: si un test anterior llamó al
  // webhook, no queremos que contamine las aserciones del siguiente.
  vi.mocked(notificarWebhook).mockClear();
});

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

describe("POST /api/v1/activos/:id/ordenes-trabajo", () => {
  let activoTestId;

  beforeEach(async () => {
    // Cada test del bloque parte de un activo limpio EN_SERVICIO,
    // creado directamente vía Prisma para no depender del endpoint POST /activos.
    const activo = await prisma.activo.create({
      data: {
        codigo: `ACT-TEST-${Date.now()}`,
        tipo: "TRANSFORMADOR_POTENCIA",
        fabricante: "TestCorp",
        fechaPuestaEnServicio: new Date(),
        estado: "EN_SERVICIO",
        // Inspección futura: regla B no se activa.
        fechaProximaInspeccion: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        subestacionId: subestacionId, // creado en beforeAll
      },
    });
    activoTestId = activo.id;
  });

  describe("autorización por rol", () => {
    it("401 sin token", async () => {
      const res = await request(app)
        .post(`/api/v1/activos/${activoTestId}/ordenes-trabajo`)
        .send({ tipo: "INSPECCION", descripcion: "Revisión", resultado: "OK" });
      expect(res.status).toBe(401);
    });

    it("OPERARIO puede crear OT de tipo INSPECCION", async () => {
      const res = await request(app)
        .post(`/api/v1/activos/${activoTestId}/ordenes-trabajo`)
        .set("Authorization", `Bearer ${tokenOperario}`)
        .send({
          tipo: "INSPECCION",
          descripcion: "Revisión visual",
          resultado: "OK",
        });
      expect(res.status).toBe(201);
    });

    it("OPERARIO NO puede crear OT de tipo PREVENTIVO (403)", async () => {
      const res = await request(app)
        .post(`/api/v1/activos/${activoTestId}/ordenes-trabajo`)
        .set("Authorization", `Bearer ${tokenOperario}`)
        .send({ tipo: "PREVENTIVO", descripcion: "Mantenimiento anual" });
      expect(res.status).toBe(403);
    });

    it("TECNICO puede crear OT de tipo CORRECTIVO", async () => {
      const res = await request(app)
        .post(`/api/v1/activos/${activoTestId}/ordenes-trabajo`)
        .set("Authorization", `Bearer ${tokenTecnico}`)
        .send({ tipo: "CORRECTIVO", descripcion: "Sustitución de fusible" });
      expect(res.status).toBe(201);
    });
  });

  describe("transiciones válidas y efectos colaterales", () => {
    it("INSPECCION OK: estado no cambia y recalcula fechaProximaInspeccion", async () => {
      const fechaAntes = (
        await prisma.activo.findUnique({ where: { id: activoTestId } })
      ).fechaProximaInspeccion;

      const res = await request(app)
        .post(`/api/v1/activos/${activoTestId}/ordenes-trabajo`)
        .set("Authorization", `Bearer ${tokenTecnico}`)
        .send({ tipo: "INSPECCION", descripcion: "OK total", resultado: "OK" });

      expect(res.status).toBe(201);
      expect(res.body.estadoAnterior).toBe("EN_SERVICIO");
      expect(res.body.estadoNuevo).toBe("EN_SERVICIO");

      const activoDespues = await prisma.activo.findUnique({
        where: { id: activoTestId },
      });
      expect(activoDespues.estado).toBe("EN_SERVICIO");
      // La nueva fecha tiene que ser POSTERIOR a la anterior (se ha recalculado).
      expect(activoDespues.fechaProximaInspeccion.getTime()).toBeGreaterThan(
        fechaAntes.getTime(),
      );

      // Webhook NO disparado: INSPECCION OK no es evento crítico.
      expect(notificarWebhook).not.toHaveBeenCalled();
    });

    it("INSPECCION AVERIA_DETECTADA: transita a AVERIADO y dispara webhook", async () => {
      const res = await request(app)
        .post(`/api/v1/activos/${activoTestId}/ordenes-trabajo`)
        .set("Authorization", `Bearer ${tokenOperario}`)
        .send({
          tipo: "INSPECCION",
          descripcion: "Detectada fuga de aceite",
          resultado: "AVERIA_DETECTADA",
        });

      expect(res.status).toBe(201);
      expect(res.body.estadoNuevo).toBe("AVERIADO");

      const activoDespues = await prisma.activo.findUnique({
        where: { id: activoTestId },
      });
      expect(activoDespues.estado).toBe("AVERIADO");

      // Webhook disparado con evento correcto.
      expect(notificarWebhook).toHaveBeenCalledTimes(1);
      expect(notificarWebhook).toHaveBeenCalledWith(
        "ot.averia_detectada",
        expect.objectContaining({
          activo: expect.objectContaining({ id: activoTestId }),
          subestacion: expect.any(Object),
          ordenTrabajo: expect.any(Object),
        }),
      );
    });

    it("CORRECTIVO: transita a FUERA_DE_SERVICIO y dispara webhook", async () => {
      const res = await request(app)
        .post(`/api/v1/activos/${activoTestId}/ordenes-trabajo`)
        .set("Authorization", `Bearer ${tokenTecnico}`)
        .send({ tipo: "CORRECTIVO", descripcion: "Reemplazo de bobina" });

      expect(res.status).toBe(201);
      expect(res.body.estadoNuevo).toBe("FUERA_DE_SERVICIO");

      expect(notificarWebhook).toHaveBeenCalledTimes(1);
      expect(notificarWebhook).toHaveBeenCalledWith(
        "ot.correctivo",
        expect.any(Object),
      );
    });

    it("PREVENTIVO sobre activo con inspección al día: transita a FUERA_DE_SERVICIO", async () => {
      const res = await request(app)
        .post(`/api/v1/activos/${activoTestId}/ordenes-trabajo`)
        .set("Authorization", `Bearer ${tokenTecnico}`)
        .send({ tipo: "PREVENTIVO", descripcion: "Mantenimiento programado" });

      expect(res.status).toBe(201);
      expect(res.body.estadoNuevo).toBe("FUERA_DE_SERVICIO");
      // PREVENTIVO no es evento crítico.
      expect(notificarWebhook).not.toHaveBeenCalled();
    });
  });

  describe("reglas de negocio", () => {
    it("Regla B: rechaza PREVENTIVO si la inspección está vencida (422)", async () => {
      // Forzamos fechaProximaInspeccion al pasado vía Prisma directo.
      // Setup de test: saltarse el endpoint normal está justificado aquí.
      await prisma.activo.update({
        where: { id: activoTestId },
        data: {
          fechaProximaInspeccion: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      });

      const res = await request(app)
        .post(`/api/v1/activos/${activoTestId}/ordenes-trabajo`)
        .set("Authorization", `Bearer ${tokenTecnico}`)
        .send({
          tipo: "PREVENTIVO",
          descripcion: "Intento con inspección vencida",
        });

      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/inspección vencida/i);

      // Verificamos que NO se creó OT y NO se llamó al webhook.
      const otsDelActivo = await prisma.ordenTrabajo.count({
        where: { activoId: activoTestId },
      });
      expect(otsDelActivo).toBe(0);
      expect(notificarWebhook).not.toHaveBeenCalled();
    });

    it("Regla A: rechaza PREVENTIVO sobre activo AVERIADO (422)", async () => {
      await prisma.activo.update({
        where: { id: activoTestId },
        data: { estado: "AVERIADO" },
      });

      const res = await request(app)
        .post(`/api/v1/activos/${activoTestId}/ordenes-trabajo`)
        .set("Authorization", `Bearer ${tokenTecnico}`)
        .send({ tipo: "PREVENTIVO", descripcion: "No debería poder" });

      expect(res.status).toBe(422);
    });

    it("Regla A: rechaza INSTALACION sobre activo EN_SERVICIO (422)", async () => {
      const res = await request(app)
        .post(`/api/v1/activos/${activoTestId}/ordenes-trabajo`)
        .set("Authorization", `Bearer ${tokenTecnico}`)
        .send({
          tipo: "INSTALACION",
          descripcion: "Reinstalar activo en servicio",
        });

      expect(res.status).toBe(422);
    });

    it("404 si el activo no existe", async () => {
      const res = await request(app)
        .post("/api/v1/activos/idquenoexiste/ordenes-trabajo")
        .set("Authorization", `Bearer ${tokenTecnico}`)
        .send({ tipo: "INSPECCION", descripcion: "NoExiste", resultado: "OK" });

      expect(res.status).toBe(404);
    });
  });

  describe("validación de body", () => {
    it("400 si falta descripcion", async () => {
      const res = await request(app)
        .post(`/api/v1/activos/${activoTestId}/ordenes-trabajo`)
        .set("Authorization", `Bearer ${tokenTecnico}`)
        .send({ tipo: "PREVENTIVO" });
      expect(res.status).toBe(400);
    });

    it("400 si INSPECCION sin resultado", async () => {
      const res = await request(app)
        .post(`/api/v1/activos/${activoTestId}/ordenes-trabajo`)
        .set("Authorization", `Bearer ${tokenTecnico}`)
        .send({ tipo: "INSPECCION", descripcion: "Sin resultado" });
      expect(res.status).toBe(400);
    });

    it("400 si PREVENTIVO con resultado (campo no aplica)", async () => {
      const res = await request(app)
        .post(`/api/v1/activos/${activoTestId}/ordenes-trabajo`)
        .set("Authorization", `Bearer ${tokenTecnico}`)
        .send({ tipo: "PREVENTIVO", descripcion: "NoExiste", resultado: "OK" });
      expect(res.status).toBe(400);
    });

    it("400 si tipo es inválido", async () => {
      const res = await request(app)
        .post(`/api/v1/activos/${activoTestId}/ordenes-trabajo`)
        .set("Authorization", `Bearer ${tokenTecnico}`)
        .send({ tipo: "TIPO_INEXISTENTE", descripcion: "NoExiste" });
      expect(res.status).toBe(400);
    });
  });
});
