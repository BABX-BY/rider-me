import express from "express";
import cors from "cors";
import { router as index } from "./controller/index.js";
import { customerRouter } from "./controller/customer.js";
import { orderRouter } from "./controller/order.js";
import { riderAuthRouter } from "./controller/rider-auth.js";
import { riderRouter } from "./controller/rider.js";

export const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:4200",
      "https://rider-frontend-git-dev-mexw.vercel.app",
    ],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json());
app.use("/", index);
app.use("/customers", customerRouter);
app.use("/orders", orderRouter);
app.use("/rider/auth", riderAuthRouter);
app.use("/rider", riderRouter);

export default app;
