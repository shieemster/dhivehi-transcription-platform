/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'], // 🌙 Enables dark mode via a .dark class
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
