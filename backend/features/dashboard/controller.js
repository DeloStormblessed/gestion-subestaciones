import { obtenerDashboard } from "./service.js";

export async function getDashboard(req, res, next) {
  try {
    const datos = await obtenerDashboard();
    res.json(datos);
  } catch (err) {
    next(err);
  }
}
