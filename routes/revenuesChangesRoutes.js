const express = require("express");
const router = express.Router();

const {
  addRevenueChange,
  getRevenueChanges,
  getRevenueChange,
  updateRevenueChange,
  deleteRevenueChange,
} = require("../controllers/revenuesChangesController");

const { protect, authorizeRoles } = require("../middleware/authMiddleware");


router.post("/", protect, authorizeRoles("admin"), addRevenueChange);

router.get("/", protect, authorizeRoles("admin"), getRevenueChanges);

router.get("/:id", protect, authorizeRoles("admin"), getRevenueChange);

router.put("/:id", protect, authorizeRoles("admin"), updateRevenueChange);

router.delete("/:id", protect, authorizeRoles("admin"), deleteRevenueChange);

module.exports = router;