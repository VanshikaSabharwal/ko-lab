/** @type {import('next').NextConfig} */

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["http://localhost:3000"];

// Production avatar host from R2 (S3_PUBLIC_BASE_URL). Added to next/image
// remotePatterns so avatars served from a bucket custom domain are optimised.
const s3PublicBase = process.env.S3_PUBLIC_BASE_URL;
const s3ImagePatterns = [];
if (s3PublicBase) {
  try {
    const { protocol, hostname, port } = new URL(s3PublicBase);
    s3ImagePatterns.push({
      protocol: protocol.replace(":", ""),
      hostname,
      ...(port ? { port } : {}),
    });
  } catch {
    // malformed URL — ignore; avatars still render via a plain <img> fallback
  }
}

const securityHeaders = [
  // Prevent browsers from MIME-sniffing the content-type
  { key: "X-Content-Type-Options", value: "nosniff" },

  // Block the site from being embedded in iframes (clickjacking protection)
  { key: "X-Frame-Options", value: "SAMEORIGIN" },

  // Force HTTPS for 2 years, including subdomains
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },

  // Control how much referrer info is sent
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // Camera/mic are granted per-route below, not here — see callHeaders. A
  // blanket camera=(self) made Android show a vague "wants to access other
  // apps and services" prompt on pages that never place a call.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },

  // Legacy XSS filter (still useful for older browsers)
  { key: "X-XSS-Protection", value: "1; mode=block" },

  // DNS prefetch control
  { key: "X-DNS-Prefetch-Control", value: "on" },

  // Content Security Policy — controls what resources can load
  // Prevents XSS: injected scripts won't execute unless they match these rules
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // unsafe-inline needed for Tailwind/Next.js inline styles
      // unsafe-eval needed for Next.js dev HMR (remove in production if possible)
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      // Allow images from self, data URIs, and any HTTPS source (GitHub avatars etc.).
      // LocalStack serves over plain HTTP in dev, so it needs an explicit allowance.
      `img-src 'self' data: https:${process.env.NODE_ENV !== "production" ? " http://localhost:4566" : ""}`,
      "font-src 'self'",
      // Allow connections to your own API + WebSocket server + GitHub API
      `connect-src 'self' ${allowedOrigins.join(" ")} ws://localhost:8080 wss: ws://localhost:7880 https://api.github.com`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

// Routes where a call can start or ring: the chat list, a 1-1 chat, and a group
// chat. CallProvider is mounted app-wide, but only these surfaces can initiate
// or receive, so only they need camera/mic.
const CALL_ROUTES = ["/chat-room", "/chat/:path*", "/group/:path*"];

const callHeaders = [
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), interest-cohort=()",
  },
];

const nextConfig = {
  headers: async () => [
    {
      // Apply security headers to all routes
      source: "/(.*)",
      headers: securityHeaders,
    },
    // Re-grant camera/mic only on call-capable routes. Listed after the
    // catch-all so these values override the deny above.
    ...CALL_ROUTES.map((source) => ({ source, headers: callHeaders })),
    {
      // CORS for your API routes — only allow your own origin
      source: "/api/(.*)",
      headers: [
        {
          key: "Access-Control-Allow-Origin",
          value: process.env.NEXTAUTH_URL || "http://localhost:3000",
        },
        {
          key: "Access-Control-Allow-Methods",
          value: "GET, POST, PUT, DELETE, OPTIONS",
        },
        {
          key: "Access-Control-Allow-Headers",
          value: "Content-Type, Authorization",
        },
        {
          key: "Access-Control-Allow-Credentials",
          value: "true",
        },
      ],
    },
  ],

  // Prevent source maps from leaking in production
  productionBrowserSourceMaps: false,

  images: {
    remotePatterns: [
      ...s3ImagePatterns,
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      // LocalStack S3 endpoint, used for locally-uploaded profile avatars in dev.
      { protocol: "http", hostname: "localhost", port: "4566" },
    ],
  },
};

export default nextConfig;
