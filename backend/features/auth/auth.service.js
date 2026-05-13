// backend/features/auth/auth.service.js
//
// Lógica de autenticación. Sin objetos req/res: el service recibe datos planos
// y devuelve datos planos. Esto permite testearlo sin levantar Express y
// reutilizarlo desde otros orígenes en el futuro (cron, webhook entrante, etc.).

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../../lib/prisma.js";
import { NoAutorizado, NoEncontrado } from "../../lib/errores.js";

// Coste 10: equilibrio razonable entre seguridad y latencia.
// El profesor usa 10 también. Subirlo a 12 multiplica el tiempo x4 sin ganancia clara para este proyecto.
const COSTE_BCRYPT = 10;

// Duración del token: 7 días. Suficiente para no obligar a reloguear constantemente
// y corto como para limitar el daño si se filtra. En producción real probablemente
// 15 min + refresh token, pero refresh tokens están explícitamente fuera del scope (§13).
const DURACION_TOKEN = "7d";

// Genera el JWT con el payload mínimo que necesita el middleware verificarToken.
// No incluimos el nombre ni otros datos: si cambian en BD, el token quedaría obsoleto.
// El id + rol es suficiente; el resto se consulta a BD cuando haga falta.
function firmarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, email: usuario.email, rol: usuario.rol },
    process.env.JWT_SECRET,
    { expiresIn: DURACION_TOKEN },
  );
}

// Devuelve el usuario sin el passwordHash. Pequeño helper para no olvidarlo nunca:
// es el tipo de fuga de datos que se cuela en code reviews si no es explícito.
function sinPasswordHash(usuario) {
  const { passwordHash, ...resto } = usuario;
  return resto;
}

// ============================================================
// Registro
// ============================================================
// El rol siempre se fuerza a OPERARIO. Ascender a TECNICO/ADMIN solo es posible
// desde el endpoint PATCH /usuarios/:id/rol, que requiere autenticación ADMIN (scope §9).
export async function registrar({ email, password, nombre }) {
  const passwordHash = await bcrypt.hash(password, COSTE_BCRYPT);

  // Si el email ya existe, Prisma lanza P2002 → errorHandler lo convierte a Conflicto (409).
  // No comprobamos manualmente con un findUnique previo: hacerlo crea una race condition
  // (dos peticiones simultáneas con el mismo email pasarían ambas el check y la segunda
  // pincharía en el insert de todas formas). Confiamos en el constraint de BD.
  const usuario = await prisma.usuario.create({
    data: { email, passwordHash, nombre, rol: "OPERARIO" },
  });

  return { usuario: sinPasswordHash(usuario), token: firmarToken(usuario) };
}

// ============================================================
// Login
// ============================================================
// Tanto "email no existe" como "password incorrecta" devuelven el MISMO error genérico.
// Diferenciarlos permitiría a un atacante enumerar emails registrados en el sistema.
export async function login({ email, password }) {
  const usuario = await prisma.usuario.findUnique({ where: { email } });
  if (!usuario) throw new NoAutorizado("Credenciales incorrectas");

  // Soft delete: usuario desactivado no puede entrar. Mensaje genérico también,
  // por el mismo motivo de no filtrar información.
  if (!usuario.activo) throw new NoAutorizado("Credenciales incorrectas");

  const passwordValida = await bcrypt.compare(password, usuario.passwordHash);
  if (!passwordValida) throw new NoAutorizado("Credenciales incorrectas");

  return { usuario: sinPasswordHash(usuario), token: firmarToken(usuario) };
}

// ============================================================
// Perfil del autenticado
// ============================================================
// Devuelve los datos actuales del usuario asociado al token. Útil porque el token
// puede tener datos desactualizados (ej: rol promovido después de firmar el token).
export async function obtenerPerfil(idUsuario) {
  const usuario = await prisma.usuario.findUnique({ where: { id: idUsuario } });
  // Caso límite: token válido cuyo usuario ha sido eliminado de BD.
  // En nuestro sistema no hay hard delete (scope §7), pero por defensa lo cubrimos.
  if (!usuario) throw new NoEncontrado("Usuario no encontrado");
  return sinPasswordHash(usuario);
}
