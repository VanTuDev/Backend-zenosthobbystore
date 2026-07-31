import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const userSchema = new mongoose.Schema({}, { strict: false });
const User = mongoose.model("User", userSchema, "users");

await mongoose.connect(process.env.MONGODB_URI);
const users = await User.find({}, "email role name").lean();
console.log(JSON.stringify(users, null, 2));
await mongoose.disconnect();
