import express from "express";
import cors from "cors";
import { router as index } from "./controller/index.js";
import { customerRouter } from "./controller/customer.js";
import { orderRouter } from "./controller/order.js";
import { riderAuthRouter } from "./controller/rider-auth.js";
import { riderRouter } from "./controller/rider.js";

export const app = express();

const allowedOrigins = new Set([
  "http://localhost:4200",
  "https://rider-frontend-git-dev-mexw.vercel.app",
  "https://rider-frontend-lnqh5yrr3-mexw.vercel.app",
  "https://rider-frontend-na5pz18f2-mexw.vercel.app",
]);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin is not allowed: ${origin}`));
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-worksheet-code"],
    optionsSuccessStatus: 204,
  }),
);

app.use(express.json());
app.use("/", index);
app.use("/customers", customerRouter);
app.use("/orders", orderRouter);
app.use("/rider/auth", riderAuthRouter);
app.use("/rider", riderRouter);

export default app;
