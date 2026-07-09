import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#080b14',
        surface: 'rgba(16,22,40,0.55)',
        elevated: 'rgba(22,30,52,0.7)',
        blue: '#5b8def',
        purple: '#8b7cf7',
        cyan: '#4dd4e8',
        green: '#3bc98a',
        yellow: '#e8b84b',
        red: '#e8636b',
      },
    },
  },
  plugins: [],
} satisfies Config;
