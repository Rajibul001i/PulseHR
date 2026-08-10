import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { store } from './store';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      {/* BASE_URL is '/' for normal dev/build, or the --base flag's value for a subpath
          deployment (e.g. the GitHub Pages demo at /PulseHR/app/) -- without matching it
          here, every in-app link would resolve against the wrong root. */}
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </Provider>
  </StrictMode>,
);
