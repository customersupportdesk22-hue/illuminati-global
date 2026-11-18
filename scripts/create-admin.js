require("dotenv").config();
const mongoose=require("mongoose"),bcrypt=require("bcryptjs"),readline=require("readline");
const Member=mongoose.model("Member",new mongoose.Schema({name:String,email:{type:String,unique:true,lowercase:true},phone:String,country:String,countryCode:String,dialCode:String,currency:String,balance:{type:Number,default:0},password:{type:String,select:false},role:{type:String,default:"member"},createdAt:{type:Date,default:Date.now}}));
// Mode 1 (npm start -> prestart, --auto): creates the admin from Render environment variables, only if none exists. Never blocks the server from starting.
// Mode 2 (npm run create-admin): asks questions in the terminal.
const auto=process.argv.includes("--auto"),E=process.env;
(async()=>{
  try{
    if(!E.MONGODB_URI)throw Error("MONGODB_URI is missing.");
    if(auto&&!(E.ADMIN_EMAIL&&E.ADMIN_PASSWORD))return;
    await mongoose.connect(E.MONGODB_URI);
    const existing=await Member.findOne({role:"admin"});
    if(existing){console.log(`Administrator already exists (${existing.email}).`);return}
    let email,name,phone,country,password;
    if(auto){email=E.ADMIN_EMAIL;name=E.ADMIN_NAME||"Administrator";phone=E.ADMIN_PHONE||"0000000000";country=E.ADMIN_COUNTRY||"Kenya";password=E.ADMIN_PASSWORD}
    else{const rl=readline.createInterface({input:process.stdin,output:process.stdout}),ask=q=>new Promise(r=>rl.question(q,r));email=await ask("Admin email: ");name=await ask("Admin full name: ");phone=await ask("Admin phone: ");country=await ask("Admin country: ");password=await ask("Admin password (minimum 12 characters): ");rl.close()}
    email=String(email).trim().toLowerCase();name=String(name).trim();phone=String(phone).trim();country=String(country).trim();
    if(!email||!name||!phone||!country||String(password).length<12)throw Error("All fields are required and the admin password must be at least 12 characters.");
    const hash=await bcrypt.hash(String(password),12),found=await Member.findOne({email}).select("_id");
    if(found){await Member.updateOne({_id:found._id},{$set:{role:"admin",password:hash}});console.log(`Existing member ${email} is now the administrator with the new password. Remove ADMIN_PASSWORD from Render now.`)}
    else{await Member.create({name,email,phone,country,password:hash,role:"admin",currency:"USD",balance:0});console.log(`Administrator account created for ${email}. Remove ADMIN_PASSWORD from Render now.`)}
  }catch(e){console.error("create-admin:",e.message);if(!auto)process.exitCode=1}
  finally{await mongoose.disconnect().catch(()=>{})}
})();
