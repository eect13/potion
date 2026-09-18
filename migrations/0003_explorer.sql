alter table potion_nodes add column if not exists synced boolean not null default true;

create table if not exists potion_shares (
  token      text primary key,
  user_id    text not null,
  node_id    text not null,
  created_at timestamptz not null default now()
);
create index if not exists potion_shares_user_idx on potion_shares (user_id, node_id);
