// Seed phrase grid (BRAND §6.9): 3-col grid of numbered slots.
export function SeedGrid({ words }: { words: string[] }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {words.map((word, i) => (
        <div
          key={i}
          className="flex items-center gap-1.5 rounded-lg bg-surface-container-highest px-2.5 py-2"
        >
          <span className="text-label-sm text-outline">{i + 1}.</span>
          <span className="font-mono text-label-md text-on-surface">{word}</span>
        </div>
      ))}
    </div>
  );
}
