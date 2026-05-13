// backend/lib/intervalos-inspeccion.js

// Intervalo de inspección periódica (en días) por tipo de activo.
// Vive en código (constante) en vez de en BD porque corresponde a normativa,
// no a configuración runtime. Migrar a tabla el día que se necesite dinámico
// es trivial: cambia la implementación de la función, no su firma.
const INTERVALOS_DIAS = {
  TRANSFORMADOR_POTENCIA: 180,
  INTERRUPTOR_AUTOMATICO: 365,
  SECCIONADOR: 90,
  PARARRAYOS: 365,
  TRANSFORMADOR_MEDIDA: 365,
  BATERIA_CONDENSADORES: 180,
};

export function obtenerIntervaloInspeccion(tipoActivo) {
  const dias = INTERVALOS_DIAS[tipoActivo];
  if (dias === undefined) {
    // Si alguien añade un TipoActivo al enum y se olvida de añadirlo aquí, que pete pronto y claro.
    throw new Error(
      `Intervalo de inspección no definido para tipo: ${tipoActivo}`,
    );
  }
  return dias;
}
