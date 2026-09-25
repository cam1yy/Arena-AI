import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation, useRouteError, isRouteErrorResponse, Link } from 'react-router';
import { useSession } from './lib/session';
import { AppShell } from './components/app/shell';
import { Button, EmptyState, Skeleton } from './components/ui';
import { Logo } from './components/app/logo';

const Landing = lazy(() => import('./pages/landing'));
const Auth = lazy(() => import('./pages/auth'));
const Legal = lazy(() => import('./pages/legal'));
const Onboarding = lazy(() => import('./pages/onboarding'));
const Dashboard = lazy(() => import('./pages/dashboard'));
const Discover = lazy(() => import('./pages/discover'));
const Prospects = lazy(() => import('./pages/prospects'));
const ProspectDetail = lazy(() => import('./pages/prospect-detail'));
const Campaigns = lazy(() => import('./pages/campaigns'));
const CampaignDetail = lazy(() => import('./pages/campaign-detail'));
const CampaignEditor = lazy(() => import('./pages/campaign-editor'));
const Templates = lazy(() => import('./pages/templates'));
const Composer = lazy(() => import('./pages/composer'));
const FollowUps = lazy(() => import('./pages/follow-ups'));
const Analytics = lazy(() => import('./pages/analytics'));
const InboxPage = lazy(() => import('./pages/inbox'));
const Integrations = lazy(() => import('./pages/integrations'));
const Billing = lazy(() => import('./pages/billing'));
const SettingsPage = lazy(() => import('./pages/settings'));
const Help = lazy(() => import('./pages/help'));
const Admin = lazy(() => import('./pages/admin'));
const DevMail = lazy(() => import('./pages/dev-mail'));

function PageFallback() {
  return (
    <div className="mx-auto max-w-[1200px] px-8 py-8" aria-busy="true">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="mt-3 h-4 w-80" />
      <div className="mt-8 grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    </div>
  );
}

function FullScreenLoader() {
  return (
    <div className="flex h-dvh items-center justify-center bg-canvas">
      <div className="animate-pulse">
        <Logo compact />
      </div>
    </div>
  );
}

const S = ({ children }: { children: ReactNode }) => <Suspense fallback={<PageFallback />}>{children}</Suspense>;

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!me) return <Navigate to={`/signin?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!me.user.onboardingCompleted && !location.pathname.startsWith('/onboarding')) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  const redirect = new URLSearchParams(location.search).get('redirect');
  if (me) return <Navigate to={redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/app'} replace />;
  return <>{children}</>;
}

function RouteError() {
  const err = useRouteError();
  const notFound = isRouteErrorResponse(err) && err.status === 404;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <EmptyState
        title={notFound ? 'Page not found' : 'Something went wrong'}
        description={notFound ? 'The page you are looking for does not exist or has moved.' : 'An unexpected error occurred while loading this page. Try reloading.'}
        action={
          <>
            <Button onClick={() => window.location.reload()}>Reload</Button>
            <Button variant="primary" asChild>
              <Link to="/app">Go to overview</Link>
            </Button>
          </>
        }
      />
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState
        title="Page not found"
        description="The page you are looking for does not exist or has moved."
        action={
          <Button variant="primary" asChild>
            <Link to="/">Go home</Link>
          </Button>
        }
      />
    </div>
  );
}

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <S><Landing /></S> },
      { path: '/privacy', element: <S><Legal doc="privacy" /></S> },
      { path: '/terms', element: <S><Legal doc="terms" /></S> },
      { path: '/cookies', element: <S><Legal doc="cookies" /></S> },
      { path: '/signin', element: <RedirectIfAuthed><S><Auth mode="signin" /></S></RedirectIfAuthed> },
      { path: '/signup', element: <RedirectIfAuthed><S><Auth mode="signup" /></S></RedirectIfAuthed> },
      { path: '/forgot-password', element: <S><Auth mode="forgot" /></S> },
      { path: '/reset-password', element: <S><Auth mode="reset" /></S> },
      { path: '/verify-email', element: <S><Auth mode="verify" /></S> },
      { path: '/recover', element: <S><Auth mode="recover" /></S> },
      { path: '/invite', element: <S><Auth mode="invite" /></S> },
      { path: '/dev/mail', element: <S><DevMail /></S> },
      { path: '/onboarding', element: <RequireAuth><S><Onboarding /></S></RequireAuth> },
      { path: '/admin/*', element: <RequireAuth><S><Admin /></S></RequireAuth> },
      {
        path: '/app',
        element: (
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <S><Dashboard /></S> },
          { path: 'discover', element: <S><Discover /></S> },
          { path: 'prospects', element: <S><Prospects /></S> },
          { path: 'prospects/:id', element: <S><ProspectDetail /></S> },
          { path: 'campaigns', element: <S><Campaigns /></S> },
          { path: 'campaigns/new', element: <S><CampaignEditor /></S> },
          { path: 'campaigns/:id', element: <S><CampaignDetail /></S> },
          { path: 'campaigns/:id/edit', element: <S><CampaignEditor /></S> },
          { path: 'templates', element: <S><Templates /></S> },
          { path: 'compose', element: <S><Composer /></S> },
          { path: 'follow-ups', element: <S><FollowUps /></S> },
          { path: 'analytics', element: <S><Analytics /></S> },
          { path: 'inbox', element: <S><InboxPage /></S> },
          { path: 'inbox/:id', element: <S><InboxPage /></S> },
          { path: 'integrations', element: <S><Integrations /></S> },
          { path: 'billing', element: <S><Billing /></S> },
          { path: 'settings', element: <S><SettingsPage /></S> },
          { path: 'settings/:section', element: <S><SettingsPage /></S> },
          { path: 'help', element: <S><Help /></S> },
          { path: '*', element: <NotFound /> },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export { Outlet };
