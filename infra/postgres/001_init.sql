create extension if not exists citext;

create table if not exists tenants (
  id uuid primary key,
  name text not null,
  slug text not null unique,
  industry text,
  timezone text not null,
  locale text not null,
  brand_theme jsonb not null default '{}'::jsonb,
  legal_settings jsonb not null default '{}'::jsonb,
  data_retention_days int not null default 365,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists users (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  email citext not null,
  password_hash text,
  auth_provider text,
  auth_provider_id text,
  full_name text not null,
  role text not null,
  is_active bool not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, email)
);

create index if not exists idx_users_tenant_role on users(tenant_id, role);

create table if not exists flows (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  name text not null,
  type text not null,
  created_by uuid references users(id),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_flows_tenant_type on flows(tenant_id, type);

create table if not exists flow_versions (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  flow_id uuid not null references flows(id),
  version_number int not null,
  status text not null,
  published_at timestamptz,
  created_by uuid references users(id),
  definition jsonb not null,
  scoring_rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (flow_id, version_number)
);

create index if not exists idx_flow_versions_tenant_flow_status on flow_versions(tenant_id, flow_id, status);

create table if not exists jobs (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  title text not null,
  department text,
  location text,
  work_format text not null,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  employment_type text not null,
  status text not null,
  public_slug text not null,
  description_short text,
  description_full text,
  owner_user_id uuid references users(id),
  active_flow_version_id uuid references flow_versions(id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, public_slug)
);

create index if not exists idx_jobs_tenant_status on jobs(tenant_id, status);

create table if not exists flow_nodes (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  flow_version_id uuid not null references flow_versions(id),
  node_key text not null,
  node_type text not null,
  config jsonb not null default '{}'::jsonb,
  position jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  unique (flow_version_id, node_key)
);

create index if not exists idx_flow_nodes_tenant_flow_version on flow_nodes(tenant_id, flow_version_id);

create table if not exists flow_edges (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  flow_version_id uuid not null references flow_versions(id),
  from_node_key text not null,
  to_node_key text not null,
  condition jsonb,
  priority int not null default 0
);

create index if not exists idx_flow_edges_from on flow_edges(flow_version_id, from_node_key);

create table if not exists candidates (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  full_name text,
  phone_e164 text,
  email citext,
  telegram_id text,
  city text,
  source_first_touch text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_candidates_tenant_created on candidates(tenant_id, created_at);
create unique index if not exists ux_candidates_tenant_phone on candidates(tenant_id, phone_e164) where phone_e164 is not null;
create unique index if not exists ux_candidates_tenant_email on candidates(tenant_id, email) where email is not null;
create unique index if not exists ux_candidates_tenant_telegram on candidates(tenant_id, telegram_id) where telegram_id is not null;

create table if not exists applications (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  candidate_id uuid not null references candidates(id),
  job_id uuid not null references jobs(id),
  flow_version_id uuid not null references flow_versions(id),
  status text not null,
  stage text not null,
  score_total numeric not null default 0,
  score_breakdown jsonb not null default '{}'::jsonb,
  utm jsonb not null default '{}'::jsonb,
  referrer text,
  submitted_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_applications_tenant_job_status on applications(tenant_id, job_id, status);
create index if not exists idx_applications_tenant_candidate on applications(tenant_id, candidate_id);
create unique index if not exists ux_applications_candidate_job_submitted
  on applications(candidate_id, job_id)
  where submitted_at is not null;

create table if not exists application_answers (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  application_id uuid not null references applications(id),
  node_key text not null,
  question_id uuid,
  question_text_snapshot text not null,
  answer jsonb not null,
  score numeric not null default 0,
  answered_at timestamptz not null
);

create index if not exists idx_application_answers_app_node on application_answers(application_id, node_key);

create table if not exists flow_magic_links (
  token text primary key,
  application_id uuid not null references applications(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null
);

create index if not exists idx_flow_magic_links_application on flow_magic_links(application_id);
create index if not exists idx_flow_magic_links_expires_at on flow_magic_links(expires_at);

create table if not exists webhook_outbox (
  id uuid primary key,
  event_type text not null,
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts int not null default 0,
  next_attempt_at timestamptz not null,
  last_error text null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_webhook_outbox_status_next_attempt on webhook_outbox(status, next_attempt_at);
create index if not exists idx_webhook_outbox_event_type on webhook_outbox(event_type);

create table if not exists files (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  application_id uuid not null references applications(id),
  candidate_id uuid references candidates(id),
  file_type text not null,
  storage_provider text not null,
  storage_path text not null,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  uploaded_at timestamptz not null
);

create index if not exists idx_files_tenant_application on files(tenant_id, application_id);

create table if not exists messages (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  application_id uuid references applications(id),
  candidate_id uuid references candidates(id),
  channel text not null,
  template_id uuid,
  to_address text not null,
  status text not null,
  provider_response jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null
);

create index if not exists idx_messages_tenant_status_created on messages(tenant_id, status, created_at);

create table if not exists events (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  actor_type text not null,
  actor_id text not null,
  entity_type text not null,
  entity_id text not null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create index if not exists idx_events_tenant_type_created on events(tenant_id, event_type, created_at);
