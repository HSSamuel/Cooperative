import express from "express";
import { protect, admin } from "../middleware/authMiddleware.js";
import Notification from "../models/Notification.js";

const router = express.Router();

// @route   GET /api/notifications
// @desc    Get all notifications for logged-in user
// @access  Private
router.get("/", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id; // 🚀 THE BUG FIX IS HERE
    const notifications = await Notification.find({ user: userId }).sort({
      createdAt: -1,
    });
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch notifications" });
  }
});

// @route   PUT /api/notifications/:id/read
// @desc    Mark a single notification as read
// @access  Private
router.put("/:id/read", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id; // 🚀 BUG FIX
    const notification = await Notification.findById(req.params.id);

    if (!notification || notification.user.toString() !== userId.toString()) {
      return res.status(404).json({ message: "Notification not found" });
    }

    notification.isRead = true;
    await notification.save();
    res.json(notification);
  } catch (error) {
    res.status(500).json({ message: "Error updating notification" });
  }
});

// @route   PUT /api/notifications/read-all
// @desc    Mark all notifications as read for logged-in user
// @access  Private
router.put("/read-all", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id; // 🚀 BUG FIX
    await Notification.updateMany(
      { user: userId, isRead: false },
      { isRead: true },
    );
    res.json({ message: "All notifications marked as read" });
  } catch (error) {
    res.status(500).json({ message: "Error updating notifications" });
  }
});

// @route   DELETE /api/notifications/:id
// @desc    Delete a notification
// @access  Private
router.delete("/:id", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id; // 🚀 BUG FIX
    const notification = await Notification.findById(req.params.id);

    if (!notification || notification.user.toString() !== userId.toString()) {
      return res.status(404).json({ message: "Notification not found" });
    }

    await notification.deleteOne();
    res.json({ message: "Notification removed" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting notification" });
  }
});

// @route   POST /api/notifications/admin-send
// @desc    Admin sends a direct notice to a user
// @access  Private/Admin
router.post("/admin-send", protect, admin, async (req, res) => {
  try {
    const { targetUserId, title, message, type } = req.body;

    const notification = await Notification.create({
      user: targetUserId,
      title,
      message,
      type: type || "system",
    });

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");
    if (io && onlineUsers) {
      const targetSocket = onlineUsers.get(targetUserId.toString());
      if (targetSocket) io.to(targetSocket).emit("update_notifications");
    }

    res
      .status(201)
      .json({ message: "Notice dispatched successfully", notification });
  } catch (error) {
    console.error("Admin Notice Error:", error);
    res.status(500).json({ message: "Error dispatching notification" });
  }
});

export default router;
