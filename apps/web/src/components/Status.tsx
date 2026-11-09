// Aviso de éxito en una región role=status fija: el key (submittedAt) hace que cada envío
// se anuncie y anime de nuevo; el CSS lo desvanece a los 3 s
export function Status({ m, text }: { m: { isSuccess: boolean; submittedAt: number }; text: string }) {
	return (
		<span role="status" className="toast">
			{m.isSuccess && <span key={m.submittedAt}>{text}</span>}
		</span>
	)
}
