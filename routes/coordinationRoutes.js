const express = require("express");
const router = express.Router();
const coordinationController = require("../controllers/coordinationController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

// Read routes: Admin and Social Media
router.get(
  "/",
  protect,
  authorizeRoles("admin", "social_media"),
  coordinationController.getCoordinations
);

router.get(
  "/:id",
  protect,
  authorizeRoles("admin", "social_media"),
  coordinationController.getCoordinationById
);

// Admin-only write routes
router.post(
  "/",
  protect,
  authorizeRoles("admin"),
  coordinationController.createCoordination
);

router.put(
  "/:id",
  protect,
  authorizeRoles("admin"),
  coordinationController.updateCoordination
);

router.delete(
  "/:id",
  protect,
  authorizeRoles("admin"),
  coordinationController.deleteCoordination
);

// Sub-item routes: Admin only
router.post(
  "/:id/items",
  protect,
  authorizeRoles("admin"),
  coordinationController.addSubItem
);

router.put(
  "/:id/items/:itemId",
  protect,
  authorizeRoles("admin"),
  coordinationController.updateSubItem
);

router.delete(
  "/:id/items/:itemId",
  protect,
  authorizeRoles("admin"),
  coordinationController.deleteSubItem
);

module.exports = router;

