require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const crypto = require("crypto");
const sharp = require("sharp");
// Optional Cloudinary storage. In Render set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET (or one CLOUDINARY_URL).
// Without it, images are stored in MongoDB exactly as before. Files are uploaded as "authenticated" (private).
const cloud = !!(process.env.CLOUDINARY_URL || (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET));
const cloudinary = cloud ? require("cloudinary").v2 : null;
if (cloud && !process.env.CLOUDINARY_URL) cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });
function cloudUpload(buf, folder, resourceType) { return new Promise((ok, fail) => cloudinary.uploader.upload_stream({ folder, type: "authenticated", resource_type: resourceType }, (e, r) => e ? fail(e) : ok(r)).end(buf)); }
async function cloudFetch(d) { const u = cloudinary.url(d.publicId, { type: "authenticated", resource_type: d.resourceType, sign_url: true, secure: true, format: d.resourceType === "image" ? d.format : undefined }); const r = await fetch(u); if (!r.ok) throw new Error("Cloudinary fetch failed"); return Buffer.from(await r.arrayBuffer()); }
const { getCountries, getCountryCallingCode } = require("libphonenumber-js");
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const currencyData = require("./public/countries.json");

const app = express();
app.set("trust proxy", 1); // Render sits behind a proxy; fixes rate-limit X-Forwarded-For error
const PORT = process.env.PORT || 3000;
if (!process.env.MONGODB_URI || !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("Set MONGODB_URI and a JWT_SECRET of at least 32 characters in Render Environment.");
  process.exit(1);
}
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", "data:", "blob:"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], connectSrc: ["'self'", "https://nominatim.openstreetmap.org"] } } }));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(cookieParser());
// Legal pages opened from the member app get a "Back to dashboard" button instead of "Back to registration".
const LEGAL_FIX = '<script>document.querySelectorAll("a,button").forEach(function(e){if(/back to registration/i.test(e.textContent)){e.textContent="Back to dashboard";if(e.tagName==="A")e.setAttribute("href","/dashboard.html");else e.onclick=function(){location.href="/dashboard.html"}}})</script>';
app.get(["/terms.html", "/privacy.html"], (req, res, next) => { if (req.query.from !== "app") return next(); fs.readFile(path.join(__dirname, "public", req.path), "utf8", (e, h) => e ? next() : res.type("html").send(h.replace("</body>", LEGAL_FIX + "</body>"))); });
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
  joinReason: { type: String, trim: true, maxlength: 300, default: "" },
  kycStatus: { type: String, enum: ["not_submitted", "pending", "approved", "rejected"], default: "not_submitted" },
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
const MemberRequest = mongoose.model("MemberRequest", new mongoose.Schema({
  member: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },
  type: { type: String, enum: ["withdraw", "send", "invest", "bank_transfer"], required: true },
  amount: { type: Number, required: true, min: 0.01 },
  currency: { type: String, required: true, uppercase: true },
  details: { type: String, trim: true, maxlength: 500, default: "" },
  status: { type: String, enum: ["pending", "approved", "rejected", "reviewed"], default: "pending" },
  adminNote: { type: String, trim: true, maxlength: 500, default: "" },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Member", default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}));
const Notification = mongoose.model("Notification", new mongoose.Schema({
  member: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },
  title: { type: String, required: true, maxlength: 100 },
  body: { type: String, required: true, maxlength: 400 },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
}));
const ChatMessage = mongoose.model("ChatMessage", new mongoose.Schema({
  member: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },
  senderRole: { type: String, enum: ["member", "admin"], required: true },
  message: { type: String, maxlength: 2000, trim: true, default: "" },
  hasImage: { type: Boolean, default: false },
  imageType: { type: String, default: "" },
  image: { type: Buffer, select: false },
  publicId: { type: String, default: "" }, resourceType: { type: String, default: "" }, format: { type: String, default: "" },
  deliveredAt: { type: Date, default: Date.now },
  readAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
}));

const KycDocument = mongoose.model("KycDocument", new mongoose.Schema({
  member: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },
  kind: { type: String, enum: ["id_front", "id_back", "selfie", "kra"], required: true },
  filename: { type: String, required: true, maxlength: 180 },
  mimeType: { type: String, required: true, enum: ["image/jpeg", "image/png", "application/pdf"] },
  size: { type: Number, required: true, max: 8 * 1024 * 1024 },
  sha256: { type: String, required: true },
  data: { type: Buffer, select: false },
  publicId: { type: String, default: "" }, resourceType: { type: String, default: "" }, format: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
}));
const KycReview = mongoose.model("KycReview", new mongoose.Schema({
  member: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, unique: true },
  kraNumber: { type: String, trim: true, maxlength: 30, default: "" },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  adminNote: { type: String, trim: true, maxlength: 500, default: "" },
  updatedAt: { type: Date, default: Date.now }
}));
const kycUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const chatUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const upl = m => (req, res, next) => m(req, res, err => err ? res.status(400).json({ message: "That file is too large or invalid." }) : next());
// Rejects blurry, dark, glared or low-resolution photos (thresholds are slightly looser than the browser check).
async function imageQuality(buf, kind) {
  const meta = await sharp(buf).metadata();
  if (Math.max(meta.width || 0, meta.height || 0) < 1000) return "Photo resolution is too low. Move closer and retake it.";
  const g = sharp(buf).rotate().resize(600, 600, { fit: "inside" }).greyscale();
  const mean = (await g.clone().stats()).channels[0].mean;
  if (mean < 55) return "Photo is too dark. Use better lighting and retake it.";
  if (mean > 225) return "Photo is too bright or has glare. Retake it.";
  const { data } = await g.clone().convolve({ width: 3, height: 3, kernel: [0,1,0,1,-4,1,0,1,0], scale: 1, offset: 128 }).raw().toBuffer({ resolveWithObject: true });
  let s = 0, s2 = 0; for (const v of data) { const d = v - 128; s += d; s2 += d * d; }
  const variance = s2 / data.length - (s / data.length) ** 2;
  if (variance < (kind === "selfie" ? 30 : 60)) return "Photo is blurry. Hold steady, tap to focus and retake it.";
  return null;
}

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
async function authenticate(req,res,next) { try { const token=req.cookies.token; if(!token) return res.status(401).json({message:"Please log in."}); const p=jwt.verify(token,process.env.JWT_SECRET); const m=await Member.findById(p.id).select("role").lean(); if(!m) return res.status(401).json({message:"Please log in."}); req.user={id:p.id,role:m.role}; next(); } catch { return res.status(401).json({message:"Your session has expired. Please log in again."}); } }
function adminOnly(req,res,next) { if(req.user.role!=="admin") return res.status(403).json({message:"Administrator access required."}); next(); }

app.post("/api/register", authLimiter, async (req,res) => {
  try {
    const name=String(req.body.name||"").trim(), email=String(req.body.email||"").trim().toLowerCase(), phone=String(req.body.phone||"").trim();
    const countryCode=String(req.body.countryCode||"").toUpperCase(), password=String(req.body.password||""), joinReason=String(req.body.joinReason||"").trim();
    const selectedCountry=countries.find(c=>c.code===countryCode);
    if(!name||!email||!phone||!selectedCountry||!joinReason||!req.body.acceptTerms||!req.body.acceptCode) return res.status(400).json({message:"Complete all required fields, select a valid country and accept the Terms and Privacy Policy."});
    const country=selectedCountry.name, dialCode=selectedCountry.dialCode, currency=selectedCountry.currency;
    if(name.length>100||phone.length>30||country.length>80) return res.status(400).json({message:"Please check your registration details."});
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({message:"Enter a valid email address."});
    if(password.length<8||password.length>128) return res.status(400).json({message:"Password must be 8–128 characters."});
    if(!countries.some(c=>c.code===countryCode)) return res.status(400).json({message:"Select a valid country."});
    const passwordHash=await bcrypt.hash(password,12);
    await Member.create({name,email,phone,country,countryCode,dialCode,currency,balance:0,password:passwordHash,joinReason,termsAcceptedAt:new Date()});
    res.status(201).json({message:"Your free account has been created. You can now log in."});
  } catch(error) { if(error?.code===11000) return res.status(409).json({message:"That email address is already registered."}); console.error("Registration error:",error); res.status(500).json({message:"Registration could not be completed. Please try again."}); }
});
app.post("/api/login",authLimiter,async(req,res)=>{try{const email=String(req.body.email||"").trim().toLowerCase(),password=String(req.body.password||"");const member=await Member.findOne({email}).select("+password");if(!member||!(await bcrypt.compare(password,member.password)))return res.status(401).json({message:"Incorrect email or password."});setAuthCookie(res,signToken(member));res.json({message:"Login successful.",redirect:member.role==="admin"?"/admin.html":"/dashboard.html"});}catch(error){console.error("Login error:",error);res.status(500).json({message:"Login failed. Please try again."});}});
app.get("/api/me",authenticate,async(req,res)=>{try{const m=await Member.findById(req.user.id).select("-password").lean();if(!m)return res.status(404).json({message:"Member account not found."});res.json(m);}catch{res.status(500).json({message:"Could not load your account."});}});
app.get("/api/me/transactions",authenticate,async(req,res)=>{try{const items=await Transaction.find({member:req.user.id}).sort({createdAt:-1}).limit(100).lean();res.json(items);}catch{res.status(500).json({message:"Could not load transactions."});}});
app.post("/api/me/requests",authenticate,moneyLimiter,async(req,res)=>{
  try {
    const type=String(req.body.type||""), amount=Number(req.body.amount), details=String(req.body.details||"").trim();
    if(!["withdraw","send","invest","bank_transfer"].includes(type)||!Number.isFinite(amount)||amount<=0||amount>100000000||details.length>500) return res.status(400).json({message:"Enter a valid request type, amount and details."});
    const member=await Member.findById(req.user.id).select("currency");
    const request=await MemberRequest.create({member:req.user.id,type,amount:Number(amount.toFixed(2)),currency:member.currency,details});
    await Notification.create({member:req.user.id,title:"Request received",body:`Your ${type.replace("_"," ")} request for ${amount.toFixed(2)} ${member.currency} has been received and is awaiting administrator review.`});
    res.status(201).json({message:"Your request has been submitted for administrator review.",requestId:request._id});
  } catch(error){console.error("Member request error:",error);res.status(500).json({message:"Could not submit your request."});}
});
app.get("/api/me/requests",authenticate,async(req,res)=>{try{res.json(await MemberRequest.find({member:req.user.id}).sort({createdAt:-1}).limit(100).lean());}catch{res.status(500).json({message:"Could not load your requests."});}});
app.get("/api/me/notifications",authenticate,async(req,res)=>{try{res.json(await Notification.find({member:req.user.id}).sort({createdAt:-1}).limit(50).lean());}catch{res.status(500).json({message:"Could not load notifications."});}});
app.post("/api/me/notifications/read",authenticate,async(req,res)=>{try{await Notification.updateMany({member:req.user.id,read:false},{$set:{read:true}});res.json({message:"Notifications marked as read."});}catch{res.status(500).json({message:"Could not update notifications."});}});
app.get("/api/me/chat",authenticate,async(req,res)=>{try{await ChatMessage.updateMany({member:req.user.id,senderRole:"admin",readAt:null},{$set:{readAt:new Date()}});res.json(await ChatMessage.find({member:req.user.id}).sort({createdAt:1}).limit(200).lean());}catch{res.status(500).json({message:"Could not load chat."});}});
app.post("/api/me/chat",authenticate,moneyLimiter,async(req,res)=>{try{const message=String(req.body.message||"").trim();if(!message||message.length>2000)return res.status(400).json({message:"Enter a message of up to 2,000 characters."});const item=await ChatMessage.create({member:req.user.id,senderRole:"member",message});res.status(201).json(item);}catch{res.status(500).json({message:"Could not send your message."});}});
app.get("/api/me/chat/unread",authenticate,async(req,res)=>{try{res.json({count:await ChatMessage.countDocuments({member:req.user.id,senderRole:"admin",readAt:null})})}catch{res.status(500).json({count:0})}});
// Identity documents are stored privately in MongoDB, never in the public web folder.
app.get("/api/me/kyc", authenticate, async (req,res) => {
  try { const docs=await KycDocument.find({member:req.user.id}).select("-data -sha256").lean(); const review=await KycReview.findOne({member:req.user.id}).select("-__v").lean(); res.json({status:review?.status||"not_submitted",kraNumber:review?.kraNumber||"",adminNote:review?.adminNote||"",documents:docs.map(d=>({kind:d.kind,filename:d.filename,size:d.size,createdAt:d.createdAt}))}); }
  catch { res.status(500).json({message:"Could not load verification status."}); }
});
app.post("/api/me/kyc", authenticate, upl(kycUpload.single("document")), async (req,res) => {
  try {
    const kind=String(req.body.kind||""), kraNumber=String(req.body.kraNumber||"").trim();
    if(!["id_front","id_back","selfie","kra"].includes(kind)) return res.status(400).json({message:"Choose a valid document type."});
    if(!req.file) return res.status(400).json({message:"Choose a file to upload."});
    if(!["image/jpeg","image/png","application/pdf"].includes(req.file.mimetype)) return res.status(400).json({message:"Only JPG, PNG or PDF files are accepted."});
    if(kind!=="kra" && req.file.mimetype==="application/pdf") return res.status(400).json({message:"ID and selfie uploads must be JPG or PNG images."});
    if(kind==="kra" && !kraNumber) return res.status(400).json({message:"Enter your KRA PIN for this document."});
    if(req.file.mimetype!=="application/pdf"){const bad=await imageQuality(req.file.buffer,kind).catch(()=>"Could not read this image. Please retake it."); if(bad) return res.status(422).json({message:bad});}
    const digest=crypto.createHash("sha256").update(req.file.buffer).digest("hex");
    if(await KycDocument.findOne({member:req.user.id,sha256:digest}).select("_id")) return res.status(409).json({message:"This exact document has already been submitted."});
    let store={data:req.file.buffer};
    if(cloud){const r=await cloudUpload(req.file.buffer,"kyc/"+req.user.id,req.file.mimetype==="application/pdf"?"raw":"image");store={publicId:r.public_id,resourceType:r.resource_type,format:r.format||""};
      for(const o of await KycDocument.find({member:req.user.id,kind}).select("publicId resourceType")) if(o.publicId) await cloudinary.uploader.destroy(o.publicId,{type:"authenticated",resource_type:o.resourceType}).catch(()=>{});}
    await KycDocument.deleteMany({member:req.user.id,kind});
    await KycDocument.create({member:req.user.id,kind,filename:path.basename(req.file.originalname).slice(0,180),mimeType:req.file.mimetype,size:req.file.size,sha256:digest,...store});
    const update={status:"pending",updatedAt:new Date()}; if(kind==="kra") update.kraNumber=kraNumber;
    await KycReview.findOneAndUpdate({member:req.user.id},{$set:update},{upsert:true,new:true});
    await Member.findByIdAndUpdate(req.user.id,{kycStatus:"pending"});
    await Notification.create({member:req.user.id,title:"Verification document received",body:"Your verification document was securely received and is awaiting review."});
    res.status(201).json({message:"Document received securely. Your verification is pending review."});
  } catch(error) { console.error("KYC upload:",error); res.status(500).json({message:"Could not store your document."}); }
});
app.get("/api/admin/kyc",authenticate,adminOnly,async(req,res)=>{try{res.json(await KycReview.find().populate("member","name email country").sort({updatedAt:-1}).lean());}catch{res.status(500).json({message:"Could not load verification reviews."});}});
app.get("/api/admin/kyc/:memberId/documents/:kind",authenticate,adminOnly,async(req,res)=>{try{if(!["id_front","id_back","selfie","kra"].includes(req.params.kind))return res.sendStatus(404);const doc=await KycDocument.findOne({member:req.params.memberId,kind:req.params.kind}).select("+data");if(!doc)return res.sendStatus(404);res.set("Content-Type",doc.mimeType);res.set("Content-Disposition",`inline; filename="${doc.filename.replace(/["\\]/g,"")}"`);res.set("Cache-Control","no-store");res.send(doc.publicId?await cloudFetch(doc):doc.data);}catch{res.sendStatus(500);}});
app.post("/api/admin/kyc/:memberId/review",authenticate,adminOnly,async(req,res)=>{try{const status=String(req.body.status||"");if(!["approved","rejected"].includes(status))return res.status(400).json({message:"Choose approved or rejected."});const adminNote=String(req.body.adminNote||"").trim().slice(0,500);const review=await KycReview.findOneAndUpdate({member:req.params.memberId},{$set:{status,adminNote,updatedAt:new Date()}},{new:true});if(!review)return res.status(404).json({message:"Verification record not found."});await Member.findByIdAndUpdate(req.params.memberId,{kycStatus:status});await Notification.create({member:req.params.memberId,title:"Verification status updated",body:`Your identity verification was ${status}. ${adminNote}`.trim()});res.json({message:"Verification review saved."});}catch{res.status(500).json({message:"Could not save verification review."});}});

// ---- Chat photos (member and admin). Stored privately in MongoDB, served only to the conversation owner / admin.
async function saveChatImage(req, res, memberId, role) {
  try {
    if (!req.file) return res.status(400).json({ message: "Choose a photo to send." });
    let meta; try { meta = await sharp(req.file.buffer).metadata(); } catch {}
    if (!meta || !["jpeg", "png", "webp"].includes(meta.format)) return res.status(400).json({ message: "Only JPG, PNG or WebP photos are accepted." });
    const message = String(req.body.message || "").trim().slice(0, 2000);
    const store = cloud ? await cloudUpload(req.file.buffer, "chat/" + memberId, "image").then(r => ({ publicId: r.public_id, resourceType: "image", format: r.format })) : { image: req.file.buffer };
    const item = await ChatMessage.create({ member: memberId, senderRole: role, message, hasImage: true, imageType: "image/" + meta.format, ...store });
    if (role === "admin") await Notification.create({ member: memberId, title: "New support reply", body: "An administrator has replied to your support conversation." });
    res.status(201).json({ _id: item._id, hasImage: true, message });
  } catch (e) { console.error("Chat image:", e); res.status(500).json({ message: "Could not send the photo." }); }
}
async function serveChatImage(req, res, filter) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(404);
    const m = await ChatMessage.findOne({ _id: req.params.id, hasImage: true, ...filter }).select("+image");
    if (!m) return res.sendStatus(404);
    res.set({ "Content-Type": m.imageType, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" });
    res.send(m.publicId ? await cloudFetch(m) : m.image);
  } catch { res.sendStatus(500); }
}
app.post("/api/me/chat/image", authenticate, moneyLimiter, upl(chatUpload.single("image")), (req, res) => saveChatImage(req, res, req.user.id, "member"));
app.get("/api/me/chat/image/:id", authenticate, (req, res) => serveChatImage(req, res, { member: req.user.id }));
app.post("/api/admin/chat/image", authenticate, adminOnly, upl(chatUpload.single("image")), (req, res) => { if (!mongoose.isValidObjectId(String(req.body.memberId || ""))) return res.status(400).json({ message: "Select a member first." }); saveChatImage(req, res, String(req.body.memberId), "admin"); });
app.get("/api/admin/chat/image/:id", authenticate, adminOnly, (req, res) => serveChatImage(req, res, {}));
app.post("/api/logout",(req,res)=>{res.clearCookie("token",{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax"});res.json({message:"You have been logged out."});});
app.get("/api/admin/members",authenticate,adminOnly,async(req,res)=>{try{const members=await Member.find().select("-password").sort({createdAt:-1}).lean();res.json(members);}catch{res.status(500).json({message:"Could not load members."});}});
app.get("/api/admin/transactions",authenticate,adminOnly,async(req,res)=>{try{const items=await Transaction.find().populate("member","name email country currency").populate("performedBy","name email").sort({createdAt:-1}).limit(250).lean();res.json(items);}catch{res.status(500).json({message:"Could not load transactions."});}});
app.get("/api/admin/requests",authenticate,adminOnly,async(req,res)=>{try{const items=await MemberRequest.find().populate("member","name email country currency").sort({createdAt:-1}).limit(300).lean();res.json(items);}catch{res.status(500).json({message:"Could not load member requests."});}});
app.post("/api/admin/requests/:id",authenticate,adminOnly,async(req,res)=>{
  try{const status=String(req.body.status||""),adminNote=String(req.body.adminNote||"").trim();if(!["approved","rejected","reviewed"].includes(status)||adminNote.length>500)return res.status(400).json({message:"Choose a valid request status and note."});const item=await MemberRequest.findByIdAndUpdate(req.params.id,{$set:{status,adminNote,reviewedBy:req.user.id,updatedAt:new Date()}},{new:true}).populate("member","name email");if(!item)return res.status(404).json({message:"Request not found."});await Notification.create({member:item.member._id,title:"Request updated",body:`Your ${item.type.replace("_"," ")} request status is now ${status}.${adminNote?` ${adminNote}`:""}`});res.json({message:"Request status updated."});}catch{res.status(500).json({message:"Could not update request."});}
});
app.get("/api/admin/chat",authenticate,adminOnly,async(req,res)=>{try{if(req.query.memberId && mongoose.isValidObjectId(req.query.memberId)) await ChatMessage.updateMany({member:req.query.memberId,senderRole:"member",readAt:null},{$set:{readAt:new Date()}});const items=await ChatMessage.find().populate("member","name email").sort({createdAt:-1}).limit(300).lean();res.json(items);}catch{res.status(500).json({message:"Could not load chat messages."});}});
app.post("/api/admin/chat",authenticate,adminOnly,async(req,res)=>{try{const memberId=String(req.body.memberId||""),message=String(req.body.message||"").trim();if(!mongoose.isValidObjectId(memberId)||!message||message.length>2000)return res.status(400).json({message:"Select a member and enter a message."});const item=await ChatMessage.create({member:memberId,senderRole:"admin",message});await Notification.create({member:memberId,title:"New support reply",body:"An administrator has replied to your support conversation."});res.status(201).json(item);}catch{res.status(500).json({message:"Could not send the reply."});}});
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
