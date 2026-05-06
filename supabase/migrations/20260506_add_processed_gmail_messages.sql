create table if not exists processed_gmail_messages (
  message_id  text        primary key,
  processed_at timestamptz not null default now()
);
