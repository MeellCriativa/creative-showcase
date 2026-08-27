alter table meta_catalog_connections
  add column if not exists phone_number text;

comment on column meta_catalog_connections.phone_number is 'Normalized WhatsApp Business phone number (e.g. +5551999999999)';
