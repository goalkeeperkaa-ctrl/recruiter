import { z } from "zod";
import type { DbClient } from "../lib/db.js";
import { newId } from "../lib/db.js";

const createJobSchema = z.object({
  title: z.string().min(2),
  status: z.enum(["draft", "active", "paused", "archived"]).default("draft"),
  workFormat: z.enum(["office", "remote", "hybrid"]),
  employmentType: z.enum(["full_time", "part_time", "project", "internship"]),
  publicSlug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  descriptionShort: z.string().max(500).optional(),
});

const updateJobSchema = z.object({
  title: z.string().min(2).optional(),
  status: z.enum(["draft", "active", "paused", "archived"]).optional(),
  descriptionShort: z.string().max(500).optional(),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;
export type UpdateJobInput = z.infer<typeof updateJobSchema>;

export function parseCreateJobInput(input: unknown): CreateJobInput {
  return createJobSchema.parse(input);
}

export function parseUpdateJobInput(input: unknown): UpdateJobInput {
  return updateJobSchema.parse(input);
}

export interface JobRecord {
  id: string;
  tenantId: string;
  title: string;
  status: "draft" | "active" | "paused" | "archived";
  publicSlug: string;
  workFormat: string;
  employmentType: string;
  descriptionShort: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicJobRecord {
  id: string;
  tenantId: string;
  tenantSlug: string;
  publicSlug: string;
  title: string;
  descriptionShort: string | null;
  status: string;
}

export interface JobsRepo {
  create(tenantId: string, ownerUserId: string, input: CreateJobInput): Promise<JobRecord>;
  list(tenantId: string): Promise<JobRecord[]>;
  findById(tenantId: string, jobId: string): Promise<JobRecord | null>;
  update(tenantId: string, jobId: string, patch: UpdateJobInput): Promise<JobRecord | null>;
  findPublic(tenantSlug: string, publicSlug: string): Promise<PublicJobRecord | null>;
}

function mapJobRow(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    title: String(row.title),
    status: row.status as JobRecord["status"],
    publicSlug: String(row.public_slug),
    workFormat: String(row.work_format),
    employmentType: String(row.employment_type),
    descriptionShort: (row.description_short as string | null) ?? null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export class PgJobsRepo implements JobsRepo {
  public constructor(private readonly db: DbClient) {}

  public async create(tenantId: string, ownerUserId: string, input: CreateJobInput): Promise<JobRecord> {
    const now = new Date();
    const id = newId();

    const result = await this.db.query(
      `insert into jobs (
          id, tenant_id, title, work_format, employment_type, status, public_slug, description_short, owner_user_id, created_at, updated_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
        returning *`,
      [
        id,
        tenantId,
        input.title,
        input.workFormat,
        input.employmentType,
        input.status,
        input.publicSlug,
        input.descriptionShort ?? null,
        ownerUserId,
        now,
      ],
    );

    return mapJobRow(result.rows[0]);
  }

  public async list(tenantId: string): Promise<JobRecord[]> {
    const result = await this.db.query(
      `select *
       from jobs
       where tenant_id = $1
       order by created_at desc`,
      [tenantId],
    );

    return result.rows.map(mapJobRow);
  }

  public async findById(tenantId: string, jobId: string): Promise<JobRecord | null> {
    const result = await this.db.query(
      `select *
       from jobs
       where tenant_id = $1
         and id = $2
       limit 1`,
      [tenantId, jobId],
    );

    if (result.rowCount !== 1) {
      return null;
    }

    return mapJobRow(result.rows[0]);
  }

  public async update(tenantId: string, jobId: string, patch: UpdateJobInput): Promise<JobRecord | null> {
    const current = await this.findById(tenantId, jobId);
    if (!current) {
      return null;
    }

    const result = await this.db.query(
      `update jobs
       set title = $3,
           status = $4,
           description_short = $5,
           updated_at = $6
       where tenant_id = $1
         and id = $2
       returning *`,
      [
        tenantId,
        jobId,
        patch.title ?? current.title,
        patch.status ?? current.status,
        patch.descriptionShort ?? current.descriptionShort,
        new Date(),
      ],
    );

    return mapJobRow(result.rows[0]);
  }

  public async findPublic(tenantSlug: string, publicSlug: string): Promise<PublicJobRecord | null> {
    const result = await this.db.query(
      `select
         j.id,
         j.tenant_id,
         t.slug as tenant_slug,
         j.public_slug,
         j.title,
         j.description_short,
         j.status
       from jobs j
       join tenants t on t.id = j.tenant_id
       where t.slug = $1
         and j.public_slug = $2
       limit 1`,
      [tenantSlug, publicSlug],
    );

    if (result.rowCount !== 1) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      tenantSlug: String(row.tenant_slug),
      publicSlug: String(row.public_slug),
      title: String(row.title),
      descriptionShort: (row.description_short as string | null) ?? null,
      status: String(row.status),
    };
  }
}
