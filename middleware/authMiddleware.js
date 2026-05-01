import jwt from "jsonwebtoken";

export const protect = (req, res, next) => {
  let token;

  // Check if the authorization header exists and starts with 'Bearer'
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      // Get the token from the header (Format: "Bearer <token>")
      token = req.headers.authorization.split(" ")[1];

      // Verify the token using your secret key
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Attach the decoded user payload (id, fileNumber, role) to the request object
      // so the next route knows exactly who is making the request
      req.user = decoded;

      // Move on to the actual route handler
      next();
    } catch (error) {
      console.error("Token verification failed:", error.message);
      return res.status(401).json({ message: "Not authorized, token failed" });
    }
  }

  if (!token) {
    return res
      .status(401)
      .json({ message: "Not authorized, no token provided" });
  }
};

// NEW: Admin Checkpoint
export const admin = (req, res, next) => {
  // Check if the user exists AND their role is an Admin variant
  if (
    req.user &&
    (req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN")
  ) {
    next(); // Let them pass
  } else {
    res
      .status(403)
      .json({ message: "Access denied. Admin privileges required." });
  }
};
