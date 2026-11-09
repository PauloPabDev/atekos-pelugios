// Aviso de éxito en una región role=status fija: el key (submittedAt) hace que cada envío
// se anuncie y anime de nuevo, y se desvanece a los 3 s
export function Status({ m, text }: { m: { isSuccess: boolean; submittedAt: number }; text: string }) {
	return (
		<span role="status" className="inline-flex text-sm font-medium text-success-fg">
			{m.isSuccess && (
				<span
					key={m.submittedAt}
					className="inline-flex animate-[fade-in_160ms_ease-out,fade-out_400ms_ease_3s_forwards] items-center gap-1.5"
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth={2}
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M5 12.5l4.5 4.5L19 7.5" />
					</svg>
					{text}
				</span>
			)}
		</span>
	)
}
