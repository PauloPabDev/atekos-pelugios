import type { Actor } from '../modules/devices/domain/policy'
declare global {
	namespace Express {
		interface Request {
			actor: Actor
		}
	}
}
export {}
