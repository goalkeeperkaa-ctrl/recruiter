export type UserRole =
  | "owner"
  | "admin_hr"
  | "recruiter"
  | "hiring_manager"
  | "interviewer"
  | "viewer";

export interface AuthUser {
  id: string;
  tenantId: string;
  tenantSlug: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  passwordHash: string | null;
}

export interface AuthContext {
  userId: string;
  tenantId: string;
  tenantSlug: string;
  role: UserRole;
}
