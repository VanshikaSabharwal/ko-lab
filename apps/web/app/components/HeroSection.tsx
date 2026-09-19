"use client";

import React from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { Code, MessageSquare, Users } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import Footer from "@repo/ui/footer";
import Cookies from "js-cookie";
import toast from "react-hot-toast";
import demoTestimonal from "../../../../data/demo-testimonial.json";
import SiteTour from "./SiteTour";
import AssistantChat from "./AssistantChat";

interface GuestData {
  guestId: string;
}

const HeroSection = () => {
  const { data: session } = useSession();
  const [guestData, setGuestData] = useState<GuestData | null>(null);
  const [testimonials, setTestimonials] = useState<
    { id: string; name: string; description: string; userId: string }[]
  >([]);
  const [inputName, setInputName] = useState("");
  const [inputDescription, setInputDescription] = useState("");
  const testimonialUserId = session?.user?.email || guestData?.guestId;

  useEffect(() => {
    let guestId = Cookies.get("guestId");
    if (!guestId) {
      guestId = uuidv4();
      Cookies.set("guestId", guestId, { expires: 365 });
    }
    setGuestData({ guestId });
  }, []);

  useEffect(() => {
    const fetchTestimonials = async () => {
      try {
        const response = await fetch("/api/testimonial-card");
        let fetched: typeof demoTestimonal = [];
        if (response.ok) {
          fetched = await response.json();
        }
        setTestimonials([...demoTestimonal, ...fetched]);
      } catch (err) {
        console.error("Failed to fetch testimonials:", err);
      }
    };
    fetchTestimonials();
  }, []);

  const handleAddTestimonial = async () => {
    try {
      const userId = session?.user?.email || guestData?.guestId;
      if (!userId) {
        toast.error("Could not determine user identity.");
        return;
      }
      const response = await fetch("/api/testimonial-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: inputName, description: inputDescription, userId }),
      });
      if (response.ok) {
        const newTestimonial = await response.json();
        setTestimonials((prev) => [...prev, newTestimonial]);
        setInputName("");
        setInputDescription("");
        toast.success("Thanks for your feedback!");
      } else {
        const errorData = await response.json();
        toast.error(`Error: ${errorData.error}`);
      }
    } catch (err) {
      console.error("Error adding testimonial: ", err);
      toast.error("Failed to add testimonial. Please try again.");
    }
  };

  const handleDeleteTestimonial = async (id: string) => {
    try {
      const userId = session?.user?.email || guestData?.guestId;
      const response = await fetch("/api/testimonial-card", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (response.ok) {
        setTestimonials((prev) => prev.filter((t) => t.id !== id));
        toast.success("Testimonial deleted successfully.");
      } else {
        const errorData = await response.json();
        toast.error(`Error: ${errorData.error}`);
      }
    } catch (err) {
      console.error("Error deleting testimonial:", err);
      toast.error("Failed to delete testimonial. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-[#829797] dark:from-gray-900 dark:to-black text-gray-900 dark:text-white">
      <SiteTour />

      {/* Hero with Assistant Chat */}
      <section className="px-4 sm:px-6 lg:px-8 py-16 sm:py-20 lg:py-24 min-h-[90vh] flex items-center">
        <div className="w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
          {/* Left: Text Content */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center lg:text-left space-y-8"
          >
            <h1 className="text-5xl sm:text-6xl md:text-6xl lg:text-7xl font-extrabold leading-tight tracking-tight">
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-purple-600">
                Ko-Lab:
              </span>{" "}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-gray-800 to-gray-600 dark:from-white dark:to-gray-300">
                Code, Collaborate, and Chat
              </span>
            </h1>

            <p className="text-lg sm:text-xl text-gray-600 dark:text-gray-300 leading-relaxed max-w-lg">
              Seamless collaboration with real-time coding, one-on-one and group chat — all in one platform.
            </p>

            <div id="tour-cta" className="flex flex-wrap items-center justify-center lg:justify-start gap-3 pt-6">
              {session || guestData ? (
                <Link
                  href="/chat-room"
                  className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg text-sm font-semibold hover:shadow-lg hover:shadow-blue-500/30 transition-all"
                >
                  Go to Chat Room
                </Link>
              ) : (
                <Link
                  href="/signup"
                  className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg text-sm font-semibold hover:shadow-lg hover:shadow-blue-500/30 transition-all"
                >
                  Get Started
                </Link>
              )}
              <Link
                href="/github"
                className="px-6 py-2.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-white rounded-lg text-sm font-semibold border border-gray-200 dark:border-gray-700 hover:shadow-md transition-all"
              >
                Create a Group
              </Link>
              <Link
                href="/groups"
                className="px-6 py-2.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-white rounded-lg text-sm font-semibold border border-gray-200 dark:border-gray-700 hover:shadow-md transition-all"
              >
                My Groups
              </Link>
            </div>
          </motion.div>

          {/* Right: Assistant Chat (only for authenticated users) */}
          {session && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="h-full"
            >
              <div className="h-full lg:min-h-96">
                <AssistantChat />
              </div>
            </motion.div>
          )}
        </div>
      </section>

      {/* Feature cards */}
      <section className="px-4 sm:px-6 lg:px-8 pb-12 sm:pb-16 max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          id="tour-features"
          className="grid grid-cols-1 sm:grid-cols-3 gap-4"
        >
          <div className="p-5 rounded-xl bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 hover:border-blue-400 transition text-center">
            <Code className="w-8 h-8 mx-auto mb-3 text-blue-400" />
            <h3 className="text-sm font-semibold mb-1">Real-Time Code Editing</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              Collaborate with live code editing and syncing.
            </p>
          </div>
          <div className="p-5 rounded-xl bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 hover:border-purple-400 transition text-center">
            <MessageSquare className="w-8 h-8 mx-auto mb-3 text-purple-400" />
            <h3 className="text-sm font-semibold mb-1">One-on-One Chat</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              Securely chat with team members anytime.
            </p>
          </div>
          <div className="p-5 rounded-xl bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 hover:border-indigo-400 transition text-center">
            <Users className="w-8 h-8 mx-auto mb-3 text-indigo-400" />
            <h3 className="text-sm font-semibold mb-1">Group Chat for Projects</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              Dedicated project chat rooms for your team.
            </p>
          </div>
        </motion.div>
      </section>

      {/* Testimonials */}
      <section id="tour-testimonials" className="py-10 sm:py-14 border-t border-gray-100 dark:border-gray-800">
        <h2 className="text-xl sm:text-2xl font-bold text-center mb-8">
          What people are saying
        </h2>

        <div className="w-full overflow-hidden">
          {testimonials.length > 0 ? (
            <div className="flex animate-marquee gap-4 w-max px-4">
              {[...testimonials, ...testimonials].map((testimonial, index) => (
                <div
                  key={`${testimonial.id}-${index}`}
                  className="flex-shrink-0 w-64 sm:w-72 p-5 rounded-xl bg-[#f3f4f6] dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 shadow-sm"
                >
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                    "{testimonial.description}"
                  </p>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                      — {testimonial.name}
                    </span>
                    {testimonialUserId === testimonial.userId && (
                      <button
                        onClick={() => handleDeleteTestimonial(testimonial.id)}
                        className="text-xs text-red-400 hover:text-red-500 transition"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center">No testimonials yet.</p>
          )}
        </div>

        {/* Add testimonial form */}
        <div className="mt-10 max-w-lg mx-auto px-4">
          <div className="bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl p-6 shadow-sm">
            <h3 className="text-base font-semibold mb-4 text-center bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
              Share your experience
            </h3>
            <div className="space-y-3">
              <input
                type="text"
                value={inputName}
                onChange={(e) => setInputName(e.target.value)}
                placeholder="Your name"
                className="w-full px-3 py-2.5 text-sm rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              />
              <textarea
                value={inputDescription}
                onChange={(e) => setInputDescription(e.target.value)}
                placeholder="What do you think of Ko-Lab?"
                rows={3}
                className="w-full px-3 py-2.5 text-sm rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 transition resize-none"
              />
              <button
                onClick={handleAddTestimonial}
                className="w-full py-2.5 text-sm font-semibold rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-90 text-white transition shadow"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default HeroSection;
