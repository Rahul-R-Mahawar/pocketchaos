import { useAuth } from './auth/context';
import { AuthView } from './components/AuthView';
import { Dashboard } from './components/Dashboard';

export function App() {
  const { session } = useAuth();
  // Keyed by user so switching accounts never reuses another project's state.
  return session ? <Dashboard key={session.user.id} session={session} /> : <AuthView />;
}
