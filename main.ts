import { createApp } from 'vue';
import App from './App.vue';
import Tres from '@tresjs/core';
import 'leaflet/dist/leaflet.css';
import './style.css';

const app = createApp(App);
app.use(Tres);
app.mount('#root');
