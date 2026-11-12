import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import Tres from '@tresjs/core';
import { i18n, setI18nLanguage } from './i18n';
// BeamNG.drive's UI fonts (bundled, so the desktop app needs no network):
// Noto Sans for text, Overpass for titles, Overpass Mono for numbers
import '@fontsource-variable/noto-sans';
import '@fontsource-variable/overpass';
import '@fontsource-variable/overpass-mono';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { installDataCache } from './services/dataCache.js';
import { watchForUpdates } from './services/appUpdate.js';

// map data downloads kept in the browser (services/dataCache.js): a second
// Generate, Preview or Export of an area reads them instead of the network
installDataCache();
// a page left open across a deploy is told so, before its missing parts fail (services/appUpdate.js)
watchForUpdates();

const originalConsoleWarn = console.warn.bind(console);
console.warn = (...args) => {
	const first = args[0];
	if (typeof first === 'string') {
		if (first.includes('[Vue warn]: provide() can only be used inside setup().')) return;
		if (first.includes('THREE.ColladaLoader: You are loading an asset with a Z-UP coordinate system.')) return;
	}
	originalConsoleWarn(...args);
};

const app = createApp(App);
const pinia = createPinia();

// Suppress a known third-party warning that does not impact app behavior.
app.config.warnHandler = (msg, instance, trace) => {
	if (typeof msg === 'string' && msg.includes('provide() can only be used inside setup().')) {
		return;
	}
	console.warn(msg, instance, trace);
};

app.use(pinia);
app.use(Tres);
app.use(i18n);

setI18nLanguage(i18n.global.locale.value);
app.mount('#root');
