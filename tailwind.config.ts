import type { Config } from 'tailwindcss';

// All tokens are mapped directly from BRAND.md. Do not introduce raw hex at call
// sites — extend the theme here instead.
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // §2.1 Surfaces (navy tonal ramp)
        background: '#0b1326',
        surface: {
          DEFAULT: '#0b1326',
          dim: '#0b1326',
          bright: '#31394d',
          variant: '#2d3449',
        },
        'surface-container-lowest': '#060e20',
        'surface-container-low': '#131b2e',
        'surface-container': '#171f33',
        'surface-container-high': '#222a3d',
        'surface-container-highest': '#2d3449',

        // §2.2 Primary (amber)
        primary: {
          DEFAULT: '#ffe4af',
          container: '#ffc107',
          fixed: '#ffdf9e',
          'fixed-dim': '#fabd00',
        },
        'on-primary': '#3f2e00',
        'on-primary-container': '#6d5100',
        'surface-tint': '#fabd00',
        'inverse-primary': '#785900',

        // §2.3 Secondary & tertiary
        secondary: {
          DEFAULT: '#ffb77a',
          container: '#ff8f00',
        },
        tertiary: {
          DEFAULT: '#cdecff',
          container: '#84d5ff',
          'fixed-dim': '#75d1ff',
        },

        // §2.4 Text / outline / status
        'on-surface': '#dae2fd',
        'on-background': '#dae2fd',
        'on-surface-variant': '#d4c5ab',
        outline: {
          DEFAULT: '#9c8f78',
          variant: '#4f4632',
        },
        error: {
          DEFAULT: '#ffb4ab',
          container: '#93000a',
        },
        'on-error': '#690005',
        'on-error-container': '#ffdad6',
        'inverse-surface': '#dae2fd',
        'inverse-on-surface': '#283044',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"Roboto Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // §3 Typography
        'display-lg': ['48px', { lineHeight: '56px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-lg': ['32px', { lineHeight: '40px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'headline-lg-mobile': ['28px', { lineHeight: '36px', fontWeight: '600' }],
        'title-md': ['20px', { lineHeight: '28px', fontWeight: '600' }],
        'body-lg': ['18px', { lineHeight: '28px', fontWeight: '400' }],
        'body-md': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'label-md': ['14px', { lineHeight: '20px', letterSpacing: '0.01em', fontWeight: '500' }],
        'label-sm': ['12px', { lineHeight: '16px', letterSpacing: '0.02em', fontWeight: '500' }],
      },
      spacing: {
        // §4.1 Spacing scale aliases (Tailwind defaults already cover px values)
        unit: '4px',
        gutter: '24px',
      },
      borderRadius: {
        // §4.2 Radius
        DEFAULT: '4px',
        lg: '8px',
        xl: '12px',
        '2xl': '16px',
        full: '9999px',
      },
      boxShadow: {
        // §6 component glows / layering
        'layer-1': '0 2px 8px rgba(0,0,0,0.35)',
        primary: '0 4px 14px rgba(255,193,7,0.3)',
        'nav-active': '0 0 15px rgba(255,193,7,0.2)',
        'focus-amber': '0 0 8px rgba(255,193,7,0.15)',
      },
      dropShadow: {
        'glow-amber': '0 0 8px rgba(255,193,7,0.3)',
        'glow-orange': '0 0 8px rgba(255,183,122,0.3)',
      },
      keyframes: {
        'subtle-glow': {
          '0%, 100%': { filter: 'drop-shadow(0 0 4px rgba(255,193,7,0.4))' },
          '50%': { filter: 'drop-shadow(0 0 12px rgba(255,193,7,0.7))' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'subtle-glow': 'subtle-glow 3s ease-in-out infinite',
        shimmer: 'shimmer 2s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
