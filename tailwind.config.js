/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 宣纸底色阶（沿用 ink 命名，数值即纸的深浅：950 作纸面色、900 作卡纸）
        ink: {
          950: '#e8dfc9',
          900: '#f7f2e3',
          850: '#f2ebd8',
          800: '#ece3cd',
          700: '#e3d8bd',
        },
        line: '#c9b78f',
        // 朱砂主色
        accent: '#b23b32',
        muted: '#857a5f',
        // 墨色（文字）：越深越浓
        mo: {
          200: '#cfc4a9',
          300: '#b3a78a',
          400: '#9c8f71',
          500: '#857a5f',
          600: '#6d6349',
          700: '#544c39',
          800: '#3d3727',
          900: '#2b2617',
          950: '#1e1a10',
        },
        // 松绿（成功）
        song: {
          200: '#6f9382',
          300: '#4e7a62',
          400: '#3f6650',
          500: '#385a47',
        },
        // 黛蓝（信息）
        dai: {
          200: '#5f8cab',
          300: '#41708f',
          400: '#355d79',
          500: '#2f536c',
        },
        // 胭脂（错误）
        yan: {
          100: '#c98e99',
          200: '#b45e6d',
          300: '#a13a4c',
          400: '#92333f',
          500: '#832e3a',
        },
        // 赭黄（警示）
        ni: {
          200: '#b08b45',
          300: '#9a7328',
          400: '#87611d',
          500: '#7a5718',
        },
        // 青莲（紫系点缀）
        lian: {
          200: '#8d7fb0',
          300: '#6f5f97',
          400: '#5d4f83',
          500: '#544675',
        },
        // 胭脂粉（教师 Agent）
        fen: {
          200: '#c07d95',
          300: '#ad5979',
          400: '#9c4a69',
          500: '#8d425f',
        },
      },
      fontFamily: {
        sans: [
          '"Noto Serif SC"',
          '"Source Han Serif SC"',
          '"Songti SC"',
          'STSong',
          'SimSun',
          'serif',
        ],
        serif: [
          '"Noto Serif SC"',
          '"Source Han Serif SC"',
          '"Songti SC"',
          'STSong',
          'SimSun',
          'serif',
        ],
        kai: [
          '"LXGW WenKai Screen"',
          '"Kaiti SC"',
          'STKaiti',
          'KaiTi',
          '"Noto Serif SC"',
          'serif',
        ],
        mono: [
          '"JetBrains Mono"',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          '"Liberation Mono"',
          'monospace',
        ],
      },
      boxShadow: {
        panel:
          'inset 0 1px 0 0 rgba(255,255,255,0.45), 0 2px 4px rgba(92,76,44,0.08), 0 16px 36px -20px rgba(92,76,44,0.5)',
        seal: 'inset 0 1px 0 rgba(255,235,205,0.35), 0 2px 8px -2px rgba(140,50,40,0.6)',
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
