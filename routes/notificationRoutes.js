import express from "express";
import { protect, admin } from "../middleware/authMiddleware.js";
import Notification from "../models/Notification.js";
import Cooperator from "../models/Cooperator.js";

const router = express.Router();

// @route   GET /api/notifications
// @desc    Get all notifications for logged-in user
// @access  Private
router.get("/", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    // 🚀 We now POPULATE the sender so the frontend gets their name
    const notifications = await Notification.find({ user: userId })
      .populate("sender", "firstName lastName")
      .sort({ createdAt: -1 });
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
    const userId = req.user.id || req.user._id;
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
    const userId = req.user.id || req.user._id;
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
    const userId = req.user.id || req.user._id;
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
    const adminId = req.user.id || req.user._id;

    const notification = await Notification.create({
      user: targetUserId,
      sender: adminId,
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

// @route   POST /api/notifications/contact-admin
// @desc    Cooperator sends a direct message to all Admins
// @access  Private
router.post("/contact-admin", protect, async (req, res) => {
  try {
    const { subject, message } = req.body;
    const senderId = req.user.id || req.user._id;

    if (!subject || !message) {
      return res
        .status(400)
        .json({ message: "Subject and message are required." });
    }

    const sender = await Cooperator.findById(senderId);
    if (!sender) return res.status(404).json({ message: "Sender not found." });

    const admins = await Cooperator.find({
      role: { $in: ["ADMIN", "SUPER_ADMIN"] },
    });

    if (admins.length === 0) {
      return res.status(400).json({
        message:
          "No administrators are currently available to receive this message.",
      });
    }

    // Clean Subject Format
    const notificationsToInsert = admins.map((admin) => ({
      user: admin._id,
      sender: senderId,
      title: subject,
      message: message,
      type: "info",
    }));

    await Notification.insertMany(notificationsToInsert);

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    if (io && onlineUsers) {
      admins.forEach((admin) => {
        const adminSocket = onlineUsers.get(admin._id.toString());
        if (adminSocket) io.to(adminSocket).emit("update_notifications");
      });
    }

    res.status(201).json({
      message: "Your message has been sent to the cooperative administration.",
    });
  } catch (error) {
    console.error("Contact Admin Error:", error);
    res.status(500).json({ message: "Server error sending message." });
  }
});

// @route   POST /api/notifications/:id/reply
// @desc    Reply directly to a specific message
router.post("/:id/reply", protect, async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.user.id || req.user._id;

    if (!message)
      return res.status(400).json({ message: "Message is required." });

    const originalNotice = await Notification.findById(req.params.id);
    if (!originalNotice)
      return res.status(404).json({ message: "Original message not found." });

    if (!originalNotice.sender) {
      return res
        .status(400)
        .json({ message: "Cannot reply to an automated system message." });
    }

    // Clean up the title to prevent "Re: Re: Message from..." chaining
    // Strip any existing prefixes to prevent clunky chains (e.g., "Re: Inquiry: Re: ...")
    const cleanTitle = originalNotice.title.replace(
      /^(Re:\s*|Inquiry:\s*|Message from[^:]*:\s*)+/i,
      "",
    );

    const newNotification = await Notification.create({
      user: originalNotice.sender,
      sender: userId,
      title: `Re: ${cleanTitle}`,
      message: message, // Removed the "says:" prefix completely
      type: "info",
    });

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");
    if (io && onlineUsers) {
      const targetSocket = onlineUsers.get(originalNotice.sender.toString());
      if (targetSocket) io.to(targetSocket).emit("update_notifications");
    }

    res.status(201).json({
      message: "Reply sent successfully.",
      notification: newNotification,
    });
  } catch (error) {
    console.error("Reply Error:", error);
    res.status(500).json({ message: "Server error sending reply." });
  }
});

export default router;
