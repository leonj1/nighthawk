export default function Home() {
  return (
    <main className="landing-page">
      <section className="login-card" aria-labelledby="welcome-heading">
        <div className="brand-mark" aria-hidden="true">
          N
        </div>
        <div className="copy">
          <p className="eyebrow">Nighthawk</p>
          <h1 id="welcome-heading">Welcome back</h1>
          <p>Sign in to view your platform status.</p>
        </div>
        <button className="login-button" type="button">
          Log in
        </button>
      </section>
    </main>
  );
}
