import './styles.css';
import { RiftForgeApp } from './ui/App';

const root = document.querySelector<HTMLElement>('#app');

if (root === null) {
  throw new Error('Rift Forge could not find its application root.');
}

const app = new RiftForgeApp(root);
app.start();

window.addEventListener('beforeunload', () => app.destroy(), { once: true });
