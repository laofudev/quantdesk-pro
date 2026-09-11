import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 金融终端风：slate 深底 + 琥珀点缀
        amber: {
          accent: "#D4B06B",
        },
      },
    },
  },
  plugins: [],
};
export default config;
