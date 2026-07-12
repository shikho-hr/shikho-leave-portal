import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Poppins", "Hind Siliguri", "sans-serif"],
        display: ["Poppins", "sans-serif"],
      },
      colors: {
        // Shikho Indigo — primary, 70% of any screen
        indigo: {
          50: "#F1F2FB",
          100: "#DDE0F4",
          200: "#888FE6",
          300: "#8F5903",
          400: "#6170B8",
          500: "#3F4FA2",
          600: "#304099",
          700: "#262F74",
          800: "#1B2356",
          900: "#121838",
        },
        // Magenta — accent
        magenta: {
          50: "#FBF0EE",
          100: "#F8BDEE",
          200: "#E87989",
          300: "#C020B8",
          400: "#BA1159",
          500: "#C020B8",
          DEFAULT: "#C020B8",
        },
        // Sunrise — highlight
        sunrise: {
          50: "#FFF8EB",
          100: "#FEF2B3",
          200: "#F8BEBC2",
          300: "#F0A010",
          400: "#E6A010",
          500: "#F0A010",
          DEFAULT: "#F0A010",
        },
        // Coral — live/alert
        coral: {
          50: "#FEF2F4",
          100: "#FBEBC2",
          200: "#F8BDE1",
          300: "#E03858",
          400: "#E03858",
          500: "#E03858",
          DEFAULT: "#E03858",
        },
      },
      borderRadius: {
        xl: "12px",
        "2xl": "16px",
        "3xl": "24px",
      },
    },
  },
  plugins: [],
};
export default config;
