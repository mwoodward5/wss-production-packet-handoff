
-- Restrict SECURITY DEFINER function execution
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_first_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

-- Storage: booking-references — anyone can upload; only admins can read
CREATE POLICY "anon can upload booking refs" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'booking-references');
CREATE POLICY "admins read booking refs" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'booking-references' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins delete booking refs" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'booking-references' AND public.has_role(auth.uid(),'admin'));
