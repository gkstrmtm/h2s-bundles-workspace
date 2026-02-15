export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 6 }}>H2S Hub</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>One bookmark → everything.</p>

      <ul style={{ lineHeight: 1.9 }}>
        <li>
          <a href="/dash.html?tab=proofpacks">Proof Packs Dashboard</a>
        </li>
        <li>
          <a href="/dash.html?tab=pipeline">Hiring Dashboard</a>
        </li>
        <li>
          <a href="/funnel-track.html">Funnel Track</a>
        </li>
        <li>
          <a href="/portal.html">Portal</a>
        </li>
      </ul>

      <p style={{ opacity: 0.8 }}>
        API base: <code>/api/v1</code>
      </p>
    </main>
  )
}
