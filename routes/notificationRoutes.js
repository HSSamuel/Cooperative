import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import Notification from "../models/Notification.js";

const router = express.Router();

// @route   GET /api/notifications
// @desc    Get all notifications for logged-in user
// @access  Private
router.get("/", protect, async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id }).sort({
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
    const notification = await Notification.findById(req.params.id);
    if (
      !notification ||
      notification.user.toString() !== req.user._id.toString()
    ) {
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
    await Notification.updateMany(
      { user: req.user._id, isRead: false },
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
    const notification = await Notification.findById(req.params.id);
    if (
      !notification ||
      notification.user.toString() !== req.user._id.toString()
    ) {
      return res.status(404).json({ message: "Notification not found" });
    }
    await notification.deleteOne();
    res.json({ message: "Notification removed" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting notification" });
  }
});

export default router;
