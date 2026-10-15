import express from "express";
import cors from "cors";
import { router as index } from "./controller/index";
import { customerRouter } from "./controller/customer";
import { orderRouter } from "./controller/order";
import { riderAuthRouter } from "./controller/rider-auth";
import { riderRouter } from "./controller/rider";

export const app = express();

app.use(
  cors({
    origin: "http://localhost:4200",
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
