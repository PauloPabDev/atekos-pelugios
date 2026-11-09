import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router'
import type { User } from '@atekos/shared'
import * as api from './api'
import { BrandMark, Icon, type IconName } from './components/Icon'
import { Login, Register } from './pages/Auth'
import { Authorize } from './pages/Authorize'
import { Contract } from './pages/Contract'
import { Devices } from './pages/Devices'
import { DeviceDetail } from './pages/DeviceDetail'
import { Displays } from './pages/Displays'
import { DisplayDetail } from './pages/DisplayDetail'
import { Tokens } from './pages/Tokens'
import { PublicDevice } from './pages/PublicDevice'

export function App() {
	return (
		<Routes>
			<Route path="/login" element={<Login />} />
			<Route path="/register" element={<Register />} />
			<Route element={<Open />}>
				<Route path="/p/:id" element={<PublicDevice />} />
				<Route path="/contrato" element={<Contract />} />
				<Route path="*" element={<NotFound />} />
			</Route>
			<Route element={<Session />}>
				<Route index element={<Devices />} />
				<Route path="/devices/:id" element={<DeviceDetail />} />
				<Route path="/displays" element={<Displays />} />
				<Route path="/displays/:deviceId" element={<DisplayDetail />} />
				<Route path="/tokens" element={<Tokens />} />
				<Route path="/autorizar" element={<Authorize />} />
			</Route>
		</Routes>
	)
}

const TABS: [to: string, label: string, icon: IconName][] = [
	['/', 'Dispositivos', 'bulb'],
	['/displays', 'Pantallas', 'screen'],
	['/tokens', 'Tokens', 'key'],
	['/contrato', 'Contrato', 'doc'],
]

// Marco común: marca, pestañas (abajo en el móvil, a la izquierda en escritorio) y salir
function Shell({ user, nav = true }: { user?: User; nav?: boolean }) {
	const qc = useQueryClient()
	const navigate = useNavigate()
	const logout = useMutation({
		mutationFn: api.logout,
		onSuccess: () => {
			qc.removeQueries()
			navigate('/login')
		},
	})
	const tabs = !!user && nav

	return (
		<div className={tabs ? 'app has-nav' : 'app'}>
			<header className="topbar">
				<Link to="/" className="brand">
					<BrandMark />
				</Link>
				{tabs && (
					<nav aria-label="Principal" className="tabs">
						{TABS.map(([to, label, icon]) => (
							<NavLink key={to} to={to} end={to === '/'}>
								<Icon name={icon} />
								{label}
							</NavLink>
						))}
					</nav>
				)}
				<div className="who">
					{user ? (
						<>
							<span className="user-chip">{user.username}</span>
							<button type="button" className="ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
								Salir
							</button>
						</>
					) : (
						<Link to="/" className="button primary">
							Entrar
						</Link>
					)}
				</div>
			</header>
			<main className="page">
				{logout.error && (
					<p role="alert" className="error">
						{logout.error.message}
					</p>
				)}
				<Outlet />
			</main>
		</div>
	)
}

// Rutas protegidas: sin sesión (/auth/me → 401) redirige a /login?next=<ruta> para volver tras entrar
function Session() {
	const { pathname, search } = useLocation()
	const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false })

	if (me.isPending)
		return (
			<main className="auth">
				<p className="loading">Cargando…</p>
			</main>
		)
	if (me.error instanceof api.HttpError && me.error.status === 401)
		return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />
	if (me.error)
		return (
			<main className="auth">
				<div className="auth-box stack">
					<p role="alert" className="error">
						No se pudo cargar la sesión: {me.error.message}
					</p>
					<button type="button" className="primary" onClick={() => me.refetch()} disabled={me.isFetching}>
						Reintentar
					</button>
				</div>
			</main>
		)

	// El consentimiento OAuth va sin pestañas: es un paso de un flujo, no una sección
	return <Shell user={me.data} nav={pathname !== '/autorizar'} />
}

// Páginas públicas (contrato, vista pública, 404): no piden /auth/me, solo leen la sesión ya cacheada;
// sin ella se ven con «Entrar», que va a / y de ahí al login solo si de verdad no hay sesión
function Open() {
	const me = useQuery({ queryKey: ['me'], queryFn: api.me, enabled: false })
	return <Shell user={me.data} />
}

function NotFound() {
	return (
		<div className="empty">
			<span className="tile pink">
				<Icon name="spark" size={32} />
			</span>
			<h1>Página no encontrada</h1>
			<p className="muted">El enlace está roto o la página ya no existe.</p>
			<Link to="/" className="button primary">
				Ir a mis dispositivos
			</Link>
		</div>
	)
}
