/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 浅色系语义令牌（4 色相：中性灰 + 强调蓝 + 柔和红 + 柔和绿）
        viaim: {
          bg: '#F6F7F9',
          card: '#FFFFFF',
          cardHover: '#F1F3F7',
          border: '#E4E7EC',
          borderLight: '#EEF1F5',
          primary: '#4F6BEB',
          primaryHover: '#3D57D1',
          cyan: '#6E8BF0',
          emerald: '#4E9B7B',
          amber: '#B5704E',
          textMain: '#1F2937',
          textMuted: '#5A6473',
          textDim: '#8A93A5',
        },

        // 中性色阶：为适配浅色主题做了明度反转
        // （原先的深色背景 bg-slate-900 → 浅色，原先的浅色文字 text-slate-200 → 深色）
        slate: {
          50: '#0B1220',
          100: '#111827',
          200: '#1F2937',
          300: '#374151',
          400: '#5A6473',
          500: '#818A9C',
          600: '#C3CAD5',
          700: '#DAE0E8',
          800: '#EDF1F6',
          900: '#F5F7FA',
          950: '#FFFFFF',
        },

        // 强调蓝（唯一允许较高饱和度的色相）—— indigo / cyan / purple 统一折叠到该色相
        indigo: {
          50: '#EEF3FF',
          100: '#E1E8FE',
          200: '#C6D3FB',
          300: '#4C66DE',
          400: '#4F6BEB',
          500: '#4F6BEB',
          600: '#3D57D1',
          700: '#3349BE',
          800: '#2A3CA0',
          900: '#EDF1FE',
          950: '#F5F7FF',
        },
        cyan: {
          50: '#EEF6FF',
          100: '#E0EBFE',
          200: '#C4D8FB',
          300: '#4A6ED9',
          400: '#4F6BEB',
          500: '#4F6BEB',
          600: '#3D57D1',
          700: '#3349BE',
          800: '#2A3CA0',
          900: '#EEF2FE',
          950: '#F5F7FF',
        },
        purple: {
          50: '#EEF3FF',
          100: '#E1E8FE',
          200: '#C6D3FB',
          300: '#4C66DE',
          400: '#4F6BEB',
          500: '#4F6BEB',
          600: '#3D57D1',
          700: '#3349BE',
          800: '#2A3CA0',
          900: '#EDF1FE',
          950: '#F5F7FF',
        },

        // 柔和绿（成功语义，低饱和度）
        emerald: {
          50: '#EFF7F2',
          100: '#DCEFE4',
          200: '#B9DECA',
          300: '#5FAA88',
          400: '#55A283',
          500: '#4E9B7B',
          600: '#3F8163',
          700: '#356B52',
          800: '#2C5944',
          900: '#2A4E3D',
          950: '#ECF5F0',
        },

        // 柔和红（危险语义，低饱和度）
        red: {
          50: '#FBEFEF',
          100: '#F6DCDC',
          200: '#EEBEBE',
          300: '#CE7C7C',
          400: '#C86A6A',
          500: '#C25E5E',
          600: '#A94E4E',
          700: '#8E4141',
          800: '#743636',
          900: '#5E2C2C',
          950: '#FBEDED',
        },

        // 暖色警示（并入红色相族，降低饱和度）
        amber: {
          50: '#FAF3EC',
          100: '#F4E6D9',
          200: '#E7CDB6',
          300: '#C99A76',
          400: '#BE8557',
          500: '#B5704E',
          600: '#9C5E40',
          700: '#824D35',
          800: '#673D2A',
          900: '#523122',
          950: '#F8EFE8',
        },
      },
      boxShadow: {
        'glow-primary': '0 4px 14px -4px rgba(79, 107, 235, 0.35)',
        'glow-cyan': '0 4px 14px -4px rgba(110, 139, 240, 0.30)',
        'glow-red': '0 4px 14px -4px rgba(194, 94, 94, 0.30)',
      },
      animation: {
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'wave': 'wave 1.2s ease-in-out infinite',
      },
      keyframes: {
        wave: {
          '0%, 100%': { height: '4px' },
          '50%': { height: '24px' },
        }
      }
    },
  },
  plugins: [],
}
