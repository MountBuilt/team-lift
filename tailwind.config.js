// One-off compiled Tailwind (replaces the render-blocking Play CDN).
// Rebuild after adding new utility classes:
//   npx tailwindcss@3.4.17 -i css/tailwind.source.css -o css/tailwind.css --minify
module.exports = {
  content: ['./index.html', './js/**/*.js'],
  theme: {
    extend: {
      colors: {
        ink: '#0f0f0f',
        card: '#1a1a1a',
        edge: '#2a2a2a',
        accent: '#f97316',
        accentDim: '#c2410c'
      }
    }
  }
};
