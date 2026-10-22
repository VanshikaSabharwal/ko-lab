"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Link from "next/link";

const SignUp = () => {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [userExist, setUserExist] = useState(false);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const toastId = toast.loading("Creating account...");
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, password }),
      });
      const result = await response.json();
      if (response.ok) {
        toast.success("Account created! Please sign in.");
        router.push("/api/auth/signin");
      } else {
        toast.error(result.error || "Signup failed");
        setUserExist(true);
      }
    } catch (error) {
      console.error(error);
      toast.error("An error occurred during signup");
    } finally {
      toast.dismiss(toastId);
    }
  };

  return (
    <div className="min-h-[calc(100vh-56px)] flex items-center justify-center px-4 py-10 bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-sm">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm p-7">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
            Create account
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Join Ko-lab today
          </p>

          <form onSubmit={handleSignUp} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Name
              </label>
              <input
                type="text"
                id="name"
                placeholder="Your full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                required
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Email
              </label>
              <input
                type="email"
                id="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                required
              />
            </div>
            <div>
              <label htmlFor="phone" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Phone number
              </label>
              <input
                type="text"
                id="phone"
                placeholder="+91 00000 00000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                required
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Password
              </label>
              <input
                type="password"
                id="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                required
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
            >
              Create account
            </button>

            {userExist && (
              <Link
                href="/api/auth/signin"
                className="block text-center w-full py-2.5 text-sm font-semibold border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
              >
                Already have an account? Sign in
              </Link>
            )}
          </form>

          <p className="text-xs text-center text-gray-500 dark:text-gray-400 mt-5">
            Already have an account?{" "}
            <Link href="/signin" className="text-blue-500 hover:underline font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default SignUp;
