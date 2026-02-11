import { hashPassword, verifyPassword } from "../lib/password.js";
import type { AuthRepo, BootstrapInput, BootstrapResult, LoginInput } from "./auth-repo.js";
import type { AuthUser } from "../types/auth.js";
import type { CreateJobInput, JobRecord, JobsRepo, PublicJobRecord, UpdateJobInput } from "./jobs-repo.js";
import { newId } from "../lib/db.js";

interface Tenant {
  id: string;
  name: string;
  slug: string;
}

export class MemoryAuthRepo implements AuthRepo {
  private readonly tenants = new Map<string, Tenant>();
  private readonly usersByTenantAndEmail = new Map<string, AuthUser>();

  public async bootstrapTenantOwner(input: BootstrapInput): Promise<BootstrapResult> {
    if (this.tenants.has(input.tenantSlug)) {
      throw new Error("tenant_slug_exists");
    }

    const tenant: Tenant = {
      id: newId(),
      name: input.tenantName,
      slug: input.tenantSlug,
    };

    const passwordHash = await hashPassword(input.password);
    const user: AuthUser = {
      id: newId(),
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      email: input.email.toLowerCase(),
      fullName: input.fullName,
      role: "owner",
      isActive: true,
      passwordHash,
    };

    this.tenants.set(tenant.slug, tenant);
    this.usersByTenantAndEmail.set(this.key(tenant.slug, user.email), user);

    return { tenant, user };
  }

  public async findByCredentials(input: LoginInput): Promise<AuthUser | null> {
    const user = this.usersByTenantAndEmail.get(this.key(input.tenantSlug, input.email.toLowerCase()));
    if (!user?.passwordHash) {
      return null;
    }

    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      return null;
    }

    return user;
  }

  private key(tenantSlug: string, email: string): string {
    return `${tenantSlug}:${email}`;
  }
}

export class MemoryJobsRepo implements JobsRepo {
  private readonly jobs = new Map<string, JobRecord>();

  public async create(tenantId: string, _ownerUserId: string, input: CreateJobInput): Promise<JobRecord> {
    const now = new Date().toISOString();

    const job: JobRecord = {
      id: newId(),
      tenantId,
      title: input.title,
      status: input.status,
      publicSlug: input.publicSlug,
      workFormat: input.workFormat,
      employmentType: input.employmentType,
      descriptionShort: input.descriptionShort ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(job.id, job);
    return job;
  }

  public async list(tenantId: string): Promise<JobRecord[]> {
    return [...this.jobs.values()].filter((job) => job.tenantId === tenantId);
  }

  public async findById(tenantId: string, jobId: string): Promise<JobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job || job.tenantId !== tenantId) {
      return null;
    }

    return job;
  }

  public async update(tenantId: string, jobId: string, patch: UpdateJobInput): Promise<JobRecord | null> {
    const job = await this.findById(tenantId, jobId);
    if (!job) {
      return null;
    }

    const next: JobRecord = {
      ...job,
      title: patch.title ?? job.title,
      status: patch.status ?? job.status,
      descriptionShort: patch.descriptionShort ?? job.descriptionShort,
      updatedAt: new Date().toISOString(),
    };

    this.jobs.set(jobId, next);
    return next;
  }

  public async findPublic(tenantSlug: string, publicSlug: string): Promise<PublicJobRecord | null> {
    const job = [...this.jobs.values()].find((item) => item.publicSlug === publicSlug);
    if (!job) {
      return null;
    }

    return {
      id: job.id,
      tenantId: job.tenantId,
      tenantSlug,
      publicSlug: job.publicSlug,
      title: job.title,
      descriptionShort: job.descriptionShort,
      status: job.status,
    };
  }
}
