import releaseVersionState from '@/lib/config/release-version.json';
import { formatReleaseVersion } from '@/lib/config/release-version-logic';
import type { ReleaseVersionState } from '@/lib/config/release-version-logic';

export function getReleaseVersionState(): ReleaseVersionState {
  return releaseVersionState as ReleaseVersionState;
}

export function getPublicReleaseVersion(): string {
  const bakedVersion = process.env.NEXT_PUBLIC_APP_RELEASE_VERSION?.trim();
  if (bakedVersion) {
    return bakedVersion;
  }

  if (process.env.NODE_ENV === 'development') {
    return formatReleaseVersion(getReleaseVersionState());
  }

  return 'local';
}

export function getPublicReleaseVersionLabel(): string {
  return `Version ${getPublicReleaseVersion()}`;
}
