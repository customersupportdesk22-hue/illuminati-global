require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const readline = require("readline");

const schema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, lowercase: true },
  phone: String,
  country: String,
  password: { type: String, select: false },
  role: { type: String, default: "member" },
  createdAt: { type: Date, default: Date.now }
});
const Member = mongoose.model("Member", schema);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, resolve));

(async () => {
  try {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing in .env");
    await mongoose.connect(process.env.MONGODB_URI);
    const email = String(await ask("Admin email: ")).trim().toLowerCase();
    const name = String(await ask("Admin full name: ")).trim();
    const phone = String(await ask("Admin phone: ")).trim();
    const country = String(await ask("Admin country: ")).trim();
    const password = await ask("Admin password (minimum 12 characters): ");
    if (!email || !name || !phone || !country || password.length < 12) {
      throw new Error("All fields are required and the admin password must be at least 12 characters.");
    }
    const hash = await bcrypt.hash(password, 12);
    await Member.findOneAndUpdate(
      { email },
      { name, email, phone, country, password: hash, role: "admin" },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    console.log("Admin account created or updated successfully.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    rl.close();
    await mongoose.disconnect().catch(() => {});
  }
})();
