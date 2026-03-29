/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#376a22',
        'primary-light': '#4a8c2e',
        'primary-container': '#baf69c',
        secondary: '#4f6443',
        surface: '#f8faf0',
        'surface-dim': '#d9dbd1',
        'surface-container': '#edefe5',
        'surface-container-low': '#f2f5ea',
      },
    },
  },
  plugins: [],
};
