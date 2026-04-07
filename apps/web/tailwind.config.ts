import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // ─── Sahay Design System Colors ───────────────────────
      colors: {
        // Primary: Sahay Violet
        violet: {
          50:  '#F0EDFF',
          100: '#E1DAFF',
          200: '#C3B5FF',
          300: '#A490FF',
          400: '#8669FF',
          500: '#6B4EFF', // PRIMARY
          600: '#5538D9',
          700: '#3F25B3',
          800: '#2A148C',
          900: '#150766',
        },
        // Accent: Saffron Gold
        saffron: {
          50:  '#FFFBEB',
          100: '#FEF3C7',
          200: '#FDE68A',
          300: '#FCD34D',
          400: '#FBBF24',
          500: '#F59E0B', // ACCENT
          600: '#D97706',
          700: '#B45309',
          800: '#92400E',
          900: '#78350F',
        },
        // Background
        background: {
          DEFAULT: '#F8F7FF',    // light lavender tint
          surface: '#FFFFFF',
          elevated: '#FAFAFA',
          dark: '#0D0B1A',       // dark surface
        },
        // Border
        border: {
          DEFAULT: '#E5E3F0',
          strong: '#C4C2D9',
        },
        // Text
        text: {
          primary: '#0D0B1A',
          secondary: '#5C5A6E',
          muted: '#9B99AE',
          inverse: '#FFFFFF',
        },
        // Channel colors
        channel: {
          whatsapp: '#25D366',
          instagram: '#E1306C',
          webchat: '#6B4EFF',
          email: '#6B7280',
        },
        // Sentiment
        sentiment: {
          veryNegative: '#EF4444',
          negative: '#F97316',
          neutral: '#6B7280',
          positive: '#22C55E',
          veryPositive: '#06B6D4',
        },
      },
      // ─── Typography ───────────────────────────────────────
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        devanagari: ['"Noto Sans Devanagari"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      // ─── Animation ────────────────────────────────────────
      animation: {
        'slide-in-right': 'slideInRight 200ms ease-out',
        'slide-in-up': 'slideInUp 200ms ease-out',
        'fade-in': 'fadeIn 150ms ease-in',
        'scale-in': 'scaleIn 200ms cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        'shimmer': 'shimmer 1.5s linear infinite',
        'pulse-border': 'pulseBorder 400ms ease-in-out',
        'rolling-number': 'rollingNumber 400ms ease-out',
        'confetti': 'confetti 2s ease-out forwards',
      },
      keyframes: {
        slideInRight: {
          '0%': { transform: 'translateX(-16px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideInUp: {
          '0%': { transform: 'translateY(16px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pulseBorder: {
          '0%, 100%': { borderColor: 'transparent' },
          '50%': { borderColor: 'rgb(107, 78, 255)' },
        },
      },
      // ─── Box Shadows ──────────────────────────────────────
      boxShadow: {
        'card': '0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'card-hover': '0 4px 12px 0 rgb(0 0 0 / 0.1), 0 2px 4px -1px rgb(0 0 0 / 0.06)',
        'panel': '0 8px 24px 0 rgb(0 0 0 / 0.08)',
        'modal': '0 20px 60px 0 rgb(0 0 0 / 0.15)',
        'ai-glow': '0 0 0 2px rgb(107 78 255 / 0.2), 0 2px 8px 0 rgb(107 78 255 / 0.15)',
      },
      // ─── Border Radius ────────────────────────────────────
      borderRadius: {
        'lg': '12px',
        'xl': '16px',
        '2xl': '20px',
        'bubble': '18px 18px 18px 4px',  // customer message bubble
        'bubble-r': '18px 18px 4px 18px', // agent/AI message bubble
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}

export default config
