import Link from "next/link";

export default function Home() {
  return (
    <main className="center-shell">
      <div className="brand-mark">HEY NOW</div>
      <h1>Source Registry</h1>
      <p className="muted">Internal ingestion operations for El Paso.</p>
      <Link className="button" href="/admin/sources">Open registry</Link>
    </main>
  );
}
