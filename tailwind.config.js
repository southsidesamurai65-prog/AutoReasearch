/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#070a0e',
          900: '#0a0f15',
          850: '#0d131b',
          800: '#111923',
          700: '#16202c',
        },
        line: '#1e2a39',
        accent: '#c8ff4d',
        muted: '#8a99ad',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 20px 50px -30px rgba(0,0,0,0.9)',
      },
      keyframes: {
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        blink: {
          '0%, 49%': { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
        rise: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'pulse-soft': 'pulseSoft 1.4s ease-in-out infinite',
        blink: 'blink 1s step-end infinite',
        rise: 'rise 0.28s ease-out both',
      },
    },
  },
  plugins: [],
}
