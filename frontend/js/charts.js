// Chart.js helpers bound to the SmartLib design tokens (validated CVD-safe palette).
import { loadScript, LIBS, inr } from './app.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export function palette() {
  return {
    c1: css('--chart-1'),
    c2: css('--chart-2'),
    c3: css('--chart-3'),
    grid: css('--chart-grid'),
    text: css('--text-2'),
    textStrong: css('--text'),
    card: css('--card'),
    gold: css('--gold'),
  };
}

export async function ensureChart() {
  await loadScript(LIBS.chart);
  const C = window.Chart;
  const p = palette();
  C.defaults.font.family = "'Inter', system-ui, sans-serif";
  C.defaults.font.size = 12;
  C.defaults.color = p.text;
  C.defaults.borderColor = p.grid;
  C.defaults.animation.duration = 900;
  C.defaults.animation.easing = 'easeOutQuart';
  C.defaults.plugins.legend.display = false;
  Object.assign(C.defaults.plugins.tooltip, {
    backgroundColor: css('--navy') || '#0f172a',
    titleColor: '#f8fafc',
    bodyColor: '#e2e8f0',
    borderColor: 'rgba(148,163,184,.25)',
    borderWidth: 1,
    padding: 10,
    cornerRadius: 10,
    displayColors: true,
    boxPadding: 4,
    usePointStyle: true,
  });
  return C;
}

const registry = new Map();
export function makeChart(canvas, config) {
  registry.get(canvas)?.destroy();
  const chart = new window.Chart(canvas, config);
  registry.set(canvas, chart);
  return chart;
}

export const axis = (p, { money = false, beginAtZero = true, stacked = false } = {}) => ({
  beginAtZero,
  stacked,
  grid: { color: p.grid, drawTicks: false },
  border: { display: false },
  ticks: { padding: 8, precision: 0, callback: money ? (v) => inr(v) : undefined },
});
export const xAxis = (p, stacked = false) => ({ stacked, grid: { display: false }, border: { color: p.grid }, ticks: { padding: 6 } });

export function onThemeChange(fn) {
  window.addEventListener('themechange', () => setTimeout(fn, 60));
}
