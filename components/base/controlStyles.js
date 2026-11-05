// Shared form-control styling so every dropdown and checkbox across the app
// looks identical (border, background, focus ring, rounding, disabled state).
// Import the relevant constant and bind it with :class — bindings (v-model /
// :value / @change) stay on the element, so adopting this is purely visual.

const SELECT_BASE =
  'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 ' +
  'text-gray-900 dark:text-white cursor-pointer transition-colors ' +
  'focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

// Full-width form dropdown (default).
export const SELECT_MD = `w-full rounded-lg px-2 py-2 text-sm ${SELECT_BASE}`;
// Compact full-width dropdown for tight control rows.
export const SELECT_SM = `w-full rounded px-2 py-1.5 text-xs ${SELECT_BASE}`;
// Inline mini dropdown that sits next to a label (e.g. export option rows).
export const SELECT_XS = `rounded px-1.5 py-0.5 text-caption ${SELECT_BASE}`;

// Checkbox — orange accent, consistent hit size.
export const CHECKBOX =
  'accent-brand w-4 h-4 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
