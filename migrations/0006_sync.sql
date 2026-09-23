alter table potion_comments add column if not exists author text;

create table if not exists potion_sync_base (
  user_id   text not null,
  path      text not null,
  hash      text,
  conflict  text,
  primary key (user_id, path)
);
