/** @type {import('tailwindcss').Config} */
// Design tokens follow BeamNG.drive's own UI (ui/ui-vue/src/styles, palette
// v25.03.04): Noto Sans text, Overpass titles, Overpass Mono numbers, the
// bng-orange ramp (its 400 is our #FF6600) and its 4/8/16 px corners.
// Notes: refs/output/ui-consistency-plan.md
const FALLBACK = ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'];

export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./*.{vue,js,ts,jsx,tsx}",
    "./components/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Noto Sans Variable"', '"Noto Sans"', ...FALLBACK],
        display: ['"Overpass Variable"', '"Overpass"', '"Noto Sans Variable"', ...FALLBACK],
        mono: ['"Overpass Mono Variable"', '"Overpass Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        // bng-orange (oklch ramp converted to sRGB)
        brand: {
          DEFAULT: '#ff6600',
          50: '#fcd4c3',
          100: '#ffbca0',
          200: '#ffa37c',
          300: '#ff8955',
          400: '#ff6600',
          500: '#da5706',
          600: '#a54106',
          700: '#6c2f13',
          800: '#451f0e',
          900: '#291006',
        },
      },
      fontSize: {
        // the two small steps the panels use, named instead of text-[10px]/[11px]
        nano: ['9px', { lineHeight: '12px' }],     // badges and tags only
        micro: ['10px', { lineHeight: '14px' }],
        caption: ['11px', { lineHeight: '16px' }],
      },
    },
  },
  plugins: [],
}
