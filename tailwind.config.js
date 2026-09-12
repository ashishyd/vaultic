/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        vt: {
          bg: '#0B1220',
          surface: '#111A2E',
          surface2: '#16213A',
          border: '#233150',
          text: '#E7ECF7',
          muted: '#8B99B8',
          teal: '#2DD4BF',
          tealDark: '#0F766E',
          danger: '#F87171'
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'sans-serif']
      }
    }
  },
  plugins: []
}
