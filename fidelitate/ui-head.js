// Stilul comun (culorile The Flower Station). Se încarcă înaintea Tailwind în fiecare pagină.
window.tailwind = window.tailwind || {};
tailwind.config = {
  theme: {
    extend: {
      colors: { ink: '#111111', paper: '#FFFFFF', cream: '#F6F1EA', pink: '#E8B4B8', rose: '#C9727B', line: '#E4DCD2', muted: '#6B6560', ok: '#2F6B4F' },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
};
