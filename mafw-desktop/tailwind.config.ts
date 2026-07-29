import type { Config } from 'tailwindcss'

const grey = {
  50: '#ffffff',
  100: '#fafafa',
  200: '#f2f2f2',
  300: '#eeeeee',
  400: '#dbdbdb',
  500: '#aeaeae',
  600: '#808080',
  700: '#5c5c5c',
  800: '#3a3a3a',
  900: '#2e2e2e',
  1000: '#242424',
  1100: '#161616',
  1200: '#080808',
}

export default {
  content: ['src/renderer/**/*.{tsx,ts,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        grey,
        accent: { DEFAULT: '#7698fd', bg: 'rgba(118,152,253,0.15)' },
        success: { DEFAULT: '#2bc94a', bg: 'rgba(43,201,74,0.15)' },
        warning: { DEFAULT: '#e8b84b', bg: 'rgba(232,184,75,0.15)' },
        danger: { DEFAULT: '#e8636b', bg: 'rgba(232,99,107,0.15)' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        '13': '13px',
        '11': '11px',
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '8px',
      },
    },
  },
  plugins: [],
} satisfies Config
