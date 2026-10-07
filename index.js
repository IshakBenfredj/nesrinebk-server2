const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const products = require("./routes/productRoutes");
const categories = require("./routes/categoryRoutes");
const auth = require("./routes/authRoutes");
const sales = require("./routes/saleRoutes");
const expenses = require("./routes/expenseRoutes");
const orders = require("./routes/orderRoutes");
const analytics = require("./routes/analyticsRoutes");
const revenuesChanges = require("./routes/revenuesChangesRoutes");
const stockHistory = require("./routes/stockHistoryRoutes");
const todo = require("./routes/todoRoutes");
const bonusRoutes = require("./routes/bonusRoutes");
const productHistory = require("./routes/productHistory");
const uploadRoutes = require("./routes/uploadRoutes");
const job = require("./utils/cron");
const useragent = require('express-useragent');

dotenv.config();

const app = express();
job.start();

// const allowedOrigins = ["https://faqeeh.academy", "https://www.faqeeh.academy"];

// const corsOptions = {
//   origin: (origin, callback) => {
//     if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
//       callback(null, true);
//     } else {
//       callback(new Error("Not allowed by CORS"));
//     }
//   },
// };
app.use(compression());
app.use(cors());
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ limit: "1mb", extended: true }));
app.use(morgan("dev"));
app.use(useragent.express());
// app.use(express.urlencoded({ limit: "5gb", extended: true }));

// if (process.env.NODE_ENV === "development") {
//   app.use(morgan("dev"));
// }
// if (process.env.NODE_ENV === "production" || !process.env.NODE_ENV) {
//   app.use(morgan("combined"));
// }

app.use((req, res, next) => {
  const customerHeader = req.headers["x-custom-header"];
  if (!customerHeader || customerHeader !== "nesrinebk") {
    res.status(403).send("Access impossible");
  } else {
    next();
  }
});

// Database connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Routes
app.use("/api/auth", auth);
app.use("/api/products", products);
app.use("/api/categories", categories);
app.use("/api/sales", sales);
app.use("/api/expenses", expenses);
app.use("/api/orders", orders);
app.use("/api/analytics", analytics);
app.use("/api/revenues-changes", revenuesChanges);
app.use("/api/stock-history", stockHistory);
app.use("/api/todos", todo);
app.use("/api/bonus", bonusRoutes);
app.use("/api/product-history", productHistory);
app.use("/api/uploads", uploadRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
