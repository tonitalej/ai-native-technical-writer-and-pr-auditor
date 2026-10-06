export function ConfigError({ problems }: { problems: string[] }) {
  return (
    <main className="panel config-error stack">
      <p className="kicker">Configuration</p>
      <h1>The app is missing its environment</h1>
      <p className="muted">
        Copy <code>.env.example</code> to <code>.env</code> and fill in the public Supabase URL, the publishable
        key, and the API URL. Do not put secret keys in the frontend.
      </p>
      <ul>
        {problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
    </main>
  );
}
