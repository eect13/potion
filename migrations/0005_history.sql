create table if not exists potion_comments (
  id          text primary key,
  user_id     text not null,
  node_id     text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists potion_comments_node_idx on potion_comments (user_id, node_id, created_at);

create table if not exists potion_versions (
  id          text primary key,
  user_id     text not null,
  node_id     text not null,
  version     integer not null,
  size        integer not null default 0,
  hash        text,
  mime        text,
  created_at  timestamptz not null default now()
);
create index if not exists potion_versions_node_idx on potion_versions (user_id, node_id, version desc);
