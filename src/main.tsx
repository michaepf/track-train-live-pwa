import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistration().then((registration) => {
    if (registration) {
      setInterval(() => registration.update(), 60 * 60 * 1000)
    }
  })
}
