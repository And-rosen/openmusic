import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { installOpenMusicDebug } from './lib/debugTools';
import { installVisibilitySync } from './lib/visibilitySync';
import { applyPageSeo } from './lib/seo';
import { ensureSessionBootstrap } from './lib/sessionBootstrap';

installOpenMusicDebug();
installVisibilitySync();
applyPageSeo();
void ensureSessionBootstrap();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
