export interface AccountSwitchProfileSummary {
  profileId: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  roleName: string | null;
}

export interface AccountSwitchStoredSession {
  profileId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
}

export interface SavedAccountShortcut {
  profileId: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  roleName: string | null;
  encryptedSession: string;
  encryptionSalt: string;
  encryptionIv: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}
