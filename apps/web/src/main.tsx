import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import './styles/index.css';
import { queryClient } from './lib/query';
import { SessionProvider } from './lib/session';
import { TooltipProvider } from './components/ui';
import { router } from './router';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster
            position="bottom-right"
            toastOptions={{
              classNames: {
                toast: '!rounded-lg !border !border-line !bg-panel !text-ink !shadow-md !font-sans !text-[13px]',
                description: '!text-muted',
                actionButton: '!bg-ink !text-white',
              },
            }}
          />
        </TooltipProvider>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
