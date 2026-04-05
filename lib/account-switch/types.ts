export interface AccountSwitchProfileSummary {
  profileId: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  roleName: string | null;
}

export interface AccountSwitchDeviceProfileSummary {
  profileId: string;
  fullName: string | null;
  avatarUrl: string | null;
  roleName: string | null;
  lastAuthenticatedAt: string | null;
}
