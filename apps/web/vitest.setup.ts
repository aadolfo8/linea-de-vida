import { afterEach } from 'vitest';
import { queryClient } from './lib/query-client';

// Every test starts with an empty server-data cache.
afterEach(() => queryClient.clear());
