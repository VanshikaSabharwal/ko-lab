import { NextResponse } from "next/server";
import prisma from "../../lib/prisma";
import { getSessionUser, unauthorized } from "../../lib/apiAuth";

export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const { searchParams } = new URL(req.url);
  const phone = searchParams.get("phone");
  const email = searchParams.get("email")?.trim().toLowerCase();

  // A member is looked up by phone or by email, whichever the caller passed.
  if (!phone && !email) {
    return NextResponse.json(
      { exists: false, error: "A phone number or email is required" },
      { status: 400 },
    );
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { exists: false, error: "Invalid email address" },
      { status: 400 },
    );
  }
  if (!email && (!phone || phone.length < 10)) {
    return NextResponse.json(
      { exists: false, error: "Invalid phone number" },
      { status: 400 },
    );
  }

  try {
    const user = await prisma.user.findUnique({
      where: email ? { email } : { phone: phone! },
    });

    if (user) {
      return NextResponse.json({ exists: true, userId: user.id });
    } else {
      return NextResponse.json({ exists: false });
    }
  } catch (err) {
    console.error("Error while checking user:", email || phone, err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
