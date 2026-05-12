import jwt from "jsonwebtoken";
import SystemSetting from "../models/SystemSetting.js"; // 🚀 Added import

// 🚀 Changed to async to query DB for Maintenance Mode
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

  if (!token) {
    return res
      .status(401)
      .json({ message: "Not authorized, no token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    // 🚀 SYSTEM LOCKOUT ENFORCEMENT: Block standard users if maintenance is ON
    const settings = await SystemSetting.findOne();
    if (
      settings &&
      settings.maintenanceMode &&
      req.user.role === "COOPERATOR"
    ) {
      return res.status(503).json({
        message:
          "System is currently under maintenance. Please try again later.",
      });
    }

    next();
  } catch (error) {
    console.error("Token verification failed:", error.message);
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
