import express from "express";
import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
import { protect } from "../middleware/authMiddleware.js";

dotenv.config();

const router = express.Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Issue a secure signature for direct client-to-cloud uploads
router.get("/signature", protect, (req, res) => {
  const timestamp = Math.round(new Date().getTime() / 1000);

  // Generate the cryptographic signature using your API Secret
  const signature = cloudinary.utils.api_sign_request(
    { timestamp, folder: "ascon_coop_avatars" },
    process.env.CLOUDINARY_API_SECRET,
  );

  res.status(200).json({
    signature,
    timestamp,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
  });
});

export default router;
