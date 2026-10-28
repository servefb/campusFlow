import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './app/App'
import { useSessionStore } from './stores/session'
import './styles/base.css'
import './styles/admin.css'
import './styles/pages.css'
import './styles/login.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

useSessionStore.getState().hydrate()
window.addEventListener('campusflow:auth-expired', () => useSessionStore.getState().logout())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
