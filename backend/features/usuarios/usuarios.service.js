// backend/features/usuarios/usuarios.service.js
//
// Lógica de gestión de usuarios. Operaciones puramente ADMIN.
// La autorización por rol la aplican las rutas; aquí asumimos que el caller es legítimo.

import prisma from "../../lib/prisma.js";
import { NoEncontrado, ReglaNegocio } from "../../lib/errores.js";

// Campos seguros que devolvemos al cliente. NUNCA incluimos passwordHash.
// Definirlo una vez y reutilizarlo en todas las queries evita la fuga por descuido.
const CAMPOS_PUBLICOS = {
  id: true,
  email: true,
  nombre: true,
  rol: true,
  activo: true,
  createdAt: true,
  updatedAt: true,
};

// ============================================================
// Listar con filtros y paginación
// ============================================================
export async function listar({ filtros, pagina, limite, salto }) {
  // Construimos el `where` solo con los filtros realmente presentes.
  // Prisma con `where: { rol: undefined }` lo ignora, pero ser explícito ayuda al leerlo.
  const where = {};
  if (filtros.rol !== undefined) where.rol = filtros.rol;
  if (filtros.activo !== undefined) where.activo = filtros.activo;

  // Paralelizar findMany + count: dos queries independientes, no hace falta esperar a una.
  const [datos, total] = await Promise.all([
    prisma.usuario.findMany({
      where,
      select: CAMPOS_PUBLICOS,
      orderBy: { createdAt: "desc" },
      skip: salto,
      take: limite,
    }),
    prisma.usuario.count({ where }),
  ]);

  return { datos, total, pagina, limite };
}

// ============================================================
// Detalle
// ============================================================
export async function obtenerPorId(id) {
  const usuario = await prisma.usuario.findUnique({
    where: { id },
    select: CAMPOS_PUBLICOS,
  });
  if (!usuario) throw new NoEncontrado("Usuario no encontrado");
  return usuario;
}

// ============================================================
// Cambio de rol
// ============================================================
// Regla defendible (no literal en el scope, pero obvia): un ADMIN no puede modificar
// su propio rol. Si pudiera, podría auto-degradarse a OPERARIO y dejar el sistema
// potencialmente sin ningún ADMIN. Mismo argumento que para la activación.
export async function cambiarRol({ idObjetivo, idSolicitante, nuevoRol }) {
  if (idObjetivo === idSolicitante) {
    throw new ReglaNegocio("Un administrador no puede modificar su propio rol");
  }
  // findUniqueOrThrow lanza P2025 si no existe → errorHandler lo convierte a 404.
  await prisma.usuario.findUniqueOrThrow({ where: { id: idObjetivo } });

  return prisma.usuario.update({
    where: { id: idObjetivo },
    data: { rol: nuevoRol },
    select: CAMPOS_PUBLICOS,
  });
}

// ============================================================
// Activación / desactivación (soft delete)
// ============================================================
// Misma regla: un ADMIN no puede desactivarse a sí mismo.
// Soft delete: el campo `activo` es el equivalente al "borrado" para usuarios (scope §7).
// Borrar físicamente rompería el histórico de OTs firmadas por este usuario.
export async function cambiarActivacion({ idObjetivo, idSolicitante, activo }) {
  if (idObjetivo === idSolicitante) {
    throw new ReglaNegocio(
      "Un administrador no puede modificar su propio estado de activación",
    );
  }
  await prisma.usuario.findUniqueOrThrow({ where: { id: idObjetivo } });

  return prisma.usuario.update({
    where: { id: idObjetivo },
    data: { activo },
    select: CAMPOS_PUBLICOS,
  });
}
