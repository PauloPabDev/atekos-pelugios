import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router'
import * as api from './api'
import { Login, Register } from './pages/Auth'
import { Devices } from './pages/Devices'
import { DeviceDetail } from './pages/DeviceDetail'
import { Tokens } from './pages/Tokens'
import { PublicDevice } from './pages/PublicDevice'

export function App() {
	return (
		<Routes>
			<Route path="/login" element={<Login />} />
			<Route path="/register" element={<Register />} />
			<Route path="/p/:id" element={<PublicDevice />} />
			<Route element={<Session />}>
				<Route index element={<Devices />} />
				<Route path="/devices/:id" element={<DeviceDetail />} />
				<Route path="/tokens" element={<Tokens />} />
			</Route>
			<Route path="*" element={<main className="page">Página no encontrada.</main>} />
		</Routes>
	)
}

// Rutas protegidas: sin sesión (/auth/me → 401) redirige a /login
function Session() {
	const qc = useQueryClient()
	const navigate = useNavigate()
	const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false })
	const logout = useMutation({
		mutationFn: api.logout,
		onSuccess: () => {
			qc.removeQueries()
			navigate('/login')
		},
	})

	if (me.isPending) return <main className="page">Cargando…</main>
	if (me.error instanceof api.HttpError && me.error.status === 401) return <Navigate to="/login" replace />
	if (me.error)
		return (
			<main className="page">
				<p role="alert">No se pudo cargar la sesión: {me.error.message}</p>
			</main>
		)

	return (
		<>
			<header className="nav">
				<nav aria-label="Principal">
					<NavLink to="/" end>
						Dispositivos
					</NavLink>
					<NavLink to="/tokens">Tokens</NavLink>
				</nav>
				<span className="muted">{me.data.username}</span>
				<button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
					Salir
				</button>
			</header>
			<main className="page">
				{logout.error && <p role="alert">{logout.error.message}</p>}
				<Outlet />
			</main>
		</>
	)
}
