import jwt from "jsonwebtoken";

export const protect = (req, res, next) => {
  let token;

  // 🚀 FIX 3: Check for the token in the HttpOnly cookie first
  if (req.cookies && req.cookies.coop_token) {
    token = req.cookies.coop_token;
  }
  // Fallback to Bearer token for easier Postman testing during development
  else if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  // If no token is found in either cookies or headers, block access
  if (!token) {
    return res
      .status(401)
      .json({ message: "Not authorized, no token provided" });
  }

  try {
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
};

// Admin Checkpoint
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
