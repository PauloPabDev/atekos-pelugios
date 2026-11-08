import type { SessionStore } from '../domain/ports'

export class Logout {
	constructor(private readonly deps: { sessions: SessionStore }) {}

	execute(sid: string) {
		return this.deps.sessions.delete(sid)
	}
}
