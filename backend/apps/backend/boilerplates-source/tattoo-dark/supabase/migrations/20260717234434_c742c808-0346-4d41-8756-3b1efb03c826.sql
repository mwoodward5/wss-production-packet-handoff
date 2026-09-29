
-- 1. has_role → SECURITY INVOKER (users can SELECT their own user_roles row per RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- 2. Drop claim_first_admin; logic moved to a service-role server function
DROP FUNCTION IF EXISTS public.claim_first_admin();

-- 3. Storage: replace unrestricted anon upload policy with a path-scoped one
DROP POLICY IF EXISTS "anon can upload booking refs" ON storage.objects;
CREATE POLICY "anon can upload booking refs"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'booking-references'
  AND (storage.foldername(name))[1] = 'req'
  AND name ~ '^req/[A-Za-z0-9._\-]{1,200}$'
  AND octet_length(name) < 256
);

-- 4. Tighten public INSERT policies (replace WITH CHECK (true) with basic content limits)
DROP POLICY IF EXISTS "anyone can submit booking" ON public.booking_requests;
CREATE POLICY "anyone can submit booking"
ON public.booking_requests
FOR INSERT
TO anon, authenticated
WITH CHECK (
  char_length(full_name)   BETWEEN 1 AND 200
  AND char_length(email)   BETWEEN 5 AND 320
  AND char_length(phone)   BETWEEN 5 AND 40
  AND char_length(description) BETWEEN 1 AND 5000
  AND (health_notes IS NULL OR char_length(health_notes) <= 4000)
  AND (admin_notes IS NULL)
  AND status = 'new'::booking_status
  AND (lead_score IS NULL OR lead_score IN ('high','warm','standard'))
);

DROP POLICY IF EXISTS "waitlist_public_insert" ON public.waitlist_subscribers;
CREATE POLICY "waitlist_public_insert"
ON public.waitlist_subscribers
FOR INSERT
TO anon, authenticated
WITH CHECK (
  char_length(email) BETWEEN 5 AND 320
  AND (phone IS NULL OR char_length(phone) <= 40)
  AND (style_preference IS NULL OR char_length(style_preference) <= 120)
  AND (size_preference  IS NULL OR char_length(size_preference)  <= 120)
  AND (notes IS NULL OR char_length(notes) <= 2000)
);

DROP POLICY IF EXISTS "flash_public_insert" ON public.flash_drop_subscribers;
CREATE POLICY "flash_public_insert"
ON public.flash_drop_subscribers
FOR INSERT
TO anon, authenticated
WITH CHECK (
  char_length(email) BETWEEN 5 AND 320
  AND (source IS NULL OR char_length(source) <= 60)
);

DROP POLICY IF EXISTS "email_captures_public_insert" ON public.email_captures;
CREATE POLICY "email_captures_public_insert"
ON public.email_captures
FOR INSERT
TO anon, authenticated
WITH CHECK (
  char_length(email)  BETWEEN 5 AND 320
  AND char_length(source) BETWEEN 1 AND 60
  AND (utm_source   IS NULL OR char_length(utm_source)   <= 120)
  AND (utm_medium   IS NULL OR char_length(utm_medium)   <= 120)
  AND (utm_campaign IS NULL OR char_length(utm_campaign) <= 200)
);
