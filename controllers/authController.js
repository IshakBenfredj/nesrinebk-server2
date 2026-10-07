const jwt = require("jsonwebtoken");
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const AuthHistory = require("../models/AuthHistory");
const { default: mongoose } = require("mongoose");

const generateToken = (user) => {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

exports.register = async (req, res) => {
  const { phone, password, role, name } = req.body;
  try {
    const userExists = await User.findOne({ phone });
    if (userExists)
      return res.status(400).json({ message: "المستخدم موجود بالفعل" });

    const user = await User.create({ phone, password, role, name });
    res
      .status(201)
      .json({ data: user, success: true, message: "تم إنشاء المستخدم بنجاح" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.login = async (req, res) => {
  const { phone, password } = req.body;

  try {
    const user = await User.findOne({ phone }).select("+password");
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({
        success: false,
        message: "رقم الهاتف أو كلمة المرور غير صحيحة",
      });
    }

    const token = generateToken(user);

    const ua = req.useragent;

    await AuthHistory.create({
      user: user._id,
      userAgent: req.headers["user-agent"] || "Unknown",
      isMobile: ua.isMobile,
      isTablet: ua.isTablet,
      isDesktop: ua.isDesktop,
      browser: ua.browser ? `${ua.browser} ${ua.version || ""}` : "Unknown",
      os: ua.os ? `${ua.os} (${ua.platform || ""})` : "Unknown",
      deviceBrand: getDeviceBrand(ua),
      type: "login",
    });

    res.json({
      success: true,
      token,
      user,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: "خطأ في الخادم" });
  }
};

exports.logout = async (req, res) => {
  try {
    const { tabClosed } = req.body;
    const ua = req.useragent;

    await AuthHistory.create({
      user: req.user._id,
      userAgent: req.headers["user-agent"] || "Unknown",
      isMobile: ua.isMobile,
      isTablet: ua.isTablet,
      isDesktop: ua.isDesktop,
      browser: ua.browser ? `${ua.browser} ${ua.version || ""}` : "Unknown",
      os: ua.os ? `${ua.os} (${ua.platform || ""})` : "Unknown",
      deviceBrand: getDeviceBrand(ua),
      type: tabClosed ? "tab_closed" : "logout",
    });

    res.status(200).json({
      success: true,
      message: "تم تسجيل الخروج بنجاح",
    });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({
      success: false,
      message: "خطأ أثناء تسجيل الخروج",
    });
  }
};

function getDeviceBrand(ua) {
  const agent = (ua.browser || "").toLowerCase();
  const os = (ua.os || "").toLowerCase();

  if (ua.isMobile || ua.isTablet) {
    if (os.includes("android")) return "Android Device";
    if (os.includes("ios")) return "iPhone / iPad";
    if (agent.includes("samsung")) return "Samsung";
    if (agent.includes("huawei")) return "Huawei";
    if (agent.includes("xiaomi")) return "Xiaomi";
    return "Mobile / Tablet";
  }

  // Desktop / Laptop
  if (os.includes("windows")) return "Windows PC";
  if (os.includes("mac")) return "Mac";
  if (os.includes("linux")) return "Linux PC";
  return "Desktop / Laptop";
}

exports.getProfile = async (req, res) => {
  const user = await User.findById(req.user._id).select("-password");
  res.json(user);
};

exports.getUsers = async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/auth/users/:id
exports.editUser = async (req, res) => {
  const { id } = req.params;
  const { phone, name, role, password, bonusPercentage } = req.body;

  // Input validation
  if (!phone || !name || !role) {
    return res.status(400).json({
      success: false,
      message: "الهاتف والاسم والصلاحية مطلوبة",
    });
  }

  // Validate role
  const validRoles = ["admin", "social_media", "worker", "inventory_manager"];
  if (!validRoles.includes(role)) {
    return res.status(400).json({
      success: false,
      message: "الدور المحدد غير صالح",
    });
  }

  try {
    const updateData = {
      phone,
      name,
      role,
      bonusPercentage,
    };

    // Only hash and add password if it is provided
    if (password && password.trim() !== "") {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateData.password = hashedPassword;
    }

    const user = await User.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "المستخدم غير موجود",
      });
    }

    res.json({
      success: true,
      data: user,
      message: "تم تحديث المستخدم بنجاح",
    });
  } catch (err) {
    console.error("Error updating user:", err);

    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "بيانات غير صالحة",
        errors: err.errors,
      });
    }

    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تحديث المستخدم",
    });
  }
};

// DELETE /api/auth/users/:id
exports.deleteUser = async (req, res) => {
  const { id } = req.params;

  // Prevent self-deletion
  if (req.user._id.toString() === id) {
    return res.status(400).json({
      success: false,
      message: "لا يمكنك حذف حسابك الخاص",
    });
  }

  try {
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "المستخدم غير موجود",
      });
    }

    // Prevent deletion of last admin
    if (user.role === "admin") {
      const adminCount = await User.countDocuments({ role: "admin" });
      if (adminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: "لا يمكن حذف آخر مدير في النظام",
        });
      }
    }

    await User.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "تم حذف المستخدم بنجاح",
    });
  } catch (err) {
    console.error("Error deleting user:", err);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء حذف المستخدم",
    });
  }
};

// controllers/authController.js
exports.getUserHistory = async (req, res) => {
  try {
    const { userId, startDate, endDate, today, type } = req.query;

    const query = {};

    // === 1. Filtre par utilisateur (optionnel) ===
    if (userId) {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({
          success: false,
          message: "معرف المستخدم غير صالح",
        });
      }
      query.user = userId;
    }

    // === 2. Filtre par type (login / logout) ===
    if (type && ["login", "logout"].includes(type)) {
      query.type = type;
    }

    // === 3. Filtre par date ===
    let dateFilter = null;

    // Cas 1 : Aujourd'hui uniquement
    if (today === "true" || today === true) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      dateFilter = { time: { $gte: todayStart, $lte: todayEnd } };
    }
    // Cas 2 : Intervalle personnalisé
    else if (startDate || endDate) {
      let start = startDate ? new Date(startDate) : null;
      let end = endDate ? new Date(endDate) : null;

      // Validation des dates
      if (startDate && isNaN(start?.getTime())) {
        return res.status(400).json({
          success: false,
          message: "صيغة تاريخ البداية غير صالحة (استخدم YYYY-MM-DD)",
        });
      }
      if (endDate && isNaN(end?.getTime())) {
        return res.status(400).json({
          success: false,
          message: "صيغة تاريخ النهاية غير صالحة (استخدم YYYY-MM-DD)",
        });
      }

      // Cas : seulement startDate → toute la journée
      if (start && !end) {
        start.setHours(0, 0, 0, 0);
        const endOfDay = new Date(start);
        endOfDay.setHours(23, 59, 59, 999);
        dateFilter = { time: { $gte: start, $lte: endOfDay } };
      }
      // Cas : seulement endDate → jusqu'à la fin de ce jour
      else if (!start && end) {
        end.setHours(23, 59, 59, 999);
        dateFilter = { time: { $lte: end } };
      }
      // Cas : les deux dates → intervalle complet
      else if (start && end) {
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        dateFilter = { time: { $gte: start, $lte: end } };
      }
    }
    // Pas de filtre de date → tout l'historique

    if (dateFilter) {
      Object.assign(query, dateFilter);
    }

    // === 4. Exécution de la requête ===
    const history = await AuthHistory.find(query)
      .populate("user", "name phone role")
      .sort({ time: -1 })
      .lean();

    console.log("Fetched auth history:", history.length, "records");

    res.json({
      success: true,
      count: history.length,
      data: history,
    });
  } catch (err) {
    console.error("Error fetching auth history:", err);
    res.status(500).json({
      success: false,
      message: "خطأ في الخادم",
    });
  }
};
