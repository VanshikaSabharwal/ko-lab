// The grey scale is driven by CSS variables (defaults in globals.css are
// Tailwind's own greys, so the site looks the same). The code editor overrides
// them from its chosen theme, which is how the whole IDE, not just the code
// area, follows that theme without restyling every component.
const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const gray = Object.fromEntries(
  shades.map((shade) => [shade, `rgb(var(--gray-${shade}) / <alpha-value>)`]),
);

module.exports = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}", //for page router
    "./components/**/*.{js,ts,jsx,tsx}",
    "./app/**/*.{js,ts,jsx,tsx}", // for app router
  ],
  theme: {
    extend: {
      colors: { gray },
    },
  },
  plugins: [],
};
