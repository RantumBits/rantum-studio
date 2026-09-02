/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./**/*.html', '!./node_modules/**'],
  theme: {
    extend: {
      colors: {
        gray: {
          900: '#111111',
          800: '#1a1a1a',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
