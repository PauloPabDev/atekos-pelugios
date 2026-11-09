import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// La base va antes que App: el CSS de cada página se carga después y puede afinarla
import './styles.css'
import { App } from './App'
import { HttpError } from './api'

// Un 4xx no mejora reintentando (y un 404 de /p/:id debe verse al instante)
const qc = new QueryClient({
	defaultOptions: { queries: { retry: (n, e) => n < 2 && !(e instanceof HttpError && e.status < 500) } },
})

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<QueryClientProvider client={qc}>
			<BrowserRouter>
				<App />
			</BrowserRouter>
		</QueryClientProvider>
	</StrictMode>,
)
