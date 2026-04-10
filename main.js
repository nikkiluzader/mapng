import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import Tres from '@tresjs/core';
import { i18n, setI18nLanguage } from './i18n';
import 'leaflet/dist/leaflet.css';
import './style.css';

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
