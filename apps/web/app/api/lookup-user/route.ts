import { NextResponse } from "next/server";
import prisma from "../../lib/prisma";
import { getSessionUser, unauthorized } from "../../lib/apiAuth";

/**
 * Resolve a user by phone or email in a single round-trip.
 *
 * Replaces the check-user + get-user-id pair, which ran the identical
 * `findUnique` twice in sequence — the second call could only ever return what
 * the first already knew. Adding a member cost three serial requests; this
 * makes it two.
 */
export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const { searchParams } = new URL(req.url);
  const phone = searchParams.get("phone");
  const email = searchParams.get("email")?.trim().toLowerCase();

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
    // Only the id is needed — the previous routes selected every column,
    // including the password hash, to read one field.
    const user = await prisma.user.findUnique({
      where: email ? { email } : { phone: phone! },
      select: { id: true, name: true },
    });

    return user
      ? NextResponse.json({ exists: true, userId: user.id, name: user.name })
      : NextResponse.json({ exists: false });
  } catch (err) {
    console.error("Error looking up user:", email || phone, err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
