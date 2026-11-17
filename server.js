require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const { getCountries, getCountryCallingCode } = require("libphonenumber-js");
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const currencyData = require("./public/countries.json");

const app = express();
const PORT = process.env.PORT || 3000;
if (!process.env.MONGODB_URI || !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("Set MONGODB_URI and a JWT_SECRET of at least 32 characters in Render Environment.");
  process.exit(1);
}
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", "data:"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], connectSrc: ["'self'", "https://nominatim.openstreetmap.org"] } } }));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });
const moneyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false });

const MemberSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true, maxlength: 30 },
  country: { type: String, required: true, trim: true, maxlength: 80 },
  countryCode: { type: String, default: "", maxlength: 2 },
  dialCode: { type: String, default: "", maxlength: 8 },
  currency: { type: String, default: "USD", uppercase: true, maxlength: 3 },
  balance: { type: Number, default: 0, min: 0 },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ["member", "admin"], default: "member" },
  termsAcceptedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});
const Member = mongoose.model("Member", MemberSchema);
const Transaction = mongoose.model("Transaction", new mongoose.Schema({
  member: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },
  type: { type: String, enum: ["credit", "debit"], required: true },
  amount: { type: Number, required: true, min: 0.01 },
  currency: { type: String, required: true, uppercase: true },
  note: { type: String, trim: true, maxlength: 240, default: "" },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true },
  createdAt: { type: Date, default: Date.now }
}));

const callingCodes = Object.fromEntries(getCountries().map(code => [code, `+${getCountryCallingCode(code)}`]));
const countries = currencyData.map(c => ({
  code: c.code,
  name: countryNames.of(c.code) || c.name,
  dialCode: callingCodes[c.code] || "",
  currency: c.currency || "USD"
})).sort((a,b) => a.name.localeCompare(b.name));
app.get("/api/countries", (req,res) => res.json(countries));
function signToken(member) { return jwt.sign({ id: member._id.toString(), role: member.role }, process.env.JWT_SECRET, { expiresIn: "7d" }); }
function setAuthCookie(res, token) { res.cookie("token", token, { httpOnly:true, secure:process.env.NODE_ENV === "production", sameSite:"lax", maxAge:7*24*60*60*1000 }); }
function authenticate(req,res,next) { try { const token=req.cookies.token; if(!token) return res.status(401).json({message:"Please log in."}); req.user=jwt.verify(token,process.env.JWT_SECRET); next(); } catch { return res.status(401).json({message:"Your session has expired. Please log in again."}); } }
function adminOnly(req,res,next) { if(req.user.role!=="admin") return res.status(403).json({message:"Administrator access required."}); next(); }

app.post("/api/register", authLimiter, async (req,res) => {
  try {
    const name=String(req.body.name||"").trim(), email=String(req.body.email||"").trim().toLowerCase(), phone=String(req.body.phone||"").trim();
    const countryCode=String(req.body.countryCode||"").toUpperCase(), password=String(req.body.password||"");
    const selectedCountry=countries.find(c=>c.code===countryCode);
    if(!name||!email||!phone||!selectedCountry||!req.body.acceptTerms) return res.status(400).json({message:"Complete all required fields, select a valid country and accept the Terms and Privacy Policy."});
    const country=selectedCountry.name, dialCode=selectedCountry.dialCode, currency=selectedCountry.currency;
    if(name.length>100||phone.length>30||country.length>80) return res.status(400).json({message:"Please check your registration details."});
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({message:"Enter a valid email address."});
    if(password.length<8||password.length>128) return res.status(400).json({message:"Password must be 8–128 characters."});
    if(!countries.some(c=>c.code===countryCode)) return res.status(400).json({message:"Select a valid country."});
    const passwordHash=await bcrypt.hash(password,12);
    await Member.create({name,email,phone,country,countryCode,dialCode,currency,balance:0,password:passwordHash,termsAcceptedAt:new Date()});
    res.status(201).json({message:"Your free account has been created. You can now log in."});
  } catch(error) { if(error?.code===11000) return res.status(409).json({message:"That email address is already registered."}); console.error("Registration error:",error); res.status(500).json({message:"Registration could not be completed. Please try again."}); }
});
app.post("/api/login",authLimiter,async(req,res)=>{try{const email=String(req.body.email||"").trim().toLowerCase(),password=String(req.body.password||"");const member=await Member.findOne({email}).select("+password");if(!member||!(await bcrypt.compare(password,member.password)))return res.status(401).json({message:"Incorrect email or password."});setAuthCookie(res,signToken(member));res.json({message:"Login successful.",redirect:member.role==="admin"?"/admin.html":"/dashboard.html"});}catch(error){console.error("Login error:",error);res.status(500).json({message:"Login failed. Please try again."});}});
app.get("/api/me",authenticate,async(req,res)=>{try{const m=await Member.findById(req.user.id).select("-password").lean();if(!m)return res.status(404).json({message:"Member account not found."});res.json(m);}catch{res.status(500).json({message:"Could not load your account."});}});
app.get("/api/me/transactions",authenticate,async(req,res)=>{try{const items=await Transaction.find({member:req.user.id}).sort({createdAt:-1}).limit(100).lean();res.json(items);}catch{res.status(500).json({message:"Could not load transactions."});}});
app.post("/api/logout",(req,res)=>{res.clearCookie("token",{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax"});res.json({message:"You have been logged out."});});
app.get("/api/admin/members",authenticate,adminOnly,async(req,res)=>{try{const members=await Member.find().select("-password").sort({createdAt:-1}).lean();res.json(members);}catch{res.status(500).json({message:"Could not load members."});}});
app.get("/api/admin/transactions",authenticate,adminOnly,async(req,res)=>{try{const items=await Transaction.find().populate("member","name email country currency").populate("performedBy","name email").sort({createdAt:-1}).limit(250).lean();res.json(items);}catch{res.status(500).json({message:"Could not load transactions."});}});
app.post("/api/admin/balance",authenticate,adminOnly,moneyLimiter,async(req,res)=>{
  const memberId=String(req.body.memberId||""),type=String(req.body.type||""),amount=Number(req.body.amount),note=String(req.body.note||"").trim();
  if(!mongoose.isValidObjectId(memberId)||!["credit","debit"].includes(type)||!Number.isFinite(amount)||amount<=0||amount>100000000||note.length>240) return res.status(400).json({message:"Enter a valid member, adjustment type, amount and note."});
  const session=await mongoose.startSession();
  try {
    let updated;
    await session.withTransaction(async()=>{
      const member=await Member.findById(memberId).session(session);
      if(!member) throw new Error("MEMBER_NOT_FOUND");
      if(type==="debit"&&member.balance<amount) throw new Error("INSUFFICIENT_BALANCE");
      member.balance=Number((member.balance+(type==="credit"?amount:-amount)).toFixed(2));
      await member.save({session});
      await Transaction.create([{member:member._id,type,amount:Number(amount.toFixed(2)),currency:member.currency,note,performedBy:req.user.id}],{session});
      updated={balance:member.balance,currency:member.currency};
    });
    res.json({message:`Balance ${type} recorded successfully.`,...updated});
  } catch(error) { if(error.message==="MEMBER_NOT_FOUND")return res.status(404).json({message:"Member not found."});if(error.message==="INSUFFICIENT_BALANCE")return res.status(400).json({message:"This member does not have enough balance for that debit."});console.error("Balance adjustment error:",error);res.status(500).json({message:"Could not record the balance adjustment."}); }
  finally { await session.endSession(); }
});
app.get("/terms.html",(req,res)=>res.sendFile(path.join(__dirname,"public","terms.html")));
app.get("/privacy.html",(req,res)=>res.sendFile(path.join(__dirname,"public","privacy.html")));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
async function migrateExistingMembers() {
  const oldMembers = await Member.find({ $or: [{ currency: { $exists: false } }, { balance: { $exists: false } }, { countryCode: { $exists: false } }, { dialCode: { $exists: false } }] }).select("country balance currency countryCode dialCode").lean();
  for (const member of oldMembers) {
    const match = countries.find(c => c.name.toLowerCase() === String(member.country || "").toLowerCase());
    await Member.updateOne({ _id: member._id }, { $set: { currency: member.currency || match?.currency || "USD", balance: member.balance ?? 0, countryCode: member.countryCode || match?.code || "", dialCode: member.dialCode || match?.dialCode || "" } });
  }
  if (oldMembers.length) console.log(`Updated ${oldMembers.length} existing member profile(s) with currency and country defaults.`);
}
mongoose.connect(process.env.MONGODB_URI).then(async()=>{console.log("MongoDB connected.");await migrateExistingMembers();app.listen(PORT,()=>console.log(`Server listening on port ${PORT}`));}).catch(error=>{console.error("MongoDB connection failed:",error.message);process.exit(1);});
