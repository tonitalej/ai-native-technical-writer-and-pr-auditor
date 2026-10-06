import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="panel stack">
      <p className="kicker">404</p>
      <h1>Not found</h1>
      <p className="muted">That page does not exist, or it belongs to someone else.</p>
      <Link to="/repositories">Back to repositories</Link>
    </section>
  );
}
