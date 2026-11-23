-- ============================================================================
-- QR Code Pix — corrigir policies do bucket catalog-images
-- ============================================================================
-- Problema: o upload do QR usa `pix-qr/<catalog_id>/arquivo.png`, mas as
-- policies atuais exigem que a PRIMEIRA pasta seja o auth.uid(). Com isso o
-- INSERT é negado por RLS e nenhuma loja consegue cadastrar o QR Code.
--
-- Solução: manter as imagens de produto públicas como hoje, tratar o prefixo
-- `pix-qr/` à parte e permitir INSERT/UPDATE/DELETE apenas ao dono do catálogo.
-- A Edge Function pix-manual usa service_role (bypassa RLS) e continua gerando
-- a URL assinada de 1 hora exibida no checkout.
--
-- Executar este bloco nos dois projetos (homologação e produção).
-- ============================================================================

-- 1) Leitura pública continua valendo para todo o bucket, EXCETO pix-qr/.
drop policy if exists catalog_images_public_read on storage.objects;
create policy catalog_images_public_read
  on storage.objects for select
  using (
    bucket_id = 'catalog-images'
    and coalesce((storage.foldername(name))[1], '') <> 'pix-qr'
  );

-- 2) QR Code: somente o dono da loja pode ler pelo Supabase do cliente.
--    (O comprador nunca acessa o Storage diretamente: recebe URL assinada
--     gerada no servidor pela Edge Function pix-manual.)
drop policy if exists catalog_images_pix_qr_owner_read on storage.objects;
create policy catalog_images_pix_qr_owner_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'catalog-images'
    and (storage.foldername(name))[1] = 'pix-qr'
    and exists (
      select 1 from public.catalogs c
      where c.id::text = (storage.foldername(name))[2]
        and c.user_id = auth.uid()
    )
  );

-- 3) INSERT: pasta do usuário (imagens normais) OU pix-qr do próprio catálogo.
drop policy if exists catalog_images_auth_insert on storage.objects;
create policy catalog_images_auth_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'catalog-images'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (
        (storage.foldername(name))[1] = 'pix-qr'
        and exists (
          select 1 from public.catalogs c
          where c.id::text = (storage.foldername(name))[2]
            and c.user_id = auth.uid()
        )
      )
    )
  );

-- 4) UPDATE: mesmas regras do INSERT.
drop policy if exists catalog_images_auth_update on storage.objects;
create policy catalog_images_auth_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'catalog-images'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (
        (storage.foldername(name))[1] = 'pix-qr'
        and exists (
          select 1 from public.catalogs c
          where c.id::text = (storage.foldername(name))[2]
            and c.user_id = auth.uid()
        )
      )
    )
  )
  with check (
    bucket_id = 'catalog-images'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (
        (storage.foldername(name))[1] = 'pix-qr'
        and exists (
          select 1 from public.catalogs c
          where c.id::text = (storage.foldername(name))[2]
            and c.user_id = auth.uid()
        )
      )
    )
  );

-- 5) DELETE: mesmas regras, para substituir/remover o QR.
drop policy if exists catalog_images_auth_delete on storage.objects;
create policy catalog_images_auth_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'catalog-images'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (
        (storage.foldername(name))[1] = 'pix-qr'
        and exists (
          select 1 from public.catalogs c
          where c.id::text = (storage.foldername(name))[2]
            and c.user_id = auth.uid()
        )
      )
    )
  );

-- Verificação (deve listar as 6 policies acima):
-- select policyname, cmd, roles from pg_policies
-- where schemaname = 'storage' and tablename = 'objects'
--   and policyname like 'catalog_images_%' order by policyname;
