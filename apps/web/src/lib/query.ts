import { QueryClient, useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, errorMessage } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
        return count < 2;
      },
    },
    mutations: { retry: false },
  },
});

export function useApi<T>(key: readonly unknown[], path: string | null, options: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'> = {}) {
  return useQuery<T, ApiError>({
    queryKey: key,
    queryFn: ({ signal }) => api.get<T>(path!, { signal }),
    enabled: Boolean(path) && (options.enabled ?? true),
    ...options,
  });
}

/**
 * Mutation helper that shows a toast for errors, optionally for success, and
 * invalidates the given query keys.
 */
export function useAction<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: { success?: string | ((r: TResult, v: TVars) => string | null); invalidate?: readonly unknown[][]; onSuccess?: (r: TResult, v: TVars) => void; onError?: (e: ApiError) => void; silentError?: boolean } = {},
) {
  const qc = useQueryClient();
  return useMutation<TResult, ApiError, TVars>({
    mutationFn: fn,
    onSuccess: async (r, v) => {
      if (opts.invalidate) await Promise.all(opts.invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
      const msg = typeof opts.success === 'function' ? opts.success(r, v) : opts.success;
      if (msg) toast.success(msg);
      opts.onSuccess?.(r, v);
    },
    onError: (e) => {
      if (!opts.silentError) toast.error(errorMessage(e));
      opts.onError?.(e);
    },
  });
}
