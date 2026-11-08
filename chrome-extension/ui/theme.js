// Theme of the NeuroLaudos IA page (passed in the URL), applied before the first paint.
(() => { const t = new URLSearchParams(location.search).get('theme'); if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t; })();
