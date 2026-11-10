import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { PdeApp } from './ui/PdeApp';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root is missing');
}

createRoot(root).render(
  <StrictMode>
    <PdeApp />
  </StrictMode>,
);
