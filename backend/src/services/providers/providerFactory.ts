import type { GitProviderName } from '../../types/domain.js';
import { AppError } from '../../utils/errors.js';
import type { GitHubProvider } from '../github/githubProvider.js';
import type { GitProvider } from './gitProvider.js';

export interface ProviderFactory {
  getProvider(provider: GitProviderName): GitProvider;
}

export function createProviderFactory(github: GitHubProvider): ProviderFactory {
  return {
    getProvider(provider: GitProviderName): GitProvider {
      if (provider === 'github') {
        return github;
      }
      throw new AppError(422, 'PROVIDER_UNSUPPORTED', 'This version only supports GitHub repositories.');
    },
  };
}
