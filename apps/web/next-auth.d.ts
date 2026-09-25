// next-auth.d.ts
import NextAuth from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      phone?: string;
      name: string;
      image?: string;
      githubAccessToken?: string;
      accessToken: string;
      provider: string;
    };
  }

  interface User {
    id: string;
    email: string;
    phone?: string;
    name: string;
    image?: string;
    githubAccessToken?: string;
    accessToken: string;
    provider: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    email: string;
    phone?: string;
    name: string;
    image?: string;
    githubAccessToken?: string;
    accessToken: string;
    provider: string;
    // When `picture` was last re-read from the database (ms epoch)
    pictureCheckedAt?: number;
  }
}
