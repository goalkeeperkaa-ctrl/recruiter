import { z } from "zod";
import type { DbClient } from "../lib/db.js";
import { hashPassword } from "../lib/password.js";
import { newId } from "../lib/db.js";
import type { AuthUser, UserRole } from "../types/auth.js";

const bootstrapSchema = z.object({
  tenantName: z.string().min(2),
  tenantSlug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  email: z.string().email(),
  fullName: z.string().min(2),
  password: z.string().min(8),
});

const loginSchema = z.object({
  tenantSlug: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

export type BootstrapInput = z.infer<typeof bootstrapSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export function parseBootstrapInput(input: unknown): BootstrapInput {
  return bootstrapSchema.parse(input);
}

export function parseLoginInput(input: unknown): LoginInput {
  return loginSchema.parse(input);
}

export interface BootstrapResult {
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  user: AuthUser;
}

export interface AuthRepo {
  bootstrapTenantOwner(input: BootstrapInput): Promise<BootstrapResult>;
  findByCredentials(input: LoginInput): Promise<AuthUser | null>;
}

export class PgAuthRepo implements AuthRepo {
  public constructor(private readonly db: DbClient) {}

  public async bootstrapTenantOwner(input: BootstrapInput): Promise<BootstrapResult> {
    const tenantId = newId();
    const userId = newId();
    const now = new Date();
    const passwordHash = await hashPassword(input.password);

    const client = await this.db.connect();

    try {
      await client.query("begin");
      await client.query(
        `insert into tenants (id, name, slug, timezone, locale, created_at, updated_at)
         values ($1, $2, $3, 'UTC', 'ru-RU', $4, $4)`,
        [tenantId, input.tenantName, input.tenantSlug, now],
      );

      await client.query(
        `insert into users (id, tenant_id, email, password_hash, full_name, role, is_active, created_at, updated_at)
         values ($1, $2, $3, $4, $5, 'owner', true, $6, $6)`,
        [userId, tenantId, input.email.toLowerCase(), passwordHash, input.fullName, now],
      );

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    return {
      tenant: {
        id: tenantId,
        name: input.tenantName,
        slug: input.tenantSlug,
      },
      user: {
        id: userId,
        tenantId,
        tenantSlug: input.tenantSlug,
        email: input.email.toLowerCase(),
        fullName: input.fullName,
        role: "owner",
        isActive: true,
        passwordHash,
      },
    };
  }

  public async findByCredentials(input: LoginInput): Promise<AuthUser | null> {
    const result = await this.db.query(
      `select
         u.id,
         u.tenant_id,
         t.slug as tenant_slug,
         u.email,
         u.full_name,
         u.role,
         u.is_active,
         u.password_hash
       from users u
       join tenants t on t.id = u.tenant_id
       where t.slug = $1
         and u.email = $2
       limit 1`,
      [input.tenantSlug, input.email.toLowerCase()],
    );

    if (result.rowCount !== 1) {
      return null;
    }

    const row = result.rows[0];

    return {
      id: row.id,
      tenantId: row.tenant_id,
      tenantSlug: row.tenant_slug,
      email: row.email,
      fullName: row.full_name,
      role: row.role as UserRole,
      isActive: row.is_active,
      passwordHash: row.password_hash,
    };
  }
}
