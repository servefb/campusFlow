import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './app/App'
import { useAuthStore } from './stores/auth'
import './styles/global.css'
import './styles/pages.css'
import './styles/knowledge.css'
import './styles/workspace.css'
import './styles/home.css'
import './styles/news.css'
import './styles/courses.css'
import './styles/tasks.css'
import './styles/history.css'
import './styles/admin.css'
import './styles/settings.css'
import './styles/login-redesign.css'
import './styles/landing.css'
import './styles/shell.css'
import './styles/glass.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })
useAuthStore.getState().hydrate()
window.addEventListener('campusflow:auth-expired', () => useAuthStore.getState().clearSession())

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><App /></QueryClientProvider></React.StrictMode>)
