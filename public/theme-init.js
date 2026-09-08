try {
  document.documentElement.dataset.theme = localStorage.getItem('clyvora-theme') === 'light' ? 'light' : 'dark';
} catch {
  document.documentElement.dataset.theme = 'dark';
}
