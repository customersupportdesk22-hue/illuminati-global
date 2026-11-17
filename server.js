require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.MONGODB_URI || !process.env.JWT_SECRET ||
    process.env.JWT_SECRET.length < 32) {
  console.error("Set MONGODB_URI and a JWT_SECRET of at least 32 characters in .env");
  process.exit(1);
}

app.use(helmet());
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

const MemberSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true, maxlength: 30 },
  country: { type: String, required: true, trim: true, maxlength: 80 },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ["member", "admin"], default: "member" },
  createdAt: { type: Date, default: Date.now }
});

const Member = mongoose.model("Member", MemberSchema);

function signToken(member) {
  return jwt.sign(
    { id: member._id.toString(), role: member.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function setAuthCookie(res, token) {
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

function authenticate(req, res, next) {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: "Please log in." });
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Your session has expired. Please log in again." });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Administrator access required." });
  }
  next();
}

app.post("/api/register", authLimiter, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const phone = String(req.body.phone || "").trim();
    const country = String(req.body.country || "").trim();
    const password = String(req.body.password || "");

    if (!name || !email || !phone || !country || !password) {
      return res.status(400).json({ message: "Please complete every field." });
    }
    if (name.length > 100 || phone.length > 30 || country.length > 80) {
      return res.status(400).json({ message: "One or more fields are too long." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "Enter a valid email address." });
    }
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ message: "Password must be 8–128 characters." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await Member.create({ name, email, phone, country, password: passwordHash });
    return res.status(201).json({ message: "Your free account has been created. You can now log in." });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ message: "That email address is already registered." });
    }
    console.error("Registration error:", error);
    return res.status(500).json({ message: "Registration could not be completed. Please try again." });
  }
});

app.post("/api/login", authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const member = await Member.findOne({ email }).select("+password");

    if (!member || !(await bcrypt.compare(password, member.password))) {
      return res.status(401).json({ message: "Incorrect email or password." });
    }

    setAuthCookie(res, signToken(member));
    return res.json({
      message: "Login successful.",
      redirect: member.role === "admin" ? "/admin.html" : "/dashboard.html"
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Login failed. Please try again." });
  }
});

app.get("/api/me", authenticate, async (req, res) => {
  try {
    const member = await Member.findById(req.user.id).select("-password");
    if (!member) return res.status(404).json({ message: "Member account not found." });
    res.json(member);
  } catch {
    res.status(500).json({ message: "Could not load your account." });
  }
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax"
  });
  res.json({ message: "You have been logged out." });
});

app.get("/api/admin/members", authenticate, adminOnly, async (req, res) => {
  try {
    const members = await Member.find().select("-password").sort({ createdAt: -1 }).lean();
    res.json(members);
  } catch {
    res.status(500).json({ message: "Could not load members." });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("MongoDB connected.");
    app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
  })
  .catch(error => {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  });
