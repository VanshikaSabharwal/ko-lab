import { execSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { AUTH_SECRET, BASE_URL, DATABASE_URL, STORAGE_STATE } from "../playwright.config";
import { USER, FRIEND, GROUP } from "./seed";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "postgres"]);

/** localStorage flags the app sets once a guided tour has been seen. */
const TOUR_KEYS = [
  "ko-lab-tour-seen",
  "ko-lab-tour-chatroom",
  "ko-lab-tour-github",
  "ko-lab-tour-groups",
  "ko-lab-tour-notifications",
];

/**
 * Prepares the throwaway database and signs the test user in.
 *
 * Sign-in normally goes through GitHub or Google, which a test can't do. The
 * app's sessions are signed cookies, so the setup signs one for the seeded user
 * with the same secret the app is started with.
 */
export default async function globalSetup() {
  // This wipes and reseeds. Refuse anything but a local database, so a stray
  // setting can never point it at development or production data.
  const host = new URL(DATABASE_URL).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Browser tests only run against a local database, but E2E_DATABASE_URL points at "${host}".`,
    );
  }

  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL },
    stdio: "pipe",
  });

  const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
  try {
    // Start from the same state every run
    await prisma.$executeRawUnsafe(
      `DO $$ DECLARE t text; BEGIN
         FOR t IN SELECT tablename FROM pg_tables
                  WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
         LOOP EXECUTE format('TRUNCATE TABLE %I CASCADE', t); END LOOP;
       END $$;`,
    );

    await prisma.user.createMany({ data: [USER, FRIEND] });
    await prisma.group.create({
      data: {
        id: GROUP.id,
        groupName: GROUP.name,
        githubRepo: GROUP.repo,
        ownerName: "e2e-owner",
        // Not a real token: nothing in these tests talks to GitHub
        githubAccessToken: "e2e-placeholder",
        ownerId: USER.id,
        members: { create: { userId: FRIEND.id } },
        groupMessage: {
          create: [
            { senderId: USER.id, senderName: USER.name, message: "Hello from the test user" },
            { senderId: FRIEND.id, senderName: FRIEND.name, message: "Hi! Reply from a member" },
          ],
        },
      },
    });
    await prisma.notifications.create({
      data: {
        recipientId: USER.id,
        type: "GROUP_INVITE",
        userId: USER.id,
        userName: USER.name,
        groupId: GROUP.id,
        groupName: GROUP.name,
        ownerId: FRIEND.id,
        ownerName: FRIEND.name,
        message: `${FRIEND.name} added you to ${GROUP.name}`,
      },
    });
  } finally {
    await prisma.$disconnect();
  }

  const token = await encode({
    secret: AUTH_SECRET,
    token: {
      sub: USER.id,
      id: USER.id,
      name: USER.name,
      email: USER.email,
      picture: null,
      provider: "github",
      accessToken: "e2e-placeholder",
      githubAccessToken: "e2e-placeholder",
    },
  });

  mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  writeFileSync(
    STORAGE_STATE,
    JSON.stringify({
      cookies: [
        {
          name: "next-auth.session-token",
          value: token,
          domain: new URL(BASE_URL).hostname,
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      // A returning user: the first-visit guided tours cover the page with an
      // overlay, which would block every click. tour.spec.ts tests them on
      // their own, as a first-time visitor.
      origins: [
        {
          origin: BASE_URL,
          localStorage: TOUR_KEYS.map((name) => ({ name, value: "1" })),
        },
      ],
    }),
  );
}
