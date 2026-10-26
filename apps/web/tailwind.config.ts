import type { Config } from 'tailwindcss';
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        night: '#11100F', wood: '#1B1917', felt: '#0D2B21', felt2: '#123B2D', oxblood: '#702C35', rose: '#8a3843',
        cream: '#F0E5CF', ink: '#1b1917', brass: '#B49A67', candle: '#B49A67', taupe: '#9C8B76',
      },
      fontFamily: { display: ['"Playfair Display"', 'Georgia', 'serif'], body: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
