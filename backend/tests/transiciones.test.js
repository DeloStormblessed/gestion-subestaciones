// backend/tests/transiciones.test.js

import { describe, it, expect } from "vitest";
import { aplicarTransicion } from "../lib/transiciones.js";
import { ReglaNegocio } from "../lib/errores.js";

describe("aplicarTransicion — transiciones válidas (scope §7 regla A)", () => {
  describe("desde EN_SERVICIO", () => {
    it("INSPECCION + OK → EN_SERVICIO (se mantiene en servicio)", () => {
      expect(aplicarTransicion("EN_SERVICIO", "INSPECCION", "OK")).toBe(
        "EN_SERVICIO",
      );
    });
    it("INSPECCION + AVERIA_DETECTADA → AVERIADO", () => {
      expect(
        aplicarTransicion("EN_SERVICIO", "INSPECCION", "AVERIA_DETECTADA"),
      ).toBe("AVERIADO");
    });
    it("PREVENTIVO → FUERA_DE_SERVICIO", () => {
      expect(aplicarTransicion("EN_SERVICIO", "PREVENTIVO")).toBe(
        "FUERA_DE_SERVICIO",
      );
    });
    it("CORRECTIVO → FUERA_DE_SERVICIO", () => {
      expect(aplicarTransicion("EN_SERVICIO", "CORRECTIVO")).toBe(
        "FUERA_DE_SERVICIO",
      );
    });
    it("BAJA → DADO_DE_BAJA", () => {
      expect(aplicarTransicion("EN_SERVICIO", "BAJA")).toBe("DADO_DE_BAJA");
    });
  });

  describe("desde AVERIADO", () => {
    // El resultado de la INSPECCION sobre un averiado no altera el estado:
    // para recuperarlo hace falta una OT de CORRECTIVO.
    it("INSPECCION + OK → AVERIADO (sigue averiado)", () => {
      expect(aplicarTransicion("AVERIADO", "INSPECCION", "OK")).toBe(
        "AVERIADO",
      );
    });
    it("INSPECCION + AVERIA_DETECTADA → AVERIADO", () => {
      expect(
        aplicarTransicion("AVERIADO", "INSPECCION", "AVERIA_DETECTADA"),
      ).toBe("AVERIADO");
    });
    it("CORRECTIVO → FUERA_DE_SERVICIO (entra a reparación)", () => {
      expect(aplicarTransicion("AVERIADO", "CORRECTIVO")).toBe(
        "FUERA_DE_SERVICIO",
      );
    });
    it("BAJA → DADO_DE_BAJA", () => {
      expect(aplicarTransicion("AVERIADO", "BAJA")).toBe("DADO_DE_BAJA");
    });
  });

  describe("desde FUERA_DE_SERVICIO", () => {
    it("INSPECCION + OK → FUERA_DE_SERVICIO (la inspección no lo reactiva)", () => {
      expect(aplicarTransicion("FUERA_DE_SERVICIO", "INSPECCION", "OK")).toBe(
        "FUERA_DE_SERVICIO",
      );
    });
    it("CORRECTIVO → EN_SERVICIO (vuelve al servicio tras reparación)", () => {
      expect(aplicarTransicion("FUERA_DE_SERVICIO", "CORRECTIVO")).toBe(
        "EN_SERVICIO",
      );
    });
    it("BAJA → DADO_DE_BAJA", () => {
      expect(aplicarTransicion("FUERA_DE_SERVICIO", "BAJA")).toBe(
        "DADO_DE_BAJA",
      );
    });
  });

  describe("desde DADO_DE_BAJA", () => {
    it("INSTALACION → EN_SERVICIO (re-puesta en servicio)", () => {
      expect(aplicarTransicion("DADO_DE_BAJA", "INSTALACION")).toBe(
        "EN_SERVICIO",
      );
    });
  });
});

describe("aplicarTransicion — transiciones prohibidas (scope §7 regla A)", () => {
  it("EN_SERVICIO + INSTALACION → ReglaNegocio (ya está instalado)", () => {
    expect(() => aplicarTransicion("EN_SERVICIO", "INSTALACION")).toThrow(
      ReglaNegocio,
    );
  });
  it("AVERIADO + PREVENTIVO → ReglaNegocio (no se hace preventivo sobre averiado)", () => {
    expect(() => aplicarTransicion("AVERIADO", "PREVENTIVO")).toThrow(
      ReglaNegocio,
    );
  });
  it("AVERIADO + INSTALACION → ReglaNegocio", () => {
    expect(() => aplicarTransicion("AVERIADO", "INSTALACION")).toThrow(
      ReglaNegocio,
    );
  });
  it("FUERA_DE_SERVICIO + PREVENTIVO → ReglaNegocio", () => {
    expect(() => aplicarTransicion("FUERA_DE_SERVICIO", "PREVENTIVO")).toThrow(
      ReglaNegocio,
    );
  });
  it("FUERA_DE_SERVICIO + INSTALACION → ReglaNegocio", () => {
    expect(() => aplicarTransicion("FUERA_DE_SERVICIO", "INSTALACION")).toThrow(
      ReglaNegocio,
    );
  });
  it("DADO_DE_BAJA + INSPECCION → ReglaNegocio (no se inspecciona lo dado de baja)", () => {
    expect(() => aplicarTransicion("DADO_DE_BAJA", "INSPECCION", "OK")).toThrow(
      ReglaNegocio,
    );
  });
  it("DADO_DE_BAJA + PREVENTIVO → ReglaNegocio", () => {
    expect(() => aplicarTransicion("DADO_DE_BAJA", "PREVENTIVO")).toThrow(
      ReglaNegocio,
    );
  });
  it("DADO_DE_BAJA + CORRECTIVO → ReglaNegocio", () => {
    expect(() => aplicarTransicion("DADO_DE_BAJA", "CORRECTIVO")).toThrow(
      ReglaNegocio,
    );
  });
  it("DADO_DE_BAJA + BAJA → ReglaNegocio (ya está dado de baja)", () => {
    expect(() => aplicarTransicion("DADO_DE_BAJA", "BAJA")).toThrow(
      ReglaNegocio,
    );
  });
});

describe("aplicarTransicion — errores de entrada", () => {
  it("INSPECCION sin resultadoInspeccion → ReglaNegocio", () => {
    expect(() => aplicarTransicion("EN_SERVICIO", "INSPECCION")).toThrow(
      ReglaNegocio,
    );
  });
  it("INSPECCION con resultadoInspeccion inválido → ReglaNegocio", () => {
    expect(() =>
      aplicarTransicion("EN_SERVICIO", "INSPECCION", "MAS_O_MENOS"),
    ).toThrow(ReglaNegocio);
  });
  it("Estado desconocido → ReglaNegocio", () => {
    expect(() => aplicarTransicion("ESTADO_FANTASMA", "BAJA")).toThrow(
      ReglaNegocio,
    );
  });
});
