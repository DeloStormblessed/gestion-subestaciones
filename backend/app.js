// backend/app.js

import express from "express";
import authRoutes from "./features/auth/routes.js";
import usuariosRoutes from "./features/usuarios/routes.js";
import subestacionesRoutes from "./features/subestaciones/routes.js";
import activosRoutes from "./features/activos/routes.js";
import ordenesTrabajoRoutes from "./features/ordenes-trabajo/routes.js";
import etiquetasRoutes from "./features/etiquetas/routes.js";
import errorHandler from "./middleware/errorHandler.js";

const app = express();
app.use(express.json());
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/usuarios", usuariosRoutes);
app.use("/api/v1/subestaciones", subestacionesRoutes);
app.use("/api/v1/activos", activosRoutes);
app.use("/api/v1/ordenes-trabajo", ordenesTrabajoRoutes);
app.use("/api/v1/etiquetas", etiquetasRoutes);
app.use(errorHandler);

export default app;
