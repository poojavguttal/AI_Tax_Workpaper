import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkpaperProvider } from './state/Workpaper.jsx';
import { App } from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <WorkpaperProvider>
      <App />
    </WorkpaperProvider>
  </StrictMode>,
);
