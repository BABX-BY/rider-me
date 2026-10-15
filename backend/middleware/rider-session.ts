import { NextFunction, Request, Response } from "express";
import { readRiderToken } from "../security/rider-session";

export interface RiderSessionRequest extends Request {
  riderId?: number;
  routePlanId?: number;
}

export function requireRiderToken(req: RiderSessionRequest, res: Response, next: NextFunction): void {
  const authorization = req.header("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const payload = token ? readRiderToken(token) : null;

  if (!payload) {
    res.status(401).json({ message: "กรุณาเข้าสู่ระบบ Rider หรือ Session หมดอายุ" });
    return;
  }

  req.riderId = payload.riderId;
  req.routePlanId = payload.routePlanId;
  next();
}
