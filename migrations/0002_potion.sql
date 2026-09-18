create table if not exists potion_nodes (
  id          text primary key,
  user_id     text not null,
  parent_id   text,
  name        text not null,
  kind        text not null,
  mime        text,
  size        integer not null default 0,
  version     integer not null default 1,
  content     text,
  origin      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists potion_nodes_user_parent_idx on potion_nodes (user_id, parent_id);
create index if not exists potion_nodes_user_updated_idx on potion_nodes (user_id, updated_at desc);

create table if not exists potion_devices (
  id          text primary key,
  user_id     text not null,
  name        text not null,
  kind        text not null,
  last_seen   timestamptz not null default now()
);
create index if not exists potion_devices_user_idx on potion_devices (user_id);

create table if not exists potion_restores (
  id           text primary key,
  user_id      text not null,
  node_id      text not null,
  file_name    text not null,
  device_kind  text not null,
  restored_at  timestamptz not null default now()
);
create index if not exists potion_restores_user_idx on potion_restores (user_id, restored_at desc);
