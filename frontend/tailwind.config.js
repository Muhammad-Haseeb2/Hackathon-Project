/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#16233B',
          50: '#E8EBF0',
          100: '#D1D7E1',
          200: '#A3AFC3',
          300: '#7587A5',
          400: '#475F87',
          500: '#16233B',
          600: '#121C2F',
          700: '#0E1523',
          800: '#0A0E17',
          900: '#06070B',
        },
        teal: {
          DEFAULT: '#167A6C',
          50: '#E6F5F2',
          100: '#CCEBE5',
          200: '#99D7CB',
          300: '#66C3B1',
          400: '#33AF97',
          500: '#167A6C',
          600: '#126256',
          700: '#0E4A41',
          800: '#0A312B',
          900: '#061916',
        },
        offwhite: '#FBFBF9',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
