export interface BrowserInfo {
  name: string;
  executablePath: string;
}

export interface BrowserProfile {
  profileName: string;
  profilePath: string;
  displayName: string;
  browser: BrowserInfo;
}

export interface LocalStateProfile {
  name: string;
}

export type SameSitePolicy = "Strict" | "Lax" | "None";

export interface ProfileCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: SameSitePolicy;
}

export interface ExtractProfileOptions {
  profile: BrowserProfile;
  port?: number;
}

export interface ExtractProfileResult {
  cookies: ProfileCookie[];
  warnings: string[];
}

export interface CdpRawCookie {
  domain: string;
  name: string;
  value: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  priority: string;
  sourceScheme: string;
  sourcePort: number;
  sameParty: boolean;
  partitionKey?: string;
  url?: string;
}

export interface CdpResponse {
  id: number;
  error?: {
    code: number;
    message: string;
  };
  result?: {
    cookies: CdpRawCookie[];
  };
}
