import type { Scope } from '@atekos/shared'

// Lo que concede cada scope, en claro (consentimiento OAuth y alta de tokens); Record obliga a cubrir SCOPES entero
export const SCOPE_TEXT: Record<Scope, string> = {
	'devices:read': 'Ver tus dispositivos',
	'devices:write': 'Crear dispositivos y cambiar su estado y sus datos',
	'telemetry:write': 'Enviar lecturas de sensores',
	'display:connect': 'Conectar una pantalla MetaDisplay (va dentro de la pantalla)',
	'displays:write': 'Crear y administrar tus pantallas (plantillas y datos)',
}
