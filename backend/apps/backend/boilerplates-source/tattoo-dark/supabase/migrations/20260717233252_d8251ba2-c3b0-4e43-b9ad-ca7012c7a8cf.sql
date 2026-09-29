
-- Portfolio: add healed-image + slug for lightbox/permalinks
ALTER TABLE public.portfolio_items
  ADD COLUMN IF NOT EXISTS healed_image_url TEXT,
  ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;

-- Booking: UTM + consent + expanded health intake
ALTER TABLE public.booking_requests
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS referrer TEXT,
  ADD COLUMN IF NOT EXISTS landing_path TEXT,
  ADD COLUMN IF NOT EXISTS photo_release BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS health_flags JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS lead_score TEXT;

-- Waitlist for cancellation openings
CREATE TABLE IF NOT EXISTS public.waitlist_subscribers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  phone TEXT,
  style_preference TEXT,
  size_preference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT INSERT ON public.waitlist_subscribers TO anon, authenticated;
GRANT ALL ON public.waitlist_subscribers TO service_role;
ALTER TABLE public.waitlist_subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "waitlist_public_insert" ON public.waitlist_subscribers FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "waitlist_admin_read" ON public.waitlist_subscribers FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Flash drop early access
CREATE TABLE IF NOT EXISTS public.flash_drop_subscribers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT INSERT ON public.flash_drop_subscribers TO anon, authenticated;
GRANT ALL ON public.flash_drop_subscribers TO service_role;
ALTER TABLE public.flash_drop_subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "flash_public_insert" ON public.flash_drop_subscribers FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "flash_admin_read" ON public.flash_drop_subscribers FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- General email captures (exit-intent, PDF, quiz)
CREATE TABLE IF NOT EXISTS public.email_captures (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  source TEXT NOT NULL,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT INSERT ON public.email_captures TO anon, authenticated;
GRANT ALL ON public.email_captures TO service_role;
ALTER TABLE public.email_captures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_captures_public_insert" ON public.email_captures FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "email_captures_admin_read" ON public.email_captures FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
