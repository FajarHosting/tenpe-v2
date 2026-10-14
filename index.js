require("dotenv").config();
const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const PgStore = require("connect-pg-simple")(session);
const pgStore = require("./lib/postgres-document-store");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const qrcode = require("qrcode");
const fs = require("fs");
const FormData = require("form-data");
const axios = require("axios");
const qs = require("qs");
const path = require("path");
const app = express();
const footer = 'Fupei-Pedia'
const ATLAN_API_KEY = process.env.ATLAN_API_KEY;
const BASE_URL = "https://atlantich2h.com";

const API_KEY = process.env.SEKALIPAY_KEY;
const BASE_URL2 = "https://sekalipay.com/api/v1";

pgStore.connect().catch((err) => { console.error("Neon PostgreSQL connection failed:", err.message); });

const userSchema = new pgStore.Schema({
  fullname: String,
  username: { type: String, unique: true },
  nomor: String,
  email: { type: String, unique: true },
  password: String,
  profileUrl: String,
  saldo: Number,
  coin: Number,
  apiKey: String,
  tanggalDaftar: Date,
  role: { type: String, default: "user" },
  isVerified: Boolean,
  lastLogin: Date,
  referralCode: String,
  otpCode: String,
  otpCodeExpired: Date,
  aktifitas: String,
  whitelistIp: {
    type: [String],
    default: ["0.0.0.0"],
  },
  historyOrder: [
    {
      id: String, 
      reff_id: String,
      layanan: String,
      code: String,
      target: String,
      price: Number,
      sn: String,
      status: String,
      created_at: Date,
    },
  ],
  historyDeposit: [
    {
      id: String,
      reff_id: String,
      nominal: Number,
      tambahan: Number,
      fee: Number,
      get_balance: Number,
      metode: String,
      bank: String,
      tujuan: String,
      atas_nama: String,
      status: String,
      qr_image: String,
      created_at: Date,
    },
  ],
});


const User = pgStore.models.User || pgStore.model("User", userSchema);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/media", express.static(path.join(__dirname, "media")));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new PgStore({ pool: pgStore._pool, tableName: "user_sessions", createTableIfMissing: true, ttl: 7200 }),
    cookie: {
      maxAge: 1000 * 60 * 120,
    },
  })
);

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({
        success: false,
        message: "User not found"
        });
} 
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId || req.session.role !== "admin") {
    return res.redirect("/auth/login");
  }
  next();
}

async function tambahHistoryDeposit(userId, depositData) {
  try {
    const result = await User.findByIdAndUpdate(
      userId,
      {
        $push: {
          historyDeposit: {
            id: depositData.id,
            reff_id: depositData.reff_id,
            nominal: depositData.nominal,
            tambahan: depositData.tambahan,
            fee: depositData.fee,
            get_balance: depositData.get_balance,
            metode: depositData.metode,
            bank: depositData.bank,
            tujuan: depositData.tujuan,
            atas_nama: depositData.atas_nama,
            qr_image: depositData.qr_image,
            status: depositData.status,
            created_at: depositData.created_at || new Date(),
          },
        },
      },
      { new: true }
    );
    return result;
  } catch (err) {
    throw new Error("Gagal menambahkan deposit: " + err.message);
  }
}

async function editHistoryDeposit(userId, depositId, newStatus) {
  try {
    const result = await User.findOneAndUpdate(
      { _id: userId, "historyDeposit.id": depositId },
      {
        $set: {
          "historyDeposit.$.status": newStatus
        }
      },
      { new: true }
    );
    return result;
  } catch (err) {
    throw new Error("Gagal mengedit deposit: " + err.message);
  }
}

async function tambahHistoryOrder(userId, orderData) {
  try {
    const result = await User.findByIdAndUpdate(
      userId,
      {
        $push: {
          historyOrder: {
            id: orderData.id,
            reff_id: orderData.reff_id,
            layanan: orderData.layanan,
            code: orderData.code,
            target: orderData.target,
            price: orderData.price,
            sn: orderData.sn || null,
            status: orderData.status,
            created_at: orderData.created_at || new Date(),
          },
        },
      },
      { new: true }
    );
    if (!result) {
      throw new Error("User tidak ditemukan.");
    }
    return result;
  } catch (err) {
    throw new Error("Gagal menambahkan history order: " + err.message);
  }
}

async function editHistoryOrder(userId, orderId, updateData) {
  try {
    const result = await User.findOneAndUpdate(
      { _id: userId, "historyOrder.id": orderId },
      {
        $set: {
          "historyOrder.$.status": updateData.status,
          "historyOrder.$.sn": updateData.sn,
        },
      },
      { new: true }
    );
    if (!result) {
      throw new Error("User atau order tidak ditemukan.");
    }
    return result;
  } catch (err) {
    throw new Error("Gagal mengedit history order: " + err.message);
  }
}

function generateApiKey() {
  const randomPart =
    Math.random().toString(36).substring(2, 10) +
    Math.random().toString(36).substring(2, 10);
  return `VPedia_${randomPart}`;
}

function generateReferralCode(username) {
  return username.toUpperCase() + Math.floor(1000 + Math.random() * 9000);
}

const toRupiah = (value) => {
  return value.toLocaleString("id-ID");
};
function generateReffId() {
  return "TRX-" + Math.random().toString(36).substring(2, 10).toUpperCase();
}


app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/support", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "support.html"));
});

app.get("/auth/forgot-password", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "forgot.html"));
});


app.get("/auth/register", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "register.html"));
});

app.post("/auth/register", async (req, res) => {
  try {
    const existingUser = await User.findOne({ username: req.body.username });
    if (existingUser) {
      return res.status(400).json({ error: "Username already exists" });
    }
    const existingEmail = await User.findOne({ email: req.body.email });
    if (existingEmail) {
      return res.status(400).json({ error: "Email already exists" });
    }
    const existingNomor = await User.findOne({ nomor: req.body.nomor });
    if (existingNomor) {
      return res.status(400).json({ error: "Nomor telepon already exists" });
    }
    let apiKey = generateApiKey();
    let apiKeyExists = await User.findOne({ apiKey });
    while (apiKeyExists) {
      apiKey = generateApiKey();
      apiKeyExists = await User.findOne({ apiKey });
    }
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const newUser = new User({
      fullname: req.body.fullname,
      username: req.body.username,
      nomor: req.body.nomor,
      email: req.body.email,
      password: hashedPassword,
      profileUrl:
        req.body.profileUrl ||
        "https://i.pinimg.com/236x/a2/80/e2/a280e2a50bf6240f29b49a72875adee5.jpg",
      saldo: 0,
      coin: 0,
      apiKey: apiKey,
      tanggalDaftar: new Date(),
      role: "user",
      isVerified: false,
      lastLogin: new Date(),
      referralCode: generateReferralCode(req.body.username),
      history: [],
    });
    await newUser.save();
    res.redirect("/auth/login");
  } catch (error) {
    res
      .status(400)
      .json({ error: "Registration failed", message: error.message });
  }
});

app.get("/auth/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/auth/login", async (req, res) => {
  try {
    const user = await User.findOne({
      $or: [
        { username: req.body.usernameOrEmail },
        { email: req.body.usernameOrEmail },
      ],
    });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User not found",
      });
    }
    const validPassword = await bcrypt.compare(
      req.body.password,
      user.password
    );
    if (!validPassword) {
      return res.status(400).json({
        success: false,
        message: "Invalid password",
      });
    }
    req.session.userId = user._id;
    req.session.role = user.role;
    user.lastLogin = new Date();
    await user.save();
    return res.status(200).json({
      success: true,
      message: "Login successful",
      role: user.role,
      redirectUrl: user.role === "admin" ? "/admin/dashboard" : "/dashboard",
      apiKey: user.apiKey,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/order", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "order.html"));
});

app.get("/profile", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "profile.html"));
});

app.get("/deposit", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "deposit.html"));
});

app.get("/price-list", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "price-list.html"));
});

app.get("/mutation-order", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "mt-order.html"));
});

app.get("/mutation-deposit", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "mt-deposit.html"));
});

app.get("/api-key-page", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "api-key-page.html"));
});

app.get("/topup", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "topup.html"));
});

app.get("/produk-detail", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "produk-detail.html"));
});

app.get("/buy-panel", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "panel.html"));
});

app.get("/docs", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "docs.html"));
});

//ADMIN RUTE 

app.get("/admin/dashboard", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin", "dashboard.html"));
});

app.get("/admin/users", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin", "users.html"));
});

app.get("/admin/deposit", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin", "deposit.html"));
});

app.get("/admin/order", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin", "order.html"));
});


app.get("/auth/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/auth/login");
});



app.get("/profile/users", requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    return res.status(200).json({
      success: true,
      user: {
        fullname: user.fullname,
        username: user.username,
        nomor: user.nomor,
        email: user.email,
        profileUrl: user.profileUrl,
        saldo: user.saldo,
        coin: user.coin,
        apiKey: user.apiKey,
        tanggalDaftar: user.tanggalDaftar,
        role: user.role,
        isVerified: user.isVerified,
        lastLogin: user.lastLogin,
        referralCode: user.referralCode,
        history: user.history,
        whitelistIp: user.whitelistIp,
        historyOrder: user.historyOrder,
        historyDeposit: user.historyDeposit,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

app.get("/api/history/deposit", requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select("historyDeposit");
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User tidak ditemukan",
      });
    }

    return res.status(200).json({
      success: true,
      historyDeposit: user.historyDeposit || [],
    });
  } catch (error) {
    console.error("❌ Error mengambil riwayat deposit:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan internal",
    });
  }
});

app.get("/api/history/order", requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select("historyOrder");
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User tidak ditemukan",
      });
    }

    return res.status(200).json({
      success: true,
      historyOrder: user.historyOrder || [],
    });
  } catch (error) {
    console.error("❌ Error mengambil riwayat order:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan internal",
    });
  }
});

const uploadMemory = multer({ storage: multer.memoryStorage() }); 

async function CatBox(buffer, originalname) {
  const data = new FormData();
  data.append("reqtype", "fileupload");
  data.append("userhash", "");
  data.append("fileToUpload", buffer, { filename: originalname });
  const config = {
    method: "POST",
    url: "https://catbox.moe/user/api.php",
    headers: {
      ...data.getHeaders(),
      "User-Agent":
        "Mozilla/5.0 (Android 10; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
    },
    data: data,
  };
  const api = await axios.request(config);
  return api.data;
}

app.post("/profile/update-photo",requireLogin, uploadMemory.single("photo"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res
          .status(400)
          .json({ success: false, message: "No file uploaded" });
      }
      const uploadedUrl = await CatBox(file.buffer, file.originalname);
      await User.findByIdAndUpdate(req.session.userId, {
        profileUrl: uploadedUrl,
      });
      return res.status(200).json({
        success: true,
        message: "Profile photo updated successfully",
        profileUrl: uploadedUrl,
      });
    } catch (error) {
      console.error("Error update profile photo:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update profile photo",
      });
    }
  }
);

app.post("/get/forgot-password", async (req, res) => {
  const { nomor } = req.body;
  if (!nomor) {
    return res.status(400).json({ success: false, message: "Nomor telepon harus diisi" });
  }
  try {
    const normalizedNomor = nomor.startsWith("62") ? nomor : "62" + nomor.substring(1);
    const user = await User.findOne({ nomor: normalizedNomor });
    if (!user) {
      return res.status(404).json({ success: false, message: "User tidak ditemukan awali nomor dengan 62" });
    }
    const now = new Date();
    if (user.otpCodeExpired && user.otpCodeExpired <= new Date(now - 5 * 60 * 1000)) {
      await User.updateOne(
        { nomor: normalizedNomor },
        { $set: { otpCode: null, otpCodeExpired: null } }
      );
    }
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // OTP berlaku 5 menit
    await User.findOneAndUpdate(
      { nomor: normalizedNomor },
      {
        otpCode,
        otpCodeExpired: otpExpiry,
        aktifitas: 'Rest Password',
      },
      { new: true, upsert: false }
    );
    return res.json({ success: true, message: "OTP berhasil dikirim", otp: otpCode });
  } catch (error) {
    console.error("Error generate OTP:", error);
    return res.status(500).json({ success: false, message: "Gagal generate OTP" });
  }
});

app.post("/auth/reset-password", async (req, res) => {
  const { nomor, otp, newPassword } = req.body;
  if (!nomor || !otp || !newPassword) {
    return res.status(400).json({ success: false, message: "Semua field harus diisi" });
  }
  try {
    const user = await User.findOne({ nomor });
    if (!user) {
      return res.status(400).json({ success: false, message: "User tidak ditemukan" });
    }
    if (user.otpCode !== otp) {
      return res.status(400).json({ success: false, message: "OTP tidak cocok" });
    }
    if (!user.otpCodeExpired || user.otpCodeExpired < new Date()) {
      return res.status(400).json({ success: false, message: "OTP sudah kadaluarsa" });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.otpCode = null;
    user.otpCodeExpired = null;
    await user.save();
    res.json({ success: true, message: "Password berhasil direset" });
  } catch (error) {
    console.error("Error reset password:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/api/user-otp-info", async (req, res) => {
  const validApiKey = 'RAHASIA_REZZZ_123'; 
  const providedKey = req.query.apikey;

  if (!providedKey || providedKey !== validApiKey) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized. Invalid API key.",
    });
  }

  try {
    const users = await User.find(
      { nomor: { $ne: null } },
      'nomor otpCode otpCodeExpired fullname username aktifitas'
    );
    const now = new Date();

    const result = users
      .map((user) => {
        let diffMinutes = 0;
        if (user.otpCodeExpired) {
          const diffMs = new Date(user.otpCodeExpired) - now;
          diffMinutes = diffMs > 0 ? Math.ceil(diffMs / 60000) : 0;
        }
        return {
          nomor: user.nomor,
          fullname: user.fullname,
          username: user.username,
          otpCode: user.otpCode,
          waktuSisaMenit: diffMinutes,
          aktifitas: user.aktifitas || null,
        };
      })
      .filter((user) => user.otpCode && user.aktifitas); // Filter hanya data dengan otpCode dan aktifitas tidak null

    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error fetching OTP info:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching data",
    });
  }
});


app.post("/profile/request-email-change", requireLogin, async (req, res) => {
  const { newEmail } = req.body;
  
  if (!newEmail) {
    return res
      .status(400)
      .json({ success: false, message: "New email is required" });
  }
  
  const user = await User.findById(req.session.userId);
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }
  
  if (newEmail === user.email) {
    return res.status(400).json({
      success: false,
      message: "New email cannot be the same as current email",
    });
  }
  
  const emailUsed = await User.findOne({ email: newEmail });
  if (emailUsed) {
    return res
      .status(400)
      .json({ success: false, message: "Email already in use" });
  }
  
  try {
    user.email = newEmail;
    await user.save();

    return res.json({
      success: true,
      message: "Email updated successfully",
      newEmail: user.email,
    });
  } catch (err) {
    console.error("Gagal mengupdate email:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/profile/change-fullname", requireLogin, async (req, res) => {
  const { newFullname } = req.body;

  if (!newFullname) {
    return res
      .status(400)
      .json({ success: false, message: "New fullname is required" });
  }
  const user = await User.findById(req.session.userId);
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }
  try {
    user.fullname = newFullname; 
    await user.save();
    return res.status(200).json({
      success: true,
      message: "Fullname has been successfully changed",
      newFullname: user.fullname,
    });
  } catch (err) {
    console.error("Error changing fullname:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

app.post("/profile/change-username", requireLogin, async (req, res) => {
  const { newUsername } = req.body;
  if (!newUsername) {
    return res
      .status(400)
      .json({ success: false, message: "New username is required" });
  }
  const user = await User.findById(req.session.userId);
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }
  const existingUsername = await User.findOne({ username: newUsername });
  if (existingUsername) {
    return res
      .status(400)
      .json({ success: false, message: "Username already exists" });
  }
  try {
    user.username = newUsername;
    await user.save();
    return res.status(200).json({
      success: true,
      message: "Username has been successfully changed",
      newUsername: user.username,
    });
  } catch (err) {
    console.error("Error changing username:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

app.post("/get/otp-change-nomor", requireLogin, async (req, res) => {
  const { nomorLama } = req.body;
  if (!nomorLama) {
    return res.status(400).json({ success: false, message: "Nomor lama harus diisi" });
  }
  try {
    const user = await User.findOne({ nomor: nomorLama });
    if (!user) {
      return res.status(404).json({ success: false, message: "User tidak ditemukan" });
    }
    const now = new Date();
    if (user.otpCodeExpired && user.otpCodeExpired > now) {
    } else {
      await User.updateOne({ nomor: nomorLama }, { $set: { otpCode: null, otpCodeExpired: null } });
    }
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 menit
    await User.findOneAndUpdate(
      { nomor: nomorLama },
      {
        otpCode,
        otpCodeExpired: otpExpiry,
        aktifitas: 'Change Number',
      }
    );
    return res.json({
      success: true,
      message: "OTP berhasil dibuat, gunakan untuk konfirmasi",
      otp: otpCode, 
    });
  } catch (err) {
    console.error("Error generate OTP:", err);
    return res.status(500).json({ success: false, message: "Gagal generate OTP" });
  }
});

app.post("/auth/change-number", requireLogin, async (req, res) => {
  const { nomorLama, otp, nomorBaru } = req.body;
  if (!nomorLama || !otp || !nomorBaru) {
    return res.status(400).json({ success: false, message: "Semua field harus diisi" });
  }
  try {
    const user = await User.findOne({ nomor: nomorLama });
    if (!user) {
      return res.status(404).json({ success: false, message: "User tidak ditemukan" });
    }
    if (user.otpCode !== otp) {
      return res.status(400).json({ success: false, message: "OTP tidak cocok" });
    }
    if (!user.otpCodeExpired || user.otpCodeExpired < new Date()) {
      return res.status(400).json({ success: false, message: "OTP sudah kadaluarsa" });
    }
    const phoneRegex = /^[0-9]{10,15}$/;
    if (!phoneRegex.test(nomorBaru)) {
      return res.status(400).json({ success: false, message: "Format nomor baru tidak valid" });
    }
    await User.findOneAndUpdate(
      { nomor: nomorLama },
      { nomor: nomorBaru, $unset: { otpCode: "", otpCodeExpired: "" } }
    );
    res.json({ success: true, message: "Nomor berhasil diubah", nomorBaru });
  } catch (err) {
    console.error("Error mengubah nomor:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/profile/regenerate-apikey", requireLogin, async (req, res) => {
  try {
    let newApiKey = generateApiKey();
    let apiKeyExists = await User.findOne({ apiKey: newApiKey });
    while (apiKeyExists) {
      newApiKey = generateApiKey();
      apiKeyExists = await User.findOne({ apiKey: newApiKey });
    }
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    user.apiKey = newApiKey;
    await user.save();
    return res.status(200).json({
      success: true,
      message: "API Key has been successfully regenerated",
      newApiKey: newApiKey,
    });
  } catch (err) {
    console.error("Error regenerating API Key:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

app.post("/profile/change-password", requireLogin, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      message: "Old password and new password are required",
    });
  }
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    const isOldPasswordValid = await bcrypt.compare(oldPassword, user.password);
    if (!isOldPasswordValid) {
      return res
        .status(400)
        .json({ success: false, message: "Old password is incorrect" });
    }
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedNewPassword;
    await user.save();
    return res.status(200).json({
      success: true,
      message: "Password has been successfully changed",
    });
  } catch (err) {
    console.error("Error changing password:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

app.post("/profile/send-verification-otp", requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User tidak ditemukan" });
    }

    const now = new Date();
    if (user.otpCodeExpired && user.otpCodeExpired > now) {
    } else {
      await User.updateOne({ _id: user._id }, { $set: { otpCode: null, otpCodeExpired: null } });
    }
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // 10 menit
    await User.findByIdAndUpdate(
      user._id,
      {
        otpCode,
        otpCodeExpired: otpExpiry,
        aktifitas: "Verify H2H"
      }
    );
    return res.json({
      success: true,
      message: "OTP berhasil dibuat, silakan Verify H2H",
      otp: otpCode 
    });
  } catch (err) {
    console.error("Error generate OTP:", err);
    return res.status(500).json({ success: false, message: "Gagal generate OTP" });
  }
});

app.post("/profile/verify-email", requireLogin, async (req, res) => {
  const { otp } = req.body;
  if (!otp) {
    return res.status(400).json({ success: false, message: "OTP harus diisi" });
  }
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User tidak ditemukan" });
    }
    if (!user.otpCode || !user.otpCodeExpired) {
      return res.status(400).json({ success: false, message: "OTP tidak ditemukan" });
    }
    if (user.otpCode !== otp) {
      return res.status(400).json({ success: false, message: "OTP tidak cocok" });
    }
    if (user.otpCodeExpired < new Date()) {
      return res.status(400).json({ success: false, message: "OTP sudah kadaluarsa" });
    }
    await User.findByIdAndUpdate(user._id, {
      isVerified: true,
      $unset: { otpCode: "", otpCodeExpired: "" }
    });
    return res.json({ success: true, message: "H2H berhasil diverifikasi" });
  } catch (err) {
    console.error("Error verifikasi H2H:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

function isValidIp(ip) {
  return ip === '0.0.0.0' || ipRegex.test(ip);
}

app.get('/profile/whitelist-ip/add', requireLogin, async (req, res) => {
  const { ip } = req.body;
  if (!ip) {
    return res.status(400).json({ success: false, message: 'Alamat IP diperlukan' });
  }
  if (!isValidIp(ip)) {
    return res.status(400).json({ success: false, message: 'Format alamat IP tidak valid' });
  }
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan' });
    }
    if (user.whitelistIp.includes('0.0.0.0') && ip !== '0.0.0.0' && user.whitelistIp.length === 1) {
      user.whitelistIp = [];
    }
    if (user.whitelistIp.includes(ip)) {
      return res.status(400).json({ success: false, message: 'Alamat IP sudah ada di whitelist' });
    }
    user.whitelistIp.push(ip);
    await user.save();
    return res.status(200).json({
      success: true,
      message: 'Alamat IP berhasil ditambahkan ke whitelist',
      whitelistIp: user.whitelistIp.join(',')
    });
  } catch (error) {
    console.error('Error adding IP to whitelist:', error);
    return res.status(500).json({ success: false, message: 'Kesalahan server internal' });
  }
});

app.post('/profile/whitelist-ip/remove', requireLogin, async (req, res) => {
  const { ip } = req.body;
  if (!ip) {
    return res.status(400).json({ success: false, message: 'Alamat IP diperlukan' });
  }
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan' });
    }
    const index = user.whitelistIp.indexOf(ip);
    if (index === -1) {
      return res.status(400).json({ success: false, message: 'Alamat IP tidak ditemukan di whitelist' });
    }
    user.whitelistIp.splice(index, 1);
    if (user.whitelistIp.length === 0) {
      user.whitelistIp.push('0.0.0.0');
    }
    await user.save();
    return res.status(200).json({
      success: true,
      message: 'Alamat IP berhasil dihapus dari whitelist',
      whitelistIp: user.whitelistIp.join(',')
    });
  } catch (error) {
    console.error('Error removing IP from whitelist:', error);
    return res.status(500).json({ success: false, message: 'Kesalahan server internal' });
  }
});

app.post('/profile/whitelist-ip/set', requireLogin, async (req, res) => {
  const { ips } = req.body;
  if (!Array.isArray(ips)) {
    return res.status(400).json({ success: false, message: 'Input "ips" harus berupa array' });
  }
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan' });
    }
    if (ips.length === 0) {
      user.whitelistIp = ['0.0.0.0'];
    } else {
      for (const singleIp of ips) {
        if (typeof singleIp !== 'string' || !isValidIp(singleIp)) {
          return res.status(400).json({ success: false, message: `Format alamat IP tidak valid: ${singleIp}` });
        }
      }
      const uniqueIps = [...new Set(ips)];
      user.whitelistIp = uniqueIps;
    }
    await user.save();
    return res.status(200).json({
      success: true,
      message: 'Whitelist IP berhasil diatur ulang',
      whitelistIp: user.whitelistIp.join(',')
    });
  } catch (error) {
    console.error('Error setting IP whitelist:', error);
    return res.status(500).json({ success: false, message: 'Kesalahan server internal' });
  }
});

app.post("/exchange/coin-to-saldo", requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const { coinAmount } = req.body;

    if (!coinAmount || isNaN(coinAmount) || coinAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Jumlah coin harus lebih besar dari 0 dan berupa angka",
      });
    }

    const coinToExchange = parseInt(coinAmount);
    const saldoToAdd = Math.floor(coinToExchange / 10);

    if (user.coin < coinToExchange) {
      return res.status(400).json({
        success: false,
        message: "Coin tidak mencukupi untuk ditukar",
      });
    }

    user.coin -= coinToExchange;
    user.saldo += saldoToAdd;

    user.history.push({
      aktivitas: "Tukar Coin ke Saldo",
      nominal: saldoToAdd,
      status: "Sukses",
      code: generateReffId(),
      notes: `Tukar ${coinToExchange} coin menjadi ${saldoToAdd} saldo`,
      tanggal: new Date(),
    });

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Penukaran coin berhasil",
      data: {
        coinDikurangi: coinToExchange,
        saldoDitambahkan: saldoToAdd,
        sisaCoin: user.coin,
        totalSaldo: user.saldo,
      },
    });
  } catch (error) {
    console.error("Error saat menukar coin:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

app.post("/upgrade/reseller", requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.role === "reseller" || user.role === "admin") {
      return res.status(400).json({
        success: false,
        message: "Anda sudah memiliki status reseller atau admin",
      });
    }

    const totalResellers = await User.countDocuments({ role: "reseller" });

    let upgradePrice = 25000;
    if (totalResellers >= 100 && totalResellers < 300) {
      upgradePrice = 50000;
    } else if (totalResellers >= 300) {
      upgradePrice = 70000;
    }

    if (user.saldo < upgradePrice) {
      return res.status(400).json({
        success: false,
        message: `Saldo tidak mencukupi. Harga upgrade saat ini adalah ${upgradePrice}`,
      });
    }

    user.saldo -= upgradePrice;
    user.role = "reseller";

    user.history.push({
      aktivitas: "Upgrade Reseller",
      nominal: upgradePrice,
      status: "Sukses",
      code: generateReffId(),
      notes: `Upgrade ke reseller dengan harga ${upgradePrice}`,
      tanggal: new Date(),
    });

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Upgrade ke reseller berhasil",
      data: {
        role: user.role,
        sisaSaldo: user.saldo,
      },
    });
  } catch (error) {
    console.error("Error saat upgrade reseller:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});


async function getServerPublicIp() {
  try {
    const response = await axios.get('https://api.ipify.org?format=json');
    return response.data.ip;
  } catch (error) {
    return null;
  }
}
/*
function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-apikey'] || req.query.apikey;
  if (!apiKey) {
    return res.status(400).json({
      success: false,
      message: 'API Key harus disertakan di header "X-APIKEY" atau query param "apikey"',
    });
  }
  User.findOne({ apiKey })
    .then(async (user) => {
      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Invalid API Key",
        });
      }
      const requestIp =
        req.headers['x-forwarded-for']?.split(',').shift().trim() || 
        req.ip ||
        req.connection.remoteAddress; 
      const detectedIp = ['::1', '127.0.0.1'].includes(requestIp)
        ? await getServerPublicIp()
        : requestIp;
      const whitelistIpArray = Array.isArray(user.whitelistIp)
        ? user.whitelistIp
        : user.whitelistIp.split(',').map(ip => ip.trim());
      if (whitelistIpArray.length > 0 && !whitelistIpArray.includes('0.0.0.0')) {
        if (!detectedIp || !whitelistIpArray.includes(detectedIp)) {
          console.warn(`Unauthorized API access from IP ${detectedIp} for user ${user.username}. IP not in whitelist: [${whitelistIpArray.join(', ')}]`);
          return res.status(403).json({
            success: false,
            message: "IP Anda saat ini tidak diizinkan untuk menggunakan API Key ini.",
            your_ip: detectedIp
          });
        }
      }
      if (user.isLocked) {
        return res.status(429).json({
          success: false,
          message: "Anda harus menunggu 5 detik sebelum melakukan request lagi.",
        });
      }
      user.isLocked = true;
      await user.save();
      setTimeout(async () => {
        try {
          if (!user.isVerified) {
            return res.status(403).json({
              success: false,
              message: "Akun belum terverifikasi. Silakan verifikasi akun terlebih dahulu.",
            });
          }
          req.user = user;
          next();
        } catch (error) {
          console.error("Error during API Key validation timeout:", error);
          return res.status(500).json({
            success: false,
            message: "Internal server error during validation",
          });
        } finally {
          user.isLocked = false;
          try {
            await user.save();
          } catch (saveError) {
            console.error("Error saving user after unlocking in validateApiKey:", saveError);
          }
        }
      }, 5000);
    })
    .catch((error) => {
      console.error("Error validating API Key (DB query):", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    });
}
*/
function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-apikey'] || req.query.apikey;
  if (!apiKey) {
    return res.status(400).json({
      success: false,
      message: 'API Key harus disertakan di header "X-APIKEY" atau query param "apikey"',
    });
  }
  User.findOne({ apiKey })
    .then(async (user) => {
      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Invalid API Key",
        });
      }
      const requestIp =
        req.headers['x-forwarded-for']?.split(',').shift().trim() || 
        req.ip ||
        req.connection.remoteAddress; 
      const detectedIp = ['::1', '127.0.0.1'].includes(requestIp)
        ? await getServerPublicIp()
        : requestIp;
      const whitelistIpArray = Array.isArray(user.whitelistIp)
        ? user.whitelistIp
        : user.whitelistIp.split(',').map(ip => ip.trim());
      if (whitelistIpArray.length > 0 && !whitelistIpArray.includes('0.0.0.0')) {
        if (!detectedIp || !whitelistIpArray.includes(detectedIp)) {
          console.warn(`Unauthorized API access from IP ${detectedIp} for user ${user.username}. IP not in whitelist: [${whitelistIpArray.join(', ')}]`);
          return res.status(403).json({
            success: false,
            message: "IP Anda saat ini tidak diizinkan untuk menggunakan API Key ini.",
            your_ip: detectedIp
          });
        }
      }
      if (user.isLocked) {
        return res.status(429).json({
          success: false,
          message: "Anda harus menunggu 5 detik sebelum melakukan request lagi.",
        });
      }
      user.isLocked = true;
      await user.save();
      setTimeout(async () => {
        try {
          if (!user.isVerified) {
            return res.status(403).json({
              success: false,
              message: "Akun belum terverifikasi. Silakan verifikasi akun terlebih dahulu.",
            });
          }
          req.user = user;
          next();
        } catch (error) {
          console.error("Error during API Key validation timeout:", error);
          return res.status(500).json({
            success: false,
            message: "Internal server error during validation",
          });
        } finally {
          user.isLocked = false;
          try {
            await user.save();
          } catch (saveError) {
            console.error("Error saving user after unlocking in validateApiKey:", saveError);
          }
        }
      }, 1000);
    })
    .catch((error) => {
      console.error("Error validating API Key (DB query):", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    });
}
module.exports = { 
  validateApiKey, 
  User,   
  tambahHistoryDeposit,
  BASE_URL,
  ATLAN_API_KEY,
  BASE_URL2,
  API_KEY,
  generateReffId,
  editHistoryDeposit,
  tambahHistoryOrder,
  editHistoryOrder,
  requireLogin,
  requireAdmin
};
app.use("/h2h", require("./endpoint/api"));
app.use("/api/webtrx", require("./endpoint/bacend"));
app.use("/admin", require("./endpoint/admin"));
app.use("/api/shop", require("./endpoint/shop"));
app.use("/api/admin/shop", require("./endpoint/adminShop"));
app.use("/media", express.static(path.join(__dirname, "media")));




app.get("/api/notif", (req, res) => {
  const notifPath = path.join(__dirname, "./notif.json");

  fs.readFile(notifPath, "utf8", (err, data) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Gagal membaca file notifikasi.",
        error: err.message,
      });
    }

    try {
      const notifikasi = JSON.parse(data);
      res.status(200).json({
        success: true,
        total: notifikasi.length,
        data: notifikasi,
      });
    } catch (parseErr) {
      res.status(500).json({
        success: false,
        message: "Format JSON tidak valid.",
        error: parseErr.message,
      });
    }
  });
});

//=====[ ADMIN BACKEND ]=====//

app.get("/data/users", requireAdmin, async (req, res) => {
  try {
    const users = await User.find({}, "-password -__v");
    res.json(users);
  } catch (err) {
    res.status(500).send("Server Error");
  }
});



app.post("/admin/unblock-user", requireAdmin, async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "Parameter userId wajib diisi",
    });
  }
  try {
    const user = await User.findById(userId); 
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User tidak ditemukan",
      });
    }
    if (!user.isLocked) {
      return res.status(400).json({
        success: false,
        message: "User tidak dalam keadaan terblokir",
      });
    }
    user.isLocked = false;
    await user.save();
    return res.status(200).json({
      success: true,
      message: `User ${user.username} berhasil di-unblock`,
    });
  } catch (error) {
    console.error("Error unblocking user:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});



app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
});

module.exports = app;

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
