const express = require("express");
const router = express.Router();
const {
  register,
  login,
  getProfile,
  getUsers,
  editUser,
  deleteUser,
  getUserHistory,
  logout,
  getUser,
} = require("../controllers/authController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

router.post("/register", register);
router.post("/login", login);
router.post("/logout",protect, logout);
router.get("/users", protect, authorizeRoles("admin"), getUsers);
router.get("/users/:id", protect, authorizeRoles("admin"), getUser);
router.put("/users/:id", protect, authorizeRoles("admin"), editUser);
router.delete("/users/:id", protect, authorizeRoles("admin"), deleteUser);
router.get("/me", protect, getProfile);
router.get("/login-history", protect, authorizeRoles("admin"), getUserHistory);
module.exports = router;
