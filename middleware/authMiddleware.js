import jwt from "jsonwebtoken";
import SystemSetting from "../models/SystemSetting.js";

// In-memory cache to prevent DB bombardment
let cachedSettings = { data: null, lastFetch: 0 };
const CACHE_TTL = 60 * 1000; // 60 seconds

// 🚀 FIX #4: Export a function to instantly invalidate the cache when settings change
export const clearSettingsCache = () => {
  cachedSettings = { data: null, lastFetch: 0 };
};

export const protect = async (req, res, next) => {
  let token;

  if (req.cookies && req.cookies.coop_token) {
    token = req.cookies.coop_token;
  } else if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token)
    return res
      .status(401)
      .json({ message: "Not authorized, no token provided" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    const now = Date.now();
    if (!cachedSettings.data || now - cachedSettings.lastFetch > CACHE_TTL) {
      cachedSettings.data = await SystemSetting.findOne();
      cachedSettings.lastFetch = now;
    }

    if (
      cachedSettings.data?.maintenanceMode &&
      req.user.role === "COOPERATOR"
    ) {
      return res
        .status(503)
        .json({ message: "System is currently under maintenance." });
    }

    next();
  } catch (error) {
    return res.status(401).json({ message: "Not authorized, token failed" });
  }
};

export const admin = (req, res, next) => {
  if (
    req.user &&
    (req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN")
  ) {
    next();
  } else {
    res
      .status(403)
      .json({ message: "Access denied. Admin privileges required." });
  }
};