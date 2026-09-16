// import { NextResponse } from "next/server";
// import nodemailer from "nodemailer";
// import prisma from "../../../lib/prisma";

// // Create nodemailer transporter
// const transporter = nodemailer.createTransport({
//   service: "Gmail",
//   auth: {
//     user: process.env.EMAIL_USER,
//     pass: process.env.EMAIL_PASS,
//   },
// });

// // Function to send OTP via email
// async function sendOtp(email: string, phone: string) {
//   // Generate a 6-digit OTP
//   const otpNum = Math.floor(100000 + Math.random() * 900000).toString();

//   // Send OTP via email
//   await transporter.sendMail({
//     from: process.env.EMAIL_USER,
//     to: email,
//     subject: "OTP verification for ko-lab",
//     text: `Your OTP is ${otpNum}`,
//   });

//   // Store OTP in the database with expiration time
//   const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Expires OTP in 10 minutes

//   // Check if OTP already exists for the email/phone
//   const existingOtp = await prisma.otp.findFirst({
//     where: { phone, email },
//   });

//   if (existingOtp) {
//     // Update the existing OTP
//     await prisma.otp.update({
//       where: { id: existingOtp.id },
//       data: {
//         otp: otpNum,
//         expiresAt,
//       },
//     });
//   } else {
//     // Create new OTP record
//     await prisma.otp.create({
//       data: {
//         phone,
//         email,
//         otp: otpNum,
//         expiresAt,
//       },
//     });
//   }

//   return otpNum;
// }

// // Named export for POST requests
// export async function POST(request: Request) {
//   const { email, phone, action } = await request.json();

//   if (!email || !phone) {
//     return NextResponse.json(
//       { message: "Email and phone number are required" },
//       { status: 400 }
//     );
//   }

//   try {
//     // Action to send or resend OTP
//     if (action === "resend") {
//       // Handle resend OTP logic
//       const existingOtp = await prisma.otp.findFirst({
//         where: { phone, email },
//       });

//       if (existingOtp) {
//         // Check if existing OTP is still valid (not expired)
//         if (existingOtp.expiresAt > new Date()) {
//           return NextResponse.json(
//             { message: "OTP is still valid. Please use the existing one." },
//             { status: 200 }
//           );
//         }
//       }

//       // If expired, send a new OTP
//       await sendOtp(email, phone);
//       return NextResponse.json(
//         { message: "OTP resent successfully" },
//         { status: 200 }
//       );
//     } else {
//       // Send OTP for the first time or if not a resend request
//       await sendOtp(email, phone);
//       return NextResponse.json(
//         { message: "OTP sent successfully" },
//         { status: 200 }
//       );
//     }
//   } catch (error) {
//     console.error(error);
//     return NextResponse.json(
//       { message: "Failed to send OTP" },
//       { status: 500 }
//     );
//   }
// }
