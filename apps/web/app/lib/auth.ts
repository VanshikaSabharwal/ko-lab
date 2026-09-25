import { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import prisma from "./prisma";

const PICTURE_REFRESH_MS = 5 * 60 * 1000;

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),

  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope: "repo user read:user admin:public_key",
        },
      },
    }),

    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
  ],

  secret: process.env.NEXTAUTH_SECRET,

  session: {
    strategy: "jwt", // required to store token on frontend
  },

  callbacks: {
    async jwt({ token, user, account, trigger }) {
      if (account && user) {
        token.id = user.id;
        token.accessToken = account.access_token!;
        token.provider = account.provider!;
        if (account.provider === "github") {
          token.githubAccessToken = account.access_token!;
        }
      }

      // The photo is copied into the token at sign-in, so an avatar uploaded
      // later never reached the header. Re-read it when the client calls
      // update() after an upload, and every few minutes otherwise so tokens
      // issued before this change heal on their own.
      const now = Date.now();
      if (
        token.id &&
        (trigger === "update" ||
          !token.pictureCheckedAt ||
          now - token.pictureCheckedAt > PICTURE_REFRESH_MS)
      ) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id },
          select: { image: true },
        });
        token.picture = dbUser?.image ?? null;
        token.pictureCheckedAt = now;
      }
      return token;
    },

    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.accessToken = token.accessToken as string;
      session.user.provider = token.provider as string;
      session.user.githubAccessToken = token.githubAccessToken as string;
      session.user.image = token.picture ?? undefined;
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
};
