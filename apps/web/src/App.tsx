import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router'
import type { User } from '@atekos/shared'
import * as api from './api'
import { BrandMark, Icon, type IconName } from './components/Icon'
import { Loading } from './components/ui'
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

// Marco común: barra lateral en escritorio; en el móvil, cabecera arriba y pestañas abajo (el pulgar llega)
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
	const { pathname } = useLocation()

	return (
		<div className={tabs ? 'min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]' : 'min-h-dvh'}>
			<header
				className={`sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface px-4 ${
					tabs ? 'lg:h-dvh lg:flex-col lg:items-stretch lg:gap-1 lg:border-r lg:border-b-0 lg:px-3 lg:py-5' : ''
				}`}
			>
				<Link to="/" className="flex items-center gap-2.5 rounded-md px-1 lg:mb-5">
					<BrandMark />
				</Link>
				{tabs && (
					<nav
						aria-label="Principal"
						className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface px-2 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] lg:static lg:flex lg:flex-col lg:gap-0.5 lg:border-0 lg:p-0"
					>
						{TABS.map(([to, label, icon]) => (
							<NavLink
								key={to}
								to={to}
								end={to === '/'}
								// El detalle de un dispositivo cuelga de «/», que necesita end para no casar con todo
								className={({ isActive }) =>
									`flex h-12 flex-col items-center justify-center gap-0.5 rounded-md text-[11px] font-medium transition-colors lg:h-9 lg:flex-row lg:justify-start lg:gap-2.5 lg:px-2.5 lg:text-sm ${
										isActive || (to === '/' && pathname.startsWith('/devices/'))
											? 'text-fg lg:bg-subtle'
											: 'text-fg-subtle hover:text-fg lg:text-fg-muted lg:hover:bg-subtle'
									}`
								}
							>
								<Icon name={icon} size={20} />
								{label}
							</NavLink>
						))}
					</nav>
				)}
				<div
					className={`ml-auto flex items-center gap-2 ${tabs ? 'lg:mt-auto lg:ml-0 lg:border-t lg:border-line lg:pt-3' : ''}`}
				>
					{user ? (
						<>
							<span className="flex min-w-0 items-center gap-2 text-sm font-medium lg:flex-1 lg:px-1">
								<span
									aria-hidden="true"
									className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand-hover"
								>
									{user.username.slice(0, 1).toUpperCase()}
								</span>
								<span className="truncate">{user.username}</span>
							</span>
							<button
								type="button"
								className="btn btn-ghost"
								onClick={() => logout.mutate()}
								disabled={logout.isPending}
							>
								Salir
							</button>
						</>
					) : (
						<Link to="/" className="btn btn-primary">
							Entrar
						</Link>
					)}
				</div>
			</header>
			<main className={`mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10 ${tabs ? 'pb-28 lg:pb-12' : ''}`}>
				{logout.error && (
					<p role="alert" className="alert alert-error mb-4">
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
			<main className="grid min-h-dvh place-items-center">
				<Loading />
			</main>
		)
	if (me.error instanceof api.HttpError && me.error.status === 401)
		return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />
	if (me.error)
		return (
			<main className="grid min-h-dvh place-items-center px-4">
				<div className="card w-full max-w-sm space-y-4 p-6">
					<p role="alert" className="alert alert-error">
						No se pudo cargar la sesión: {me.error.message}
					</p>
					<button
						type="button"
						className="btn btn-primary w-full"
						onClick={() => me.refetch()}
						disabled={me.isFetching}
					>
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
		<div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
			<p className="font-mono text-sm text-fg-subtle">404</p>
			<h1 className="mt-2">Página no encontrada</h1>
			<p className="mt-2 text-sm text-fg-muted">El enlace está roto o la página ya no existe.</p>
			<Link to="/" className="btn btn-primary mt-6">
				Ir a mis dispositivos
			</Link>
		</div>
	)
}
