/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{html,ts,tsx,js,jsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        reactor: {
          dark: '#18181b',
          darker: '#0f0f11',
          card: '#242429',
          border: '#383842',
          primary: '#3b82f6',
          purple: '#a855f7',
          yellow: '#eab308',
          green: '#22c55e',
          text: '#f4f4f5',
          muted: '#a1a1aa'
        }
      }
    },
  },
  plugins: [],
}
