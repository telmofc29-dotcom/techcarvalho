export function SearchBox({ action, placeholder, defaultValue }: { action: string; placeholder: string; defaultValue?: string }) {
  return (
    <form action={action} method="get" className="mb-4">
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full max-w-sm border border-neutral-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/20 focus:border-neutral-400 bg-white"
      />
    </form>
  );
}
