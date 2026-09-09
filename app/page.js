sed: --: No such file or directory
import Link from "next/link";

export default function Home() {
  return (
    <main className="center-shell">
      <div className="brand-mark">HEY NOW</div>
      <h1>Event Registry</h1>
      <p className="muted">Internal event curation and ingestion operations for El Paso.</p>
      <Link className="button" href="/admin/events">Open registry</Link>
    </main>
  );
}
