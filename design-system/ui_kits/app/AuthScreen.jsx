/* Edg3 UI Kit — Auth screen (login + signup). Recreated from app/login & app/signup */
const { Button: AuthBtn, Logo: AuthLogo, Card: AuthCard, Input: AuthInput, Orb: AuthOrb } = window.Edg3DesignSystem_b79f44;

function AuthScreen({ mode = 'signup', onComplete, onSwitch }) {
  const isSignup = mode === 'signup';
  const [form, setForm] = React.useState({ name: '', email: '', password: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit(e) {
    e.preventDefault();
    onComplete();
  }

  return (
    <div style={{ position: 'relative', minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 16px', background: 'var(--surface-page)', overflow: 'hidden' }}>
      <AuthOrb variant={1} />
      <AuthOrb variant={2} />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 448 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <AuthLogo size={30} eyebrow />
          <p style={{ marginTop: 12, fontSize: 14, color: 'var(--text-muted)' }}>
            {isSignup ? 'Create your account' : 'Welcome back'}
          </p>
        </div>

        <AuthCard padding={32}>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {isSignup && (
              <AuthInput label="Full name" placeholder="Your name" value={form.name} onChange={set('name')} required />
            )}
            <AuthInput label="Email" type="email" placeholder="you@example.com" value={form.email} onChange={set('email')} required />
            <AuthInput label="Password" type="password" placeholder={isSignup ? 'At least 8 characters' : 'Your password'} value={form.password} onChange={set('password')} required />
            <AuthBtn variant="primary" type="submit" fullWidth style={{ marginTop: 8 }}>
              {isSignup ? 'Create account' : 'Log in'}
            </AuthBtn>
          </form>
          <p style={{ textAlign: 'center', fontSize: 14, marginTop: 24, marginBottom: 0, color: 'var(--text-muted)' }}>
            {isSignup ? 'Already have an account? ' : "Don't have an account? "}
            <button onClick={onSwitch} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-accent)', fontSize: 14, fontFamily: 'inherit' }}>
              {isSignup ? 'Log in' : 'Sign up'}
            </button>
          </p>
        </AuthCard>
      </div>
    </div>
  );
}

window.AuthScreen = AuthScreen;
